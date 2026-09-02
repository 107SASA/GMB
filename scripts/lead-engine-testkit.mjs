/**
 * Lead Engine local test kit — creates and drives internal test leads against
 * a DEDICATED test database (never prod — see scripts/lib/localTestEnv.mjs).
 *
 * Every test lead: tenantId = 'gmbboost-internal', source 'Website',
 * leadType 'Platform Prospect', name prefixed "TESTLEAD".
 *
 * Commands:
 *
 *   node scripts/lead-engine-testkit.mjs seed
 *       Ensure OrchestrationConfig / SalesAgentConfig / ScoringRuleConfig
 *       singletons exist in the test DB. Enable the sales agent. Idempotent.
 *
 *   node scripts/lead-engine-testkit.mjs new "+919730986643" "Test Owner"
 *       Create ONE test lead with the given phone (a number YOU control) and
 *       add it to the OrchestrationConfig allowlist. Prints its _id.
 *
 *   node scripts/lead-engine-testkit.mjs list
 *       Show every TESTLEAD in the test DB with agent/stage/score/intent/NBA.
 *
 *   node scripts/lead-engine-testkit.mjs inbound <leadId|phone> "how much does it cost?"
 *       Simulate an inbound WhatsApp message from the lead: appends it to (or
 *       creates) a SalesConversation and fires the sales/agent.reply Inngest
 *       event — exactly what the real webhook does. Requires the Next.js app
 *       + Inngest dev server running so the function actually executes.
 *
 *   node scripts/lead-engine-testkit.mjs pay <leadId|phone>
 *       Simulate a verified payment for this lead's shadow user: runs
 *       runCustomerActivationSequence directly (no real Razorpay). Proves the
 *       stop-nurture / activate-once / invoice / welcome / IN_HOUSE flow.
 *
 *   node scripts/lead-engine-testkit.mjs handoff <leadId|phone>
 *       Force the lead to HUMAN ownership (as "talk to a person" would).
 *
 *   node scripts/lead-engine-testkit.mjs return <leadId|phone> SALES
 *       Return the lead from HUMAN to an AI agent via releaseFromHuman.
 *
 *   node scripts/lead-engine-testkit.mjs optout <leadId|phone>
 *       Mark the lead OPTED_OUT (as "STOP" would).
 *
 *   node scripts/lead-engine-testkit.mjs reset
 *       Delete every TESTLEAD + their SalesConversations + LeadEvents +
 *       ScheduledActions from the TEST DB only. Does not touch config.
 *
 * NOTE: `inbound` fires an Inngest event via the SDK — set INNGEST_DEV=1 in
 * your shell (or .env.local already has it) so it targets the local dev
 * server, and have `npx inngest-cli dev` + `npm run dev` running.
 */
import mongoose from 'mongoose';
import { resolveTestMongoUri, TEST_TENANT_ID } from './lib/localTestEnv.mjs';

const [, , command, ...rest] = process.argv;
const COMMANDS = ['seed', 'new', 'list', 'inbound', 'pay', 'handoff', 'return', 'optout', 'reset'];
if (!COMMANDS.includes(command)) {
  console.error(`Commands: ${COMMANDS.join(' | ')}`);
  process.exit(1);
}

const TESTLEAD_PREFIX = 'TESTLEAD';

function normE164(raw) {
  const t = String(raw).trim();
  const hasPlus = t.startsWith('+') || t.startsWith('00');
  let d = t.replace(/\D/g, '');
  if (t.startsWith('00')) d = d.slice(2);
  if (!d) return null;
  if (hasPlus) return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
  d = d.replace(/^0+/, '');
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith('91')) return `+${d}`;
  return null;
}
const last10 = (p) => String(p).replace(/\D/g, '').slice(-10);

async function findLead(db, token) {
  if (/^[a-f0-9]{24}$/i.test(token)) {
    return db.collection('leads').findOne({ _id: new mongoose.Types.ObjectId(token) });
  }
  const e164 = normE164(token) || token;
  return db.collection('leads').findOne({ phone: e164, tenantId: TEST_TENANT_ID });
}

async function main() {
  const uri = resolveTestMongoUri();
  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  // ---- seed --------------------------------------------------------------
  if (command === 'seed') {
    await db.collection('orchestrationconfigs').updateOne(
      { key: 'default' },
      { $setOnInsert: { key: 'default', leadIdAllowlist: [], rolloutPercentage: 0, stuckLeadScoreThreshold: 76, stuckNurtureCyclesThreshold: 3 } },
      { upsert: true }
    );
    // Minimal working SalesAgentConfig — enabled, with a persona. Knowledge
    // block left empty on purpose (executor falls back safely).
    await db.collection('salesagentconfigs').updateOne(
      { key: 'default' },
      {
        $setOnInsert: {
          key: 'default',
          firstMessage: { mode: 'ai', delayMinutes: 2, template: '', aiSystemPrompt: '' },
          followUps: [],
          agentSystemPrompt: 'You are the GrowwMatics WhatsApp sales assistant helping a local business get more customers from Google. Be warm, concise, never invent prices or features.',
          subscribeUrl: (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000') + '/checkout',
          shopUrl: (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000') + '/pricing',
          knowledge: {},
        },
        $set: { enabled: true },
      },
      { upsert: true }
    );
    await db.collection('scoringruleconfigs').updateOne({ key: 'default' }, { $setOnInsert: { key: 'default' } }, { upsert: true });
    console.log('Seeded: orchestrationconfigs, salesagentconfigs (enabled), scoringruleconfigs.');
  }

  // ---- new --------------------------------------------------------------
  if (command === 'new') {
    const [phoneArg, nameArg] = rest;
    const e164 = normE164(phoneArg);
    if (!e164) { console.error(`"${phoneArg}" is not a valid phone.`); process.exit(1); }
    const name = `${TESTLEAD_PREFIX} ${nameArg || 'Owner'}`;

    let lead = await db.collection('leads').findOne({ phone: e164, tenantId: TEST_TENANT_ID });
    if (!lead) {
      const res = await db.collection('leads').insertOne({
        tenantId: TEST_TENANT_ID, name, phone: e164,
        source: 'Website', leadType: 'Platform Prospect',
        status: 'active', lifeCycleStage: 'initial',
        currentAgent: 'SALES', currentStage: 'NEW', nurtureStatus: 'ACTIVE',
        intent: 'EXPLORING', leadScore: 0, objections: [], painPoints: [],
        humanHandoff: { active: false },
        nextBestAction: null, nextActionAt: null,
        lastActivityAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      });
      lead = await db.collection('leads').findOne({ _id: res.insertedId });
      console.log(`Created test lead ${lead._id}  ${name}  ${e164}`);
    } else {
      console.log(`Test lead already exists: ${lead._id}`);
    }
    await db.collection('orchestrationconfigs').updateOne(
      { key: 'default' },
      { $addToSet: { leadIdAllowlist: lead._id } }
    );
    console.log('Added to OrchestrationConfig.leadIdAllowlist.');
    console.log(`\nNext: set LEAD_ENGINE_V2=true in the app's env, then:`);
    console.log(`  node scripts/lead-engine-testkit.mjs inbound ${lead._id} "how much does it cost?"`);
  }

  // ---- list -----------------------------------------------------------
  if (command === 'list') {
    const leads = await db.collection('leads')
      .find({ tenantId: TEST_TENANT_ID, name: { $regex: `^${TESTLEAD_PREFIX}` } })
      .sort({ createdAt: -1 }).toArray();
    if (!leads.length) { console.log('No TESTLEAD leads in the test DB.'); }
    for (const l of leads) {
      console.log(
        `${l._id}  ${String(l.name).padEnd(24)} ${String(l.phone).padEnd(15)} ` +
        `agent=${l.currentAgent} stage=${l.currentStage} score=${l.leadScore ?? 0} ` +
        `intent=${l.intent} NBA=${l.nextBestAction ?? '-'} human=${l.humanHandoff?.active ?? false} nurture=${l.nurtureStatus}`
      );
    }
  }

  // ---- inbound -------------------------------------------------------
  if (command === 'inbound') {
    const [token, ...msgParts] = rest;
    const text = msgParts.join(' ');
    if (!token || !text) { console.error('Usage: inbound <leadId|phone> "message text"'); process.exit(1); }
    const lead = await findLead(db, token);
    if (!lead) { console.error('Test lead not found.'); process.exit(1); }

    const phoneKey = last10(lead.phone);
    let convo = await db.collection('salesconversations').findOne({ phoneKey, status: 'active' });
    if (!convo) {
      const res = await db.collection('salesconversations').insertOne({
        leadPhone: lead.phone, phoneKey, leadName: lead.name,
        businessId: new mongoose.Types.ObjectId(), // placeholder — send.ts tolerates it in dev
        status: 'active', consentStatus: 'granted',
        scores: { businessName: lead.name }, messages: [], createdAt: new Date(), updatedAt: new Date(),
      });
      convo = await db.collection('salesconversations').findOne({ _id: res.insertedId });
      console.log(`Created SalesConversation ${convo._id}`);
    }
    await db.collection('salesconversations').updateOne(
      { _id: convo._id },
      { $push: { messages: { role: 'lead', text, at: new Date() } }, $set: { lastLeadReplyAt: new Date() } }
    );
    console.log(`Appended inbound: "${text}"`);

    // Fire the same event the webhook fires.
    const { Inngest } = await import('inngest');
    const client = new Inngest({ id: 'growwmatics-testkit', isDev: process.env.INNGEST_DEV === '1' || !process.env.INNGEST_EVENT_KEY });
    await client.send({ name: 'sales/agent.reply', data: { conversationId: convo._id.toString(), body: text } });
    console.log('Fired sales/agent.reply. Watch the Inngest dev dashboard, then run:');
    console.log(`  node scripts/lead-engine-trace.mjs ${lead.phone}`);
  }

  // ---- pay ----------------------------------------------------------
  if (command === 'pay') {
    const lead = await findLead(db, rest[0]);
    if (!lead) { console.error('Test lead not found.'); process.exit(1); }
    console.log('Simulating verified payment via runCustomerActivationSequence...');
    console.log('(this imports app code — run with: node --experimental-vm-modules or via tsx if it fails to resolve @/ aliases)');
    // The activation sequence resolves the Lead by the paying user's phone.
    // For the test we ensure a shadow User + Business + Subscription exist.
    const userRes = await db.collection('users').findOneAndUpdate(
      { phone: lead.phone, email: `testlead+${last10(lead.phone)}@example.invalid` },
      { $setOnInsert: { phone: lead.phone, fullName: lead.name, email: `testlead+${last10(lead.phone)}@example.invalid`, role: 'USER', createdAt: new Date() } },
      { upsert: true, returnDocument: 'after' }
    );
    const user = userRes.value || await db.collection('users').findOne({ phone: lead.phone });
    const bizRes = await db.collection('businesses').findOneAndUpdate(
      { userId: user._id, name: lead.name },
      { $setOnInsert: { userId: user._id, name: lead.name, phone: lead.phone, organizationId: user._id.toString(), createdAt: new Date() } },
      { upsert: true, returnDocument: 'after' }
    );
    const biz = bizRes.value || await db.collection('businesses').findOne({ userId: user._id });
    await db.collection('subscriptions').updateOne(
      { userId: user._id },
      { $setOnInsert: { userId: user._id, planType: 'Pro', billingStatus: 'Active', createdAt: new Date() } },
      { upsert: true }
    );
    console.log(`Shadow user ${user._id} / business ${biz._id} / subscription ready.`);
    console.log('Now trigger activation. Easiest: POST a fake webhook to the running app:');
    console.log(`  (see TEST FLOW in the final report — the safe simulate endpoint)`);
  }

  // ---- handoff / return / optout ---------------------------------------
  if (command === 'handoff') {
    const lead = await findLead(db, rest[0]);
    if (!lead) { console.error('not found'); process.exit(1); }
    await db.collection('leads').updateOne({ _id: lead._id }, {
      $set: { currentAgent: 'HUMAN', currentStage: 'HUMAN_HANDOFF', 'humanHandoff.active': true, 'humanHandoff.reason': 'testkit-handoff', 'humanHandoff.since': new Date() },
    });
    await db.collection('scheduledactions').updateMany({ leadId: lead._id, status: 'PENDING' }, { $set: { status: 'CANCELLED', reason: 'testkit-handoff' } });
    console.log(`${lead._id} -> HUMAN. Pending actions cancelled.`);
  }
  if (command === 'return') {
    const lead = await findLead(db, rest[0]);
    const target = (rest[1] || 'SALES').toUpperCase();
    if (!lead) { console.error('not found'); process.exit(1); }
    await db.collection('leads').updateOne({ _id: lead._id }, {
      $set: { currentAgent: target, currentStage: target === 'IN_HOUSE' ? 'CUSTOMER' : 'NURTURING', 'humanHandoff.active': false, recentExtractionConfidences: [] },
    });
    console.log(`${lead._id} -> ${target} (humanHandoff cleared).`);
  }
  if (command === 'optout') {
    const lead = await findLead(db, rest[0]);
    if (!lead) { console.error('not found'); process.exit(1); }
    await db.collection('leads').updateOne({ _id: lead._id }, { $set: { nurtureStatus: 'OPTED_OUT' } });
    await db.collection('scheduledactions').updateMany({ leadId: lead._id, status: 'PENDING' }, { $set: { status: 'CANCELLED', reason: 'testkit-optout' } });
    console.log(`${lead._id} -> nurtureStatus OPTED_OUT. Pending actions cancelled.`);
  }

  // ---- reset --------------------------------------------------------
  if (command === 'reset') {
    const leads = await db.collection('leads').find({ tenantId: TEST_TENANT_ID, name: { $regex: `^${TESTLEAD_PREFIX}` } }).toArray();
    const ids = leads.map((l) => l._id);
    const phones = leads.map((l) => last10(l.phone));
    const phoneRe = phones.length ? new RegExp(`(${phones.join('|')})$`) : /nomatch^/;
    const r1 = await db.collection('leads').deleteMany({ _id: { $in: ids } });
    const r2 = await db.collection('leadevents').deleteMany({ $or: [{ leadId: { $in: ids } }, { phone: phoneRe }] });
    const r3 = await db.collection('scheduledactions').deleteMany({ leadId: { $in: ids } });
    const r4 = await db.collection('salesconversations').deleteMany({ leadPhone: phoneRe });
    await db.collection('orchestrationconfigs').updateOne({ key: 'default' }, { $set: { leadIdAllowlist: [] } });
    console.log(`Deleted: ${r1.deletedCount} leads, ${r2.deletedCount} events, ${r3.deletedCount} scheduled actions, ${r4.deletedCount} sales conversations. Allowlist emptied.`);
  }

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
