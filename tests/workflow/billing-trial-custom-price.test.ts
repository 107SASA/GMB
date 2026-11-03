/**
 * Custom trial pricing, end to end through the REAL route handlers
 * (POST /api/billing/checkout, GET /api/billing/trial-offer,
 * PUT /api/admin/billing-policy) against an in-memory MongoDB. Intercepted:
 *   - lib/tenant (the signed-in workspace context)
 *   - lib/superAdminAuth (who is calling the admin route)
 *   - lib/billing/razorpay (a fake Razorpay client + the configured mode)
 * Nothing is sent to Razorpay or any messaging provider.
 *
 * Run: npx tsx --test tests/workflow/billing-trial-custom-price.test.ts
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|RESEND|SENDGRID|GROQ|OPENAI|INNGEST|DO_SPACES)_/.test(k)) delete process.env[k];

// ── Fake Razorpay: plans and subscriptions exist only in the mode they were created in ──
const rz = {
  mode: 'live' as 'test' | 'live',
  calls: [] as string[],
  plans: new Map<string, { amount: number; mode: 'test' | 'live' }>(),
  subs: new Map<string, { status: string; paid_count: number; plan_id: string; mode: 'test' | 'live'; notes?: any }>(),
  onPlanCreate: null as null | ((params: any) => Promise<void>),
  seq: 0,
};
const notFound = () => Object.assign(new Error('BAD_REQUEST_ERROR'), { error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' } });
const fakeClient = {
  plans: {
    create: async (params: any) => {
      rz.calls.push(`plans.create:${params.item.amount}`);
      if (rz.onPlanCreate) await rz.onPlanCreate(params);
      const id = `plan_${rz.mode}_${++rz.seq}`;
      rz.plans.set(id, { amount: params.item.amount, mode: rz.mode });
      return { id };
    },
  },
  subscriptions: {
    create: async (params: any) => {
      const plan = rz.plans.get(params.plan_id);
      if (!plan || plan.mode !== rz.mode) throw notFound();
      rz.calls.push(`subscriptions.create:${params.plan_id}:${plan.amount}`);
      const id = `sub_${rz.mode}_${++rz.seq}`;
      rz.subs.set(id, { status: 'created', paid_count: 0, plan_id: params.plan_id, mode: rz.mode, notes: params.notes });
      return { id, status: 'created' };
    },
    fetch: async (id: string) => {
      rz.calls.push(`fetch:${id}`);
      const s = rz.subs.get(id);
      if (!s || s.mode !== rz.mode) throw notFound();
      return { id, status: s.status, paid_count: s.paid_count, plan_id: s.plan_id };
    },
    cancel: async (id: string) => {
      rz.calls.push(`cancel:${id}`);
      const s = rz.subs.get(id);
      if (!s || s.mode !== rz.mode) throw notFound();
      s.status = 'cancelled';
      return { id, status: 'cancelled' };
    },
  },
};

let ctx: { userId: string; businessId: string } = { userId: '', businessId: '' };
let superAdmin = true;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/lib[\\/]tenant(\.ts)?$/.test(request)) {
    return { requireBusinessContext: async () => ({ ok: true, userId: ctx.userId, organizationId: 'org', businessId: ctx.businessId, business: {} }) };
  }
  if (/lib[\\/]superAdminAuth(\.ts)?$/.test(request)) {
    const { NextResponse } = require('next/server');
    return {
      requireSuperAdmin: async () =>
        superAdmin
          ? { ok: true, userId: '64b000000000000000000001', user: { email: 'admin@example.invalid' } }
          : { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) },
    };
  }
  if (/(^\.|lib[\\/]billing)[\\/]razorpay(\.ts)?$/.test(request)) {
    return {
      getRazorpay: () => fakeClient,
      getRazorpayKeyId: () => `rzp_${rz.mode}_FAKEKEYFORTESTS`,
      getRazorpayMode: () => rz.mode,
    };
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
  process.env.MONGODB_URI = memoryServer.getUri(`gm_trial_custom_price_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    BillingPlan: (await import('../../src/models/BillingPlan')).default,
    BillingPolicy: (await import('../../src/models/BillingPolicy')).default,
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    TrialClaim: (await import('../../src/models/TrialClaim')).default,
    AdminActionLog: (await import('../../src/models/AdminActionLog')).default,
    checkoutRoute: await import('../../src/app/api/billing/checkout/route'),
    trialOfferRoute: await import('../../src/app/api/billing/trial-offer/route'),
    policyRoute: await import('../../src/app/api/admin/billing-policy/route'),
    billingEvents: await import('../../src/services/billing/billingEvents'),
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

let phoneSeq = 0;
beforeEach(async () => {
  rz.mode = 'live';
  rz.calls = [];
  rz.onPlanCreate = null;
  superAdmin = true;
  if (!m.BillingPlan) return;
  await Promise.all([m.BillingPlan.deleteMany({}), m.BillingPolicy.deleteMany({}), m.TrialClaim.deleteMany({})]);
  await m.BillingPlan.create({
    key: 'default', displayName: 'GrowwMatics AI', description: '', priceInr: 1999, features: [],
    durations: [
      { cycle: 'monthly', priceInr: 1999, enabled: true },
      { cycle: 'yearly', priceInr: 9999, enabled: true },
    ],
  });
});

const oid = () => new m.mongoose.Types.ObjectId();

async function policy(offerEnabled: boolean, custom: { enabled: boolean; priceInr: number } | null, extra: Record<string, unknown> = {}) {
  await m.BillingPolicy.create({
    key: 'default',
    trial: { offerEnabled, trialMonths: 3, eligibleCycle: 'yearly', ...(custom && { customPrice: custom }), ...extra },
    version: 1,
  } as any);
}

async function workspace(over: Record<string, unknown> = {}, phone?: string) {
  const userId = oid();
  const b = await m.Business.create({ name: `WS ${++phoneSeq}`, category: 'Bakery', address: 'Pune', userId, organizationId: oid(), ...over } as any);
  await m.User.create({
    _id: userId, fullName: `Owner ${phoneSeq}`, email: `owner${phoneSeq}@example.invalid`,
    phone: phone ?? `+9198766${String(phoneSeq).padStart(5, '0')}`, isPhoneVerified: true, role: 'CLIENT', businessIds: [b._id],
  } as any);
  ctx = { userId: String(userId), businessId: String(b._id) };
  return ctx;
}

async function checkout(body: Record<string, unknown>) {
  const res = await m.checkoutRoute.POST(new Request('http://localhost/api/billing/checkout', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}
async function adminPut(body: unknown) {
  const res = await m.policyRoute.PUT(new Request('http://localhost/api/admin/billing-policy', { method: 'PUT', body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}
const created = () => rz.calls.filter((c) => c.startsWith('subscriptions.create'));
const subAmount = (subId: string) => rz.plans.get(rz.subs.get(subId)!.plan_id)!.amount;

// ── The pricing matrix, through the real checkout ───────────────────────────

test('trial ON + custom ON: subscribed to a separate ₹35,999 yearly plan; terms frozen on the claim', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: true, priceInr: 35999 });
  await workspace();
  const r = await checkout({ cycle: 'yearly' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const subId = r.json.checkout.subscriptionId;
  assert.equal(subAmount(subId), 3_599_900, 'the subscription bills ₹35,999');
  assert.equal(r.json.trial.firstChargeInr, 35999);
  assert.match(r.json.checkout.description, /then ₹35999 \/ year/);

  const claim: any = await m.TrialClaim.findOne({ razorpaySubscriptionId: subId }).lean();
  assert.equal(claim.offer.amountPaise, 3_599_900);
  assert.equal(claim.offer.priceSource, 'custom');
  assert.equal(claim.offer.razorpayMode, 'live');
  assert.equal(claim.offer.trialMonths, 3);
  assert.equal(claim.offer.razorpayPlanId, rz.subs.get(subId)!.plan_id);
  assert.equal(rz.subs.get(subId)!.notes.priceSource, 'custom');

  // The standard yearly plan is untouched: its price and its own plan id.
  const plan: any = await m.BillingPlan.findOne({ key: 'default' }).lean();
  const yearly = plan.durations.find((d: any) => d.cycle === 'yearly');
  assert.equal(yearly.priceInr, 9999);
  assert.notEqual(yearly.razorpayPlanId, claim.offer.razorpayPlanId, 'never the standard plan');
  assert.equal(yearly.razorpayPlanPriceInr, 9999);
});

test('trial ON + custom OFF: the standard ₹9,999 yearly plan, no custom plan created', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: false, priceInr: 35999 });
  await workspace();
  const r = await checkout({ cycle: 'yearly' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(subAmount(r.json.checkout.subscriptionId), 999_900);
  assert.ok(!rz.calls.includes('plans.create:3599900'));
  const claim: any = await m.TrialClaim.findOne({ razorpaySubscriptionId: r.json.checkout.subscriptionId }).lean();
  assert.equal(claim.offer.amountPaise, 999_900);
  assert.equal(claim.offer.priceSource, 'standard');
  assert.equal(r.json.trial.firstChargeInr, 9999);
});

for (const custom of [true, false]) {
  test(`trial OFF + custom ${custom ? 'ON' : 'OFF'}: ₹9,999 charged now, no trial`, async (t) => {
    if (skipReason) return t.skip(skipReason);
    await policy(false, { enabled: custom, priceInr: 35999 });
    await workspace();
    const r = await checkout({ cycle: 'yearly' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.trial, null);
    assert.equal(subAmount(r.json.checkout.subscriptionId), 999_900);
    assert.ok(!rz.calls.includes('plans.create:3599900'));
    assert.equal(await m.TrialClaim.countDocuments({}), 0, 'no trial claim taken');
  });
}

test('skipping the trial pays the standard ₹9,999 now, even with custom pricing ON', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: true, priceInr: 35999 });
  await workspace();
  const r = await checkout({ cycle: 'yearly', skipTrial: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.trial, null);
  assert.equal(subAmount(r.json.checkout.subscriptionId), 999_900);
  assert.ok(!rz.calls.includes('plans.create:3599900'));
  assert.equal(await m.TrialClaim.countDocuments({}), 0, 'the phone keeps its one trial');
});

test('an ineligible customer (workspace already trialled) pays ₹9,999, never the custom price', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: true, priceInr: 35999 });
  await workspace({ trialStartedAt: new Date('2026-01-01') });
  const r = await checkout({ cycle: 'yearly' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.trial, null);
  assert.equal(subAmount(r.json.checkout.subscriptionId), 999_900);
});

test('one phone = one trial: a second workspace on the same phone pays ₹9,999', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: true, priceInr: 35999 });
  await workspace({}, '+919876700001');
  const first = await checkout({ cycle: 'yearly' });
  assert.ok(first.json.trial, 'first workspace gets the trial');
  // Same number, stored in national format by another account (User.phone is unique per format).
  await workspace({}, '9876700001');
  const second = await checkout({ cycle: 'yearly' });
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.equal(second.json.trial, null);
  assert.equal(subAmount(second.json.checkout.subscriptionId), 999_900);
  assert.equal(await m.TrialClaim.countDocuments({}), 1);
});

test('the browser cannot choose the amount: price fields in the request are ignored', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: false, priceInr: 35999 });
  await workspace();
  const r = await checkout({ cycle: 'yearly', priceInr: 1, amount: 100, priceSource: 'custom', customPrice: { enabled: true, priceInr: 1 } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(subAmount(r.json.checkout.subscriptionId), 999_900);
  assert.equal(r.json.trial.firstChargeInr, 9999);
});

// ── Plan cache, modes and races ─────────────────────────────────────────────

test('the custom plan is created once and reused for the same price and mode', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: true, priceInr: 35999 });
  await workspace();
  await checkout({ cycle: 'yearly' });
  await workspace();
  const r = await checkout({ cycle: 'yearly' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(rz.calls.filter((c) => c === 'plans.create:3599900').length, 1, 'one ₹35,999 plan');
  const doc: any = await m.BillingPolicy.findOne({ key: 'default' }).lean();
  assert.equal(doc.trial.customPricePlan.razorpayPlanPriceInr, 35999);
  assert.equal(doc.trial.customPricePlan.razorpayPlanMode, 'live');
  assert.equal(doc.version, 1, 'caching a plan is not a policy change');
});

test('a cached custom plan from TEST mode is never used with live keys (and vice versa a new amount gets a new plan)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  rz.plans.set('plan_test_custom', { amount: 3_599_900, mode: 'test' });
  await policy(true, { enabled: true, priceInr: 35999 }, { customPricePlan: { razorpayPlanId: 'plan_test_custom', razorpayPlanPriceInr: 35999, razorpayPlanMode: 'test' } });
  await workspace();
  const r = await checkout({ cycle: 'yearly' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(rz.calls.includes('plans.create:3599900'), 'a live plan was created');
  assert.ok(!rz.calls.some((c) => c.includes('plan_test_custom')), 'test plan id never sent');

  // Admin changes the amount → the cached ₹35,999 plan is not reused for ₹29,999.
  await m.BillingPolicy.updateOne({ key: 'default' }, { $set: { 'trial.customPrice.priceInr': 29999 } });
  await workspace();
  const r2 = await checkout({ cycle: 'yearly' });
  assert.equal(subAmount(r2.json.checkout.subscriptionId), 2_999_900);
});

test('admin changes the custom price while its plan is being created → 409 PLAN_CHANGED, nothing handed out', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: true, priceInr: 35999 });
  const { businessId } = await workspace();
  rz.onPlanCreate = async (params) => {
    if (params.item.amount === 3_599_900) await m.BillingPolicy.updateOne({ key: 'default' }, { $set: { 'trial.customPrice.priceInr': 39999 } });
  };
  const r = await checkout({ cycle: 'yearly' });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'PLAN_CHANGED');
  assert.equal(created().length, 0, 'no subscription');
  const claim: any = await m.TrialClaim.findOne({ businessId }).lean();
  assert.equal(claim?.razorpaySubscriptionId, undefined, 'reservation has no subscription (released when its window ends)');
  const doc: any = await m.BillingPolicy.findOne({ key: 'default' }).lean();
  assert.equal(doc.trial.customPricePlan?.razorpayPlanId, undefined, 'stale plan not cached');
});

test('two simultaneous trial checkouts for one workspace: one claim, at most one usable subscription', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: true, priceInr: 35999 });
  const { businessId } = await workspace();
  const [a, b] = await Promise.all([checkout({ cycle: 'yearly' }), checkout({ cycle: 'yearly' })]);
  const ok = [a, b].filter((r) => r.status === 200);
  assert.ok(ok.length >= 1, JSON.stringify([a, b]));
  const ids = new Set(ok.map((r) => r.json.checkout.subscriptionId));
  assert.equal(ids.size, 1, 'both tabs (if both succeed) get the same subscription');
  assert.equal(await m.TrialClaim.countDocuments({ businessId }), 1);
  const claim: any = await m.TrialClaim.findOne({ businessId }).lean();
  assert.ok(ids.has(claim.razorpaySubscriptionId));
  for (const id of rz.subs.keys()) {
    if (id !== claim.razorpaySubscriptionId && rz.subs.get(id)!.notes?.businessId === businessId) {
      assert.equal(rz.subs.get(id)!.status, 'cancelled', `extra subscription ${id} cancelled`);
    }
  }
});

// ── Existing agreements are never re-priced ─────────────────────────────────

test('second tab after an admin price change shows and keeps the ORIGINAL saved price', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: true, priceInr: 35999 });
  await workspace();
  const first = await checkout({ cycle: 'yearly' });
  const subId = first.json.checkout.subscriptionId;

  await m.BillingPolicy.updateOne({ key: 'default' }, { $set: { 'trial.customPrice.priceInr': 49999 }, $inc: { version: 1 } });
  rz.calls = [];
  const second = await checkout({ cycle: 'yearly' });
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.equal(second.json.checkout.subscriptionId, subId);
  assert.equal(second.json.trial.firstChargeInr, 35999);
  assert.match(second.json.checkout.description, /then ₹35999 \/ year/);
  assert.equal(created().length, 0, 'nothing new created');
  const claim: any = await m.TrialClaim.findOne({ razorpaySubscriptionId: subId }).lean();
  assert.equal(claim.offer.amountPaise, 3_599_900);
});

test('admin turning custom pricing OFF does not touch existing claims or trials', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: true, priceInr: 35999 });
  await workspace();
  const r = await checkout({ cycle: 'yearly' });
  const before: any = await m.TrialClaim.findOne({ razorpaySubscriptionId: r.json.checkout.subscriptionId }).lean();
  const put = await adminPut({ customPrice: { enabled: false, priceInr: 35999 } });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const afterDoc: any = await m.TrialClaim.findOne({ _id: before._id }).lean();
  assert.deepEqual(afterDoc.offer, before.offer);
  assert.equal(String(afterDoc.updatedAt), String(before.updatedAt), 'claim not written');
});

// ── Expected amount for webhooks / recovery subscriptions ───────────────────

test('webhook amount check knows a trial-agreed plan even after the admin price moved on', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: true, priceInr: 35999 });
  await workspace();
  const r = await checkout({ cycle: 'yearly' });
  const planId = rz.subs.get(r.json.checkout.subscriptionId)!.plan_id;
  await m.BillingPolicy.updateOne({ key: 'default' }, { $set: { 'trial.customPrice.priceInr': 49999, 'trial.customPrice.enabled': false } });
  assert.equal(await m.billingEvents.expectedPlanAmountPaise(planId), 3_599_900);
});

// ── Payment recovery keeps the agreed plan ──────────────────────────────────

async function pastDueTrialWorkspace(planAmountPaise: number, priceSource: 'standard' | 'custom') {
  const planId = `plan_live_agreed_${++rz.seq}`;
  rz.plans.set(planId, { amount: planAmountPaise, mode: 'live' });
  const trialSub = `sub_live_trial_${rz.seq}`;
  rz.subs.set(trialSub, { status: 'halted', paid_count: 0, plan_id: planId, mode: 'live' });
  const { businessId, userId } = await workspace({
    subscriptionStatus: 'past_due', billingSubscriptionId: trialSub, razorpaySubscriptionId: trialSub,
    billingSubscriptionEnv: { subscriptionId: trialSub, mode: 'live' }, razorpaySubscriptionEnv: { subscriptionId: trialSub, mode: 'live' },
    trialStartedAt: new Date('2026-08-01'), paymentFailureKind: 'first_charge', paymentFailedAt: new Date(),
  });
  await m.TrialClaim.create({
    phoneHash: `hash_${rz.seq}`, status: 'consumed', userId, businessId, holderBusinessId: businessId, razorpaySubscriptionId: trialSub,
    offer: { trialMonths: 3, trialEndsAt: new Date('2026-11-01'), razorpayPlanId: planId, amountPaise: planAmountPaise, currency: 'INR', policyVersion: 3, decidedAt: new Date('2026-08-01'), razorpayMode: 'live', priceSource },
  } as any);
  return { businessId, planId, trialSub };
}

test('failed first charge on a ₹35,999 trial: recovery uses the same ₹35,999 plan, whatever the admin set since', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: false, priceInr: 49999 }); // price since changed AND turned off
  const { businessId, planId, trialSub } = await pastDueTrialWorkspace(3_599_900, 'custom');
  const r = await checkout({ cycle: 'monthly' }); // the cycle the browser sent is not what decides
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.recovery, true);
  const replacement = r.json.checkout.subscriptionId;
  assert.equal(rz.subs.get(replacement)!.plan_id, planId, 'same agreed plan');
  assert.equal(subAmount(replacement), 3_599_900);
  assert.match(r.json.checkout.description, /₹35999 \/ Yearly/);
  assert.ok(rz.calls.indexOf(`cancel:${trialSub}`) < rz.calls.findIndex((c) => c.startsWith('subscriptions.create')), 'original cancelled first');
  const ws: any = await m.Business.findById(businessId).lean();
  assert.equal(ws.recoveryCheckout.planId, planId);
  assert.equal(ws.recoveryCheckout.amountPaise, 3_599_900);
  assert.equal(ws.recoveryCheckout.cycle, 'yearly');

  // A repeated click reuses it and still shows ₹35,999.
  const again = await checkout({ cycle: 'monthly' });
  assert.equal(again.json.checkout.subscriptionId, replacement);
  assert.match(again.json.checkout.description, /₹35999 \/ Yearly/);
});

test('failed first charge on a ₹9,999 trial: recovery keeps ₹9,999 even with custom pricing ON now', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: true, priceInr: 35999 });
  await m.BillingPlan.updateOne({ key: 'default', 'durations.cycle': 'yearly' }, { $set: { 'durations.$.priceInr': 12999 } });
  const { planId } = await pastDueTrialWorkspace(999_900, 'standard');
  const r = await checkout({ cycle: 'yearly' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(rz.subs.get(r.json.checkout.subscriptionId)!.plan_id, planId);
  assert.equal(subAmount(r.json.checkout.subscriptionId), 999_900);
  // (The route still ensures the standard yearly plan exists, as before — but nothing subscribes to it.)
  assert.deepEqual(created(), [`subscriptions.create:${planId}:999900`], 'only the agreed ₹9,999 plan is subscribed');
  assert.ok(!rz.calls.includes('plans.create:3599900'));
});

test('an expired recovery checkout is replaced on the same agreed plan', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: false, priceInr: 35999 });
  const { businessId, planId } = await pastDueTrialWorkspace(3_599_900, 'custom');
  const first = await checkout({ cycle: 'yearly' });
  rz.subs.get(first.json.checkout.subscriptionId)!.status = 'expired';
  const second = await checkout({ cycle: 'yearly' });
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.notEqual(second.json.checkout.subscriptionId, first.json.checkout.subscriptionId);
  assert.equal(rz.subs.get(second.json.checkout.subscriptionId)!.plan_id, planId);
  assert.equal(((await m.Business.findById(businessId).lean()) as any).recoveryCheckout.amountPaise, 3_599_900);
});

test('a non-trial paid customer’s recovery is unchanged (standard plan for the chosen cycle)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: true, priceInr: 35999 });
  rz.plans.set('plan_live_monthly_old', { amount: 199_900, mode: 'live' });
  rz.subs.set('sub_live_paid', { status: 'pending', paid_count: 4, plan_id: 'plan_live_monthly_old', mode: 'live' });
  await workspace({
    subscriptionStatus: 'past_due', billingSubscriptionId: 'sub_live_paid', razorpaySubscriptionId: 'sub_live_paid',
    billingSubscriptionEnv: { subscriptionId: 'sub_live_paid', mode: 'live' }, subscriptionCurrentPeriodEnd: new Date(), paymentFailureKind: 'renewal', paymentFailedAt: new Date(),
  });
  const r = await checkout({ cycle: 'monthly' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(subAmount(r.json.checkout.subscriptionId), 199_900);
  assert.ok(!rz.calls.includes('plans.create:3599900'));
});

test('a trial agreement from TEST mode is never recovered on a live plan or at another price', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: true, priceInr: 35999 });
  const { businessId } = await pastDueTrialWorkspace(3_599_900, 'custom');
  await m.TrialClaim.updateOne({ businessId }, { $set: { 'offer.razorpayMode': 'test' } });
  const r = await checkout({ cycle: 'yearly' });
  assert.equal(r.status, 503, JSON.stringify(r.json));
  assert.equal(r.json.code, 'RECOVERY_UNAVAILABLE');
  assert.equal(created().length, 0, 'nothing created');
});

// ── Customer-facing preview ─────────────────────────────────────────────────

test('trial-offer preview: eligible customers see the custom price; ineligible see ₹9,999', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: true, priceInr: 35999 });
  await workspace();
  const eligible = await (await m.trialOfferRoute.GET()).json();
  assert.equal(eligible.offer.eligible, true);
  assert.equal(eligible.offer.preview.firstChargeInr, 35999);
  assert.equal(eligible.offer.preview.standardPriceInr, 9999);

  await workspace({ trialStartedAt: new Date('2026-01-01') });
  const ineligible = await (await m.trialOfferRoute.GET()).json();
  assert.equal(ineligible.offer.eligible, false);
  assert.equal(ineligible.offer.preview.firstChargeInr, 9999);
});

// ── Admin configuration ─────────────────────────────────────────────────────

test('admin: saving custom pricing changes only its fields, bumps the version and is audited', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, null);
  await m.BillingPolicy.updateOne({ key: 'default' }, { $set: { failure: { firstCharge: { mode: 'grace', graceDays: 5 }, renewal: { mode: 'grace', graceDays: 3 }, restrictedModules: ['sales_agent'], restoreAccessOnRecovery: false } } });
  const r = await adminPut({ customPrice: { enabled: true, priceInr: 35999 } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const doc: any = await m.BillingPolicy.findOne({ key: 'default' }).lean();
  assert.deepEqual(doc.trial.customPrice, { enabled: true, priceInr: 35999 });
  assert.equal(doc.trial.offerEnabled, true, 'trial switch untouched');
  assert.equal(doc.trial.trialMonths, 3, 'trial length untouched');
  assert.equal(doc.failure.firstCharge.graceDays, 5, 'failure policy untouched');
  assert.equal(doc.version, 2);
  const log: any = await m.AdminActionLog.findOne({ action: 'billing_policy.update' }).sort({ _id: -1 }).lean();
  assert.deepEqual(log.metadata.old.trial.customPrice, { enabled: false, priceInr: 35999 });
  assert.deepEqual(log.metadata.new.trial.customPrice, { enabled: true, priceInr: 35999 });

  // Saving the trial switch afterwards keeps the custom price.
  await adminPut({ trial: { offerEnabled: false, trialMonths: 3 } });
  const again: any = await m.BillingPolicy.findOne({ key: 'default' }).lean();
  assert.deepEqual(again.trial.customPrice, { enabled: true, priceInr: 35999 });
});

test('admin: invalid custom prices are rejected and nothing is saved', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: false, priceInr: 35999 });
  for (const bad of [{ enabled: true, priceInr: 0 }, { enabled: true, priceInr: 500001 }, { enabled: true, priceInr: 99.5 }, { enabled: 'on', priceInr: 35999 }, { enabled: true, priceInr: '35999' }]) {
    const r = await adminPut({ customPrice: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  const doc: any = await m.BillingPolicy.findOne({ key: 'default' }).lean();
  assert.deepEqual(doc.trial.customPrice, { enabled: false, priceInr: 35999 });
  assert.equal(doc.version, 1);
});

test('admin: a non-super-admin cannot read or change the billing policy', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: false, priceInr: 35999 });
  superAdmin = false;
  const put = await adminPut({ customPrice: { enabled: true, priceInr: 1 } });
  assert.equal(put.status, 403);
  const get = await m.policyRoute.GET();
  assert.equal(get.status, 403);
  const doc: any = await m.BillingPolicy.findOne({ key: 'default' }).lean();
  assert.equal(doc.trial.customPrice.enabled, false);
});

test('existing policy documents without custom-price fields keep working (old request shape too)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  // A document written before this feature: raw, without customPrice at all.
  await m.BillingPolicy.collection.insertOne({ key: 'default', trial: { offerEnabled: true, trialMonths: 3, eligibleCycle: 'yearly' }, version: 7, updatedBy: 'x' });
  const get = await (await m.policyRoute.GET()).json();
  assert.deepEqual(get.policy.customPrice, { enabled: false, priceInr: 35999 });
  const put = await adminPut({ trial: { offerEnabled: true, trialMonths: 4 } });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  await workspace();
  const r = await checkout({ cycle: 'yearly' });
  assert.equal(subAmount(r.json.checkout.subscriptionId), 999_900, 'standard price, as before');
});

test('test-mode trial workspaces are not touched by live checkouts or policy changes', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await policy(true, { enabled: true, priceInr: 35999 });
  // A workspace on a Razorpay TEST-mode trial (like the existing internal ones).
  rz.subs.set('sub_test_internal', { status: 'authenticated', paid_count: 0, plan_id: 'plan_test_9999', mode: 'test' });
  const { businessId } = await workspace({
    subscriptionStatus: 'trial_active', billingSubscriptionId: 'sub_test_internal', razorpaySubscriptionId: 'sub_test_internal',
    billingSubscriptionEnv: { subscriptionId: 'sub_test_internal', mode: 'test' }, trialStartedAt: new Date('2026-10-01'), trialEndsAt: new Date('2027-01-01'),
  });
  const before: any = await m.Business.findById(businessId).lean();
  await adminPut({ customPrice: { enabled: true, priceInr: 39999 } });
  const r = await checkout({ cycle: 'yearly' });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'TRIAL_ACTIVE');
  assert.ok(!rz.calls.some((c) => c.includes('sub_test_internal')), 'never fetched, cancelled or replaced');
  const afterDoc: any = await m.Business.findById(businessId).lean();
  assert.deepEqual(
    { s: afterDoc.subscriptionStatus, b: afterDoc.billingSubscriptionId, e: String(afterDoc.trialEndsAt) },
    { s: before.subscriptionStatus, b: before.billingSubscriptionId, e: String(before.trialEndsAt) }
  );
});

// ── Abuse guard ─────────────────────────────────────────────────────────────

test('checkout is rate limited per account (429), without creating more subscriptions', async (t) => {
  if (skipReason) return t.skip(skipReason);
  process.env.BILLING_CHECKOUT_RATE_LIMIT = '3';
  try {
    await policy(false, null);
    await workspace();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await checkout({ cycle: 'monthly' }));
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 429]);
    assert.equal(results[3].json.code, 'RATE_LIMITED');
    assert.equal(created().length, 3, 'the blocked call created nothing');
    // Another account is not affected.
    await workspace();
    assert.equal((await checkout({ cycle: 'monthly' })).status, 200);
  } finally {
    delete process.env.BILLING_CHECKOUT_RATE_LIMIT;
  }
});
