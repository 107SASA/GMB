/**
 * Segment 4A — minimal support intake on the Growwmatics platform WhatsApp
 * line, through the REAL webhook handler (Twilio form posts) and the real
 * Inngest support job, against an in-memory MongoDB. WhatsApp delivery is
 * mocked by the existing suppression switch (every send becomes a
 * MessageQueue row); inngest.send is captured, never delivered; Groq points
 * at a closed local port. No provider is contacted.
 *
 * Run: npx tsx --test tests/workflow/support-intake.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runDurably } from '../helpers/inngestReplay';

process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_|RESEND|SENDGRID|GROQ|OPENAI|INNGEST|LEAD_ENGINE|DO_SPACES)_?/.test(k) && k !== 'INNGEST_DEV') delete process.env[k];
process.env.GROQ_API_KEY = 'test-unused';
process.env.GROQ_BASE_URL = 'http://127.0.0.1:9'; // closed port → any AI call fails fast, never leaves the machine
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
    memoryServer = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_support_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  const client = await import('../../src/services/inngest/client');
  (client.inngest as any).send = async (e: any) => { for (const x of [e].flat()) dispatched.push(x); return { ids: [] }; };
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    Lead: (await import('../../src/models/Lead')).default,
    Customer: (await import('../../src/models/Customer')).default,
    SalesConversation: (await import('../../src/models/SalesConversation')).default,
    BookingConversation: (await import('../../src/models/BookingConversation')).default,
    Support: (await import('../../src/models/SupportConversation')).default,
    MessageQueue: (await import('../../src/models/MessageQueue')).default,
    Processed: (await import('../../src/models/ProcessedWebhookEvent')).default,
    webhook: await import('../../src/app/api/whatsapp/webhook/route'),
    fns: await import('../../src/services/inngest/functions'),
    intake: await import('../../src/services/support/supportIntake'),
    policy: await import('../../src/services/sales/preSalesPolicy'),
  };
  await Promise.all([m.Processed.init(), m.Support.init()]);
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
const nextPhone = () => `+9198200${String(++seq).padStart(5, '0')}`;
const rows = (phone: string) => m.MessageQueue.find({ 'payload.phone': phone }).sort({ createdAt: 1 }).lean();
const text = (r: any) => r.payload.body || r.payload.variables?.['2'] || '';
const ACK = /^Thank you for contacting Growwmatics\. We've received your message\. Our support team will review your concern and get back to you shortly\.$/;
const SALES_COPY = /book a demo|free report|demo|subscribe|offer|pricing/i;

let sidSeq = 0;
async function inbound(from: string, body: string, opts: { to?: string; profileName?: string; sid?: string } = {}) {
  const form = new URLSearchParams({ MessageSid: opts.sid || `SMsi${Date.now()}${++sidSeq}`, From: `whatsapp:${from}`, To: `whatsapp:${opts.to || '+919000000000'}`, Body: body, NumMedia: '0', ProfileName: opts.profileName ?? 'Asha' });
  const res = await m.webhook.handleTwilioWebhook(new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(),
  }));
  return res.status;
}

/** An owner whose workspace is on an active subscription, phone NOT verified. */
async function payingOwner(phone: string) {
  const userId = new m.mongoose.Types.ObjectId();
  const b = await m.Business.create({ name: `Bakery ${seq}`, category: 'Bakery', address: 'Pune', userId, organizationId: new m.mongoose.Types.ObjectId(), subscriptionStatus: 'active' } as any);
  await m.User.create({ _id: userId, fullName: 'Paying Owner', email: `po${seq}@example.invalid`, phone, role: 'CLIENT', isPhoneVerified: false, activeBusinessId: b._id, businessIds: [b._id] } as any);
  return { userId: String(userId), businessId: String(b._id) };
}

async function activeSalesThread(phone: string) {
  return m.SalesConversation.create({ businessId: new m.mongoose.Types.ObjectId(), leadPhone: phone, phoneKey: phone.slice(-10), status: 'active', consentStatus: 'granted', scores: { businessName: 'Shop' } } as any);
}

const salesOrAiEvents = () => dispatched.filter((e) => /^(sales|booking|report|support)\//.test(e.name) || /nurture/.test(e.name));

// ── Bug 1: paying customer, unverified phone ───────────────────────────────

test('a paying customer with an unverified phone gets support (one acknowledgement), never the sales menu', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = nextPhone();
  const owner = await payingOwner(phone);
  dispatched.length = 0;
  assert.equal(await inbound(phone, 'hi, can someone call me?'), 200);
  const sent: any[] = await rows(phone);
  assert.equal(sent.length, 1);
  assert.match(text(sent[0]), ACK);
  assert.doesNotMatch(text(sent[0]), SALES_COPY);
  const issue: any = await m.Support.findOne({ leadPhone: phone }).lean();
  assert.equal(issue.matchedBy, 'paying_customer');
  assert.equal(issue.senderVerified, false, 'context is flagged unverified for the team');
  assert.equal(String(issue.userId), owner.userId);
  assert.equal(String(issue.businessId), owner.businessId);
  assert.deepEqual(salesOrAiEvents(), [], 'no AI job, no sales, no nurture');
});

test('a verified user is still routed to support, with verified context', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = nextPhone();
  await m.User.create({ fullName: 'Verified', email: `v${seq}@example.invalid`, phone, role: 'CLIENT', isPhoneVerified: true } as any);
  await inbound(phone, 'hello');
  const issue: any = await m.Support.findOne({ leadPhone: phone }).lean();
  assert.equal(issue.matchedBy, 'verified_user');
  assert.equal(issue.senderVerified, true);
  assert.equal((await rows(phone)).length, 1);
});

// ── Bug 2: explicit support during an active sales conversation ────────────

test('an explicit support request during an active sales thread goes to support; the thread is left alone', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = nextPhone();
  const sales = await activeSalesThread(phone);
  dispatched.length = 0;
  await inbound(phone, 'I need help, my login is not working');
  assert.deepEqual(dispatched.map((e) => e.name), [], 'the sales agent is not woken');
  const sent: any[] = await rows(phone);
  assert.equal(sent.length, 1);
  assert.match(text(sent[0]), ACK);
  assert.equal((await m.SalesConversation.findById(sales._id).lean()).status, 'active', 'no sales state changed');
  // The next message belongs to the same issue — captured, no second acknowledgement, still not the sales agent.
  await inbound(phone, 'it says invalid password');
  assert.deepEqual(dispatched.map((e) => e.name), []);
  assert.equal((await rows(phone)).length, 1);
  const issue: any = await m.Support.findOne({ leadPhone: phone }).lean();
  assert.deepEqual(issue.messages.filter((x: any) => x.role === 'lead').map((x: any) => x.text), ['I need help, my login is not working', 'it says invalid password']);
});

test('ordinary sales replies are not mistaken for support ("no problem, 3pm works")', async (t) => {
  if (skipReason) return t.skip(skipReason);
  for (const body of ['no problem, 3pm works', 'any issue with Tuesday?', 'Yes please, tell me more']) {
    const phone = nextPhone();
    await activeSalesThread(phone);
    dispatched.length = 0;
    await inbound(phone, body);
    assert.deepEqual(dispatched.map((e) => e.name), ['sales/agent.reply'], body);
    assert.equal(await m.Support.countDocuments({ leadPhone: phone }), 0, body);
  }
  assert.equal(m.intake.isExplicitSupportRequest('Help'), true);
  assert.equal(m.intake.isExplicitSupportRequest("I can't login to the dashboard"), true);
  assert.equal(m.intake.isExplicitSupportRequest('facing an issue with posts'), true);
});

test('an explicit support request during an active demo booking goes to support', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = nextPhone();
  await m.BookingConversation.create({ leadPhone: phone, phoneKey: phone.slice(-10), status: 'active', messages: [] } as any);
  dispatched.length = 0;
  await inbound(phone, 'I have a problem with my account');
  assert.equal(dispatched.filter((e) => e.name === 'booking/agent.reply').length, 0);
  assert.equal(await m.Support.countDocuments({ leadPhone: phone }), 1);
});

// ── Bug 3: classification ──────────────────────────────────────────────────

test('a prospect asking for help is NOT relabelled a customer; sales stays alive and nurture eligibility returns later', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = nextPhone();
  const lead = await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Prospect', phone, currentAgent: 'SALES', currentStage: 'NURTURING' } as any);
  await inbound(phone, 'I have a problem with the report link');
  const after: any = await m.Lead.findById(lead._id).lean();
  assert.equal(after.currentAgent, 'SALES', 'not IN_HOUSE');
  assert.equal(after.currentStage, 'NURTURING', 'not a customer stage');
  // While the issue is open, automated sales waits; it is not "already-customer".
  const convo = await activeSalesThread(phone);
  assert.equal(await m.policy.preSalesSendBlockedReason({ kind: 'invite', phone }), 'support-conversation-active');
  // Once the issue is idle and closed, the prospect is eligible again.
  await m.Support.updateMany({ leadPhone: phone }, { $set: { updatedAt: new Date(Date.now() - 8 * DAY) } }, { timestamps: false });
  await m.intake.findOngoingSupportIssue(phone);
  assert.equal(await m.policy.preSalesSendBlockedReason({ kind: 'invite', phone }), null);
  assert.equal((await m.SalesConversation.findById(convo._id).lean()).status, 'active');
});

// ── Acknowledgement rules ──────────────────────────────────────────────────

test('a stranger with no user or lead: their support message is captured and acknowledged once, as a free-form reply', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = nextPhone();
  await inbound(phone, 'help', { profileName: '' });
  const sent: any[] = await rows(phone);
  assert.equal(sent.length, 1);
  assert.match(sent[0].payload.body, ACK, 'sent inside the 24h window the message just opened (no template needed)');
  assert.equal(sent[0].payload.contentSid, undefined);
  const issue: any = await m.Support.findOne({ leadPhone: phone }).lean();
  assert.equal(issue.matchedBy, 'support_request');
  assert.equal(issue.senderVerified, false);
  assert.equal(issue.userId, undefined);
});

test('more messages, concurrent messages and redeliveries in the same issue never repeat the acknowledgement', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = nextPhone();
  await payingOwner(phone);
  await inbound(phone, 'my posts are not publishing');
  await Promise.all([inbound(phone, 'any update?'), inbound(phone, 'hello?'), inbound(phone, 'please check')]);
  await inbound(phone, 'still waiting', { sid: 'SMsi-dup-1' });
  await inbound(phone, 'still waiting', { sid: 'SMsi-dup-1' }); // provider redelivery
  const sent: any[] = await rows(phone);
  assert.equal(sent.length, 1, 'one acknowledgement for the issue');
  const issue: any = await m.Support.findOne({ leadPhone: phone }).lean();
  assert.equal(issue.messages.filter((x: any) => x.role === 'lead').length, 5, 'every message captured once');
  assert.equal(await m.Support.countDocuments({ leadPhone: phone }), 1);
});

test('an issue idle for more than 7 days is closed; the next message opens a new issue with its own acknowledgement', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = nextPhone();
  await payingOwner(phone);
  await inbound(phone, 'help with billing');
  await m.Support.updateMany({ leadPhone: phone }, { $set: { updatedAt: new Date(Date.now() - 8 * DAY) } }, { timestamps: false });
  await inbound(phone, 'new problem: cannot see reviews');
  const issues: any[] = await m.Support.find({ leadPhone: phone }).sort({ createdAt: 1 }).lean();
  assert.deepEqual(issues.map((i) => [i.status, i.closedReason]), [['closed', 'idle'], ['active', undefined]]);
  assert.equal((await rows(phone)).length, 2);
});

test('an issue opened before this change (already answered by the old agent) gets no second reply', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = nextPhone();
  await m.Support.create({ leadPhone: phone, phoneKey: phone.slice(-10), status: 'active', messages: [{ role: 'lead', text: 'help', at: new Date() }, { role: 'agent', text: 'Thanks, our team will follow up.', at: new Date() }] } as any);
  await inbound(phone, 'any news?');
  assert.equal((await rows(phone)).length, 0);
});

test('a human-owned lead: captured, no automatic acknowledgement', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = nextPhone();
  await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Handled', phone, currentAgent: 'HUMAN', humanHandoff: { active: true } } as any);
  await inbound(phone, 'I need help');
  assert.equal(await m.Support.countDocuments({ leadPhone: phone }), 1);
  assert.equal((await rows(phone)).length, 0);
});

test('an event queued for the old AI support job only acknowledges (once) — no AI reply', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = nextPhone();
  const convo = await m.Support.create({ leadPhone: phone, phoneKey: phone.slice(-10), status: 'active', messages: [{ role: 'lead', text: 'help', at: new Date(), via: 'whatsapp' }] } as any);
  const first: any = await runDurably(m.fns.supportAgentReply, { data: { conversationId: String(convo._id), body: 'help' } });
  const second: any = await runDurably(m.fns.supportAgentReply, { data: { conversationId: String(convo._id), body: 'help' } });
  assert.deepEqual([first.result.acknowledgement, second.result.acknowledgement], ['sent', 'already_sent']);
  const sent: any[] = await rows(phone);
  assert.equal(sent.length, 1);
  assert.match(text(sent[0]), ACK);
});

// ── Opt-out and tenant isolation ───────────────────────────────────────────

test('STOP closes the support issue; a later message is captured but never acknowledged', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = nextPhone();
  await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Leaver', phone } as any);
  await inbound(phone, 'help please');
  assert.equal((await rows(phone)).length, 1);
  await inbound(phone, 'STOP');
  assert.equal((await m.Support.findOne({ leadPhone: phone }).lean()).closedReason, 'opt_out');
  await inbound(phone, 'help again');
  assert.equal((await rows(phone)).length, 1, 'no acknowledgement after STOP');
  assert.equal(await m.Support.countDocuments({ leadPhone: phone, status: 'active' }), 1, 'but the message is captured for the team');
});

test("a tenant's own number is unaffected: a customer's \"help\" goes to that business's agent, not Growwmatics support", async (t) => {
  if (skipReason) return t.skip(skipReason);
  const userId = new m.mongoose.Types.ObjectId();
  const b = await m.Business.create({ name: 'Tenant', category: 'Salon', address: 'Pune', userId, organizationId: new m.mongoose.Types.ObjectId(), integrations: { whatsappNumber: '+919122200001' } } as any);
  const phone = nextPhone();
  dispatched.length = 0;
  await inbound(phone, 'I need help with my booking', { to: '+919122200001' });
  assert.deepEqual(dispatched.filter((e) => e.name === 'whatsapp/incoming').map((e) => e.data.businessId), [String(b._id)]);
  assert.deepEqual(dispatched.filter((e) => /^(support|sales)\//.test(e.name)), []);
  assert.equal(await m.Support.countDocuments({ leadPhone: phone }), 0);
  assert.equal((await rows(phone)).length, 0);
});

test('support never sends a menu, a nurture message or marketing', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phone = nextPhone();
  await payingOwner(phone);
  dispatched.length = 0;
  for (const body of ['hi', '1', 'book a demo', 'free report', 'what is the price?']) await inbound(phone, body);
  const sent: any[] = await rows(phone);
  assert.equal(sent.length, 1);
  assert.match(text(sent[0]), ACK);
  assert.deepEqual(salesOrAiEvents(), []);
  assert.equal(await m.SalesConversation.countDocuments({ leadPhone: phone }), 0);
  assert.equal(await m.BookingConversation.countDocuments({ leadPhone: phone }), 0);
});
