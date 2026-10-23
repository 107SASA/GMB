/**
 * Segment 1 — sales & nurturing, through the REAL Inngest handlers
 * (`fn.fn({ event, step })` with a mock step) against an in-memory MongoDB.
 * WhatsApp delivery is mocked by the existing suppression switch: every send
 * becomes a MessageQueue row and no provider is contacted. Groq is pointed
 * at a closed local port, so AI calls fail fast and template fallbacks run.
 * inngest.send is captured, never delivered.
 *
 * Run: npx tsx --test tests/workflow/presales-lifecycle.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runDurably } from '../helpers/inngestReplay';

process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|RESEND|SENDGRID|GROQ|OPENAI|INNGEST|LEAD_ENGINE)_?/.test(k) && k !== 'INNGEST_DEV') delete process.env[k];
process.env.GROQ_API_KEY = 'test-unused';
process.env.GROQ_BASE_URL = 'http://127.0.0.1:9'; // closed port → AI fails fast, never leaves the machine
process.env.WHATSAPP_PROVIDER = 'twilio';
process.env.TWILIO_TEMPLATE_NOTIFICATION = 'HXnotification_test';
process.env.TWILIO_TEMPLATE_SALES_INTRO = 'HXsales_intro_test';
process.env.TWILIO_TEMPLATE_REPORT_READY = 'HXreport_ready_test';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
// The platform line, so the real webhook handler routes to the sales agent.
// No TWILIO_AUTH_TOKEN + non-production → its documented local signature skip.
process.env.PLATFORM_WHATSAPP_NUMBER = '+919000000000';

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};
const dispatched: any[] = [];

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_presales_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  const client = await import('../../src/services/inngest/client');
  (client.inngest as any).send = async (e: any) => { dispatched.push(e); return { ids: [] }; };
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    Audit: (await import('../../src/models/Audit')).default,
    Lead: (await import('../../src/models/Lead')).default,
    SalesConversation: (await import('../../src/models/SalesConversation')).default,
    SalesAgentConfig: (await import('../../src/models/SalesAgentConfig')).default,
    ReportConversation: (await import('../../src/models/ReportConversation')).default,
    BookingConversation: (await import('../../src/models/BookingConversation')).default,
    DemoBooking: (await import('../../src/models/DemoBooking')).default,
    ScheduledAction: (await import('../../src/models/ScheduledAction')).default,
    MessageQueue: (await import('../../src/models/MessageQueue')).default,
    SupportConversation: (await import('../../src/models/SupportConversation')).default,
    fns: await import('../../src/services/inngest/functions'),
    policy: await import('../../src/services/sales/preSalesPolicy'),
    webhook: await import('../../src/app/api/whatsapp/webhook/route'),
    salesAgent: await import('../../src/services/sales/salesAgent'),
    defaults: await import('../../src/lib/salesAgentDefaults'),
  };
  await m.SalesAgentConfig.create({
    key: 'default',
    enabled: true,
    firstMessage: { mode: 'template', delayMinutes: 2, template: 'Hi {{name}}, your free audit for {{business}} is ready. Would a quick demo help? Reply DEMO.', aiSystemPrompt: '' },
    // Two follow-ups configured — the server-side limit still sends only one.
    followUps: [
      { delayHours: 24, mode: 'template', onlyIfNoReply: false, template: 'Final note about {{business}} — reply DEMO anytime.' },
      { delayHours: 72, mode: 'template', onlyIfNoReply: true, template: 'Second follow-up that must never send.' },
    ],
    agentSystemPrompt: 'You are a test agent.',
    subscribeUrl: 'https://app.example.test/dashboard/billing',
  } as any);
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const DAY = 86_400_000;
let seq = 0;

/** A mock Inngest step: runs steps inline, records sleeps, can run a hook during a named sleep. */
function mockStep(hooks: Record<string, () => Promise<void>> = {}) {
  const sleeps: Array<{ name: string; duration: string }> = [];
  return {
    sleeps,
    step: {
      run: async (_name: string, cb: () => any) => cb(),
      sleep: async (name: string, duration: string) => { sleeps.push({ name, duration }); if (hooks[name]) await hooks[name](); },
      sleepUntil: async (name: string) => { sleeps.push({ name, duration: 'until' }); },
      sendEvent: async (_n: string, e: any) => { dispatched.push(e); },
    },
  };
}

const rows = (phone: string) => m.MessageQueue.find({ 'payload.phone': phone }).sort({ createdAt: 1 }).lean();
const count = (phone: string) => m.MessageQueue.countDocuments({ 'payload.phone': phone });
const textOf = (row: any) => row.payload.body || row.payload.variables?.['2'] || '';

/** A free-report prospect: business + owner + completed fastMode audit (+ platform Lead). */
async function prospect(opts: { priorContact?: boolean; business?: Record<string, unknown>; lead?: Record<string, unknown> | false } = {}) {
  const n = ++seq;
  const phone = `+9198770${String(n).padStart(5, '0')}`;
  const userId = new m.mongoose.Types.ObjectId();
  const b = await m.Business.create({ name: `Shop ${n}`, category: 'Bakery', address: 'Pune', userId, organizationId: new m.mongoose.Types.ObjectId(), ...(opts.business || {}) } as any);
  await m.User.create({ _id: userId, fullName: `Owner ${n}`, email: `p${n}@example.invalid`, phone, role: 'CLIENT', businessIds: [b._id] } as any);
  const audit = await m.Audit.create({ tenantId: String(b._id), userId: String(userId), organizationId: 'org', businessId: b._id, businessName: b.name, location: 'Pune', status: 'COMPLETED', fastMode: true } as any);
  if (opts.lead !== false) await m.Lead.create({ tenantId: 'gmbboost-internal', name: `Owner ${n}`, phone, currentAgent: 'SALES', currentStage: 'NURTURING', ...(opts.lead || {}) } as any);
  if (opts.priorContact) {
    const { phoneDedupeKey } = await import('../../src/lib/phone');
    await m.ReportConversation.create({ leadPhone: phone, phoneKey: phoneDedupeKey(phone), status: 'report_sent', messages: [{ role: 'lead', text: 'report please', at: new Date(Date.now() - DAY) }] } as any);
  }
  return { phone, businessId: String(b._id), userId: String(userId), auditId: String(audit._id) };
}

const runNurture = (auditId: string, hooks: Record<string, () => Promise<void>> = {}) => {
  const s = mockStep(hooks);
  return { s, done: m.fns.salesNurtureRequested.fn({ event: { data: { auditId } }, step: s.step }) };
};

test('free report (prior contact): one invitation ≥ 2h later, then exactly ONE follow-up ~48h later', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await prospect({ priorContact: true });
  const { s, done } = runNurture(p.auditId);
  await done;
  const sent = await rows(p.phone);
  assert.equal(sent.length, 2, 'invitation + one follow-up');
  assert.match(textOf(sent[0]), /Would a quick demo help\? Reply DEMO/);
  assert.match(textOf(sent[1]), /Final note about/);
  assert.ok(!sent.some((r: any) => /must never send/.test(textOf(r))), 'the second configured follow-up never sends');
  const wait = s.sleeps.find((x) => x.name === 'wait-before-first');
  assert.equal(wait?.duration, '120m', 'invitation waits at least 2 hours after the report');
  assert.deepEqual(s.sleeps.filter((x) => x.name.startsWith('wait-followup-')).map((x) => x.duration), ['2880m']);
});

test('free report (cold website number): only the consent invitation, no follow-up', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await prospect();
  const { done } = runNurture(p.auditId);
  const out: any = await done;
  assert.equal(out.awaitingConsent, true);
  const sent = await rows(p.phone);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.contentSid, 'HXsales_intro_test');
});

test('a reply during the wait stops the follow-up', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await prospect({ priorContact: true });
  const { done } = runNurture(p.auditId, {
    'wait-followup-0': async () => {
      await m.SalesConversation.updateOne({ leadPhone: p.phone }, { $set: { lastLeadReplyAt: new Date(Date.now() + 1000) } });
    },
  });
  await done;
  assert.equal(await count(p.phone), 1, 'invitation only');
});

test('booking a demo, starting a trial, or paying (with no Lead) stops the follow-up', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const demo = await prospect({ priorContact: true });
  await runNurture(demo.auditId, {
    'wait-followup-0': async () => { await m.Lead.updateOne({ phone: demo.phone }, { $set: { currentAgent: 'DEMO', currentStage: 'DEMO_SCHEDULED' } }); },
  }).done;
  assert.equal(await count(demo.phone), 1);

  const trial = await prospect({ priorContact: true });
  await runNurture(trial.auditId, {
    'wait-followup-0': async () => { await m.Business.updateOne({ _id: trial.businessId }, { $set: { subscriptionStatus: 'trial_active', trialStartedAt: new Date() } }); },
  }).done;
  assert.equal(await count(trial.phone), 1);

  // No platform Lead at all: the workspace state alone must stop it.
  const paid = await prospect({ priorContact: true, lead: false });
  await runNurture(paid.auditId, {
    'wait-followup-0': async () => {
      await m.Lead.deleteMany({ phone: paid.phone });
      await m.Business.updateOne({ _id: paid.businessId }, { $set: { subscriptionStatus: 'active', billingSubscriptionId: 'sub_x' } });
    },
  }).done;
  assert.equal(await count(paid.phone), 1);
});

test('no invitation at all for someone already on a trial, opted out, not interested, or with a demo booked', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const cases = [
    await prospect({ priorContact: true, business: { subscriptionStatus: 'trial_active', trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 30 * DAY) } }),
    await prospect({ priorContact: true, lead: { nurtureStatus: 'OPTED_OUT' } }),
    await prospect({ priorContact: true, lead: { intent: 'NOT_INTERESTED' } }),
    await prospect({ priorContact: true, lead: { currentAgent: 'DEMO', currentStage: 'DEMO_SCHEDULED' } }),
  ];
  for (const p of cases) {
    const out: any = await runNurture(p.auditId).done;
    assert.ok(out.skipped, `skipped: ${JSON.stringify(out)}`);
    assert.equal(await count(p.phone), 0);
  }
});

test('trial/paid check: a phone with no user or business is not "converted" just because other workspaces paid', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await prospect({ business: { subscriptionStatus: 'active' } }); // someone else's paid workspace
  assert.equal(await m.policy.trialOrPaidForPhone('+919800000001', undefined), false);
  const paidByPhone = await prospect({ business: { subscriptionStatus: 'active' } });
  assert.equal(await m.policy.trialOrPaidForPhone(paidByPhone.phone, undefined), true, 'found through the owner\'s phone, no Lead needed');
});

test('stopPreSalesNurtureForWorkspace closes the sales thread and cancels queued sales rows, keeping demo reminders', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await prospect({ priorContact: true });
  const convo = await m.SalesConversation.create({ businessId: p.businessId, leadPhone: p.phone, phoneKey: p.phone.slice(-10), status: 'active' } as any);
  const lead: any = await m.Lead.findOne({ phone: p.phone }).lean();
  await m.ScheduledAction.create({ leadId: lead._id, actionType: 'SHOW_VALUE', dueAt: new Date(), status: 'PENDING', idempotencyKey: `k-sv-${seq}`, payload: { conversationId: String(convo._id), followUpIndex: 0 } } as any);
  await m.ScheduledAction.create({ leadId: lead._id, actionType: 'DEMO_REMINDER', dueAt: new Date(Date.now() + DAY), status: 'PENDING', idempotencyKey: `k-dr-${seq}`, payload: {} } as any);
  const r = await m.policy.stopPreSalesNurtureForWorkspace(p.businessId, 'trial-started');
  assert.equal(r.conversations, 1);
  assert.equal(r.actions, 1);
  assert.equal((await m.SalesConversation.findById(convo._id).lean()).status, 'completed');
  assert.equal((await m.ScheduledAction.findOne({ actionType: 'DEMO_REMINDER', leadId: lead._id }).lean()).status, 'PENDING');
});

test('the invitation cannot be sent twice by retries or overlapping runs', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await prospect({ priorContact: true });
  const convo = await m.SalesConversation.create({ businessId: p.businessId, leadPhone: p.phone, phoneKey: p.phone.slice(-10), status: 'active', scores: { businessName: 'X' } } as any);
  const results = await Promise.all(Array.from({ length: 5 }, () => m.fns.sendSalesFirstMessage(String(convo._id))));
  assert.equal(results.filter((r: any) => r.sent).length, 1);
  assert.equal(await count(p.phone), 1);
  // A second nurture run for the same audit is stopped by the atomic send-once claim.
  await runNurture(p.auditId).done;
  await runNurture(p.auditId).done;
  assert.equal(await count(p.phone), 1);
});

async function salesThread(over: Record<string, unknown> = {}, leadOver: Record<string, unknown> = {}) {
  const p = await prospect({ priorContact: true, lead: leadOver });
  const convo = await m.SalesConversation.create({
    businessId: p.businessId, leadPhone: p.phone, phoneKey: p.phone.slice(-10), status: 'active', consentStatus: 'not_required',
    firstSentAt: new Date(Date.now() - DAY), scores: { businessName: 'Shop' },
    messages: [{ role: 'agent', text: 'invitation', at: new Date(Date.now() - DAY) }, { role: 'lead', text: 'How much does it cost?', at: new Date() }],
    lastLeadReplyAt: new Date(), ...over,
  } as any);
  return { ...p, conversationId: String(convo._id) };
}

const reply = (conversationId: string, body: string, id = `evt-${++seq}`) => {
  const { step } = mockStep();
  return m.fns.salesAgentReply.fn({ event: { id, data: { conversationId, body } }, step });
};

test('an inbound reply gets ONE answer, cancels queued follow-ups, and schedules nothing unsolicited', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await salesThread();
  const lead: any = await m.Lead.findOne({ phone: p.phone }).lean();
  await m.ScheduledAction.create({ leadId: lead._id, actionType: 'SHOW_VALUE', dueAt: new Date(Date.now() + DAY), status: 'PENDING', idempotencyKey: `k-q-${seq}`, payload: { conversationId: p.conversationId, followUpIndex: 0 } } as any);
  await reply(p.conversationId, 'How much does it cost?', 'evt-same');
  await reply(p.conversationId, 'How much does it cost?', 'evt-same'); // Inngest retry of the same event
  assert.equal(await count(p.phone), 1, 'one reply, even when the step is retried');
  assert.equal(await m.ScheduledAction.countDocuments({ leadId: lead._id, status: 'PENDING' }), 0, 'queued follow-up cancelled');
  // Even if the lead is armed for a proactive action, the retired scheduler creates nothing.
  await m.Lead.updateOne({ _id: lead._id }, { $set: { nextBestAction: 'SHOW_VALUE', nextActionAt: new Date(Date.now() - 1000) } });
  const out: any = await m.fns.proactiveNbaScheduler.fn({ event: {}, step: mockStep().step });
  assert.equal(out.scheduled, 0);
  assert.equal(await m.ScheduledAction.countDocuments({ leadId: lead._id, status: 'PENDING' }), 0);
});

test('"not interested" gets one acknowledgement and ends the sales thread', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await salesThread({}, { intent: 'NOT_INTERESTED' });
  await reply(p.conversationId, 'Not interested, thanks');
  const sent = await rows(p.phone);
  assert.equal(sent.length, 1);
  assert.match(textOf(sent[0]), /won't send you any more follow-ups/);
  assert.equal((await m.SalesConversation.findById(p.conversationId).lean()).status, 'stopped');
});

test('a paying customer writing into an old sales thread goes to support, not the sales agent', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await salesThread();
  await m.Lead.deleteMany({ phone: p.phone }); // no Lead match
  await m.Business.updateOne({ _id: p.businessId }, { $set: { subscriptionStatus: 'active' } });
  dispatched.length = 0;
  await reply(p.conversationId, 'My posts are not showing');
  // Segment 4A: support intake sends its one fixed acknowledgement — never a sales reply.
  const sent = await rows(p.phone);
  assert.equal(sent.length, 1, 'only the support acknowledgement');
  assert.match(textOf(sent[0]), /^Thank you for contacting Growwmatics\. We've received your message\./);
  assert.equal((await m.SalesConversation.findById(p.conversationId).lean()).status, 'completed');
  const support: any = await m.SupportConversation.findOne({ leadPhone: p.phone }).lean();
  assert.equal(support?.matchedBy, 'sales_handoff', 'handed to support');
  assert.ok(support?.ackSentAt);
  assert.equal(await m.SupportConversation.countDocuments({ leadPhone: p.phone }), 1);
});

const tick = () => m.fns.nurtureSchedulerTick.fn({ event: {}, step: mockStep().step });

test('the scheduler re-checks a queued follow-up row right before sending; proactive NBA rows never send', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await salesThread(); // lead replied after the invitation
  const lead: any = await m.Lead.findOne({ phone: p.phone }).lean();
  const drip = await m.ScheduledAction.create({ leadId: lead._id, actionType: 'SHOW_VALUE', dueAt: new Date(Date.now() - 1000), status: 'PENDING', idempotencyKey: `k-d-${seq}`, payload: { conversationId: p.conversationId, followUpIndex: 0 } } as any);
  const nba = await m.ScheduledAction.create({ leadId: lead._id, actionType: 'EXECUTE_NBA', dueAt: new Date(Date.now() - 1000), status: 'PENDING', idempotencyKey: `k-n-${seq}`, payload: { action: 'SHOW_VALUE' } } as any);
  const beyond = await m.ScheduledAction.create({ leadId: lead._id, actionType: 'SHOW_VALUE', dueAt: new Date(Date.now() - 1000), status: 'PENDING', idempotencyKey: `k-b-${seq}`, payload: { conversationId: p.conversationId, followUpIndex: 1 } } as any);
  await tick();
  assert.equal((await m.ScheduledAction.findById(drip._id).lean()).reason, 'pre-sales: lead-replied');
  assert.equal((await m.ScheduledAction.findById(nba._id).lean()).reason, 'proactive-nba-retired');
  assert.equal((await m.ScheduledAction.findById(beyond._id).lean()).reason, 'pre-sales: follow-up-limit');
  assert.equal(await count(p.phone), 0);
});

test('existing booking reminders still send for a booked demo', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const n = ++seq;
  const phone = `+9198772${String(n).padStart(5, '0')}`;
  const lead = await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Asha', phone, currentAgent: 'DEMO', currentStage: 'DEMO_SCHEDULED' } as any);
  const start = new Date(Date.now() + 2 * DAY);
  const booking = await m.DemoBooking.create({ leadId: lead._id, name: 'Asha', phone, date: 'Wed 28 Oct', timeSlot: '11:00 AM', status: 'Confirmed', startUtc: start, meetingLink: 'https://meet.example/abc' } as any);
  const ids = await m.fns.scheduleDemoReminders(lead._id, booking, start, 30);
  assert.equal(ids.length, 4, '24h, 1h, 15m reminders + the no-show check');
  await m.ScheduledAction.updateOne({ leadId: lead._id, actionType: 'DEMO_REMINDER', 'payload.reminderType': '24h' }, { $set: { dueAt: new Date(Date.now() - 1000) } });
  await tick();
  const sent = await rows(phone);
  assert.equal(sent.length, 1);
  assert.match(textOf(sent[0]), /Just a reminder that your GrowwMatics demo is tomorrow/);
});

test('existing report-ready delivery still sends once for a completed free report', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await prospect();
  const { step } = mockStep();
  await m.fns.sendReportReadyNotification.fn({ event: { data: { auditId: p.auditId } }, step });
  await m.fns.sendReportReadyNotification.fn({ event: { data: { auditId: p.auditId } }, step });
  const sent = await rows(p.phone);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.contentSid, 'HXreport_ready_test');
});

// ── Review follow-ups: consent / STOP through the real webhook, quiet hours,
//    opt-out mid-sequence, attendance edge cases, default copy upgrade ──────

let sidSeq = 0;
async function inbound(phone: string, body: string) {
  const form = new URLSearchParams({ MessageSid: `SMtest${Date.now()}${++sidSeq}`, From: `whatsapp:${phone}`, To: 'whatsapp:+919000000000', Body: body, NumMedia: '0' });
  const req = new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  return m.webhook.handleTwilioWebhook(req);
}

async function pendingConsent() {
  const p = await prospect();
  const convo = await m.SalesConversation.create({ businessId: p.businessId, leadPhone: p.phone, phoneKey: p.phone.slice(-10), status: 'active', consentStatus: 'pending', scores: { businessName: 'Shop' } } as any);
  return { ...p, conversationId: String(convo._id) };
}

test('consent: a non-YES reply is answered (sales agent) but never starts the pitch or the follow-up; YES does', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const q = await pendingConsent();
  dispatched.length = 0;
  await inbound(q.phone, 'Who is this?');
  assert.deepEqual(dispatched.map((e) => e.name), ['sales/agent.reply']);
  assert.equal((await m.SalesConversation.findById(q.conversationId).lean()).consentStatus, 'granted');

  const y = await pendingConsent();
  dispatched.length = 0;
  await inbound(y.phone, 'Yes');
  assert.deepEqual(dispatched.map((e) => e.name), ['sales/nurture.consented']);
});

test('STOP: the sales thread stops, the Lead is opted out, and nothing more is scheduled or sent', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const s = await pendingConsent();
  dispatched.length = 0;
  await inbound(s.phone, 'STOP');
  assert.equal(dispatched.length, 0);
  assert.equal((await m.SalesConversation.findById(s.conversationId).lean()).status, 'stopped');
  assert.equal((await m.Lead.findOne({ phone: s.phone }).lean()).nurtureStatus, 'OPTED_OUT');
  assert.equal(await m.policy.preSalesSendBlockedReason({ kind: 'invite', phone: s.phone }), 'opted-out');
  assert.equal(await count(s.phone), 0);
});

test('an opt-out during the 48h wait stops the follow-up', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await prospect({ priorContact: true });
  await runNurture(p.auditId, {
    'wait-followup-0': async () => { await m.Lead.updateOne({ phone: p.phone }, { $set: { nurtureStatus: 'OPTED_OUT' } }); },
  }).done;
  assert.equal(await count(p.phone), 1, 'invitation only');
});

test('quiet hours: a report finished at 20:30 IST gets its invitation at 09:00 IST, not overnight', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await prospect({ priorContact: true });
  // 22:30 IST is when the 2-hour minimum ends for a 20:30 report — the step clock reads it here.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-22T17:00:00Z') });
  try {
    const { s, done } = runNurture(p.auditId);
    await done;
    assert.equal(s.sleeps.find((x) => x.name === 'wait-before-first')?.duration, '120m');
    assert.equal(s.sleeps.find((x) => x.name === 'quiet-wait-before-first')?.duration, '630m', '22:30 → 09:00 IST');
  } finally {
    t.mock.timers.reset();
  }
});

test('default copy: an unmodified earlier default is read as the new demo invitation; customized copy is untouched', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const original: any = await m.SalesAgentConfig.findOne({ key: 'default' }).lean();
  try {
    const custom = await m.salesAgent.getSalesAgentConfig();
    assert.equal(custom.firstMessage.template, original.firstMessage.template, 'customized template kept');
    await m.SalesAgentConfig.updateOne({ key: 'default' }, { $set: { 'firstMessage.template': m.defaults.SEP_2026_FIRST_TEMPLATE, 'firstMessage.aiSystemPrompt': m.defaults.SEP_2026_FIRST_AI_PROMPT } });
    const upgraded = await m.salesAgent.getSalesAgentConfig();
    assert.equal(upgraded.firstMessage.template, m.defaults.DEFAULT_FIRST_TEMPLATE);
    assert.equal(upgraded.firstMessage.aiSystemPrompt, m.defaults.DEFAULT_FIRST_AI_PROMPT);
    const stored: any = await m.SalesAgentConfig.findOne({ key: 'default' }).lean();
    assert.equal(stored.firstMessage.template, m.defaults.SEP_2026_FIRST_TEMPLATE, 'read-time only — the database is not rewritten');
  } finally {
    await m.SalesAgentConfig.updateOne({ key: 'default' }, { $set: { firstMessage: original.firstMessage } });
  }
});

// ── Durable sequences through the REAL Inngest execution engine ─────────────
// Each run re-enters the handler from the top with memoized step results, and
// every sleep "wakes" only after onSleep changed the world — the production
// replay model. Assertions: eligibility is evaluated AFTER the wake, and
// replaying completed steps never sends again.

test('engine replay: full sequence = invitation + one follow-up, despite many re-entries; order sleep → re-check → send', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await prospect({ priorContact: true });
  const out = await runDurably(m.fns.salesNurtureRequested, { data: { auditId: p.auditId } });
  assert.equal(await count(p.phone), 2);
  assert.ok(out.invocations > 6, `handler replayed ${out.invocations} times`);
  const tl = out.timeline;
  const at = (label: string) => tl.indexOf(label);
  assert.ok(at('sleep:wait-before-first') < at('run:quiet-before-first'));
  assert.ok(at('run:quiet-before-first') < at('run:send-first-message'));
  assert.ok(at('sleep:wait-followup-0') < at('run:send-followup-0'));
  assert.equal(tl.filter((x) => x === 'run:send-first-message').length, 1);
  assert.ok(!tl.includes('run:send-followup-1'), 'never a second follow-up');
});

test('engine replay: a trial started during the 2h wait → no invitation, nothing at all', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await prospect({ priorContact: true });
  await runDurably(m.fns.salesNurtureRequested, { data: { auditId: p.auditId } }, {
    onSleep: async (id) => {
      if (id === 'wait-before-first') await m.Business.updateOne({ _id: p.businessId }, { $set: { subscriptionStatus: 'trial_active', trialStartedAt: new Date() } });
    },
  });
  assert.equal(await count(p.phone), 0);
});

test('engine replay: a reply or an opt-out during the 48h wait → no follow-up', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const replied = await prospect({ priorContact: true });
  await runDurably(m.fns.salesNurtureRequested, { data: { auditId: replied.auditId } }, {
    onSleep: async (id) => {
      if (id === 'wait-followup-0') await m.SalesConversation.updateOne({ leadPhone: replied.phone }, { $set: { lastLeadReplyAt: new Date(Date.now() + 1000) } });
    },
  });
  assert.equal(await count(replied.phone), 1);

  const optedOut = await prospect({ priorContact: true });
  await runDurably(m.fns.salesNurtureRequested, { data: { auditId: optedOut.auditId } }, {
    onSleep: async (id) => {
      if (id === 'wait-followup-0') await m.Lead.updateOne({ phone: optedOut.phone }, { $set: { nurtureStatus: 'OPTED_OUT' } });
    },
  });
  assert.equal(await count(optedOut.phone), 1);
});

test('engine replay: after YES, paying during the 48h wait (no Lead) → no follow-up', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await prospect({ lead: false });
  const convo = await m.SalesConversation.create({ businessId: p.businessId, leadPhone: p.phone, phoneKey: p.phone.slice(-10), status: 'active', consentStatus: 'granted', scores: { businessName: 'Shop' } } as any);
  await runDurably(m.fns.salesNurtureConsented, { data: { conversationId: String(convo._id) } }, {
    onSleep: async (id) => {
      if (id === 'wait-followup-0') await m.Business.updateOne({ _id: p.businessId }, { $set: { subscriptionStatus: 'active', billingSubscriptionId: 'sub_paid' } });
    },
  });
  assert.equal(await count(p.phone), 1, 'the findings reply only');
});
