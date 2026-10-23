/**
 * Segment 3 — customer review requests, through the REAL code against an
 * in-memory MongoDB:
 *  - the review-campaign worker (processReviewCampaign) driven by the real
 *    Inngest execution engine (tests/helpers/inngestReplay.ts): initial send,
 *    reminders, the identical-template cap, stop-after-click (Super Admin
 *    setting, default on), opt-out mid-sequence, Asia/Kolkata business hours;
 *  - replies from review recipients on the platform number through the real
 *    webhook handler: STOP opts out the right customers only; an ordinary
 *    reply gets no sales menu, no support thread and no automatic message.
 * WhatsApp delivery is mocked by the existing suppression switch: every send
 * becomes a MessageQueue row and no provider is contacted. inngest.send is
 * captured, never delivered.
 *
 * Run: npx tsx --test tests/workflow/review-request-recipient.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runDurably } from '../helpers/inngestReplay';

process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|RESEND|SENDGRID|GROQ|OPENAI|INNGEST|LEAD_ENGINE|DO_SPACES)_?/.test(k) && k !== 'INNGEST_DEV') delete process.env[k];
process.env.GROQ_API_KEY = 'test-unused';
process.env.GROQ_BASE_URL = 'http://127.0.0.1:9'; // closed port → AI fails fast, never leaves the machine
process.env.WHATSAPP_PROVIDER = 'twilio';
process.env.TWILIO_TEMPLATE_NOTIFICATION = 'HXnotification_test';
process.env.TWILIO_TEMPLATE_REVIEW_REQUEST_UTILITY = 'HXreview_utility_test';
process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
process.env.NEXT_PUBLIC_BASE_URL = 'https://app.example.test';
// No TWILIO_AUTH_TOKEN + non-production → the webhook's documented local signature skip.
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
  process.env.MONGODB_URI = memoryServer.getUri(`gm_review_recipient_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  const client = await import('../../src/services/inngest/client');
  (client.inngest as any).send = async (e: any) => { dispatched.push(e); return { ids: [] }; };
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    Customer: (await import('../../src/models/Customer')).default,
    Campaign: (await import('../../src/models/Campaign')).default,
    ReviewRequest: (await import('../../src/models/ReviewRequest')).default,
    ReviewFollowUpPolicy: (await import('../../src/models/ReviewFollowUpPolicy')).default,
    MessageQueue: (await import('../../src/models/MessageQueue')).default,
    SupportConversation: (await import('../../src/models/SupportConversation')).default,
    Lead: (await import('../../src/models/Lead')).default,
    fns: await import('../../src/services/inngest/functions'),
    webhook: await import('../../src/app/api/whatsapp/webhook/route'),
    policyStore: await import('../../src/lib/reviewFollowUpPolicyStore'),
    redirect: await import('../../src/lib/reviewRedirect'),
    recipient: await import('../../src/services/reviews/reviewRecipientInbound'),
  };
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

const rows = (phone: string) => m.MessageQueue.find({ 'payload.phone': phone }).sort({ createdAt: 1 }).lean();
const count = (phone: string) => m.MessageQueue.countDocuments({ 'payload.phone': phone });

/** A business that sends review requests, with one customer. */
async function shop(over: { customer?: Record<string, unknown> } = {}) {
  const n = ++seq;
  const userId = new m.mongoose.Types.ObjectId();
  const b = await m.Business.create({ name: `Cafe ${n}`, category: 'Cafe', address: 'Pune', userId, organizationId: new m.mongoose.Types.ObjectId(), placeId: `ChIJtestPlace${String(n).padStart(6, '0')}`, subscriptionStatus: 'active' } as any);
  await m.User.create({ _id: userId, fullName: `Owner ${n}`, email: `rr${n}@example.invalid`, phone: `+9196600${String(n).padStart(5, '0')}`, role: 'CLIENT', businessIds: [b._id] } as any);
  const phone = `+9197700${String(n).padStart(5, '0')}`;
  const c = await m.Customer.create({ tenantId: String(b._id), businessId: b._id, name: `Asha ${n}`, phone, ...(over.customer || {}) } as any);
  return { businessId: String(b._id), customerId: String(c._id), phone };
}

const start = (s: { businessId: string; customerId: string }, extra: Record<string, unknown> = {}) =>
  ({ data: { customerId: s.customerId, businessId: s.businessId, tenantId: s.businessId, ...extra } });

async function setPolicy(over: Record<string, unknown>) {
  const current = await m.policyStore.loadReviewFollowUpPolicy();
  const saved = await m.policyStore.saveReviewFollowUpPolicy({ ...current, ...over });
  assert.ok(saved.ok, JSON.stringify(saved));
}

let sidSeq = 0;
async function inbound(phone: string, body: string) {
  const form = new URLSearchParams({ MessageSid: `SMrr${Date.now()}${++sidSeq}`, From: `whatsapp:${phone}`, To: 'whatsapp:+919000000000', Body: body, NumMedia: '0' });
  const req = new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  return m.webhook.handleTwilioWebhook(req);
}

// ── The review-campaign worker ─────────────────────────────────────────────

test('default policy: stop-after-click is on for a fresh install and for a policy saved before the setting existed', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal((await m.policyStore.loadReviewFollowUpPolicy()).stopOnClick, true, 'seeded default');
  // A policy document saved before Oct 2026 carries the old hard-coded stopOnClick: false and no stopOnLinkClick.
  await m.ReviewFollowUpPolicy.updateOne({ key: 'global' }, { $set: { stopOnClick: false }, $unset: { stopOnLinkClick: '' } });
  assert.equal((await m.policyStore.loadReviewFollowUpPolicy()).stopOnClick, true, 'legacy false is not an admin choice');
  await setPolicy({ stopOnClick: false });
  assert.equal((await m.policyStore.loadReviewFollowUpPolicy()).stopOnClick, false, 'Super Admin can turn it off');
  await setPolicy({ stopOnClick: true });
  assert.equal((await m.policyStore.loadReviewFollowUpPolicy()).stopOnClick, true);
});

test('no click: the request plus ONE reminder (identical-template cap), on the default 2-day schedule — unchanged', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const s = await shop();
  const out = await runDurably(m.fns.processReviewCampaign, start(s));
  const sent: any[] = await rows(s.phone);
  assert.equal(sent.length, 2);
  assert.ok(sent.every((r) => r.payload.contentSid === 'HXreview_utility_test'));
  assert.ok(out.timeline.includes('sleep:wait-reminder-1') && out.timeline.includes('run:send-reminder-1'));
  assert.ok(!out.timeline.includes('run:send-reminder-2'), 'never a third identical template');
  const req: any = await m.ReviewRequest.findOne({ customerId: s.customerId }).lean();
  assert.equal(req.followUpStage, 1);
});

test('click during the wait: the pending reminder is skipped (setting on, the default); no review is claimed', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const s = await shop();
  const out = await runDurably(m.fns.processReviewCampaign, start(s), {
    onSleep: async (id) => {
      if (id !== 'wait-reminder-1') return;
      const req: any = await m.ReviewRequest.findOne({ customerId: s.customerId }).lean();
      // The real public redirect records the click.
      const url = await m.redirect.handleReviewRedirectByToken(req.token);
      assert.match(url, /^https:\/\/search\.google\.com\/local\/writereview\?placeid=/);
    },
  });
  assert.equal(await count(s.phone), 1, 'initial request only');
  assert.ok(!out.timeline.includes('run:send-reminder-1'));
  const req: any = await m.ReviewRequest.findOne({ customerId: s.customerId }).lean();
  assert.equal(req.clicked, true);
  assert.equal(req.reviewReceived, false, 'a click is not a submitted review');
});

test('click with the setting OFF: the reminder still goes (old behaviour, Super Admin choice)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await setPolicy({ stopOnClick: false });
  try {
    const s = await shop();
    await runDurably(m.fns.processReviewCampaign, start(s), {
      onSleep: async (id) => {
        if (id !== 'wait-reminder-1') return;
        const req: any = await m.ReviewRequest.findOne({ customerId: s.customerId }).lean();
        await m.redirect.handleReviewRedirectByToken(req.token);
      },
    });
    assert.equal(await count(s.phone), 2);
  } finally {
    await setPolicy({ stopOnClick: true });
  }
});

test('the maximum stays the Super Admin maximum: 0 follow-ups → the request only', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await setPolicy({ maximumFollowUps: 0 });
  try {
    const s = await shop();
    await runDurably(m.fns.processReviewCampaign, start(s));
    assert.equal(await count(s.phone), 1);
  } finally {
    await setPolicy({ maximumFollowUps: 2 });
  }
});

test('STOP from the recipient during the wait (real webhook): no reminder, request stopped', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const s = await shop();
  await runDurably(m.fns.processReviewCampaign, start(s), {
    onSleep: async (id) => { if (id === 'wait-reminder-1') await inbound(s.phone, 'STOP'); },
  });
  assert.equal(await count(s.phone), 1, 'initial request only — and no reply to the STOP');
  assert.equal((await m.Customer.findById(s.customerId).lean()).optedOut, true);
  assert.equal((await m.ReviewRequest.findOne({ customerId: s.customerId }).lean()).automationStatus, 'Stopped');
});

test('business hours: computed in Asia/Kolkata (07:30 IST waits until 09:00 IST), not the server clock', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const s = await shop();
  const campaign = await m.Campaign.create({ businessId: s.businessId, tenantId: s.businessId, name: 'Hours', status: 'ACTIVE', sendOnlyBizHours: true, bizHoursStart: 9, bizHoursEnd: 20 } as any);
  const waits: Array<{ name: string; at: string }> = [];
  const step = {
    run: async (_n: string, cb: () => any) => JSON.parse(JSON.stringify((await cb()) ?? null)),
    sleep: async () => {},
    sleepUntil: async (name: string, at: string) => { waits.push({ name, at }); },
    sendEvent: async () => {},
  };
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-22T02:00:00Z') }); // 07:30 IST
  try {
    await m.fns.processReviewCampaign.fn({ event: start(s, { campaignId: String(campaign._id) }), step });
  } finally {
    t.mock.timers.reset();
  }
  assert.deepEqual(waits[0], { name: 'wait-biz-hours-initial', at: '2026-10-22T03:30:00.000Z' }, '09:00 IST the same day');
});

// ── Replies from review recipients on the platform number ─────────────────

/** A customer who was sent a review request `daysAgo` days ago. */
async function recipient(daysAgo = 2) {
  const s = await shop();
  await m.ReviewRequest.create({ tenantId: s.businessId, businessId: s.businessId, customerId: s.customerId, message: 'x', status: 'Sent', sentAt: new Date(Date.now() - daysAgo * DAY), token: `tok${Date.now()}${++seq}` } as any);
  return s;
}

test('STOP / UNSUBSCRIBE / CANCEL: the recipient\'s recent-request customers are opted out and their requests stopped — nobody else', async (t) => {
  if (skipReason) return t.skip(skipReason);
  for (const word of ['STOP', 'unsubscribe', ' Cancel ']) {
    const r = await recipient();
    // Same phone, another business that never sent this person a recent request.
    const other = await shop();
    await m.Customer.updateOne({ _id: other.customerId }, { $set: { phone: r.phone } });
    const old = await shop();
    await m.Customer.updateOne({ _id: old.customerId }, { $set: { phone: r.phone } });
    await m.ReviewRequest.create({ tenantId: old.businessId, businessId: old.businessId, customerId: old.customerId, message: 'x', status: 'Sent', sentAt: new Date(Date.now() - 90 * DAY), automationStatus: 'Completed', token: `old${Date.now()}${++seq}` } as any);
    const bystander = await recipient();

    await inbound(r.phone, word);
    assert.equal((await m.Customer.findById(r.customerId).lean()).optedOut, true, word);
    assert.equal((await m.ReviewRequest.findOne({ customerId: r.customerId }).lean()).automationStatus, 'Stopped');
    assert.equal((await m.Customer.findById(other.customerId).lean()).optedOut, false, 'same phone at a business that sent no request');
    assert.equal((await m.Customer.findById(old.customerId).lean()).optedOut, false, 'a finished 90-day-old request is not this STOP');
    assert.equal((await m.Customer.findById(bystander.customerId).lean()).optedOut, false, 'another phone is untouched');
    assert.equal(await count(r.phone), 0, 'no reply to STOP');
  }
});

test('an ordinary reply from a recipient: no sales menu, no support thread, no automatic message', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const r = await recipient();
  dispatched.length = 0;
  for (const body of ['Thank you!', 'I need help with my order', '1', 'report']) await inbound(r.phone, body);
  assert.equal(await count(r.phone), 0, 'nothing sent back');
  assert.equal(await m.SupportConversation.countDocuments({ leadPhone: r.phone }), 0, 'no support thread');
  assert.deepEqual(dispatched.filter((e) => /agent\.reply/.test(e.name)), [], 'no agent woken');
  assert.equal((await m.Customer.findById(r.customerId).lean()).optedOut, false, 'a reply is not an opt-out');
});

test('everyone else on the platform number is routed as before', async (t) => {
  if (skipReason) return t.skip(skipReason);
  // A known prospect (a platform Lead gives the template its {{1}}) still gets the menu.
  const stranger = '+919811100001';
  await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Ravi Kumar', phone: stranger } as any);
  await inbound(stranger, 'hello');
  const [menu]: any[] = await rows(stranger);
  assert.match(menu.payload.body || menu.payload.variables?.['2'] || '', /Book a Demo|demo/i);
  // A finished request older than the window no longer silences the phone.
  const old = await recipient(45);
  await m.ReviewRequest.updateOne({ customerId: old.customerId }, { $set: { automationStatus: 'Completed' } });
  await m.Lead.create({ tenantId: 'gmbboost-internal', name: 'Old Customer', phone: old.phone } as any);
  await inbound(old.phone, 'hello');
  assert.equal(await count(old.phone), 1, 'menu, as before');
  // A stranger asking for help still gets the support path (Segment 4A intake: one acknowledgement).
  await inbound('+919811100002', 'I need help');
  assert.equal(await m.SupportConversation.countDocuments({ leadPhone: '+919811100002' }), 1);
  const [ack]: any[] = await rows('+919811100002');
  assert.match(ack?.payload.body || ack?.payload.variables?.['2'] || '', /^Thank you for contacting Growwmatics/);
});

// ── Review fixes: stored phone formats, long-delay requests, previews, in-flight setting changes ──

test('STOP matches the customer however the phone was stored (CSV digits, spaces, leading 0) — but not another country', async (t) => {
  if (skipReason) return t.skip(skipReason);
  for (const stored of ['9123400001', '91234 00002', '09123400003', '+91 91234-00004', '919123400005']) {
    const s = await shop({ customer: { phone: stored } });
    await m.ReviewRequest.create({ tenantId: s.businessId, businessId: s.businessId, customerId: s.customerId, message: 'x', status: 'Sent', sentAt: new Date(), token: `fmt${Date.now()}${++seq}` } as any);
    const { normalizePhoneE164 } = await import('../../src/lib/phone');
    const inboundPhone = normalizePhoneE164(stored)!; // the address the Twilio sender actually used
    // Same last 10 digits, different country, also sent a request: must stay.
    const foreign = await shop({ customer: { phone: `+1${inboundPhone.slice(-10)}` } });
    await m.ReviewRequest.create({ tenantId: foreign.businessId, businessId: foreign.businessId, customerId: foreign.customerId, message: 'x', status: 'Sent', sentAt: new Date(), token: `us${Date.now()}${++seq}` } as any);

    await inbound(inboundPhone, 'STOP');
    assert.equal((await m.Customer.findById(s.customerId).lean()).optedOut, true, `stored as "${stored}"`);
    assert.equal((await m.Customer.findById(foreign.customerId).lean()).optedOut, false, '+1 number sharing the last 10 digits');
  }
});

test('a still-running request with long Super Admin delays counts, even 45 days after its last message', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const r = await recipient(45); // Sent 45 days ago, automation still Active (second follow-up pending)
  dispatched.length = 0;
  await inbound(r.phone, 'hello?');
  assert.equal(await count(r.phone), 0, 'ordinary reply still silent');
  await inbound(r.phone, 'STOP');
  assert.equal((await m.Customer.findById(r.customerId).lean()).optedOut, true);
  assert.equal((await m.ReviewRequest.findOne({ customerId: r.customerId }).lean()).automationStatus, 'Stopped');
});

test('a link-preview fetch is not a click: the reminder still goes; a real tap stops it', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const previewed = await shop();
  await runDurably(m.fns.processReviewCampaign, start(previewed), {
    onSleep: async (id) => {
      if (id !== 'wait-reminder-1') return;
      const req: any = await m.ReviewRequest.findOne({ customerId: previewed.customerId }).lean();
      await m.redirect.handleReviewRedirectByToken(req.token, { method: 'GET', userAgent: 'facebookexternalhit/1.1' });
      await m.redirect.handleReviewRedirectByToken(req.token, { method: 'HEAD', userAgent: 'Mozilla/5.0' });
    },
  });
  const pr: any = await m.ReviewRequest.findOne({ customerId: previewed.customerId }).lean();
  assert.equal(pr.clicked, false);
  assert.equal(pr.clickCount || 0, 0);
  assert.equal(await count(previewed.phone), 2, 'request + reminder');

  // The real route passes the request's user agent through.
  const tapped = await recipient();
  const req: any = await m.ReviewRequest.findOne({ customerId: tapped.customerId }).lean();
  const route = await import('../../src/app/review/[token]/route');
  const res = await route.GET(new Request(`http://localhost/review/${req.token}?src=wa`, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) Safari/604.1' } }), { params: Promise.resolve({ token: req.token }) });
  assert.equal(res.status, 302);
  assert.equal((await m.ReviewRequest.findById(req._id).lean()).clicked, true);
});

test('in-flight runs read the setting at send time: switched off during the wait → the clicked customer still gets the reminder', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const s = await shop();
  try {
    await runDurably(m.fns.processReviewCampaign, start(s), {
      onSleep: async (id) => {
        if (id !== 'wait-reminder-1') return;
        const req: any = await m.ReviewRequest.findOne({ customerId: s.customerId }).lean();
        await m.redirect.handleReviewRedirectByToken(req.token);
        await setPolicy({ stopOnClick: false });
      },
    });
    assert.equal(await count(s.phone), 2);
  } finally {
    await setPolicy({ stopOnClick: true });
  }
  // And the reverse: on during the wait → skipped (the deploy-day case for runs started earlier).
  const s2 = await shop();
  await setPolicy({ stopOnClick: false });
  await runDurably(m.fns.processReviewCampaign, start(s2), {
    onSleep: async (id) => {
      if (id !== 'wait-reminder-1') return;
      const req: any = await m.ReviewRequest.findOne({ customerId: s2.customerId }).lean();
      await m.redirect.handleReviewRedirectByToken(req.token);
      await setPolicy({ stopOnClick: true });
    },
  });
  assert.equal(await count(s2.phone), 1);
});
