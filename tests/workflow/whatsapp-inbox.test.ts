/**
 * The full Super Admin WhatsApp Inbox, through the REAL webhook (Twilio form
 * posts), the real send paths and the real Inbox service, against an
 * in-memory MongoDB. Every send is suppressed into a MessageQueue row;
 * inngest.send is captured; nothing reaches WhatsApp.
 *
 * Covers: every message on our number is in the Inbox (new contacts, support,
 * free report, review replies, customers); review requests a workspace sends
 * to its own customers, login codes and a workspace's own chats are not; the
 * team's replies, unread / needs-reply, resolve and reopen; chats from before
 * the Inbox existed.
 *
 * Run: npx tsx --test tests/workflow/whatsapp-inbox.test.ts
 */
import { signInAsSuperAdmin, startMemoryDb, stopMemoryDb } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|GROQ|OPENAI|INNGEST|LEAD_ENGINE)_?/.test(k) && k !== 'INNGEST_DEV') delete process.env[k];
process.env.GROQ_API_KEY = 'test-unused';
process.env.GROQ_BASE_URL = 'http://127.0.0.1:9';
process.env.WHATSAPP_PROVIDER = 'twilio';
process.env.PLATFORM_WHATSAPP_NUMBER = '+919000000000';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
process.env.TWILIO_TEMPLATE_REVIEW_REQUEST_UTILITY = 'HXreview_utility_test';
process.env.TWILIO_TEMPLATE_LOGIN_OTP = 'HXlogin_otp_test';
process.env.TWILIO_TEMPLATE_NOTIFICATION = 'HXnotification_test';

let skipReason: string | null = null;
let m: any = {};
let admin: any;
const dispatched: any[] = [];

before(async () => {
  skipReason = await startMemoryDb('wa_inbox');
  if (skipReason) return;
  const client = await import('../../src/services/inngest/client');
  (client.inngest as any).send = async (e: any) => { for (const x of [e].flat()) dispatched.push(x); return { ids: [] }; };
  m = {
    mongoose: (await import('mongoose')).default,
    webhook: await import('../../src/app/api/whatsapp/webhook/route'),
    inbox: await import('../../src/services/inbox/platformInbox'),
    log: await import('../../src/services/inbox/whatsappLog'),
    twilio: await import('../../src/services/twilio/client'),
    send: await import('../../src/services/whatsapp/send'),
    Thread: (await import('../../src/models/WhatsAppThread')).default,
    Message: (await import('../../src/models/WhatsAppMessage')).default,
    Lead: (await import('../../src/models/Lead')).default,
    User: (await import('../../src/models/User')).default,
    Business: (await import('../../src/models/Business')).default,
    Customer: (await import('../../src/models/Customer')).default,
    ReviewRequest: (await import('../../src/models/ReviewRequest')).default,
    SalesConversation: (await import('../../src/models/SalesConversation')).default,
    Support: (await import('../../src/models/SupportConversation')).default,
    Processed: (await import('../../src/models/ProcessedWebhookEvent')).default,
  };
  await Promise.all([m.Processed.init(), m.Support.init(), m.Thread.init(), m.Message.init()]);
  admin = await signInAsSuperAdmin('inbox-admin@example.invalid');
});
after(stopMemoryDb);

let seq = 0;
const nextPhone = () => `+9198300${String(++seq).padStart(5, '0')}`;
let sidSeq = 0;
async function inbound(from: string, body: string, extra: Record<string, string> = {}) {
  const form = new URLSearchParams({ MessageSid: `SMinbox${Date.now()}${++sidSeq}`, From: `whatsapp:${from}`, To: 'whatsapp:+919000000000', Body: body, NumMedia: '0', ProfileName: 'Asha', ...extra });
  const res = await m.webhook.handleTwilioWebhook(new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(),
  }));
  assert.equal(res.status, 200);
}
const threadOf = (phone: string) => m.Thread.findOne({ phoneKey: phone.slice(-10) }).lean();
const messagesOf = async (phone: string) => (await m.Message.find({ phoneKey: phone.slice(-10) }).sort({ at: 1, _id: 1 }).lean()) as any[];
const rowFor = async (phone: string, filter = 'all') => (await m.inbox.listInbox({ filter, viewerUserId: String(admin._id) })).conversations.find((c: any) => c.phone === phone);

test('a first message from someone new is in the Inbox with the bot\'s reply — labelled a new contact', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = nextPhone();
  await inbound(phone, 'Hi');
  const msgs = await messagesOf(phone);
  assert.equal(msgs[0].direction, 'in');
  assert.equal(msgs[0].text, 'Hi');
  assert.equal(msgs[0].sender, 'customer');
  assert.ok(msgs.some((x) => x.direction === 'out' && x.sender === 'bot'), 'the welcome menu is recorded too');
  const row = await rowFor(phone);
  assert.ok(row, 'listed');
  assert.equal(row.kind, 'new');
  assert.equal(row.unread, true);
  assert.ok(await rowFor(phone, 'new'));
});

test('a customer asking for help: support chat, acknowledgement recorded, needs reply until resolved; a new message reopens it', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = nextPhone();
  const userId = new m.mongoose.Types.ObjectId();
  const b = await m.Business.create({ name: 'Bakery', category: 'Bakery', address: 'Pune', userId, organizationId: new m.mongoose.Types.ObjectId(), subscriptionStatus: 'active' } as any);
  await m.User.create({ _id: userId, fullName: 'Owner', email: `owner${seq}@example.invalid`, phone, role: 'CLIENT', isPhoneVerified: true, activeBusinessId: b._id, businessIds: [b._id] } as any);

  await inbound(phone, 'Need help, my reviews are not working');
  const row = await rowFor(phone, 'support');
  assert.ok(row, 'in Support');
  assert.equal(row.needsReply, true, 'the automatic acknowledgement is not an answer');
  const thread: any = await threadOf(phone);
  assert.equal(String(thread.userId), String(userId), 'linked to the account (purge, customer view)');
  const msgs = await messagesOf(phone);
  assert.match(msgs.at(-1).text, /Thank you for contacting Growwmatics/);

  const detail = await m.inbox.inboxDetail(row.id);
  assert.equal(detail.contact.kind, 'support');
  assert.match(detail.banner, /Support request/);
  assert.equal(detail.windowOpen, true);
  assert.equal(detail.customer?.name, 'Bakery');

  // The team answers from the Inbox (once, despite a retry) and resolves it.
  const reply = { text: 'Hi! Looking into it now.', clientKey: 'k-support-1' };
  assert.equal((await m.inbox.sendInboxMessage(row.id, reply, String(admin._id))).ok, true);
  assert.equal((await m.inbox.sendInboxMessage(row.id, reply, String(admin._id))).duplicate, true, 'a retry is not sent twice');
  const team = (await messagesOf(phone)).filter((x) => x.sender === 'team');
  assert.equal(team.length, 1);
  assert.equal(String(team[0].sentByUserId), String(String(admin._id)));

  assert.equal((await m.inbox.resolveInbox(row.id, false)).ok, true);
  assert.equal((await m.Support.findOne({ phoneKey: phone.slice(-10) }).lean()).status, 'closed', 'the support issue is closed');
  assert.equal((await rowFor(phone, 'needs-reply')), undefined);
  assert.ok(await rowFor(phone, 'resolved'));

  await inbound(phone, 'It is still broken');
  assert.equal((await threadOf(phone)).status, 'open', 'reopened by their message');
  assert.equal((await rowFor(phone)).needsReply, true);
});

test('review requests a workspace sends to its customers stay out; that person\'s reply to us is in, as a review reply', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const userId = new m.mongoose.Types.ObjectId();
  const b = await m.Business.create({ name: 'Cafe', category: 'Cafe', address: 'Pune', userId, organizationId: new m.mongoose.Types.ObjectId(), placeId: 'ChIJtestInbox000001', subscriptionStatus: 'active' } as any);
  const phone = nextPhone();
  const c = await m.Customer.create({ tenantId: String(b._id), businessId: b._id, name: 'Ravi', phone } as any);

  // Both review send shapes: the utility template, and free text marked as a review request.
  await m.twilio.sendTemplateMessage(phone, 'HXreview_utility_test', { '1': 'Ravi', '2': 'Cafe', '3': 'tok' }, String(b._id));
  await m.log.withWhatsAppSendContext({ exclude: 'review-request' }, () => m.twilio.sendOutboundMessage(phone, 'Please review Cafe', undefined, String(b._id)));
  assert.equal(await m.Message.countDocuments({ phoneKey: phone.slice(-10) }), 0, 'no review request recorded');
  assert.equal(await threadOf(phone), null, 'no chat opened for it');

  await m.ReviewRequest.create({ tenantId: String(b._id), businessId: b._id, customerId: c._id, message: 'x', status: 'Sent', sentAt: new Date(), token: `inbox${Date.now()}` } as any);
  await inbound(phone, 'Who is this?');
  const row = await rowFor(phone, 'review-replies');
  assert.ok(row, 'their reply is in the Inbox');
  assert.equal(row.kind, 'review-reply');
  assert.equal(row.needsReply, true, 'no bot answers them — someone should look');
  const msgs = await messagesOf(phone);
  assert.equal(msgs.length, 1, 'only their message — the review request itself is not');
  assert.equal(msgs[0].reviewReply, true);
});

test('not recorded: login codes, a workspace\'s own chat with its customer, a number we have nothing to do with', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const owner = nextPhone();
  await m.User.create({ fullName: 'Login Owner', email: `login${seq}@example.invalid`, phone: owner, role: 'CLIENT' } as any);
  await m.twilio.sendTemplateMessage(owner, 'HXlogin_otp_test', { '1': '123456' });
  assert.equal(await m.Message.countDocuments({ phoneKey: owner.slice(-10) }), 0, 'no login code');

  const tenantCustomer = nextPhone();
  const tenantLead = await m.Lead.create({ tenantId: 'some-business', name: 'Their customer', phone: tenantCustomer } as any);
  await m.twilio.sendOutboundMessage(tenantCustomer, 'Your table is booked', String(tenantLead._id), 'biz');
  assert.equal(await m.Message.countDocuments({ phoneKey: tenantCustomer.slice(-10) }), 0, 'a workspace\'s own conversation');

  const stranger = nextPhone();
  await m.twilio.sendOutboundMessage(stranger, 'hello');
  assert.equal(await m.Message.countDocuments({ phoneKey: stranger.slice(-10) }), 0);

  // An owner notification to our customer IS ours.
  await m.twilio.sendOutboundMessage(owner, 'Your report is ready');
  const msgs = await messagesOf(owner);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].sender, 'bot');
  assert.equal(msgs[0].text, 'Your report is ready');
});

test('a tapped list row reads as its title; templates and buttons read as text; delivery status is shown', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = nextPhone();
  await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Meera', phone } as any);
  await m.send.sendButtonChoice(phone, 'When would you like your demo?', [{ id: 'today', title: 'Today' }, { id: 'tomorrow', title: 'Tomorrow' }]);
  await m.twilio.sendTemplateMessage(phone, 'HXnotification_test', { '1': 'Meera', '2': 'Your demo is tomorrow at 11 AM' });
  await inbound(phone, '11:30 AM', { ListId: '2' });
  const msgs = await messagesOf(phone);
  assert.equal(msgs[0].text, 'When would you like your demo?\n[Today | Tomorrow]');
  assert.equal(msgs[1].text, 'Your demo is tomorrow at 11 AM');
  assert.equal(msgs[1].template, 'Notification');
  assert.equal(msgs.find((x) => x.direction === 'in').text, '11:30 AM', 'what they tapped, not the row id');
  const detail = await m.inbox.inboxDetail((await rowFor(phone)).id);
  assert.ok(detail.messages.filter((x: any) => x.kind === 'ai').every((x: any) => x.status === 'sent'));
});

test('chats from before the Inbox existed are listed, with their history; old sales/booking ids still open them', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = nextPhone();
  const old = await m.SalesConversation.create({
    businessId: new m.mongoose.Types.ObjectId(), leadPhone: phone, phoneKey: phone.slice(-10), leadName: 'Old Lead', status: 'active',
    messages: [{ role: 'agent', text: 'Your report is ready', at: new Date(Date.now() - 3 * 3600_000) }, { role: 'lead', text: 'Tell me more', at: new Date(Date.now() - 2 * 3600_000) }],
  } as any);
  // What the first Inbox load after deploy runs (once per server process).
  await m.log.backfillThreads();
  const thread: any = await threadOf(phone);
  assert.ok(thread, 'a chat was created for it');
  assert.equal(thread.lastDirection, 'in');
  const detail = await m.inbox.inboxDetail(`sales:${old._id}`);
  assert.equal(detail.id, `wa:${thread._id}`);
  assert.deepEqual(detail.messages.map((x: any) => x.text), ['Your report is ready', 'Tell me more']);
});
