/**
 * Demo attendance lifecycle (Segment 1): the automatic no-show timeout vs a
 * person's confirmation, and the one post-demo message each allows.
 *
 * Real services against an in-memory MongoDB. The 15-minute scheduler
 * (nurtureSchedulerTick) runs through the Inngest SDK's own execution engine
 * (tests/helpers/inngestReplay.ts), not a hand-written step mock. WhatsApp
 * delivery is mocked by the existing suppression switch (every send is a
 * MessageQueue row; no provider is contacted); Groq points at a closed local
 * port; inngest.send is captured.
 *
 * Run: npx tsx --test tests/workflow/demo-attendance.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runDurably } from '../helpers/inngestReplay';

process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|RESEND|SENDGRID|GROQ|OPENAI|INNGEST|LEAD_ENGINE)_?/.test(k) && k !== 'INNGEST_DEV') delete process.env[k];
process.env.GROQ_API_KEY = 'test-unused';
process.env.GROQ_BASE_URL = 'http://127.0.0.1:9';
process.env.WHATSAPP_PROVIDER = 'twilio';
process.env.TWILIO_TEMPLATE_NOTIFICATION = 'HXnotification_test';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
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
  process.env.MONGODB_URI = memoryServer.getUri(`gm_demo_attendance_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  const client = await import('../../src/services/inngest/client');
  (client.inngest as any).send = async (e: any) => { dispatched.push(e); return { ids: [] }; };
  m = {
    mongoose: (await import('mongoose')).default,
    Lead: (await import('../../src/models/Lead')).default,
    User: (await import('../../src/models/User')).default,
    Business: (await import('../../src/models/Business')).default,
    DemoBooking: (await import('../../src/models/DemoBooking')).default,
    BookingConversation: (await import('../../src/models/BookingConversation')).default,
    ScheduledAction: (await import('../../src/models/ScheduledAction')).default,
    MessageQueue: (await import('../../src/models/MessageQueue')).default,
    SalesAgentConfig: (await import('../../src/models/SalesAgentConfig')).default,
    fns: await import('../../src/services/inngest/functions'),
    policy: await import('../../src/services/sales/preSalesPolicy'),
    rules: await import('../../src/lib/preSalesRules'),
    webhook: await import('../../src/app/api/whatsapp/webhook/route'),
    phone: await import('../../src/lib/phone'),
  };
  await m.SalesAgentConfig.create({
    key: 'default', enabled: true,
    firstMessage: { mode: 'template', delayMinutes: 2, template: 'Hi {{name}}', aiSystemPrompt: '' },
    followUps: [], agentSystemPrompt: 'x', subscribeUrl: 'https://app.example.test/dashboard/billing',
  } as any);
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const MIN = 60_000;
let seq = 0;
const rows = (phone: string) => m.MessageQueue.find({ 'payload.phone': phone }).sort({ createdAt: 1 }).lean();
const count = (phone: string) => m.MessageQueue.countDocuments({ 'payload.phone': phone });
const textOf = (row: any) => row.payload.body || row.payload.variables?.['2'] || '';
const booking = (id: unknown) => m.DemoBooking.findById(id).lean();

/** A booked demo (lead DEMO-owned, booking thread 'booked') that started `startedMinutesAgo` minutes ago, 30 minutes long. */
async function bookedDemo(startedMinutesAgo = 120) {
  const n = ++seq;
  const phone = `+9198773${String(n).padStart(5, '0')}`;
  const lead = await m.Lead.create({ tenantId: 'gmbboost-internal', name: `Priya ${n}`, phone, currentAgent: 'DEMO', currentStage: 'DEMO_SCHEDULED' } as any);
  const start = new Date(Date.now() - startedMinutesAgo * MIN);
  const b = await m.DemoBooking.create({
    leadId: lead._id, name: `Priya ${n}`, phone, company: `Cafe ${n}`, date: 'Mon 26 Oct', timeSlot: '4:00 PM',
    status: 'Confirmed', channel: 'whatsapp', startUtc: start, endUtc: new Date(start.getTime() + 30 * MIN), meetingLink: 'https://meet.example/x',
  } as any);
  await m.BookingConversation.create({ leadPhone: phone, phoneKey: m.phone.phoneDedupeKey(phone), leadId: lead._id, bookingId: b._id, status: 'booked', messages: [{ role: 'lead', text: 'book me', at: new Date(start.getTime() - 86_400_000), via: 'whatsapp' }] } as any);
  return { phone, leadId: lead._id, bookingId: String(b._id) };
}

/** Real-engine scheduler pass after making this lead's pending rows due. */
async function fireDue(leadId: unknown) {
  await m.ScheduledAction.updateMany({ leadId, status: 'PENDING' }, { $set: { dueAt: new Date(Date.now() - 1000) } });
  await runDurably(m.fns.nurtureSchedulerTick, { data: {} });
}

const confirm = (bookingId: string, outcome: string) => m.policy.confirmDemoAttendance({ bookingId, outcome, staffUserId: null });
const postDemoRows = (leadId: unknown) => m.ScheduledAction.find({ leadId, actionType: 'FOLLOW_UP_AFTER_DEMO' }).lean();

test('automatic timeout: No Show + "unconfirmed", lead untouched, no message, no follow-up row', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const d = await bookedDemo(60);
  await m.ScheduledAction.create({ leadId: d.leadId, actionType: 'NO_SHOW_CHECK', dueAt: new Date(Date.now() - 1000), status: 'PENDING', idempotencyKey: `ns-${d.bookingId}`, payload: { bookingId: d.bookingId } } as any);
  await runDurably(m.fns.nurtureSchedulerTick, { data: {} });
  const b: any = await booking(d.bookingId);
  assert.equal(b.status, 'No Show', 'existing views and analytics still see a no-show');
  assert.equal(b.attendance.outcome, 'unconfirmed');
  assert.equal(b.attendance.source, 'auto-timeout');
  assert.equal(m.rules.confirmedAttendance(b), null, 'not attendance data');
  const lead: any = await m.Lead.findById(d.leadId).lean();
  assert.equal(lead.currentStage, 'DEMO_SCHEDULED', 'no "demo completed" claim');
  assert.equal((await postDemoRows(d.leadId)).length, 0);
  assert.equal(await count(d.phone), 0);
});

test('the timeout never overwrites an outcome a person already recorded', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const d = await bookedDemo(60);
  assert.deepEqual(await confirm(d.bookingId, 'declined'), { ok: true, scheduled: false });
  await m.ScheduledAction.create({ leadId: d.leadId, actionType: 'NO_SHOW_CHECK', dueAt: new Date(Date.now() - 1000), status: 'PENDING', idempotencyKey: `ns2-${d.bookingId}`, payload: { bookingId: d.bookingId } } as any);
  await runDurably(m.fns.nurtureSchedulerTick, { data: {} });
  const b: any = await booking(d.bookingId);
  assert.equal(b.status, 'Completed');
  assert.equal(b.attendance.outcome, 'declined');
});

test('a person confirms No Show on an auto-marked booking directly → one rescheduling message; the reply uses the reschedule flow', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const d = await bookedDemo(60);
  await m.DemoBooking.updateOne({ _id: d.bookingId }, { $set: { status: 'No Show', attendance: { outcome: 'unconfirmed', source: 'auto-timeout', at: new Date() } } });
  const res = await confirm(d.bookingId, 'no_show');
  assert.deepEqual(res, { ok: true, scheduled: true }, 'no status switch needed');
  await fireDue(d.leadId);
  const sent = await rows(d.phone);
  assert.equal(sent.length, 1);
  assert.match(textOf(sent[0]), /sorry we missed you at your Growwmatics demo on Mon 26 Oct at 4:00 PM/);
  assert.match(textOf(sent[0]), /Reply RESCHEDULE/);
  // The reply lands in the existing booking thread → booking agent (reschedule flow).
  dispatched.length = 0;
  const form = new URLSearchParams({ MessageSid: `SMr${Date.now()}`, From: `whatsapp:${d.phone}`, To: 'whatsapp:+919000000000', Body: 'RESCHEDULE', NumMedia: '0' });
  await m.webhook.handleTwilioWebhook(new Request('http://localhost/api/whatsapp/webhook', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() }));
  assert.deepEqual(dispatched.map((e) => e.name), ['booking/agent.reply']);
});

test('attended: refused before the recorded end time; after it, one follow-up — never a second', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const early = await bookedDemo(10); // started 10 min ago, ends in 20
  const refused = await confirm(early.bookingId, 'attended');
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 409);
  assert.equal((await booking(early.bookingId)).status, 'Confirmed', 'nothing recorded');
  assert.equal((await postDemoRows(early.leadId)).length, 0);

  const d = await bookedDemo(120);
  assert.deepEqual(await confirm(d.bookingId, 'attended'), { ok: true, scheduled: true });
  const [row]: any[] = await postDemoRows(d.leadId);
  const b: any = await booking(d.bookingId);
  assert.ok(row.dueAt.getTime() >= new Date(b.endUtc).getTime() + 3 * 60 * MIN - 5000, 'well after the demo end');
  assert.equal(b.status, 'Completed');
  assert.equal(b.attendance.source, 'staff');
  await fireDue(d.leadId);
  assert.match(textOf((await rows(d.phone))[0]), /thank you for joining the Growwmatics demo for Cafe/);
  // Re-confirming, and firing again, adds nothing.
  await confirm(d.bookingId, 'attended');
  await fireDue(d.leadId);
  assert.equal(await count(d.phone), 1);
});

test('declined, not ready and unknown send nothing', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const declined = await bookedDemo();
  assert.deepEqual(await confirm(declined.bookingId, 'declined'), { ok: true, scheduled: false });
  assert.equal((await m.Lead.findById(declined.leadId).lean()).intent, 'NOT_INTERESTED', 'blocks later sales messages too');
  const notReady = await bookedDemo();
  assert.deepEqual(await confirm(notReady.bookingId, 'not_ready'), { ok: true, scheduled: false });
  // Unknown: a status set without a confirmation (e.g. the dropdown) schedules nothing.
  const unknown = await bookedDemo();
  await m.DemoBooking.updateOne({ _id: unknown.bookingId }, { $set: { status: 'Completed' } });
  assert.equal(await m.policy.schedulePostDemoFollowUp({ bookingId: unknown.bookingId, kind: 'attended' }), false);
  for (const d of [declined, notReady, unknown]) {
    await fireDue(d.leadId);
    assert.equal(await count(d.phone), 0);
    assert.equal((await postDemoRows(d.leadId)).length, 0);
  }
});

test('a corrected outcome cancels the old message; only the current one can send', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const d = await bookedDemo();
  await confirm(d.bookingId, 'no_show');
  await confirm(d.bookingId, 'attended');
  const r: any[] = await postDemoRows(d.leadId);
  assert.equal(r.find((x) => x.payload.kind === 'missed').status, 'CANCELLED');
  assert.equal(r.find((x) => x.payload.kind === 'attended').status, 'PENDING');
  await fireDue(d.leadId);
  const sent = await rows(d.phone);
  assert.equal(sent.length, 1);
  assert.match(textOf(sent[0]), /thank you for joining/);
});

test('concurrent confirmations and concurrent scheduler passes send exactly one message', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const d = await bookedDemo();
  await Promise.all([confirm(d.bookingId, 'no_show'), confirm(d.bookingId, 'no_show'), confirm(d.bookingId, 'no_show')]);
  assert.equal((await postDemoRows(d.leadId)).filter((x: any) => x.status === 'PENDING').length, 1);
  // A stray second row for the same booking + demo time (e.g. a manual insert) is stopped by the booking claim.
  const b: any = await booking(d.bookingId);
  await m.ScheduledAction.create({ leadId: d.leadId, actionType: 'FOLLOW_UP_AFTER_DEMO', dueAt: new Date(), status: 'PENDING', idempotencyKey: `dup-${d.bookingId}`, payload: { bookingId: d.bookingId, kind: 'missed', forStartUtc: new Date(b.startUtc).toISOString() } } as any);
  await m.ScheduledAction.updateMany({ leadId: d.leadId, status: 'PENDING' }, { $set: { dueAt: new Date(Date.now() - 1000) } });
  await Promise.all([runDurably(m.fns.nurtureSchedulerTick, { data: {} }), runDurably(m.fns.nurtureSchedulerTick, { data: {} })]);
  assert.equal(await count(d.phone), 1);
  assert.equal((await booking(d.bookingId)).postDemoMessageFor, new Date(b.startUtc).toISOString());
});

test('re-checked at send time: opt-out, human handoff, trial/paid, reschedule, or a reply since the demo', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const cases: Array<[string, (d: any) => Promise<void>, string]> = [
    ['opt-out', async (d) => { await m.Lead.updateOne({ _id: d.leadId }, { $set: { nurtureStatus: 'OPTED_OUT' } }); }, 'opted-out'],
    ['human', async (d) => { await m.Lead.updateOne({ _id: d.leadId }, { $set: { 'humanHandoff.active': true } }); }, 'human-owned'],
    ['trial', async (d) => {
      const userId = new m.mongoose.Types.ObjectId();
      await m.User.create({ _id: userId, fullName: 'P', email: `t${++seq}@example.invalid`, phone: d.phone, role: 'CLIENT' } as any);
      await m.Business.create({ name: 'B', category: 'Cafe', address: 'Pune', userId, organizationId: new m.mongoose.Types.ObjectId(), subscriptionStatus: 'trial_active', trialStartedAt: new Date() } as any);
    }, 'trial-or-paid'],
    ['rescheduled', async (d) => { await m.DemoBooking.updateOne({ _id: d.bookingId }, { $set: { startUtc: new Date(Date.now() + 86_400_000), endUtc: new Date(Date.now() + 86_400_000 + 30 * MIN) } }); }, 'demo-rescheduled'],
    ['replied', async (d) => { await m.BookingConversation.updateOne({ bookingId: d.bookingId }, { $push: { messages: { role: 'lead', text: 'thanks!', at: new Date(), via: 'whatsapp' } } }); }, 'lead-engaged-after-demo'],
  ];
  for (const [, change, reason] of cases) {
    const d = await bookedDemo();
    await confirm(d.bookingId, 'no_show');
    await change(d);
    await fireDue(d.leadId);
    assert.equal(await count(d.phone), 0, reason);
    assert.equal((await postDemoRows(d.leadId))[0].reason, reason);
  }
});

test('after a reschedule the old outcome is stale: unknown again, and the timeout works for the new time', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const d = await bookedDemo();
  await confirm(d.bookingId, 'no_show');
  const newStart = new Date(Date.now() - 50 * MIN);
  await m.DemoBooking.updateOne({ _id: d.bookingId }, { $set: { status: 'Confirmed', startUtc: newStart, endUtc: new Date(newStart.getTime() + 30 * MIN) } });
  assert.equal(m.rules.confirmedAttendance(await booking(d.bookingId)), null);
  await m.ScheduledAction.create({ leadId: d.leadId, actionType: 'NO_SHOW_CHECK', dueAt: new Date(Date.now() - 1000), status: 'PENDING', idempotencyKey: `ns3-${d.bookingId}`, payload: { bookingId: d.bookingId } } as any);
  await runDurably(m.fns.nurtureSchedulerTick, { data: {} });
  const b: any = await booking(d.bookingId);
  assert.equal(b.attendance.outcome, 'unconfirmed');
  assert.equal(new Date(b.attendance.forStartUtc).toISOString(), newStart.toISOString());
});

test('existing demo reminders still send through the real scheduler', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const d = await bookedDemo(-2 * 24 * 60); // starts in 2 days
  const b: any = await m.DemoBooking.findById(d.bookingId);
  const ids = await m.fns.scheduleDemoReminders(d.leadId, b, b.startUtc, 30);
  assert.equal(ids.length, 4);
  await m.ScheduledAction.updateOne({ leadId: d.leadId, actionType: 'DEMO_REMINDER', 'payload.reminderType': '24h' }, { $set: { dueAt: new Date(Date.now() - 1000) } });
  await runDurably(m.fns.nurtureSchedulerTick, { data: {} });
  const sent = await rows(d.phone);
  assert.equal(sent.length, 1);
  assert.match(textOf(sent[0]), /Just a reminder that your GrowwMatics demo is tomorrow/);
});

test('re-confirming the same outcome while its message is pending keeps exactly one message (regression)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const d = await bookedDemo();
  await confirm(d.bookingId, 'attended');
  await confirm(d.bookingId, 'attended'); // its lead hand-back cancels pending rows — the row must come back
  const pending = (await postDemoRows(d.leadId)).filter((x: any) => x.status === 'PENDING');
  assert.equal(pending.length, 1);
  await fireDue(d.leadId);
  assert.equal(await count(d.phone), 1);
});

// ── "Our team missed it" (team_missed) ──────────────────────────────────────

test('team missed: booking needs a new time (not a customer no-show), lead not "demo completed", one apology that offers rescheduling', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const d = await bookedDemo(60);
  assert.deepEqual(await confirm(d.bookingId, 'team_missed'), { ok: true, scheduled: true });
  const b: any = await booking(d.bookingId);
  assert.equal(b.status, 'Rescheduled', 'never counted as the customer\'s No Show');
  assert.equal(b.attendance.outcome, 'team_missed');
  const lead: any = await m.Lead.findById(d.leadId).lean();
  assert.equal(lead.currentStage, 'DEMO_SCHEDULED', 'no demo happened — not DEMO_COMPLETED');
  assert.equal(lead.currentAgent, 'DEMO', 'the demo flow keeps the lead to pick a new time');
  const [row]: any[] = await postDemoRows(d.leadId);
  assert.equal(row.payload.kind, 'apology');

  await fireDue(d.leadId);
  await fireDue(d.leadId); // a second pass never sends again
  const sent = await rows(d.phone);
  assert.equal(sent.length, 1);
  assert.match(textOf(sent[0]), /we're very sorry — our team couldn't join your Growwmatics demo on Mon 26 Oct at 4:00 PM/);
  assert.match(textOf(sent[0]), /Reply RESCHEDULE/);
  assert.doesNotMatch(textOf(sent[0]), /we missed you/, 'never implies the customer missed it');

  // The reply uses the existing reschedule flow in the booking thread.
  dispatched.length = 0;
  const form = new URLSearchParams({ MessageSid: `SMtm${Date.now()}`, From: `whatsapp:${d.phone}`, To: 'whatsapp:+919000000000', Body: 'RESCHEDULE', NumMedia: '0' });
  await m.webhook.handleTwilioWebhook(new Request('http://localhost/api/whatsapp/webhook', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() }));
  assert.deepEqual(dispatched.map((e) => e.name), ['booking/agent.reply']);
});

test('team missed can be corrected afterwards, and a corrected outcome cancels the apology', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const d = await bookedDemo(60);
  await confirm(d.bookingId, 'team_missed');
  const corrected = await confirm(d.bookingId, 'no_show');
  assert.equal(corrected.ok, true, 'still editable from Rescheduled');
  const b: any = await booking(d.bookingId);
  assert.equal(b.status, 'No Show');
  const rowsNow: any[] = await postDemoRows(d.leadId);
  assert.equal(rowsNow.find((r) => r.payload.kind === 'apology').status, 'CANCELLED');
  // A booking the LEAD rescheduled (no team_missed record) still cannot take an outcome.
  const other = await bookedDemo(60);
  await m.DemoBooking.updateOne({ _id: other.bookingId }, { $set: { status: 'Rescheduled' } });
  const refused = await confirm(other.bookingId, 'attended');
  assert.equal(refused.ok, false);
});

test('team missed never counts toward the customer no-show rate', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { bookingSummary } = await import('../../src/services/admin/conversionReport');
  const s = bookingSummary([{ bookings: [{ status: 'Rescheduled', attendance: { outcome: 'team_missed' } }, { status: 'Completed' }] } as any]);
  assert.equal(s.noShow, 0);
  assert.equal(s.noShowRate.value, 0);
  assert.equal(m.rules.postDemoKindFor('team_missed'), 'apology');
  assert.equal(m.rules.statusForAttendance('team_missed'), 'Rescheduled');
});
