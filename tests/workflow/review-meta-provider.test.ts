/**
 * Review requests over Meta with Twilio as the fallback (Nov 2026, step 1 of
 * the Twilio → Meta move), through the REAL code against an in-memory
 * MongoDB:
 *  - processReviewCampaign sends through Meta when REVIEW_WHATSAPP_PROVIDER=meta
 *    is fully configured, and the "same text at most twice" cap still holds;
 *  - Meta refusing the send → the same request goes through Twilio;
 *  - Meta reporting the message failed (real webhook) → resent once through
 *    Twilio, never twice;
 *  - Meta delivered / read receipts move the request to Delivered / Read;
 *  - half-configured Meta, or no WHATSAPP_PROVIDER, keeps sends on Twilio.
 * Meta's Graph API is a fetch stub and the `twilio` package a recording stub
 * — nothing reaches either provider.
 *
 * Run: npx tsx --test tests/workflow/review-meta-provider.test.ts
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { runDurably } from '../helpers/inngestReplay';

// ── Twilio stub ────────────────────────────────────────────────────────────
const twilioCalls: Array<{ to: string; body?: string; contentSid?: string; variables?: Record<string, string> }> = [];
const loader = Module as any;
const realTwilio = loader._load('twilio', module, false);
const twilioStub: any = () => ({
  messages: {
    create: async (p: any) => {
      twilioCalls.push({ to: p.to, body: p.body, contentSid: p.contentSid, variables: p.contentVariables ? JSON.parse(p.contentVariables) : undefined });
      return { sid: `SMstub${twilioCalls.length}` };
    },
  },
});
twilioStub.validateRequest = realTwilio.validateRequest;
twilioStub.default = twilioStub;
const prevLoad = loader._load;
loader._load = function (request: string, ...rest: unknown[]) {
  if (request === 'twilio') return twilioStub;
  return prevLoad.call(this, request, ...rest);
};

// ── Meta Graph API stub ────────────────────────────────────────────────────
const metaCalls: any[] = [];
let metaReply: { status: number; body: any } | null = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  if (url.startsWith('https://graph.facebook.com/')) {
    metaCalls.push({ url, body: JSON.parse(String(init?.body || '{}')) });
    const reply = metaReply ?? { status: 200, body: { messages: [{ id: `wamid.test${metaCalls.length}` }] } };
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  }
  if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return originalFetch(input, init);
  throw new Error(`unexpected outbound request: ${url}`);
}) as typeof fetch;

for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_|RESEND|SENDGRID|GROQ|OPENAI|INNGEST|LEAD_ENGINE|DO_SPACES|REVIEW_WHATSAPP)_?/.test(k) && k !== 'INNGEST_DEV') delete process.env[k];
const META_ENV = {
  REVIEW_WHATSAPP_PROVIDER: 'meta',
  META_WHATSAPP_ACCESS_TOKEN: 'test_not_real',
  META_WHATSAPP_PHONE_NUMBER_ID: '100000000000001',
  META_TEMPLATE_REVIEW_REQUEST: 'review_request_test',
};
Object.assign(process.env, META_ENV, {
  QA_SUPPRESS_WHATSAPP_SENDS: 'false', // the real send paths run — against the stubs
  QA_SUPPRESS_EMAIL_SENDS: 'true',
  QA_SUPPRESS_PUSH_SENDS: 'true',
  WHATSAPP_PROVIDER: 'twilio',
  TWILIO_ACCOUNT_SID: 'ACtest_not_real',
  TWILIO_AUTH_TOKEN: 'test_not_real_token',
  TWILIO_WHATSAPP_NUMBER: '+10000000000',
  TWILIO_TEMPLATE_NOTIFICATION: 'HXnotification_test',
  TWILIO_TEMPLATE_REVIEW_REQUEST_UTILITY: 'HXreview_utility_test',
  GROQ_API_KEY: 'test-unused',
  GROQ_BASE_URL: 'http://127.0.0.1:9',
  NEXT_PUBLIC_APP_URL: 'https://app.example.test',
  NEXT_PUBLIC_BASE_URL: 'https://app.example.test',
});

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_review_meta_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  const client = await import('../../src/services/inngest/client');
  (client.inngest as any).send = async () => ({ ids: [] });
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    Customer: (await import('../../src/models/Customer')).default,
    ReviewRequest: (await import('../../src/models/ReviewRequest')).default,
    MessageQueue: (await import('../../src/models/MessageQueue')).default,
    fns: await import('../../src/services/inngest/functions'),
    webhook: await import('../../src/app/api/whatsapp/webhook/route'),
    send: await import('../../src/services/whatsapp/send'),
  };
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  twilioCalls.length = 0;
  metaCalls.length = 0;
  metaReply = null;
  Object.assign(process.env, META_ENV);
});

let seq = 0;
async function shop() {
  const n = ++seq;
  const userId = new m.mongoose.Types.ObjectId();
  const b = await m.Business.create({ name: `Bakery ${n}`, category: 'Bakery', address: 'Pune', userId, organizationId: new m.mongoose.Types.ObjectId(), placeId: `ChIJmetaPlace${String(n).padStart(6, '0')}`, subscriptionStatus: 'active' } as any);
  await m.User.create({ _id: userId, fullName: `Owner ${n}`, email: `meta${n}@example.invalid`, phone: `+9196611${String(n).padStart(5, '0')}`, role: 'CLIENT', businessIds: [b._id] } as any);
  const phone = `+9197711${String(n).padStart(5, '0')}`;
  const c = await m.Customer.create({ tenantId: String(b._id), businessId: b._id, name: `Ravi ${n}`, phone } as any);
  return { businessId: String(b._id), customerId: String(c._id), phone };
}
const start = (s: { businessId: string; customerId: string }) =>
  ({ data: { customerId: s.customerId, businessId: s.businessId, tenantId: s.businessId } });

/** Delivers one Meta status receipt through the real webhook route. */
async function metaStatus(id: string, status: string, errors?: any[]) {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: META_ENV.META_WHATSAPP_PHONE_NUMBER_ID }, statuses: [{ id, status, ...(errors ? { errors } : {}) }] } }] }],
  };
  const res = await m.webhook.POST(new Request('http://localhost/api/whatsapp/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  assert.equal(res.status, 200);
}

const reviewFor = (s: { customerId: string }) => m.ReviewRequest.findOne({ customerId: s.customerId }).lean();

test('Meta on: the request and one reminder go through Meta as the approved template; the same-text cap holds', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const s = await shop();
  const out = await runDurably(m.fns.processReviewCampaign, start(s));
  assert.equal(twilioCalls.length, 0, 'nothing through Twilio');
  assert.equal(metaCalls.length, 2, 'request + one reminder');
  const first = metaCalls[0].body;
  assert.equal(first.type, 'template');
  assert.equal(first.template.name, 'review_request_test');
  assert.equal(first.to, s.phone.replace('+', ''));
  const req: any = await reviewFor(s);
  const params = first.template.components[0].parameters.map((p: any) => p.text);
  assert.deepEqual(params, [`Ravi ${seq}`, `Bakery ${seq}`, req.token], 'same variables as the Twilio utility template');
  assert.ok(!out.timeline.includes('run:send-reminder-2'), 'never a third identical message');
  assert.equal(req.templateSid, 'meta:review_request_test');
  assert.ok(req.lastMessageSid.startsWith('wamid.'));
  const logged = await m.MessageQueue.find({ 'payload.phone': s.phone }).lean();
  assert.equal(logged.length, 2);
  assert.ok(logged.every((row: any) => row.payload.provider === 'meta' && row.status === 'SENT'));
});

test('Meta refuses the send → the same request goes through Twilio', async (t) => {
  if (skipReason) return t.skip(skipReason);
  metaReply = { status: 400, body: { error: { code: 131049, message: 'Meta chose not to deliver' } } };
  const s = await shop();
  await runDurably(m.fns.processReviewCampaign, start(s));
  assert.ok(metaCalls.length >= 1, 'Meta tried first');
  assert.ok(twilioCalls.length >= 1, 'Twilio took over');
  assert.equal(twilioCalls[0].contentSid, 'HXreview_utility_test');
  const req: any = await reviewFor(s);
  assert.equal(req.messageHistory[0].status, 'Sent');
  assert.equal(req.messageHistory[0].templateSid, 'HXreview_utility_test');
  assert.ok(req.lastMessageSid.startsWith('SMstub'));
  const failedMeta = await m.MessageQueue.findOne({ 'payload.phone': s.phone, 'payload.provider': 'meta' }).lean();
  assert.equal(failedMeta.status, 'FAILED');
  assert.equal(failedMeta.errorCode, '131049');
});

test('Meta accepts, then reports failed → resent once through Twilio; a repeated receipt sends nothing more', async (t) => {
  if (skipReason) return t.skip(skipReason);
  process.env.META_TEMPLATE_REVIEW_REQUEST = 'review_request_test';
  const s = await shop();
  await runDurably(m.fns.processReviewCampaign, start(s), {
    onSleep: async (id) => {
      if (id !== 'wait-reminder-1') return;
      const before: any = await reviewFor(s);
      const wamid = before.lastMessageSid;
      await metaStatus(wamid, 'failed', [{ code: 131026, title: 'Message undeliverable' }]);
      await metaStatus(wamid, 'failed', [{ code: 131026, title: 'Message undeliverable' }]);
      const afterRetry: any = await reviewFor(s);
      assert.equal(twilioCalls.length, 1, 'exactly one Twilio resend');
      assert.equal(afterRetry.status, 'Sent');
      assert.ok(afterRetry.lastMessageSid.startsWith('SMstub'));
      const metaEntry = afterRetry.messageHistory.find((e: any) => e.sid === wamid);
      assert.equal(metaEntry.status, 'Failed');
      assert.equal(metaEntry.errorCode, '131026');
      assert.equal(afterRetry.messageHistory.at(-1).stage, 'retry');
    },
  });
});

test('Meta delivered / read receipts → Delivered / Read', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const s = await shop();
  await runDurably(m.fns.processReviewCampaign, start(s), {
    onSleep: async (id) => {
      if (id !== 'wait-reminder-1') return;
      const req: any = await reviewFor(s);
      await metaStatus(req.lastMessageSid, 'delivered');
      assert.equal((await reviewFor(s)).status, 'Delivered');
      await metaStatus(req.lastMessageSid, 'read');
      const read: any = await reviewFor(s);
      assert.equal(read.status, 'Read');
      assert.ok(read.deliveredAt && read.readAt);
      const row: any = await m.MessageQueue.findOne({ 'payload.sid': req.lastMessageSid }).lean();
      assert.ok(row.deliveredAt && row.readAt);
    },
  });
  assert.equal(twilioCalls.length, 0);
});

test('half-configured Meta (no template name) keeps review requests on Twilio', async (t) => {
  if (skipReason) return t.skip(skipReason);
  delete process.env.META_TEMPLATE_REVIEW_REQUEST;
  const s = await shop();
  await runDurably(m.fns.processReviewCampaign, start(s));
  assert.equal(metaCalls.length, 0);
  assert.equal(twilioCalls.length, 2, 'request + one reminder, through Twilio as before');
  assert.ok(twilioCalls.every((c) => c.contentSid === 'HXreview_utility_test'));
});

test('Meta keys present but WHATSAPP_PROVIDER unset → every other send stays on Twilio', async (t) => {
  if (skipReason) return t.skip(skipReason);
  delete process.env.WHATSAPP_PROVIDER;
  try {
    const res = await m.send.sendOutboundMessage('+919771199999', 'Hello from the team', undefined, undefined, undefined, 'Asha');
    assert.equal(res.success, true, res.error);
    assert.equal(metaCalls.length, 0, 'Meta not used');
    assert.equal(twilioCalls.length, 1, 'went to Twilio');
  } finally {
    process.env.WHATSAPP_PROVIDER = 'twilio';
  }
});
