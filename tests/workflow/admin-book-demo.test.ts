/**
 * Super admin books a demo on a lead's behalf (CRM lead page → "Book a demo
 * for them") through the REAL route, against an in-memory MongoDB with Google
 * Calendar faked at the HTTP level. Checks that the customer gets exactly the
 * same follow-through as a self-booked demo: calendar event + Meet link,
 * WhatsApp confirmation, reminders, Demo-agent ownership — including a lead
 * the team had taken over (HUMAN), whose reminders would otherwise be skipped.
 *
 * Run: npx tsx --test tests/workflow/admin-book-demo.test.ts
 */
import { signInAsSuperAdmin, startMemoryDb, stopMemoryDb, jsonReq } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

for (const k of Object.keys(process.env)) if (/^(TWILIO|META_WHATSAPP|GROQ|INNGEST|LEAD_ENGINE|GOOGLE_CALENDAR)_?/.test(k) && k !== 'INNGEST_DEV') delete process.env[k];
process.env.WHATSAPP_PROVIDER = 'twilio';
process.env.TWILIO_TEMPLATE_NOTIFICATION = 'HXnotification_test';
process.env.GROQ_API_KEY = 'test-unused';
process.env.GROQ_BASE_URL = 'http://127.0.0.1:9';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.GOOGLE_TOKEN_SECRET = '0123456789abcdef'.repeat(4);

const google: { inserted: any[] } = { inserted: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return realFetch(input, init);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'ya29.test', expires_in: 3600 });
  if (url.endsWith('/freeBusy')) return json({ calendars: { primary: { busy: [] } } });
  if (url.includes('/events')) {
    const body = JSON.parse(String(init?.body || '{}'));
    google.inserted.push(body);
    return json({ id: `evt_${google.inserted.length}`, hangoutLink: 'https://meet.google.com/abc-defg-hij', conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] } });
  }
  throw new Error(`unexpected outbound request: ${url}`);
}) as typeof fetch;

let skipReason: string | null = null;
let m: any = {};
const dispatched: any[] = [];

before(async () => {
  skipReason = await startMemoryDb('admin_book_demo');
  if (skipReason) return;
  const client = await import('../../src/services/inngest/client');
  (client.inngest as any).send = async (e: any) => { for (const x of [e].flat()) dispatched.push(x); return { ids: [] }; };
  m = {
    route: await import('../../src/app/api/admin/crm/leads/[id]/book-demo/route'),
    crypto: await import('../../src/lib/crypto'),
    Lead: (await import('../../src/models/Lead')).default,
    User: (await import('../../src/models/User')).default,
    DemoBooking: (await import('../../src/models/DemoBooking')).default,
    BookingConversation: (await import('../../src/models/BookingConversation')).default,
    Connection: (await import('../../src/models/SalespersonCalendarConnection')).default,
    ScheduledAction: (await import('../../src/models/ScheduledAction')).default,
    MessageQueue: (await import('../../src/models/MessageQueue')).default,
  };
  const sales: any = await m.User.create({ fullName: 'Rahul Sales', email: 'rahul-sales@example.invalid', phone: '+919800000001', role: 'SUPER_ADMIN' } as any);
  await m.Connection.create({ userId: sales._id, googleEmail: 'rahul-sales@example.invalid', calendarId: 'primary', refreshTokenEnc: m.crypto.encrypt('1//refresh-test'), status: 'active' } as any);
  await signInAsSuperAdmin('book-demo-admin@example.invalid');
});
after(async () => {
  globalThis.fetch = realFetch;
  await stopMemoryDb();
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const BASE = 'https://x.invalid/api/admin/crm/leads';

/** A Monday–Friday at least two days out, and its first open slot from the GET. */
async function openSlot(leadId: string): Promise<{ date: string; time: string }> {
  const d = new Date(Date.now() + 2 * 86_400_000);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  const date = d.toISOString().slice(0, 10);
  const res = await m.route.GET(new Request(`${BASE}/${leadId}/book-demo?date=${date}`), ctx(leadId));
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(body.slots.length > 0, 'the day has open slots');
  return { date, time: body.slots[0].time };
}
const book = async (leadId: string, body: any) => {
  const res = await m.route.POST(jsonReq(`${BASE}/${leadId}/book-demo`, 'POST', body), ctx(leadId));
  return { status: res.status, body: await res.json() };
};
const sentTo = (phone: string) => m.MessageQueue.find({ 'payload.phone': phone }).lean();

test('booking for a lead the team took over: calendar + Meet, WhatsApp confirmation, reminders, and the Demo agent owns it', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = '+919877711001';
  const lead = await m.Lead.create({
    tenantId: 'gmbboost-internal', name: 'Priya Shah', phone, businessType: 'Shah Dental',
    currentAgent: 'HUMAN', currentStage: 'HUMAN_HANDOFF', humanHandoff: { active: true, reason: 'explicit-request', since: new Date() },
  } as any);
  const slot = await openSlot(String(lead._id));

  const res = await book(String(lead._id), { ...slot, email: 'priya@example.invalid', note: 'Called — wants review replies' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'confirmed');
  assert.equal(res.body.meetingLink, 'https://meet.google.com/abc-defg-hij');
  assert.equal(res.body.whatsappSent, true, res.body.whatsappNote);

  assert.equal(google.inserted.length, 1, 'one calendar event');
  assert.match(google.inserted[0].description, /Booked by our team on the customer's behalf/);
  assert.match(google.inserted[0].description, /Called — wants review replies/);

  const booking: any = await m.DemoBooking.findById(res.body.bookingId).lean();
  assert.equal(booking.status, 'Confirmed');
  assert.equal(booking.channel, 'admin');
  assert.ok(booking.whatsappConfirmationSentAt, 'confirmation claimed');
  assert.equal(await m.DemoBooking.countDocuments({ leadId: lead._id }), 1, 'one booking row');

  const reminders = await m.ScheduledAction.find({ leadId: lead._id, actionType: 'DEMO_REMINDER', status: 'PENDING' }).lean();
  assert.equal(reminders.length, 3, '24h / 1h / 15m reminders');
  assert.equal(await m.ScheduledAction.countDocuments({ leadId: lead._id, actionType: 'NO_SHOW_CHECK', status: 'PENDING' }), 1);

  const after: any = await m.Lead.findById(lead._id).lean();
  assert.equal(after.currentAgent, 'DEMO', 'handed back from HUMAN so reminders are not skipped');
  assert.equal(after.currentStage, 'DEMO_SCHEDULED');
  assert.equal(after.humanHandoff?.active, false);
  assert.equal(after.email, 'priya@example.invalid', 'email saved on the lead');

  const convo: any = await m.BookingConversation.findOne({ leadId: lead._id }).lean();
  assert.equal(convo.status, 'booked');
  assert.equal(String(convo.bookingId), res.body.bookingId);
  assert.ok(!convo.messages.some((x: any) => x.role === 'lead'), 'no words put in the customer\'s mouth');

  assert.equal((await sentTo(phone)).length, 1, 'one WhatsApp confirmation');
  assert.ok(dispatched.some((e) => e.name === 'demo/booked'), 'demo/booked fired (emails)');
});

test('a second booking while one is upcoming is refused — reschedule from Demos instead', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const lead: any = await m.Lead.findOne({ phone: '+919877711001' });
  const slot = await openSlot(String(lead._id));
  const res = await book(String(lead._id), slot);
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'already_booked');
  assert.equal(google.inserted.length, 1, 'no second calendar event');
});

test('a slot that is not open is refused before anything is written', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const lead = await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Late Slot', phone: '+919877711002', currentAgent: 'SALES', currentStage: 'NURTURING' } as any);
  const { date } = await openSlot(String(lead._id));
  const res = await book(String(lead._id), { date, time: '03:00' });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'slot_unavailable');
  assert.equal(await m.DemoBooking.countDocuments({ leadId: lead._id }), 0);
  assert.equal((await m.Lead.findById(lead._id).lean()).currentAgent, 'SALES', 'ownership untouched');
});

test('an opted-out lead is booked but gets no WhatsApp', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = '+919877711003';
  const lead = await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Quiet Lead', phone, currentAgent: 'SALES', currentStage: 'NURTURING', nurtureStatus: 'OPTED_OUT' } as any);
  const slot = await openSlot(String(lead._id));
  // A different time from the first test's booking, which still holds its slot.
  const res = await book(String(lead._id), slot);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, 'confirmed');
  assert.equal(res.body.whatsappSent, false);
  assert.match(res.body.whatsappNote, /opted out/);
  assert.equal((await sentTo(phone)).length, 0);
});

test('a lead from another tenant is not found', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const lead = await m.Lead.create({ tenantId: 'some-customer-tenant', name: 'Not Ours', phone: '+919877711004' } as any);
  const res = await book(String(lead._id), { date: '2030-01-07', time: '11:00' });
  assert.equal(res.status, 404);
});
