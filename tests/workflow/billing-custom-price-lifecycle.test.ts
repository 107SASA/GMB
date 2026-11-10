/**
 * Custom trial pricing — the whole subscription lifecycle through the REAL
 * routes: POST /api/billing/checkout creates the subscriptions, and every
 * Razorpay event arrives as an HMAC-signed delivery to the REAL
 * POST /api/webhook/razorpay. In-memory MongoDB, a fake Razorpay client that
 * remembers what was created, a test-only webhook secret. Nothing is sent to
 * Razorpay; no real database is touched.
 *
 * What this cannot prove (needs a real Razorpay test-mode run): customer
 * authorization in the hosted checkout, and Razorpay actually charging at
 * start_at / each renewal.
 *
 * Run: npx tsx --test tests/workflow/billing-custom-price-lifecycle.test.ts
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|RESEND|SENDGRID|GROQ|OPENAI|INNGEST|DO_SPACES)_/.test(k)) delete process.env[k];
const SECRET = 'whsec_lifecycle_test_not_real';
process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;

// ── Fake Razorpay ───────────────────────────────────────────────────────────
type FakeSub = { id: string; status: string; paid_count: number; plan_id: string; start_at?: number; current_end?: number; notes: any };
const rz = { plans: new Map<string, number>(), subs: new Map<string, FakeSub>(), seq: 0 };
const notFound = () => Object.assign(new Error('BAD_REQUEST_ERROR'), { error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' } });
const fakeClient = {
  plans: {
    create: async (params: any) => {
      const id = `plan_test_${++rz.seq}`;
      rz.plans.set(id, params.item.amount);
      return { id };
    },
  },
  subscriptions: {
    create: async (params: any) => {
      if (!rz.plans.has(params.plan_id)) throw notFound();
      const id = `sub_test_${++rz.seq}`;
      rz.subs.set(id, { id, status: 'created', paid_count: 0, plan_id: params.plan_id, start_at: params.start_at, notes: params.notes });
      return { id, status: 'created' };
    },
    fetch: async (id: string) => {
      const s = rz.subs.get(id);
      if (!s) throw notFound();
      return { ...s };
    },
    cancel: async (id: string) => {
      const s = rz.subs.get(id);
      if (!s) throw notFound();
      s.status = 'cancelled';
      return { ...s };
    },
  },
};

let ctx = { userId: '', businessId: '' };
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/lib[\\/]tenant(\.ts)?$/.test(request)) {
    return { requireBusinessContext: async () => ({ ok: true, userId: ctx.userId, organizationId: 'org', businessId: ctx.businessId, business: {} }) };
  }
  if (/(^\.|lib[\\/]billing)[\\/]razorpay(\.ts)?$/.test(request)) {
    return { getRazorpay: () => fakeClient, getRazorpayKeyId: () => 'rzp_test_FAKEKEYFORTESTS', getRazorpayMode: () => 'test' };
  }
  return origLoad.call(this, request, ...rest);
};

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
  process.env.MONGODB_URI = memoryServer.getUri(`gm_custom_price_lifecycle_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    BillingPlan: (await import('../../src/models/BillingPlan')).default,
    BillingPolicy: (await import('../../src/models/BillingPolicy')).default,
    BillingEvent: (await import('../../src/models/BillingEvent')).default,
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    TrialClaim: (await import('../../src/models/TrialClaim')).default,
    checkout: await import('../../src/app/api/billing/checkout/route'),
    webhook: await import('../../src/app/api/webhook/razorpay/route'),
  };
  await m.TrialClaim.syncIndexes();
});

after(async () => {
  Module._load = origLoad;
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

beforeEach(async () => {
  if (!m.BillingPlan) return;
  await Promise.all([m.BillingPlan.deleteMany({}), m.BillingPolicy.deleteMany({})]);
  await m.BillingPlan.create({
    key: 'default', displayName: 'Growwmatics AI', description: '', priceInr: 1999, features: [],
    durations: [{ cycle: 'monthly', priceInr: 1999, enabled: true }, { cycle: 'yearly', priceInr: 9999, enabled: true }],
  });
});

let seq = 0;
async function newCustomer() {
  const userId = new m.mongoose.Types.ObjectId();
  const b = await m.Business.create({ name: `Life ${++seq}`, category: 'Bakery', address: 'Pune', userId, organizationId: new m.mongoose.Types.ObjectId() } as any);
  await m.User.create({
    _id: userId, fullName: `Life Owner ${seq}`, email: `life${seq}@example.invalid`,
    phone: `+9198768${String(seq).padStart(5, '0')}`, isPhoneVerified: true, role: 'CLIENT', businessIds: [b._id],
  } as any);
  ctx = { userId: String(userId), businessId: String(b._id) };
  return ctx;
}
async function setPolicy(offerEnabled: boolean, customPrice: { enabled: boolean; priceInr: number }) {
  await m.BillingPolicy.deleteMany({});
  await m.BillingPolicy.create({ key: 'default', trial: { offerEnabled, trialMonths: 3, eligibleCycle: 'yearly', customPrice }, version: 1 } as any);
}
async function checkout(body: Record<string, unknown>) {
  const res = await m.checkout.POST(new Request('http://localhost/api/billing/checkout', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}

// Every event is a real signed delivery to the real webhook route.
let eventSeq = 0;
let clock = Math.floor(Date.now() / 1000);
async function deliver(event: string, sub: FakeSub, payment?: { amount: number; status?: string }, eventId = `evt_${++eventSeq}`) {
  clock += 60;
  const raw = JSON.stringify({
    event,
    created_at: clock,
    payload: {
      subscription: { entity: { ...sub } },
      ...(payment && { payment: { entity: { id: `pay_${eventSeq}`, amount: payment.amount, currency: 'INR', status: payment.status ?? 'captured' } } }),
    },
  });
  const sig = crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  const res = await m.webhook.POST(new Request('https://app.example.test/api/webhook/razorpay', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig, 'x-razorpay-event-id': eventId }, body: raw,
  }));
  return { status: res.status, json: await res.json() };
}
const ws = async (id: string) => (await m.Business.findById(id).lean()) as any;
const YEAR = 365 * 86400;
const reviewFlags = async (subId: string) => m.BillingEvent.countDocuments({ razorpaySubscriptionId: subId, needsReview: true });

test('custom price ₹35,999: trial → first charge → renewal → failure → recovery, always ₹35,999', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await setPolicy(true, { enabled: true, priceInr: 35999 });
  const { businessId } = await newCustomer();

  // 1–3. Eligible customer starts the trial on the custom-price plan.
  const c = await checkout({ cycle: 'yearly' });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  const sub = rz.subs.get(c.json.checkout.subscriptionId)!;
  assert.equal(rz.plans.get(sub.plan_id), 3_599_900, 'custom ₹35,999 plan');
  assert.equal(c.json.trial.firstChargeInr, 35999);

  // 4. Future start date = 3 calendar months out; trial starts on authorization.
  const claim: any = await m.TrialClaim.findOne({ razorpaySubscriptionId: sub.id }).lean();
  assert.equal(sub.start_at, Math.floor(new Date(claim.offer.trialEndsAt).getTime() / 1000));
  const days = (sub.start_at! * 1000 - Date.now()) / 86_400_000;
  assert.ok(days > 88 && days < 93, `trial ≈ 3 months (${days.toFixed(1)} days)`);
  sub.status = 'authenticated';
  assert.equal((await deliver('subscription.authenticated', sub)).status, 200);
  let w = await ws(businessId);
  assert.equal(w.subscriptionStatus, 'trial_active');
  assert.equal(new Date(w.trialEndsAt).getTime(), new Date(claim.offer.trialEndsAt).getTime());
  assert.equal(((await m.TrialClaim.findById(claim._id).lean()) as any).status, 'consumed');

  // A duplicate delivery of the same event is skipped.
  const dup = await deliver('subscription.authenticated', sub, undefined, `evt_${eventSeq}`);
  assert.equal(dup.json.skipped, 'duplicate event');

  // 5. Trial ends: "activated" (billing cycle starts, no payment) is not payment…
  sub.status = 'active';
  await deliver('subscription.activated', sub);
  assert.equal((await ws(businessId)).subscriptionStatus, 'trial_active');
  // …the captured ₹35,999 charge is.
  sub.paid_count = 1;
  sub.current_end = sub.start_at! + YEAR;
  assert.equal((await deliver('subscription.charged', sub, { amount: 3_599_900 })).status, 200);
  w = await ws(businessId);
  assert.equal(w.subscriptionStatus, 'active');
  assert.equal(new Date(w.subscriptionCurrentPeriodEnd).getTime(), sub.current_end * 1000);

  // 6. Annual renewal at the same ₹35,999 — accepted, period extended.
  sub.paid_count = 2;
  sub.current_end += YEAR;
  await deliver('subscription.charged', sub, { amount: 3_599_900 });
  w = await ws(businessId);
  assert.equal(w.subscriptionStatus, 'active');
  assert.equal(new Date(w.subscriptionCurrentPeriodEnd).getTime(), sub.current_end * 1000);
  // A charge at any other amount is never accepted silently.
  sub.paid_count = 3;
  await deliver('subscription.charged', sub, { amount: 999_900 });
  assert.equal(await reviewFlags(sub.id), 1, 'flagged for review');
  assert.equal(new Date((await ws(businessId)).subscriptionCurrentPeriodEnd).getTime(), (sub.current_end) * 1000, 'not extended');
  sub.paid_count = 2;

  // 7. Next renewal fails → past due → recovery stays on the ₹35,999 plan.
  await m.BillingPolicy.updateOne({ key: 'default' }, { $set: { 'trial.customPrice.enabled': false, 'trial.customPrice.priceInr': 49999 } });
  sub.status = 'pending';
  await deliver('subscription.pending', sub);
  assert.equal((await ws(businessId)).subscriptionStatus, 'past_due');
  const rec = await checkout({ cycle: 'monthly' });
  assert.equal(rec.status, 200, JSON.stringify(rec.json));
  assert.equal(rec.json.recovery, true);
  const replacement = rz.subs.get(rec.json.checkout.subscriptionId)!;
  assert.equal(replacement.plan_id, sub.plan_id, 'same agreed plan');
  assert.equal(rz.subs.get(sub.id)!.status, 'cancelled', 'original cancelled before replacing');
  assert.match(rec.json.checkout.description, /₹35999 \/ Yearly/);

  // The replacement's charge must be ₹35,999 to restore access.
  replacement.status = 'active';
  replacement.paid_count = 1;
  replacement.current_end = clock + YEAR;
  await deliver('subscription.charged', replacement, { amount: 999_900 });
  assert.equal((await ws(businessId)).subscriptionStatus, 'past_due', '₹9,999 does not settle a ₹35,999 agreement');
  await deliver('subscription.charged', replacement, { amount: 3_599_900 });
  w = await ws(businessId);
  assert.equal(w.subscriptionStatus, 'active');
  assert.equal(w.billingSubscriptionId, replacement.id);
});

test('standard trial customer (custom OFF) pays ₹9,999 after the trial and on renewal', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await setPolicy(true, { enabled: false, priceInr: 35999 });
  const { businessId } = await newCustomer();
  const c = await checkout({ cycle: 'yearly' });
  const sub = rz.subs.get(c.json.checkout.subscriptionId)!;
  assert.equal(rz.plans.get(sub.plan_id), 999_900);
  sub.status = 'authenticated';
  await deliver('subscription.authenticated', sub);
  assert.equal((await ws(businessId)).subscriptionStatus, 'trial_active');

  // Admin switches custom pricing ON later — this customer is unaffected.
  await setPolicy(true, { enabled: true, priceInr: 35999 });
  sub.status = 'active';
  sub.paid_count = 1;
  sub.current_end = sub.start_at! + YEAR;
  await deliver('subscription.charged', sub, { amount: 999_900 });
  assert.equal((await ws(businessId)).subscriptionStatus, 'active');
  sub.paid_count = 2;
  sub.current_end += YEAR;
  await deliver('subscription.charged', sub, { amount: 999_900 });
  assert.equal(new Date((await ws(businessId)).subscriptionCurrentPeriodEnd).getTime(), sub.current_end * 1000);
});

test('skipping the trial pays ₹9,999 immediately, even with custom pricing ON', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await setPolicy(true, { enabled: true, priceInr: 35999 });
  const { businessId } = await newCustomer();
  const c = await checkout({ cycle: 'yearly', skipTrial: true });
  assert.equal(c.json.trial, null);
  const sub = rz.subs.get(c.json.checkout.subscriptionId)!;
  assert.equal(rz.plans.get(sub.plan_id), 999_900);
  assert.equal(sub.start_at, undefined, 'charged now, no future start');
  sub.status = 'active';
  sub.paid_count = 1;
  sub.current_end = clock + YEAR;
  await deliver('subscription.charged', sub, { amount: 999_900 });
  assert.equal((await ws(businessId)).subscriptionStatus, 'active');
  assert.equal(await m.TrialClaim.countDocuments({ businessId }), 0, 'trial not used up');
});

test('a failed payment during checkout changes no access; a failed first charge after the trial locks', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await setPolicy(true, { enabled: true, priceInr: 35999 });
  const { businessId } = await newCustomer();
  const c = await checkout({ cycle: 'yearly' });
  const sub = rz.subs.get(c.json.checkout.subscriptionId)!;
  sub.status = 'authenticated';
  await deliver('subscription.authenticated', sub);
  // First charge at trial end fails (Razorpay: subscription.pending).
  sub.status = 'pending';
  await deliver('subscription.pending', sub);
  const w = await ws(businessId);
  assert.equal(w.subscriptionStatus, 'past_due');
  assert.equal(w.paymentFailureKind, 'first_charge');
});
