/**
 * Demos page fixes through the REAL routes (GET /api/admin/conversion/demos,
 * PATCH /api/admin/demo-bookings) and the REAL booking-chat function, against
 * an in-memory MongoDB. WhatsApp sends are suppressed and recorded.
 *
 * Run: npx tsx --test tests/workflow/admin-demos.test.ts
 */
import { signInAsSuperAdmin, startMemoryDb, stopMemoryDb, jsonReq } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runDurably } from '../helpers/inngestReplay';

for (const k of Object.keys(process.env)) if (/^(TWILIO|META_WHATSAPP|GROQ|INNGEST|LEAD_ENGINE)_?/.test(k) && k !== 'INNGEST_DEV') delete process.env[k];
process.env.WHATSAPP_PROVIDER = 'twilio';
process.env.TWILIO_TEMPLATE_NOTIFICATION = 'HXnotification_test';
process.env.GROQ_API_KEY = 'test-unused';
process.env.GROQ_BASE_URL = 'http://127.0.0.1:9'; // AI fails fast, never leaves the machine

let skipReason: string | null = null;
let m: any = {};
const MIN = 60_000;

before(async () => {
  skipReason = await startMemoryDb('admin_demos');
  if (skipReason) return;
  const client = await import('../../src/services/inngest/client');
  (client.inngest as any).send = async () => ({ ids: [] });
  m = {
    mongoose: (await import('mongoose')).default,
    demos: await import('../../src/app/api/admin/conversion/demos/route'),
    patchRoute: await import('../../src/app/api/admin/demo-bookings/route'),
    fns: await import('../../src/services/inngest/functions'),
    Lead: (await import('../../src/models/Lead')).default,
    DemoBooking: (await import('../../src/models/DemoBooking')).default,
    BookingConversation: (await import('../../src/models/BookingConversation')).default,
    ScheduledAction: (await import('../../src/models/ScheduledAction')).default,
    MessageQueue: (await import('../../src/models/MessageQueue')).default,
    BookingAgentConfig: (await import('../../src/models/BookingAgentConfig')).default,
  };
  await m.BookingAgentConfig.updateOne({ key: 'default' }, { $set: { enabled: true } }, { upsert: true });
  await signInAsSuperAdmin('demos-admin@example.invalid');
});
after(stopMemoryDb);

let seq = 0;
const rows = (phone: string) => m.MessageQueue.find({ 'payload.phone': phone }).sort({ createdAt: 1 }).lean();
const textOf = (row: any) => row.payload.body || row.payload.variables?.['2'] || '';

/** A booked demo starting `startsInMinutes` from now (negative = in the past), 30 minutes long, with its 3 reminders. */
async function demo(startsInMinutes: number, over: Record<string, unknown> = {}) {
  const phone = `+9198775${String(++seq).padStart(5, '0')}`;
  const lead = await m.Lead.create({ tenantId: 'gmbboost-internal', name: `Neha ${seq}`, phone, currentAgent: 'DEMO', currentStage: 'DEMO_SCHEDULED' } as any);
  const start = new Date(Date.now() + startsInMinutes * MIN);
  const booking = await m.DemoBooking.create({
    leadId: lead._id, name: `Neha ${seq}`, phone, date: 'Tue 27 Oct', timeSlot: '11:00 AM', status: 'Confirmed',
    startUtc: start, endUtc: new Date(start.getTime() + 30 * MIN), ...over,
  } as any);
  for (const r of ['24h', '1h', '15m']) {
    await m.ScheduledAction.create({ leadId: lead._id, actionType: 'DEMO_REMINDER', dueAt: new Date(Date.now() + MIN), status: 'PENDING', idempotencyKey: `r-${booking._id}-${r}`, payload: { bookingId: String(booking._id), reminderType: r } } as any);
  }
  const convo = await m.BookingConversation.create({ leadPhone: phone, phoneKey: phone.slice(-10), leadId: lead._id, bookingId: booking._id, status: 'booked', messages: [] } as any);
  return { phone, lead, booking, convo };
}

const patch = async (body: any) => {
  const res = await m.patchRoute.PATCH(jsonReq('https://x.invalid/api/admin/demo-bookings', 'PATCH', body));
  return { status: res.status, body: await res.json() };
};
const list = async () => (await m.demos.GET(new Request('https://x.invalid/api/admin/conversion/demos'))).json();

test('cancel an upcoming demo from the status menu: slot + reminders freed, chat closed, lead back to Sales, customer told once', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const d = await demo(2 * 24 * 60);
  const res = await patch({ bookingId: String(d.booking._id), status: 'Cancelled' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.customerNotified, true);
  const sent = await rows(d.phone);
  assert.equal(sent.length, 1);
  assert.match(textOf(sent[0]), /your Growwmatics demo on Tue 27 Oct at 11:00 AM has been cancelled/);
  assert.equal((await m.BookingConversation.findById(d.convo._id).lean()).status, 'stopped', 'the chat no longer says "booked"');
  const lead: any = await m.Lead.findById(d.lead._id).lean();
  assert.equal(lead.currentAgent, 'SALES');
  assert.equal(await m.ScheduledAction.countDocuments({ leadId: d.lead._id, status: 'PENDING' }), 0, 'no reminders left');

  // Re-saving the same status, or flipping back and cancelling again, never resends.
  await patch({ bookingId: String(d.booking._id), status: 'Confirmed' });
  await patch({ bookingId: String(d.booking._id), status: 'Cancelled' });
  assert.equal((await rows(d.phone)).length, 1, 'told once');
});

test('cancelling a demo that is already over sends nothing (admin tidy-up)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const d = await demo(-120);
  const res = await patch({ bookingId: String(d.booking._id), status: 'Cancelled' });
  assert.equal(res.body.customerNotified, false);
  assert.equal((await rows(d.phone)).length, 0);
});

test('reschedule from the status menu: customer asked to reply RESCHEDULE; any other reply gets "needs a new time", never "booked"', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const d = await demo(3 * 24 * 60);
  const res = await patch({ bookingId: String(d.booking._id), status: 'Rescheduled' });
  assert.equal(res.body.customerNotified, true);
  assert.match(textOf((await rows(d.phone))[0]), /we need to move your Growwmatics demo.*Reply RESCHEDULE/);
  assert.equal((await m.BookingConversation.findById(d.convo._id).lean()).status, 'booked', 'so RESCHEDULE runs the existing flow');
  assert.equal(await m.ScheduledAction.countDocuments({ leadId: d.lead._id, status: 'PENDING' }), 0);

  await m.BookingConversation.updateOne({ _id: d.convo._id }, { $push: { messages: { role: 'lead', text: 'Is it still on?', at: new Date(), via: 'whatsapp' } } });
  await runDurably(m.fns.bookingAgentReply, { data: { conversationId: String(d.convo._id), body: 'Is it still on?' } });
  const all = await rows(d.phone);
  assert.match(textOf(all[all.length - 1]), /needs a new time\. Reply RESCHEDULE/);
});

test('a booked chat for a demo that was cancelled elsewhere is never told it is booked', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const d = await demo(24 * 60);
  await m.DemoBooking.updateOne({ _id: d.booking._id }, { $set: { status: 'Cancelled' } }); // e.g. cancelled before this fix
  await m.BookingConversation.updateOne({ _id: d.convo._id }, { $push: { messages: { role: 'lead', text: 'see you tomorrow', at: new Date(), via: 'whatsapp' } } });
  await runDurably(m.fns.bookingAgentReply, { data: { conversationId: String(d.convo._id), body: 'see you tomorrow' } });
  const all = await rows(d.phone);
  assert.match(textOf(all[all.length - 1]), /was cancelled\. If you'd still like one, reply DEMO/);
  assert.equal((await m.BookingConversation.findById(d.convo._id).lean()).status, 'stopped');
});

test('"Completed" from the status menu is refused before the demo has ended; allowed after', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const future = await demo(60);
  const refused = await patch({ bookingId: String(future.booking._id), status: 'Completed' });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /hasn't ended yet/);
  assert.equal((await m.DemoBooking.findById(future.booking._id).lean()).status, 'Confirmed');
  assert.equal((await m.Lead.findById(future.lead._id).lean()).currentAgent, 'DEMO', 'lead not marked as having had a demo');

  const past = await demo(-120);
  assert.equal((await patch({ bookingId: String(past.booking._id), status: 'Completed' })).status, 200);
});

test('a Pending demo arranged by a person can get its outcome once its time has passed', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const d = await demo(-90, { status: 'Pending' });
  const listed = await list();
  const row = listed.all.find((r: any) => r._id === String(d.booking._id));
  assert.equal(row.canConfirmAttendance, true);
  const res = await patch({ bookingId: String(d.booking._id), attendance: 'attended' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await m.DemoBooking.findById(d.booking._id).lean()).status, 'Completed');
});

test('"Today" is the India day and "Needs outcome" starts as soon as a demo ends', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await m.DemoBooking.deleteMany({});
  // 01:30 IST on 27 Oct = 20:00 UTC on 26 Oct. A demo at 15:30 IST on 27 Oct is TODAY in India
  // (on a UTC server the old code put it in "upcoming").
  const now = new Date('2026-10-26T20:00:00Z');
  const lead = await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Tara', phone: '+919877599001' } as any);
  const later = await m.DemoBooking.create({ leadId: lead._id, name: 'Tara', phone: lead.phone, date: '27 Oct', timeSlot: '3:30 PM', status: 'Confirmed', startUtc: new Date('2026-10-27T10:00:00Z'), endUtc: new Date('2026-10-27T10:30:00Z') } as any);
  // Ended 10 minutes ago, nothing recorded → needs an outcome now, not tomorrow.
  const ended = await m.DemoBooking.create({ leadId: lead._id, name: 'Tara', phone: lead.phone, date: '27 Oct', timeSlot: '1:00 AM', status: 'Confirmed', startUtc: new Date('2026-10-26T19:20:00Z'), endUtc: new Date('2026-10-26T19:50:00Z') } as any);
  t.mock.timers.enable({ apis: ['Date'], now });
  try {
    const out = await list();
    assert.ok(out.groups.today.some((r: any) => r._id === String(later._id)), 'today in India');
    assert.ok(!out.groups.upcoming.some((r: any) => r._id === String(later._id)));
    assert.ok(out.groups.overdue.some((r: any) => r._id === String(ended._id)), 'needs outcome right after it ends');
    assert.ok(!out.groups.overdue.some((r: any) => r._id === String(later._id)));
  } finally {
    t.mock.timers.reset();
  }
});
