/**
 * WhatsApp demo booking end to end: a lead taps an offered time and the REAL
 * booking agent (Inngest engine) books it on a salesperson's Google Calendar
 * — faked at the HTTP level, so nothing reaches Google — files the
 * DemoBooking, sends the confirmation with the Meet link and schedules the
 * reminders. Regression for the tapped-time bug: stored offered slots were
 * copied with a spread of the Mongoose sub-document, so their date/time were
 * undefined, no tap ever matched, and the step crashed on `date.split`.
 *
 * Run: npx tsx --test tests/workflow/whatsapp-demo-booking.test.ts
 */
// First: a fake next/headers (the free-report account setup sets a cookie),
// suppressed sends and a session secret.
import '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runDurably } from '../helpers/inngestReplay';

for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|GROQ|OPENAI|INNGEST|LEAD_ENGINE|GOOGLE_CALENDAR)_?/.test(k) && k !== 'INNGEST_DEV') delete process.env[k];
process.env.GROQ_API_KEY = 'test-unused';
process.env.GROQ_BASE_URL = 'http://127.0.0.1:9';
process.env.WHATSAPP_PROVIDER = 'twilio';
process.env.PLATFORM_WHATSAPP_NUMBER = '+919000000000';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.GOOGLE_TOKEN_SECRET = '0123456789abcdef'.repeat(4);

// ── Fake Google (token, free/busy, event insert) ──────────────────────────
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
  process.env.MONGODB_URI = memoryServer.getUri(`gm_wa_demo_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  const client = await import('../../src/services/inngest/client');
  (client.inngest as any).send = async (e: any) => { for (const x of [e].flat()) dispatched.push(x); return { ids: [] }; };
  m = {
    mongoose: (await import('mongoose')).default,
    fns: await import('../../src/services/inngest/functions'),
    crypto: await import('../../src/lib/crypto'),
    Lead: (await import('../../src/models/Lead')).default,
    User: (await import('../../src/models/User')).default,
    DemoBooking: (await import('../../src/models/DemoBooking')).default,
    BookingConversation: (await import('../../src/models/BookingConversation')).default,
    BookingAgentConfig: (await import('../../src/models/BookingAgentConfig')).default,
    Connection: (await import('../../src/models/SalespersonCalendarConnection')).default,
    ScheduledAction: (await import('../../src/models/ScheduledAction')).default,
    MessageQueue: (await import('../../src/models/MessageQueue')).default,
    ReportConversation: (await import('../../src/models/ReportConversation')).default,
    Audit: (await import('../../src/models/Audit')).default,
    Processed: (await import('../../src/models/ProcessedWebhookEvent')).default,
    webhook: await import('../../src/app/api/whatsapp/webhook/route'),
    choice: await import('../../src/services/whatsapp/prospectChoice'),
  };
  await m.Processed.init();
  await m.BookingAgentConfig.updateOne({ key: 'default' }, { $set: { enabled: true, automatedBookingEnabled: true } }, { upsert: true });
  const sales: any = await m.User.create({ fullName: 'Rahul Sales', email: 'rahul-sales@example.invalid', phone: '+919800000001', role: 'SUPER_ADMIN' } as any);
  await m.Connection.create({ userId: sales._id, googleEmail: 'rahul-sales@example.invalid', calendarId: 'primary', refreshTokenEnc: m.crypto.encrypt('1//refresh-test'), status: 'active' } as any);
});

after(async () => {
  globalThis.fetch = realFetch;
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

/** The next Monday–Friday at least two days out, 11:30 IST (06:00 UTC). */
function nextWorkdaySlot(): { date: string; time: string; startUtc: Date } {
  const d = new Date(Date.now() + 2 * 86_400_000);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  const date = d.toISOString().slice(0, 10);
  return { date, time: '11:30', startUtc: new Date(`${date}T06:00:00.000Z`) };
}

test('tapping an offered time books it: calendar event with Meet link, DemoBooking, confirmation, reminders — no "team member" handoff', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = '+919877700001';
  const lead = await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Sarvesh Gadkari', phone, businessType: 'Mulsetu', currentAgent: 'DEMO', currentStage: 'DEMO_REQUESTED' } as any);
  const slot = nextWorkdaySlot();
  const labels = await import('../../src/services/whatsapp/slotButtons');
  const other = { ...slot, time: '15:00', startUtc: new Date(slot.startUtc.getTime() + 3.5 * 3600_000) };
  const convo = await m.BookingConversation.create({
    leadPhone: phone, phoneKey: phone.slice(-10), leadId: lead._id, status: 'awaiting_slot_selection',
    details: { name: 'Sarvesh Gadkari', businessName: 'Mulsetu' },
    offeredSlots: [slot, other],
    messages: [{ role: 'lead', text: '11:30 AM', at: new Date(), via: 'whatsapp' }],
  } as any);

  // What WhatsApp sends back for a tapped list row: the row title and its day.
  await runDurably(m.fns.bookingAgentReply, { data: { conversationId: String(convo._id), body: `${labels.timeLabel(slot.time)}\n${labels.dateLabel(slot.date)}` } });

  assert.equal(google.inserted.length, 1, 'one calendar event');
  assert.equal(new Date(google.inserted[0].start.dateTime).toISOString(), slot.startUtc.toISOString(), 'the tapped time, not the other one');
  const booking: any = await m.DemoBooking.findOne({ leadId: lead._id }).lean();
  assert.ok(booking, 'booking filed');
  assert.equal(booking.status, 'Confirmed');
  assert.equal(booking.meetingLink, 'https://meet.google.com/abc-defg-hij');
  const sent: any[] = await m.MessageQueue.find({ 'payload.phone': phone }).lean();
  const texts = sent.map((r) => r.payload.body || r.payload.variables?.['2'] || '');
  assert.ok(texts.some((x) => x.includes('meet.google.com/abc-defg-hij')), 'confirmation with the Meet link');
  assert.ok(!texts.some((x) => /team member help schedule/.test(x)), 'no handoff');
  const reminders = await m.ScheduledAction.countDocuments({ leadId: lead._id, actionType: 'DEMO_REMINDER' });
  assert.ok(reminders >= 2, `reminders scheduled (${reminders})`);
  const after: any = await m.BookingConversation.findById(convo._id).lean();
  assert.equal(after.status, 'booked');
});

const sentTo = async (phone: string): Promise<string[]> => (await m.MessageQueue.find({ 'payload.phone': phone }).sort({ createdAt: 1 }).lean()).map((r: any) => r.payload.body || r.payload.variables?.['2'] || '');
let sidSeq = 0;
/** A Twilio inbound on the platform line; `listId` is what a tapped list row sends. */
async function inbound(from: string, body: string, listId?: string) {
  const form = new URLSearchParams({ MessageSid: `SMdemo${Date.now()}${++sidSeq}`, From: `whatsapp:${from}`, To: 'whatsapp:+919000000000', Body: body, NumMedia: '0', ProfileName: 'Sarvesh', ...(listId ? { ListId: listId } : {}) });
  const res = await m.webhook.handleTwilioWebhook(new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(),
  }));
  return res.status;
}

test('a tap (Twilio sends the row id "2") after the bot handed scheduling to a person still books — and the handoff ends, so reminders go out', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = '+919877700002';
  const lead = await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Asha', phone, businessType: 'Asha Bakery', currentAgent: 'HUMAN', currentStage: 'DEMO_REQUESTED', humanHandoff: { active: true, reason: 'calendar-api-failure', since: new Date() } } as any);
  const slot = nextWorkdaySlot();
  const earlier = { ...slot, time: '10:30', startUtc: new Date(slot.startUtc.getTime() - 3600_000) };
  const convo = await m.BookingConversation.create({
    leadPhone: phone, phoneKey: phone.slice(-10), leadId: lead._id, status: 'awaiting_slot_selection', schedulingHandoffAt: new Date(),
    details: { name: 'Asha', businessName: 'Asha Bakery' }, offeredSlots: [earlier, slot], messages: [],
  } as any);
  const before = google.inserted.length;

  await runDurably(m.fns.bookingAgentReply, { data: { conversationId: String(convo._id), body: '2' } });

  assert.equal(google.inserted.length, before + 1, 'booked on the calendar');
  assert.equal(new Date(google.inserted.at(-1).start.dateTime).toISOString(), slot.startUtc.toISOString(), 'row 2, not row 1');
  const fresh: any = await m.Lead.findById(lead._id).lean();
  assert.equal(fresh.humanHandoff.active, false, 'the scheduling handoff ended');
  assert.equal(fresh.currentAgent, 'DEMO');
  assert.ok(await m.ScheduledAction.countDocuments({ leadId: lead._id, actionType: 'DEMO_REMINDER', status: 'PENDING' }) >= 2, 'reminders pending');
  assert.ok(!(await sentTo(phone)).some((x) => /team member help schedule/.test(x)));
});

test('a team member\'s own takeover is not ended by a booking', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = '+919877700003';
  const lead = await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Ravi', phone, businessType: 'Ravi Motors', currentAgent: 'HUMAN', humanHandoff: { active: true, reason: 'inbox-takeover', since: new Date() } } as any);
  const slot = nextWorkdaySlot();
  const convo = await m.BookingConversation.create({ leadPhone: phone, phoneKey: phone.slice(-10), leadId: lead._id, status: 'awaiting_slot_selection', details: { name: 'Ravi', businessName: 'Ravi Motors' }, offeredSlots: [{ ...slot, time: '16:00', startUtc: new Date(slot.startUtc.getTime() + 4.5 * 3600_000) }], messages: [] } as any);
  await runDurably(m.fns.bookingAgentReply, { data: { conversationId: String(convo._id), body: '1' } });
  assert.equal((await m.Lead.findById(lead._id).lean()).humanHandoff.active, true);
});

test('booked demo + "I want free report as well": the report is started (asks only the city), the demo is untouched, and a reschedule still reaches the booking agent', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = '+919877700004';
  const lead = await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Sarvesh Gadkari', phone, businessType: 'Mulsetu', currentAgent: 'DEMO', currentStage: 'DEMO_SCHEDULED' } as any);
  const booking = await m.DemoBooking.create({ leadId: lead._id, name: 'Sarvesh Gadkari', phone, company: 'Mulsetu', date: 'Wed, 28 Oct', timeSlot: '11:30 AM', status: 'Confirmed', channel: 'whatsapp' } as any);
  const convo = await m.BookingConversation.create({ leadPhone: phone, phoneKey: phone.slice(-10), leadId: lead._id, bookingId: booking._id, status: 'booked', details: { name: 'Sarvesh Gadkari', businessName: 'Mulsetu', location: '' }, messages: [] } as any);
  const bookingReplies = () => dispatched.filter((e) => e.name === 'booking/agent.reply' && e.data.conversationId === String(convo._id)).length;

  assert.equal(await inbound(phone, 'I want free report as well'), 200);
  assert.equal(bookingReplies(), 0, 'not sent to the booking agent');
  assert.deepEqual(await sentTo(phone), [m.choice.REPORT_ASK_LOCATION], 'business name known from the booking — only the city is asked');

  assert.equal(await inbound(phone, 'Pune'), 200);
  assert.equal(bookingReplies(), 0);
  const texts = await sentTo(phone);
  assert.equal(texts.at(-1), m.choice.reportProcessingDuringDemo(true), 'report under way, demo stays booked — no "or book a demo?"');
  assert.ok(await m.Audit.exists({ businessName: 'Mulsetu' }), 'the report is generating');

  const after: any = await m.BookingConversation.findById(convo._id).lean();
  assert.equal(after.status, 'booked');
  assert.equal((await m.DemoBooking.findById(booking._id).lean()).status, 'Confirmed');
  assert.equal((await m.Lead.findById(lead._id).lean()).currentAgent, 'DEMO', 'still the demo agent\'s lead');

  assert.equal(await inbound(phone, 'can we reschedule'), 200);
  assert.equal(bookingReplies(), 1, 'a reschedule still goes to the booking agent');
});

test('choosing a time while a report question is open: the tap books, it is not taken as the city', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = '+919877700005';
  const lead = await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Meera', phone, businessType: 'Meera Salon', currentAgent: 'DEMO', currentStage: 'DEMO_REQUESTED' } as any);
  const slot = nextWorkdaySlot();
  const convo = await m.BookingConversation.create({ leadPhone: phone, phoneKey: phone.slice(-10), leadId: lead._id, status: 'awaiting_slot_selection', details: { name: 'Meera', businessName: 'Meera Salon' }, offeredSlots: [slot], messages: [] } as any);
  assert.equal(await inbound(phone, 'send me the free report too'), 200);
  assert.equal((await sentTo(phone)).at(-1), m.choice.REPORT_ASK_LOCATION);
  assert.equal(await inbound(phone, '11:30 AM', '1'), 200);
  assert.equal(dispatched.filter((e) => e.name === 'booking/agent.reply' && e.data.conversationId === String(convo._id)).at(-1)?.data.body, '1', 'the tap went to booking');
  const intake: any = await m.ReportConversation.findOne({ phoneKey: phone.slice(-10) }).lean();
  assert.equal(intake.intakePhase, 'need-location', 'city still to be asked — the tap was not taken as one');
});

test('a chat a team member took over: "free report" is left to the team', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = '+919877700006';
  const lead = await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Kiran', phone, businessType: 'Kiran Store', currentAgent: 'HUMAN', humanHandoff: { active: true, reason: 'inbox-takeover', since: new Date() } } as any);
  const convo = await m.BookingConversation.create({ leadPhone: phone, phoneKey: phone.slice(-10), leadId: lead._id, status: 'active', details: { name: 'Kiran', businessName: 'Kiran Store', location: 'Nashik' }, messages: [] } as any);
  assert.equal(await inbound(phone, 'free report please'), 200);
  assert.equal((await sentTo(phone)).length, 0, 'the bot sends nothing');
  assert.ok(dispatched.some((e) => e.name === 'booking/agent.reply' && e.data.conversationId === String(convo._id)));
});
