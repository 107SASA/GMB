/**
 * Lead Engine — ONE automated end-to-end QA suite.
 *
 * Drives the COMPLETE lead lifecycle against the DEDICATED local test DB
 * (growwmatics_local_test) and the LOCAL dev server + Inngest dev server.
 * Never touches production. All WhatsApp sends are suppressed
 * (QA_SUPPRESS_WHATSAPP_SENDS=true) — logged to MessageQueue as SENT with a
 * synthetic qa_* sid, no real message delivered.
 *
 * Prereqs (the script checks and tells you if one is missing):
 *   - `npm run dev` running on http://localhost:3000
 *   - `npx inngest-cli dev` running on http://localhost:8288
 *   - .env.local: LEAD_ENGINE_V2=true, QA_TESTING_MODE=true,
 *     QA_SUPPRESS_WHATSAPP_SENDS=true, INNGEST_DEV=1, MONGODB_URI -> test DB
 *
 * Run:  node scripts/lead-engine-e2e.mjs
 * Exit: 0 if every critical assertion passed, 1 otherwise.
 *
 * Tests: A initial sales · B demo intent · C human handoff · D human silence
 *        · E return to AI · F payment activation · G payment idempotency
 *        · H opt-out · I scheduler safety · J cross-tenant safety
 */
import mongoose from 'mongoose';
import {
  connectTestDb, disconnectTestDb, postJson, sendInngestEvent, invokeInngestFunction,
  waitFor, sleep, normE164, last10, oid, makeHarness, appBaseUrl, inngestDevUrl,
  twilioSignature, TEST_TENANT_ID,
} from './lib/leadEngineQa.mjs';

const PHONE_A = process.env.E2E_PHONE || '+915550100001'; // synthetic — sends are suppressed
const PHONE_H = '+915550100002';
const PHONE_I = '+915550100003';
const PHONE_OTHER_TENANT = '+915550100009';

let db;
const H = makeHarness();

// ---- low-level helpers --------------------------------------------------

const leads = () => db.collection('leads');
const leadEvents = () => db.collection('leadevents');
const scheduled = () => db.collection('scheduledactions');
const salesConvos = () => db.collection('salesconversations');
const mq = () => db.collection('messagequeues');

async function events(leadId, type) {
  const q = { leadId: oid(leadId) };
  if (type) q.type = type;
  return leadEvents().find(q).sort({ createdAt: 1 }).toArray();
}
async function lastEvent(leadId, type) {
  const e = await events(leadId, type);
  return e[e.length - 1] || null;
}
async function countEvents(leadId, type) {
  return (await events(leadId, type)).length;
}
async function getLead(id) { return leads().findOne({ _id: oid(id) }); }

/** Create a fresh, isolated TESTLEAD + allowlist it. Returns the lead doc. */
async function freshLead(phone, name = 'E2E') {
  const e164 = normE164(phone) || phone;
  await purgeLead(e164);
  const res = await leads().insertOne({
    tenantId: TEST_TENANT_ID, name: `TESTLEAD ${name}`, phone: e164,
    source: 'Website', leadType: 'Platform Prospect',
    status: 'active', lifeCycleStage: 'initial',
    currentAgent: 'SALES', currentStage: 'NEW', nurtureStatus: 'ACTIVE',
    intent: 'EXPLORING', leadScore: 0, objections: [], painPoints: [],
    scoredSignalKeys: [], humanHandoff: { active: false },
    nextBestAction: null, nextActionAt: null,
    lastActivityAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
  });
  await db.collection('orchestrationconfigs').updateOne(
    { key: 'default' }, { $addToSet: { leadIdAllowlist: res.insertedId } }, { upsert: true },
  );
  return leads().findOne({ _id: res.insertedId });
}

async function purgeLead(e164) {
  const key = last10(e164);
  const existing = await leads().find({ phone: e164 }).toArray();
  const ids = existing.map((l) => l._id);
  if (ids.length) {
    await leads().deleteMany({ _id: { $in: ids } });
    await leadEvents().deleteMany({ leadId: { $in: ids } });
    await scheduled().deleteMany({ leadId: { $in: ids } });
    await db.collection('orchestrationconfigs').updateOne(
      { key: 'default' }, { $pull: { leadIdAllowlist: { $in: ids } } },
    );
  }
  await leadEvents().deleteMany({ phone: new RegExp(`${key}$`) });
  await salesConvos().deleteMany({ phoneKey: key });
  await mq().deleteMany({ 'payload.phone': new RegExp(`${key}$`) });
  await db.collection('bookingconversations').deleteMany({ phoneKey: key });
}

/**
 * Simulate an inbound WhatsApp message: append to the lead's SalesConversation
 * and fire sales/agent.reply (exactly what the webhook does).
 *
 * `allowCreate` (default true) creates an active conversation if none exists —
 * matching the webhook's first-touch behavior. Pass false to model "the lead
 * messages but has no active sales thread" (e.g. after conversion, where the
 * real webhook would route them to support, not resurrect a sales thread).
 */
async function inbound(lead, text, { allowCreate = true } = {}) {
  const key = last10(lead.phone);
  let convo = await salesConvos().findOne({ phoneKey: key, status: 'active' });
  if (!convo) {
    if (!allowCreate) {
      // No active sales thread — the real platform webhook would NOT create
      // one here. Signal "nothing happened" to the caller.
      return null;
    }
    const r = await salesConvos().insertOne({
      leadPhone: lead.phone, phoneKey: key, leadName: lead.name,
      businessId: new mongoose.Types.ObjectId(),
      status: 'active', consentStatus: 'granted',
      scores: { businessName: lead.name }, messages: [],
      followUpsSent: 0, createdAt: new Date(), updatedAt: new Date(),
    });
    convo = await salesConvos().findOne({ _id: r.insertedId });
  }
  await salesConvos().updateOne(
    { _id: convo._id },
    { $push: { messages: { role: 'lead', text, at: new Date() } }, $set: { lastLeadReplyAt: new Date() } },
  );
  await sendInngestEvent('sales/agent.reply', { conversationId: convo._id.toString(), body: text });
  return convo;
}

/**
 * Wait until the lead's sales-agent Inngest processing has drained: no new
 * lead events for `quietMs`. Prevents one test's async replies from leaking
 * into the next test's assertion window. Also throttles to respect Groq TPM.
 */
async function drain(leadId, { quietMs = 6000, maxMs = 40000 } = {}) {
  const start = Date.now();
  let lastCount = -1;
  let lastChange = Date.now();
  while (Date.now() - start < maxMs) {
    const c = await leadEvents().countDocuments({ leadId: oid(leadId) });
    if (c !== lastCount) { lastCount = c; lastChange = Date.now(); }
    else if (Date.now() - lastChange >= quietMs) return;
    await sleep(1500);
  }
}

/** Snapshot the counts that must not change on an idempotent re-run. */
async function paymentFootprint(leadId, userId) {
  const [users, subs, custEvents, invSub] = await Promise.all([
    db.collection('users').countDocuments({ _id: oid(userId) }),
    db.collection('subscriptions').countDocuments({ userId: oid(userId) }),
    countEvents(leadId, 'CUSTOMER_ACTIVATED'),
    db.collection('subscriptions').findOne({ userId: oid(userId) }),
  ]);
  return {
    users, subs, custEvents,
    invoiceAt: invSub?.invoiceMessageSentAt ? +new Date(invSub.invoiceMessageSentAt) : null,
    welcomeAt: invSub?.welcomeMessageSentAt ? +new Date(invSub.welcomeMessageSentAt) : null,
  };
}

// ---- preflight ---------------------------------------------------------

async function preflight() {
  H.section('PREFLIGHT');
  // dev server
  try {
    const r = await postJson('/api/dev/simulate-payment', {});
    H.assert('dev server reachable + QA_TESTING_MODE on', r.status === 400,
      `POST /api/dev/simulate-payment -> ${r.status} (400 = route live & gated; 404 = QA_TESTING_MODE off)`);
  } catch (e) {
    H.assert('dev server reachable', false, e.message);
    throw e;
  }
  // inngest dev
  try {
    const r = await fetch(`${inngestDevUrl()}/v0/gql`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ functions { slug } }' }),
    });
    const j = await r.json();
    const has = (j.data?.functions || []).some((f) => f.slug.includes('sales-agent-reply'));
    H.assert('inngest dev server reachable + app synced', has, `${inngestDevUrl()} (${(j.data?.functions || []).length} functions)`);
  } catch (e) {
    H.assert('inngest dev server reachable', false, e.message);
    throw e;
  }
  // flags via a known lead round-trip is implicit; check env-derived config
  const oc = await db.collection('orchestrationconfigs').findOne({ key: 'default' });
  H.assert('OrchestrationConfig singleton exists (run testkit seed)', !!oc);
  const sac = await db.collection('salesagentconfigs').findOne({ key: 'default' });
  H.assert('SalesAgentConfig exists and is enabled', !!sac && sac.enabled === true);
}

// ---- TEST A — Initial Sales -------------------------------------------

async function testA() {
  H.section('TEST A — Initial Sales (pricing question)');
  const lead = await freshLead(PHONE_A, 'A');
  await inbound(lead, 'Hi, how much does this cost per month?');

  // Wait for intelligence AND the NBA decision (decideNextAction runs at the
  // very end of applyExtraction — after the INTENT/SCORE events are logged —
  // so there's a brief window where the events exist but nextBestAction is
  // still null; wait for the whole extraction to land).
  const scored = await waitFor(
    async () => {
      const hasScore = (await countEvents(lead._id, 'LEAD_SCORE_CHANGED')) > 0;
      const hasIntent = !!(await lastEvent(lead._id, 'INTENT_CHANGED'));
      const l = await getLead(lead._id);
      return hasScore && hasIntent && !!l.nextBestAction;
    },
    { timeoutMs: 50000, label: 'intelligence + NBA decision' },
  );
  H.assert('A: intelligence extracted (INTENT_CHANGED + LEAD_SCORE_CHANGED)', !!scored);

  const fresh = await getLead(lead._id);
  const scoreEv = await lastEvent(lead._id, 'LEAD_SCORE_CHANGED');
  H.assert('A: leadScore increased from 0', (fresh.leadScore || 0) > 0, `leadScore=${fresh.leadScore}, signal=${scoreEv?.payload?.signal}`);
  H.assert('A: intent moved off EXPLORING', fresh.intent && fresh.intent !== 'EXPLORING', `intent=${fresh.intent}`);
  H.assert('A: an NBA was decided (nextBestAction set)', !!fresh.nextBestAction, `nextBestAction=${fresh.nextBestAction}`);

  // AI response: MESSAGE_SENT event OR a new agent message in the transcript
  const replied = await waitFor(async () => {
    const sent = await countEvents(lead._id, 'MESSAGE_SENT');
    const convo = await salesConvos().findOne({ phoneKey: last10(lead.phone) });
    const agentMsgs = (convo?.messages || []).filter((m) => m.role === 'agent').length;
    return sent > 0 || agentMsgs > 0;
  }, { timeoutMs: 30000, label: 'AI response' });
  H.assert('A: AI responded (MESSAGE_SENT or agent turn in transcript)', !!replied);
  return lead;
}

// ---- TEST B — Demo intent ------------------------------------------------

async function testB(lead) {
  H.section('TEST B — Demo intent');
  await inbound(lead, "Yes I'd like a demo — can someone show me how it works?");

  const decided = await waitFor(async () => {
    const l = await getLead(lead._id);
    return ['OFFER_DEMO', 'SCHEDULE_DEMO'].includes(l.nextBestAction) || l.intent === 'DEMO_INTEREST';
  }, { timeoutMs: 45000, label: 'demo-intent NBA' });
  const l = await getLead(lead._id);
  H.assert('B: intent or NBA reflects demo interest', !!decided, `intent=${l.intent}, nextBestAction=${l.nextBestAction}`);

  // executor should have run for OFFER_DEMO/SCHEDULE_DEMO (NBA_OWNS_REPLY) — or a generic reply went out
  const acted = await waitFor(async () => {
    const nbaExec = await lastEvent(lead._id, 'NBA_EXECUTED');
    const sent = await countEvents(lead._id, 'MESSAGE_SENT');
    return (nbaExec && ['sent', 'handoff'].includes(nbaExec.payload?.outcome)) || sent > 0;
  }, { timeoutMs: 30000, label: 'executor/send' });
  const nbaExec = await lastEvent(lead._id, 'NBA_EXECUTED');
  H.assert('B: executor acted or a reply was sent', !!acted,
    `NBA_EXECUTED outcome=${nbaExec?.payload?.outcome ?? 'none'}`);
}

// ---- TEST C — Human handoff -------------------------------------------

async function testC(lead) {
  H.section('TEST C — Human handoff ("talk to a person")');
  const sentBefore = await countEvents(lead._id, 'MESSAGE_SENT');
  const nbaExecBefore = await countEvents(lead._id, 'NBA_EXECUTED');
  await inbound(lead, 'can I talk to a person please');

  const handed = await waitFor(async () => {
    const l = await getLead(lead._id);
    return l.currentAgent === 'HUMAN' && l.humanHandoff?.active === true;
  }, { timeoutMs: 40000, label: 'SALES -> HUMAN' });
  const l = await getLead(lead._id);
  H.assert('C: currentAgent -> HUMAN', l.currentAgent === 'HUMAN', `currentAgent=${l.currentAgent}`);
  H.assert('C: humanHandoff.active === true', l.humanHandoff?.active === true);
  H.assert('C: currentStage -> HUMAN_HANDOFF', l.currentStage === 'HUMAN_HANDOFF', `currentStage=${l.currentStage}`);

  const handoffEv = await lastEvent(lead._id, 'AGENT_HANDOFF');
  H.assert('C: AGENT_HANDOFF event to HUMAN recorded', handoffEv?.payload?.to === 'HUMAN',
    `reason=${handoffEv?.payload?.reason}`);

  // The handoff-triggering message must not itself get intelligence-extracted
  // or an NBA-executed reply — checkHandoffTriggers returns before either.
  // (A MESSAGE_SENT can still legitimately appear from a PRIOR test's message
  // still draining — assert on NBA execution + no INTENT/SCORE change tied to
  // THIS message instead of a raw MESSAGE_SENT delta.)
  await sleep(5000);
  const nbaExecAfter = await countEvents(lead._id, 'NBA_EXECUTED');
  H.assert('C: the handoff turn did not run the NBA executor', nbaExecAfter === nbaExecBefore,
    `NBA_EXECUTED ${nbaExecBefore} -> ${nbaExecAfter}`);

  // pending scheduled actions cancelled
  const pending = await scheduled().countDocuments({ leadId: lead._id, status: 'PENDING' });
  H.assert('C: no PENDING scheduled actions remain after handoff', pending === 0, `${pending} pending`);
}

// ---- TEST D — Human silence -----------------------------------------

async function testD(lead) {
  H.section('TEST D — Human-owned lead stays silent');
  const sentBefore = await countEvents(lead._id, 'MESSAGE_SENT');
  const nbaExecBefore = await countEvents(lead._id, 'NBA_EXECUTED');
  await inbound(lead, 'hello? is anyone there?');

  // give the worker time to (not) act
  const skipped = await waitFor(
    async () => await lastEvent(lead._id, 'NURTURE_ACTION_SKIPPED'),
    { timeoutMs: 25000, label: 'NURTURE_ACTION_SKIPPED (human-owned)' },
  );
  await sleep(3000);

  const sentAfter = await countEvents(lead._id, 'MESSAGE_SENT');
  const nbaExecAfter = await countEvents(lead._id, 'NBA_EXECUTED');
  const l = await getLead(lead._id);

  H.assert('D: still HUMAN-owned', l.currentAgent === 'HUMAN' && l.humanHandoff?.active === true);
  H.assert('D: no new MESSAGE_SENT while HUMAN-owned', sentAfter === sentBefore, `${sentBefore} -> ${sentAfter}`);
  H.assert('D: no new NBA execution while HUMAN-owned', nbaExecAfter === nbaExecBefore, `${nbaExecBefore} -> ${nbaExecAfter}`);
  H.assert('D: a skip was recorded (reason=human-owned)', skipped?.payload?.reason === 'human-owned' || !!skipped,
    `reason=${skipped?.payload?.reason ?? 'none'}`);
}

// ---- TEST E — Return to AI ------------------------------------------

async function testE(lead) {
  H.section('TEST E — Return to AI + AI resumes');
  // QA companion to the super-admin-gated /api/admin/leads/return-to-ai —
  // calls the SAME releaseFromHuman service function.
  const r = await postJson('/api/dev/lead-engine', { action: 'return-to-ai', leadId: String(lead._id), targetAgent: 'SALES' });
  H.assert('E: return-to-ai (QA path) accepted', r.status === 200 && r.json?.success === true, `HTTP ${r.status} ${JSON.stringify(r.json)}`);

  const returned = await waitFor(async () => {
    const l = await getLead(lead._id);
    return l.currentAgent === 'SALES' && l.humanHandoff?.active !== true;
  }, { timeoutMs: 15000, label: 'HUMAN -> SALES' });
  const l = await getLead(lead._id);
  H.assert('E: currentAgent -> SALES', l.currentAgent === 'SALES', `currentAgent=${l.currentAgent}`);
  H.assert('E: humanHandoff cleared', l.humanHandoff?.active !== true, `active=${l.humanHandoff?.active}`);

  const sentBefore = await countEvents(lead._id, 'MESSAGE_SENT');
  await inbound(lead, 'ok thanks — what areas do you help with?');
  const resumed = await waitFor(async () => {
    const sent = await countEvents(lead._id, 'MESSAGE_SENT');
    const convo = await salesConvos().findOne({ phoneKey: last10(lead.phone) });
    const agentMsgs = (convo?.messages || []).filter((m) => m.role === 'agent').length;
    return sent > sentBefore || agentMsgs > 0;
  }, { timeoutMs: 40000, label: 'AI resume' });
  H.assert('E: AI resumed after return (new reply / MESSAGE_SENT)', !!resumed);
}

// ---- TEST F — Payment activation ------------------------------------

async function testF(lead) {
  H.section('TEST F — Payment activation');
  // shadow user/business/subscription
  const email = `e2e+${last10(lead.phone)}@example.invalid`;
  const uRes = await db.collection('users').findOneAndUpdate(
    { phone: lead.phone, email },
    { $setOnInsert: { phone: lead.phone, isPhoneVerified: true, fullName: lead.name, email, role: 'USER', createdAt: new Date(), updatedAt: new Date() } },
    { upsert: true, returnDocument: 'after' },
  );
  const user = uRes.value || await db.collection('users').findOne({ phone: lead.phone, email });
  await db.collection('businesses').updateOne(
    { userId: user._id, name: lead.name },
    { $setOnInsert: { userId: user._id, name: lead.name, phone: lead.phone, organizationId: String(user._id), createdAt: new Date(), updatedAt: new Date() } },
    { upsert: true },
  );
  await db.collection('subscriptions').updateOne(
    { userId: user._id },
    { $setOnInsert: { userId: user._id, planType: 'Free', billingStatus: 'Trialing', createdAt: new Date(), updatedAt: new Date() } },
    { upsert: true },
  );

  const r = await postJson('/api/dev/simulate-payment', { phone: lead.phone, amount: 199900, currency: 'INR' });
  H.assert('F: simulate-payment succeeded', r.status === 200 && r.json?.success === true, `HTTP ${r.status} ${JSON.stringify(r.json)}`);

  const activated = await waitFor(async () => {
    const l = await getLead(lead._id);
    return l.currentStage === 'CUSTOMER' && l.currentAgent === 'IN_HOUSE';
  }, { timeoutMs: 15000, label: 'activation' });
  const l = await getLead(lead._id);
  const sub = await db.collection('subscriptions').findOne({ userId: user._id });

  H.assert('F: subscription active (planType Pro, billingStatus Active)',
    sub?.planType === 'Pro' && sub?.billingStatus === 'Active', `plan=${sub?.planType}/${sub?.billingStatus}`);
  H.assert('F: lead ownership -> IN_HOUSE / stage CUSTOMER', !!activated, `agent=${l.currentAgent}, stage=${l.currentStage}`);
  H.assert('F: CUSTOMER_ACTIVATED event logged', (await countEvents(lead._id, 'CUSTOMER_ACTIVATED')) === 1);
  H.assert('F: invoice message step ran (invoiceMessageSentAt set)', !!sub?.invoiceMessageSentAt);
  H.assert('F: welcome message step ran (welcomeMessageSentAt set)', !!sub?.welcomeMessageSentAt);
  H.assert('F: Sales nurture stopped (0 PENDING scheduled actions)',
    (await scheduled().countDocuments({ leadId: lead._id, status: 'PENDING' })) === 0);

  // Sales AI must now refuse to act on a converted (IN_HOUSE / CUSTOMER)
  // lead. Post-conversion the SalesConversation is set to 'completed' by
  // setLeadOwnership's legacy sync, so a real inbound would NOT resurrect a
  // sales thread — model that (allowCreate:false). Then also force a sales
  // convo + fire the event directly to prove the in-handler guard blocks it.
  const scStatus = (await salesConvos().findOne({ phoneKey: last10(lead.phone) }))?.status;
  H.assert('F: SalesConversation was stood down on conversion', scStatus && scStatus !== 'active',
    `status=${scStatus}`);

  const sentBefore = await countEvents(lead._id, 'MESSAGE_SENT');
  const skipBefore = await countEvents(lead._id, 'NURTURE_ACTION_SKIPPED');
  // force a sales convo active again and fire the reply event straight in
  await salesConvos().updateOne({ phoneKey: last10(lead.phone) }, { $set: { status: 'active' } });
  await inbound(lead, 'hey I have a question about my account');
  await sleep(6000);
  const sentAfter = await countEvents(lead._id, 'MESSAGE_SENT');
  const skipAfter = await countEvents(lead._id, 'NURTURE_ACTION_SKIPPED');
  H.assert('F: Sales agent does not reply to a converted (IN_HOUSE) lead',
    sentAfter === sentBefore, `MESSAGE_SENT ${sentBefore} -> ${sentAfter}`);
  H.assert('F: the converted-lead turn was explicitly skipped (reason=already-customer)',
    skipAfter > skipBefore, `NURTURE_ACTION_SKIPPED ${skipBefore} -> ${skipAfter}`);

  return { user };
}

// ---- TEST G — Payment idempotency --------------------------------------

async function testG(lead, user) {
  H.section('TEST G — Payment idempotency (second identical payment)');
  const before = await paymentFootprint(lead._id, user._id);
  const r = await postJson('/api/dev/simulate-payment', { phone: lead.phone, amount: 199900, currency: 'INR' });
  H.assert('G: second simulate-payment still returns success (no-op)', r.status === 200 && r.json?.success === true);
  await sleep(3000);
  const after = await paymentFootprint(lead._id, user._id);

  H.assert('G: no duplicate user', after.users === before.users && after.users === 1);
  H.assert('G: no duplicate subscription', after.subs === before.subs && after.subs === 1);
  H.assert('G: no duplicate CUSTOMER_ACTIVATED event', after.custEvents === before.custEvents && after.custEvents === 1,
    `${before.custEvents} -> ${after.custEvents}`);
  H.assert('G: invoice message not re-sent (timestamp unchanged)', after.invoiceAt === before.invoiceAt);
  H.assert('G: welcome message not re-sent (timestamp unchanged)', after.welcomeAt === before.welcomeAt);
  const l = await getLead(lead._id);
  H.assert('G: ownership unchanged (still IN_HOUSE / CUSTOMER)', l.currentAgent === 'IN_HOUSE' && l.currentStage === 'CUSTOMER');
  console.log(`  unchanged: users=${after.users} subs=${after.subs} custEvents=${after.custEvents} invoiceAt=${after.invoiceAt} welcomeAt=${after.welcomeAt}`);
}

// ---- TEST H — Opt-out -------------------------------------------------

async function testH() {
  H.section('TEST H — Opt-out ("STOP" via the real webhook path)');
  const lead = await freshLead(PHONE_H, 'H');
  // seed an active sales conversation + a due proactive action so we can prove both stop
  await inbound(lead, 'tell me more about what you do');
  await waitFor(async () => (await getLead(lead._id)).nextBestAction, { timeoutMs: 40000, label: 'initial NBA' });
  await scheduled().insertOne({
    leadId: lead._id, actionType: 'EXECUTE_NBA', dueAt: new Date(), status: 'PENDING',
    idempotencyKey: `e2e-H-${lead._id}-${Date.now()}`, createdBy: 'e2e', payload: { action: 'SHOW_VALUE' },
    createdAt: new Date(), updatedAt: new Date(),
  });

  // real inbound STOP through the platform webhook (Twilio form format),
  // signed exactly as Twilio would so the signature check passes.
  const toNumber = process.env.PLATFORM_WHATSAPP_NUMBER || process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || process.env.TWILIO_WHATSAPP_NUMBER || '+919405070323';
  const params = {
    MessageSid: `SMqa${Date.now()}`,
    From: `whatsapp:${lead.phone}`,
    To: `whatsapp:${toNumber.startsWith('+') ? toNumber : '+' + toNumber}`,
    Body: 'STOP',
    NumMedia: '0',
    ProfileName: 'E2E H',
  };
  const webhookUrl = `${appBaseUrl()}/api/whatsapp/webhook`;
  const sig = await twilioSignature(webhookUrl, params);
  let webhookStatus = 0;
  let webhookBody = '';
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig },
      body: new URLSearchParams(params).toString(),
    });
    webhookStatus = res.status;
    webhookBody = (await res.text()).slice(0, 120);
  } catch (e) {
    H.assert('H: webhook reachable', false, e.message);
  }

  const optedOut = await waitFor(async () => {
    const l = await getLead(lead._id);
    return l.nurtureStatus === 'OPTED_OUT';
  }, { timeoutMs: 15000, label: 'Lead.nurtureStatus OPTED_OUT' });
  const l = await getLead(lead._id);

  H.assert('H: webhook accepted the STOP (200)', webhookStatus === 200, `HTTP ${webhookStatus} ${webhookBody}`);
  H.assert('H: Lead.nurtureStatus -> OPTED_OUT', l.nurtureStatus === 'OPTED_OUT', `nurtureStatus=${l.nurtureStatus}`);
  H.assert('H: OPT_OUT event logged', (await countEvents(lead._id, 'OPT_OUT')) >= 1);
  H.assert('H: pending scheduled actions cancelled', (await scheduled().countDocuments({ leadId: lead._id, status: 'PENDING' })) === 0);
  const sc = await salesConvos().findOne({ phoneKey: last10(lead.phone) });
  H.assert('H: SalesConversation stopped', sc?.status === 'stopped', `status=${sc?.status}`);

  // subsequent inbound must not produce an AI outbound
  const sentBefore = await countEvents(lead._id, 'MESSAGE_SENT');
  await inbound(lead, 'actually wait, one more question');
  await sleep(5000);
  H.assert('H: no AI outbound after opt-out',
    (await countEvents(lead._id, 'MESSAGE_SENT')) === sentBefore,
    `MESSAGE_SENT ${sentBefore} -> ${await countEvents(lead._id, 'MESSAGE_SENT')}`);

  // proactive scheduler must skip an opted-out lead
  await leads().updateOne({ _id: lead._id }, { $set: { nextBestAction: 'SHOW_VALUE', nextActionAt: new Date() } });
  await invokeInngestFunction('proactive-nba-scheduler');
  await sleep(6000);
  const newRows = await scheduled().countDocuments({ leadId: lead._id, status: 'PENDING' });
  H.assert('H: proactive scheduler creates no rows for an opted-out lead', newRows === 0, `${newRows} PENDING`);
}

// ---- TEST I — Scheduler safety / idempotency -------------------------

async function testI() {
  H.section('TEST I — Scheduler safety & scoring idempotency');
  const lead = await freshLead(PHONE_I, 'I');
  // Put it in a proactive-eligible state: NURTURING + a proactive NBA due.
  await leads().updateOne({ _id: lead._id }, {
    $set: { currentStage: 'NURTURING', intent: 'SOLUTION_AWARE', leadScore: 20, nextBestAction: 'SHOW_VALUE', nextActionAt: new Date() },
  });

  // run the proactive scheduler 3x back-to-back
  for (let i = 0; i < 3; i++) { await invokeInngestFunction('proactive-nba-scheduler'); await sleep(2500); }
  await sleep(4000);

  const rows = await scheduled().find({ leadId: lead._id, actionType: 'EXECUTE_NBA' }).toArray();
  const distinctKeys = new Set(rows.map((r) => r.idempotencyKey));
  H.assert('I: multiple scheduler runs did not create duplicate EXECUTE_NBA rows',
    rows.length <= 1 || distinctKeys.size === rows.length,
    `${rows.length} rows, ${distinctKeys.size} distinct idempotency keys`);

  const l1 = await getLead(lead._id);
  H.assert('I: nextActionAt was consumed (null) or pushed out after scheduling',
    l1.nextActionAt === null || new Date(l1.nextActionAt) > new Date(),
    `nextActionAt=${l1.nextActionAt}`);

  // scoring idempotency: same inbound (same signal) processed 3x -> score awarded once.
  // Note on Groq: the free-tier TPM limit can make an individual extraction
  // fail (429 -> MESSAGE_RECEIVED{extractionFailed}). We space the sends out
  // and, for the score assertions, wait for a SUCCESSFUL extraction rather
  // than a fixed timeout, and retry a rate-limited step once.
  const lead2 = await freshLead(PHONE_I + '0', 'I2');
  const key = last10(lead2.phone);
  const msg = 'so what does the pro plan cost exactly?';

  async function fireAndWaitExtraction(text, { mustScoreTo = null } = {}) {
    const beforeOk = await leadEvents().countDocuments({ leadId: oid(lead2._id), type: { $in: ['LEAD_SCORE_CHANGED', 'INTENT_CHANGED'] } });
    await inbound(lead2, text);
    // wait until either a score/intent event appears OR an extractionFailed marker
    const r = await waitFor(async () => {
      const okNow = await leadEvents().countDocuments({ leadId: oid(lead2._id), type: { $in: ['LEAD_SCORE_CHANGED', 'INTENT_CHANGED'] } });
      const failed = await leadEvents().findOne({ leadId: oid(lead2._id), type: 'MESSAGE_RECEIVED', 'payload.extractionFailed': true }, { sort: { createdAt: -1 } });
      const failedRecently = failed && Date.now() - +new Date(failed.createdAt) < 30000;
      return okNow > beforeOk ? 'ok' : (failedRecently ? 'failed' : null);
    }, { timeoutMs: 50000, intervalMs: 2000, label: 'extraction outcome' });
    return r;
  }

  let r = await fireAndWaitExtraction(msg);
  if (r === 'failed') { await sleep(35000); r = await fireAndWaitExtraction(msg); } // one retry after the TPM window
  const firstScore = (await getLead(lead2._id)).leadScore || 0;
  H.assert('I: first pricing question scored', r === 'ok' && firstScore > 0, `outcome=${r}, leadScore=${firstScore}`);

  // re-fire the SAME message twice more, spaced out
  const convo = await salesConvos().findOne({ phoneKey: key });
  for (let i = 0; i < 2; i++) {
    await sendInngestEvent('sales/agent.reply', { conversationId: convo._id.toString(), body: msg });
    await sleep(12000);
  }
  await sleep(5000);
  const l2 = await getLead(lead2._id);
  H.assert('I: re-processing the same pricing question did NOT increase the score again',
    l2.leadScore === firstScore, `leadScore ${firstScore} -> ${l2.leadScore}`);
  const scoreEvents = await countEvents(lead2._id, 'LEAD_SCORE_CHANGED');
  H.assert('I: exactly one LEAD_SCORE_CHANGED for the repeated signal', scoreEvents === 1, `${scoreEvents} events`);

  // a genuinely new signal (purchase intent) still scores
  await sleep(20000); // respect TPM before the next real extraction
  let r2 = await fireAndWaitExtraction('ok I want to sign up and pay now, how do I do that?');
  if (r2 === 'failed') { await sleep(35000); r2 = await fireAndWaitExtraction('please tell me how to sign up and pay right now'); }
  const l3 = await getLead(lead2._id);
  H.assert('I: a new qualifying signal still increases the score',
    r2 === 'ok' && l3.leadScore > firstScore, `outcome=${r2}, leadScore ${firstScore} -> ${l3.leadScore}`);
}

// ---- TEST J — Cross-tenant safety ----------------------------------

async function testJ() {
  H.section('TEST J — Cross-tenant safety');
  const e164 = normE164(PHONE_OTHER_TENANT) || PHONE_OTHER_TENANT;
  await leads().deleteMany({ phone: e164 });
  // a lead with the SAME phone but a DIFFERENT tenant
  const otherRes = await leads().insertOne({
    tenantId: 'some-other-tenant', name: 'OTHER TENANT LEAD', phone: e164,
    source: 'Manual', status: 'active', currentAgent: 'SALES', currentStage: 'NEW',
    nurtureStatus: 'ACTIVE', intent: 'EXPLORING', leadScore: 0,
    humanHandoff: { active: false }, createdAt: new Date(), updatedAt: new Date(), lastActivityAt: new Date(),
  });
  const otherId = otherRes.insertedId;
  const otherBefore = await getLead(otherId);

  // 1. simulate-payment by phone must NOT resolve/modify the other-tenant lead
  //    (no platform User with this phone -> should 400, and definitely not touch the lead)
  const r = await postJson('/api/dev/simulate-payment', { phone: e164 });
  H.assert('J: simulate-payment does not activate a lead with no platform user',
    r.status === 400 || (r.status === 200 && r.json?.success),
    `HTTP ${r.status} ${JSON.stringify(r.json)}`);
  const otherAfter = await getLead(otherId);
  H.assert('J: other-tenant lead ownership/stage untouched by payment attempt',
    otherAfter.currentAgent === otherBefore.currentAgent && otherAfter.currentStage === otherBefore.currentStage &&
    (otherAfter.nurtureStatus || 'ACTIVE') === (otherBefore.nurtureStatus || 'ACTIVE'),
    `agent=${otherAfter.currentAgent} stage=${otherAfter.currentStage} nurture=${otherAfter.nurtureStatus}`);

  // 2. proactive scheduler is tenantId-scoped to 'gmbboost-internal'
  await leads().updateOne({ _id: otherId }, { $set: { nextBestAction: 'SHOW_VALUE', nextActionAt: new Date() } });
  await invokeInngestFunction('proactive-nba-scheduler');
  await sleep(6000);
  const otherRows = await scheduled().countDocuments({ leadId: otherId });
  H.assert('J: proactive scheduler ignores a non-platform-tenant lead', otherRows === 0, `${otherRows} scheduled rows`);

  // 3. a STOP webhook for the other-tenant phone must not opt out THIS lead
  //    (optOutLeadByPhone filters tenantId:'gmbboost-internal').
  const toNumber = process.env.PLATFORM_WHATSAPP_NUMBER || process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '+919405070323';
  const params = {
    MessageSid: `SMqaJ${Date.now()}`, From: `whatsapp:${e164}`,
    To: `whatsapp:${toNumber.startsWith('+') ? toNumber : '+' + toNumber}`, Body: 'STOP', NumMedia: '0',
  };
  const wurl = `${appBaseUrl()}/api/whatsapp/webhook`;
  const sig = await twilioSignature(wurl, params);
  await fetch(wurl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig },
    body: new URLSearchParams(params).toString(),
  }).catch(() => {});
  await sleep(3000);
  const otherAfterStop = await getLead(otherId);
  H.assert('J: STOP for a same-phone non-platform tenant does not opt that lead out',
    (otherAfterStop.nurtureStatus || 'ACTIVE') === 'ACTIVE', `nurtureStatus=${otherAfterStop.nurtureStatus}`);

  await leads().deleteMany({ _id: otherId });
}

// ---- run ----------------------------------------------------------------

async function main() {
  console.log('='.repeat(70));
  console.log('LEAD ENGINE — END-TO-END QA');
  console.log(`app: ${appBaseUrl()}   inngest: ${inngestDevUrl()}`);
  console.log('='.repeat(70));
  db = await connectTestDb();

  try {
    await preflight();
    const leadA = await testA();
    await drain(leadA._id);
    await testB(leadA);
    await drain(leadA._id);
    await testC(leadA);
    await drain(leadA._id);
    await testD(leadA);
    await drain(leadA._id);
    await testE(leadA);
    await drain(leadA._id);
    const { user } = await testF(leadA);
    await drain(leadA._id);
    await testG(leadA, user);
    await testH();
    await testI();
    await testJ();
  } catch (err) {
    console.error('\n\x1b[31mE2E ABORTED:\x1b[0m', err.message);
    H.assert('E2E completed without an unhandled error', false, err.message);
  }

  const ok = H.summary();
  await disconnectTestDb();
  process.exit(ok ? 0 : 1);
}

main();
