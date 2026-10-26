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

async function withQuietHours(quietHours: any, timezone: string | undefined, fn: () => Promise<void>) {
  const original: any = await m.SalesAgentConfig.findOne({ key: 'default' }).lean();
  await m.SalesAgentConfig.updateOne({ key: 'default' }, { $set: { quietHours, ...(timezone ? { timezone } : {}) } });
  try {
    await fn();
  } finally {
    await m.SalesAgentConfig.updateOne({ key: 'default' }, { $set: { quietHours: original.quietHours ?? { enabled: false, start: '21:00', end: '09:00' }, timezone: original.timezone ?? 'Asia/Kolkata' } });
  }
}

test('quiet hours off (no built-in window): a report finished at 20:30 IST gets its invitation at 22:30 IST', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await withQuietHours({ enabled: false, start: '21:00', end: '09:00' }, undefined, async () => {
    const p = await prospect({ priorContact: true });
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-22T17:00:00Z') });
    try {
      const { s, done } = runNurture(p.auditId);
      await done;
      assert.equal(s.sleeps.find((x) => x.name === 'wait-before-first')?.duration, '120m');
      assert.equal(s.sleeps.find((x) => x.name === 'quiet-wait-before-first'), undefined, 'no overnight wait');
      assert.equal(await count(p.phone), 2, 'invitation + its follow-up, no time restriction');
    } finally {
      t.mock.timers.reset();
    }
  });
});

test('quiet hours on: 21:00–09:00 IST holds a 22:30 invitation until 09:00; another timezone is read in that zone', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await withQuietHours({ enabled: true, start: '21:00', end: '09:00' }, 'Asia/Kolkata', async () => {
    const p = await prospect({ priorContact: true });
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-22T17:00:00Z') });
    try {
      const { s, done } = runNurture(p.auditId);
      await done;
      assert.equal(s.sleeps.find((x) => x.name === 'quiet-wait-before-first')?.duration, '630m', '22:30 → 09:00 IST');
    } finally {
      t.mock.timers.reset();
    }
  });
  // 17:00 UTC is 21:00 in Dubai: inside 20:00–08:00 there → 11 hours.
  await withQuietHours({ enabled: true, start: '20:00', end: '08:00' }, 'Asia/Dubai', async () => {
    const p = await prospect({ priorContact: true });
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-22T17:00:00Z') });
    try {
      const { s, done } = runNurture(p.auditId);
      await done;
      assert.equal(s.sleeps.find((x) => x.name === 'quiet-wait-before-first')?.duration, '660m');
    } finally {
      t.mock.timers.reset();
    }
  });
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

// ── Nurturing switch (separate from the Sales agent), follow-up switch, skip visibility ──

async function withSalesConfig(patch: Record<string, unknown>, fn: () => Promise<void>) {
  const original: any = await m.SalesAgentConfig.findOne({ key: 'default' }).lean();
  await m.SalesAgentConfig.updateOne({ key: 'default' }, { $set: patch });
  try {
    await fn();
  } finally {
    await m.SalesAgentConfig.replaceOne({ key: 'default' }, original);
  }
}

const skippedFor = async (phone: string) => {
  const { default: LeadEvent } = await import('../../src/models/LeadEvent');
  return LeadEvent.find({ type: 'NURTURE_ACTION_SKIPPED', phone }).lean();
};

test('nurturing off: no invitation and no follow-up — but the Sales agent still answers live messages', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await withSalesConfig({ nurtureEnabled: false }, async () => {
    const p = await prospect({ priorContact: true });
    assert.deepEqual(await runNurture(p.auditId).done, { skipped: 'nurture disabled' });
    assert.equal(await count(p.phone), 0);
    // A live reply path is gated by the agent switch only.
    assert.equal((await m.salesAgent.getSalesAgentConfig()).enabled, true);
  });
});

test('nurturing switched off during the 48h wait: the follow-up is skipped and the reason is recorded', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await prospect({ priorContact: true });
  await runNurture(p.auditId, {
    'wait-followup-0': async () => { await m.SalesAgentConfig.updateOne({ key: 'default' }, { $set: { nurtureEnabled: false } }); },
  }).done;
  await m.SalesAgentConfig.updateOne({ key: 'default' }, { $unset: { nurtureEnabled: 1 } });
  assert.equal(await count(p.phone), 1, 'invitation only');
  const skipped = await skippedFor(p.phone);
  assert.equal(skipped.length, 1);
  assert.equal((skipped[0] as any).payload.reason, 'nurture-disabled');
});

test('Sales agent off stops automated sends too, even with nurturing on', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await withSalesConfig({ enabled: false, nurtureEnabled: true }, async () => {
    const p = await prospect({ priorContact: true });
    assert.deepEqual(await runNurture(p.auditId).done, { skipped: 'agent disabled' });
    assert.equal(await count(p.phone), 0);
  });
});

test('follow-up switched off: the invitation goes out, the follow-up never does', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const original: any = await m.SalesAgentConfig.findOne({ key: 'default' }).lean();
  const followUps = original.followUps.map((f: any, i: number) => (i === 0 ? { ...f, enabled: false } : f));
  await withSalesConfig({ followUps }, async () => {
    const p = await prospect({ priorContact: true });
    await runNurture(p.auditId).done;
    assert.equal(await count(p.phone), 1);
  });
});

test('an invitation blocked at send time is recorded with its reason', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await prospect({ priorContact: true });
  await runNurture(p.auditId, {
    'wait-before-first': async () => { await m.Lead.updateOne({ phone: p.phone }, { $set: { nurtureStatus: 'OPTED_OUT' } }); },
  }).done;
  assert.equal(await count(p.phone), 0);
  const skipped: any[] = await skippedFor(p.phone);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].payload.agent, 'sales-agent-invite');
  assert.equal(skipped[0].payload.reason, 'opted-out');
});

test('after YES the findings are still an answer when nurturing is off; the automated follow-up is not', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const y = await pendingConsent();
  await m.SalesConversation.updateOne({ _id: y.conversationId }, { $set: { consentStatus: 'granted' } });
  await withSalesConfig({ nurtureEnabled: false }, async () => {
    assert.equal(await m.policy.preSalesSendBlockedReason({ kind: 'invite', step: 'first', conversationId: y.conversationId }), null, 'answering YES');
    assert.equal(await m.policy.preSalesSendBlockedReason({ kind: 'invite', step: 'consent', conversationId: y.conversationId }), 'consent-not-pending');
    const fu = await m.policy.followUpBlockedReason(y.conversationId, 0);
    assert.ok(fu.reason, 'the follow-up is blocked');
  });
});

// ── Audit fixes: human-owned inbound, both follow-up paths, skip categories, returning leads ──

const LeadEventModel = async () => (await import('../../src/models/LeadEvent')).default;
const OrchestrationConfigModel = async () => (await import('../../src/models/OrchestrationConfig')).default;

test('human-owned lead with no live thread: the message is saved to the Inbox, no AI or menu reply, team notified', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { listInbox } = await import('../../src/services/inbox/platformInbox');
  // (a) Their old sales thread was handed off → the message lands there.
  const a = await prospect();
  await m.Lead.updateOne({ phone: a.phone }, { $set: { currentAgent: 'HUMAN', humanHandoff: { active: true, reason: 'test', since: new Date() } } });
  const old = await m.SalesConversation.create({ businessId: a.businessId, leadPhone: a.phone, phoneKey: a.phone.slice(-10), status: 'handed_off', messages: [{ role: 'agent', text: 'earlier', at: new Date(Date.now() - 86_400_000) }] } as any);
  dispatched.length = 0;
  await inbound(a.phone, 'Hello, is anyone there?');
  assert.deepEqual(dispatched, [], 'no agent is triggered');
  assert.equal(await count(a.phone), 0, 'no automated reply or menu');
  const saved: any = await m.SalesConversation.findById(old._id).lean();
  assert.equal(saved.messages.at(-1).text, 'Hello, is anyone there?');
  assert.equal(saved.status, 'handed_off', 'the thread is not reopened to the AI');
  let inbox = await listInbox({});
  const rowA = inbox.conversations.find((c: any) => c.phone === a.phone);
  assert.ok(rowA, 'visible in the Inbox');
  assert.equal(rowA.unread, true);

  // (b) No thread at all → a closed thread is created to hold it, and it is listed.
  const b = await prospect();
  await m.Lead.updateOne({ phone: b.phone }, { $set: { currentAgent: 'HUMAN', humanHandoff: { active: true } } });
  await inbound(b.phone, 'Need to talk to someone');
  const holder: any = await m.BookingConversation.findOne({ phoneKey: b.phone.slice(-10) }).lean();
  assert.equal(holder.status, 'stopped', 'the booking agent never picks it up');
  assert.ok(holder.humanInboxAt);
  assert.equal(holder.messages[0].text, 'Need to talk to someone');
  inbox = await listInbox({});
  assert.ok(inbox.conversations.find((c: any) => c.phone === b.phone), 'listed although closed');
  assert.equal(await count(b.phone), 0);

  // (c) An open report thread (not shown in the Inbox) does not swallow it either.
  const c = await prospect();
  await m.Lead.updateOne({ phone: c.phone }, { $set: { currentAgent: 'HUMAN', humanHandoff: { active: true } } });
  await m.ReportConversation.create({ leadPhone: c.phone, phoneKey: c.phone.slice(-10), status: 'connected', messages: [] } as any);
  dispatched.length = 0;
  await inbound(c.phone, 'question about my report');
  assert.deepEqual(dispatched, [], 'report agent not triggered');
  assert.ok((await listInbox({})).conversations.find((x: any) => x.phone === c.phone));

  const received = await (await LeadEventModel()).find({ type: 'MESSAGE_RECEIVED', phone: { $in: [a.phone, b.phone, c.phone] } }).lean();
  assert.equal(received.length, 3, 'recorded on each lead timeline');
});

test('scheduled follow-up path (LEAD_ENGINE_V2 + cohort) obeys the same rules as the inline path', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const Orch = await OrchestrationConfigModel();
  await Orch.updateOne({ key: 'default' }, { $set: { leadIdAllowlist: [], rolloutPercentage: 0, cooldownHours: 0 } }, { upsert: true });
  process.env.LEAD_ENGINE_V2 = 'true';
  const tick = () => runDurably(m.fns.nurtureSchedulerTick, { data: {} });
  const makeDue = (leadId: unknown) => m.ScheduledAction.updateMany({ leadId, status: 'PENDING' }, { $set: { dueAt: new Date(Date.now() - 1000) } });
  try {
    // (a) Eligible → exactly one follow-up, never a second (stable key + send claim).
    const p = await prospect({ priorContact: true });
    const lead: any = await m.Lead.findOne({ phone: p.phone }).lean();
    await Orch.updateOne({ key: 'default' }, { $addToSet: { leadIdAllowlist: lead._id } });
    await runNurture(p.auditId).done;
    await runNurture(p.auditId).done; // a retried run does not add a second row
    const rowsQueued = await m.ScheduledAction.find({ leadId: lead._id, createdBy: 'sales-agent-drip' }).lean();
    assert.equal(rowsQueued.length, 1, 'one row per conversation + step');
    assert.equal(await count(p.phone), 1, 'invitation only so far');
    await makeDue(lead._id); await tick();
    await makeDue(lead._id); await tick();
    assert.equal(await count(p.phone), 2, 'invitation + exactly one follow-up');

    // (b) Demo intent appeared before it fired → skipped with the same reason the inline path gives, and recorded.
    const q = await prospect({ priorContact: true });
    const qLead: any = await m.Lead.findOne({ phone: q.phone }).lean();
    await Orch.updateOne({ key: 'default' }, { $addToSet: { leadIdAllowlist: qLead._id } });
    await runNurture(q.auditId).done;
    await m.Lead.updateOne({ _id: qLead._id }, { $set: { intent: 'DEMO_INTEREST' } });
    await makeDue(qLead._id); await tick();
    assert.equal(await count(q.phone), 1, 'no follow-up');
    const row: any = await m.ScheduledAction.findOne({ leadId: qLead._id, createdBy: 'sales-agent-drip' }).lean();
    assert.equal(row.status, 'SKIPPED');
    assert.equal(row.reason, 'pre-sales: demo-intent-owns-next-step');
    const ev: any = await (await LeadEventModel()).findOne({ type: 'NURTURE_ACTION_SKIPPED', phone: q.phone }).sort({ createdAt: -1 }).lean();
    assert.equal(ev.payload.category, 'follow-up');
    assert.equal(ev.payload.path, 'scheduled');
    assert.equal(ev.payload.reason, 'demo-intent-owns-next-step');

    // (c) Quiet hours on → the row waits for the window to end instead of sending or skipping.
    await withQuietHours({ enabled: true, start: '00:00', end: '23:59' }, 'Asia/Kolkata', async () => {
      const r = await prospect({ priorContact: true });
      const rLead: any = await m.Lead.findOne({ phone: r.phone }).lean();
      await Orch.updateOne({ key: 'default' }, { $addToSet: { leadIdAllowlist: rLead._id } });
      await runNurture(r.auditId).done;
      await m.SalesConversation.updateOne({ phoneKey: r.phone.slice(-10) }, { $set: { 'nurtureTiming.quietHours': { enabled: true, start: '00:00', end: '23:59' } } });
      await makeDue(rLead._id); await tick();
      const waiting: any = await m.ScheduledAction.findOne({ leadId: rLead._id, createdBy: 'sales-agent-drip' }).lean();
      assert.equal(waiting.status, 'PENDING');
      assert.ok(new Date(waiting.dueAt).getTime() > Date.now(), 'deferred to the end of quiet hours');
      assert.equal(await count(r.phone), 1, 'not sent during quiet hours');
    });

    // (d) Nurturing switched off before it fired → skipped, recorded.
    const s = await prospect({ priorContact: true });
    const sLead: any = await m.Lead.findOne({ phone: s.phone }).lean();
    await Orch.updateOne({ key: 'default' }, { $addToSet: { leadIdAllowlist: sLead._id } });
    await runNurture(s.auditId).done;
    await withSalesConfig({ nurtureEnabled: false }, async () => {
      await makeDue(sLead._id); await tick();
    });
    assert.equal(await count(s.phone), 1);
    assert.equal((await m.ScheduledAction.findOne({ leadId: sLead._id, createdBy: 'sales-agent-drip' }).lean()).reason, 'pre-sales: nurture-disabled');
  } finally {
    delete process.env.LEAD_ENGINE_V2;
  }
});

test('skip categories: preparation-time skips are recorded; the Nurturing list shows only nurturing categories, labelled', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { recentSkippedNurture, skipCategoryOf } = await import('../../src/services/nurture/nurtureAdminConfig');
  const LeadEvent = await LeadEventModel();
  await withSalesConfig({ nurtureEnabled: false }, async () => {
    const p = await prospect({ priorContact: true });
    await runNurture(p.auditId).done;
    const ev: any = await LeadEvent.findOne({ type: 'NURTURE_ACTION_SKIPPED', phone: p.phone }).lean();
    assert.equal(ev.payload.category, 'preparation');
    assert.equal(ev.payload.reason, 'nurture-disabled');
  });
  const opted = await prospect({ priorContact: true, lead: { nurtureStatus: 'OPTED_OUT' } });
  await runNurture(opted.auditId).done;
  assert.equal((await LeadEvent.findOne({ type: 'NURTURE_ACTION_SKIPPED', phone: opted.phone }).lean() as any).payload.category, 'preparation');

  // Other agents' skips are not nurturing — never listed, never mislabelled.
  await LeadEvent.create({ phone: '+919111100001', type: 'NURTURE_ACTION_SKIPPED', payload: { reason: 'quiet', agent: 'demo-agent', actionType: 'DEMO_REMINDER' }, actor: 'demo-agent' });
  await LeadEvent.create({ phone: '+919111100002', type: 'NURTURE_ACTION_SKIPPED', payload: { reason: 'human-owned', agent: 'sales-agent' }, actor: 'sales-agent' });
  const list = await recentSkippedNurture(200);
  assert.ok(!list.some((x: any) => x.phone === '+919111100001' || x.phone === '+919111100002'));
  assert.ok(list.some((x: any) => x.phone === opted.phone && x.categoryLabel === 'not started'));
  assert.equal(skipCategoryOf({ agent: 'sales-agent-drip' }), 'follow-up', 'older events still categorised');
  assert.equal(skipCategoryOf({ agent: 'SALES', isReply: false }), 'follow-up');
  assert.equal(skipCategoryOf({ agent: 'demo-agent', actionType: 'DEMO_REMINDER' }), 'demo-reminder');
});

test('returning lead after a cancelled demo: "Hi" reaches the Sales agent with history, not the first-contact menu', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const p = await prospect();
  const thread = await m.SalesConversation.create({ businessId: p.businessId, leadPhone: p.phone, phoneKey: p.phone.slice(-10), status: 'handed_off', consentStatus: 'granted', messages: [{ role: 'lead', text: 'book a demo', at: new Date(Date.now() - 86_400_000) }] } as any);
  dispatched.length = 0;
  await inbound(p.phone, 'Hi again');
  assert.deepEqual(dispatched.map((e) => e.name), ['sales/agent.reply']);
  const reopened: any = await m.SalesConversation.findById(thread._id).lean();
  assert.equal(reopened.status, 'active');
  assert.equal(reopened.messages.length, 2, 'history kept');
  assert.equal(await count(p.phone), 0, 'no menu');

  // A brand-new number still gets the menu; an opted-out returning lead is never reopened.
  const fresh = `+9198771${String(++seq).padStart(5, '0')}`;
  await inbound(fresh, 'Hi');
  const menu = await rows(fresh);
  assert.equal(menu.length, 1, 'first-contact menu is delivered');
  assert.equal(menu[0].payload.contentSid, undefined, 'as a free-form reply inside the 24h window, not a refused template');
  const out = await prospect({ lead: { nurtureStatus: 'OPTED_OUT' } });
  await m.SalesConversation.create({ businessId: out.businessId, leadPhone: out.phone, phoneKey: out.phone.slice(-10), status: 'handed_off', messages: [] } as any);
  dispatched.length = 0;
  await inbound(out.phone, 'Hi');
  assert.deepEqual(dispatched, []);
  assert.equal((await m.SalesConversation.findOne({ phoneKey: out.phone.slice(-10) }).lean()).status, 'handed_off');
});

test('sales intro: the approved template with exactly {{1}} name and {{2}} business; without it nothing is sent and the claim is released', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { WA_TEMPLATES } = await import('../../src/lib/whatsappTemplates');
  const p = await prospect();
  await runNurture(p.auditId).done;
  const [consent]: any[] = await rows(p.phone);
  assert.equal(consent.payload.contentSid, 'HXsales_intro_test');
  assert.deepEqual(Object.keys(consent.payload.variables).sort(), ['1', '2'], 'matches the live template placeholders');

  const saved = WA_TEMPLATES.salesIntro;
  (WA_TEMPLATES as any).salesIntro = '';
  try {
    const q = await prospect();
    await runNurture(q.auditId).done;
    assert.equal(await count(q.phone), 0, 'no free text and no generic notification template in its place');
    const convo: any = await m.SalesConversation.findOne({ phoneKey: q.phone.slice(-10) }).lean();
    assert.ok(!(convo.nurtureSentKeys || []).includes('consent'), 'the send claim is given back so it can go out once configured');
    assert.equal(convo.consentStatus, 'pending');
  } finally {
    (WA_TEMPLATES as any).salesIntro = saved;
  }
});

test('first WhatsApp message from an unknown number: captured as a New lead (source WhatsApp, their profile name), once', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const fresh = `+9198772${String(++seq).padStart(5, '0')}`;
  const form = (body: string, sid: string) => new URLSearchParams({ MessageSid: sid, From: `whatsapp:${fresh}`, To: 'whatsapp:+919000000000', Body: body, NumMedia: '0', ProfileName: 'Sunita Patil' });
  const send = (body: string, sid: string) => m.webhook.handleTwilioWebhook(new Request('http://localhost/api/whatsapp/webhook', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(body, sid).toString() }));
  await send('Hi', `SMfc1${Date.now()}`);
  await send('hello?', `SMfc2${Date.now()}`);
  const leads: any[] = await m.Lead.find({ tenantId: 'gmbboost-internal', phone: fresh }).lean();
  assert.equal(leads.length, 1, 'one lead, not one per message');
  assert.equal(leads[0].currentStage, 'NEW');
  assert.equal(leads[0].source, 'WhatsApp');
  assert.equal(leads[0].name, 'Sunita Patil');
  assert.ok(await m.SalesConversation.exists({}) !== undefined);
  assert.ok((await rows(fresh)).length >= 1, 'they still get the menu');
});
