/**
 * POST /api/billing/checkout — the REAL route handler against an in-memory
 * MongoDB, with only two modules intercepted:
 *   - lib/tenant (the signed-in workspace context)
 *   - lib/billing/razorpay (a fake Razorpay client + the configured test/live mode)
 * Nothing is sent to Razorpay or any messaging provider.
 *
 * Run: npx tsx --test tests/workflow/billing-checkout-route.test.ts
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|RESEND|SENDGRID|GROQ|OPENAI|INNGEST|DO_SPACES)_/.test(k)) delete process.env[k];

// ── Fake Razorpay: ids exist only in the mode they were created in ──────────
const rz = {
  mode: 'live' as 'test' | 'live',
  calls: [] as string[],
  subs: new Map<string, { status: string; paid_count: number; mode: 'test' | 'live' }>(),
  onPlanCreate: null as null | ((params: any) => Promise<void>),
  seq: 0,
};
const notFound = () => Object.assign(new Error('BAD_REQUEST_ERROR'), { error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' } });
const fakeClient = {
  plans: {
    create: async (params: any) => {
      rz.calls.push(`plans.create:${params.item.amount}`);
      if (rz.onPlanCreate) await rz.onPlanCreate(params);
      return { id: `plan_${rz.mode}_${++rz.seq}` };
    },
  },
  subscriptions: {
    create: async (params: any) => {
      rz.calls.push(`subscriptions.create:${params.plan_id}`);
      const id = `sub_${rz.mode}_${++rz.seq}`;
      rz.subs.set(id, { status: 'created', paid_count: 0, mode: rz.mode });
      return { id, status: 'created' };
    },
    fetch: async (id: string) => {
      rz.calls.push(`fetch:${id}`);
      const s = rz.subs.get(id);
      if (!s || s.mode !== rz.mode) throw notFound();
      return { id, status: s.status, paid_count: s.paid_count };
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
const fired = { tenant: 0, razorpay: 0 };
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  // `(\.ts)?` — tsx passes the resolved path for lazy imports; './razorpay' is planCatalog's relative import.
  if (/lib[\\/]tenant(\.ts)?$/.test(request)) {
    fired.tenant++;
    return { requireBusinessContext: async () => ({ ok: true, userId: ctx.userId, organizationId: 'org', businessId: ctx.businessId, business: {} }) };
  }
  if (/(^\.|lib[\\/]billing)[\\/]razorpay(\.ts)?$/.test(request)) {
    fired.razorpay++;
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
  process.env.MONGODB_URI = memoryServer.getUri(`gm_checkout_route_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    BillingPlan: (await import('../../src/models/BillingPlan')).default,
    BillingPolicy: (await import('../../src/models/BillingPolicy')).default,
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    TrialClaim: (await import('../../src/models/TrialClaim')).default,
    route: await import('../../src/app/api/billing/checkout/route'),
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
  if (!m.BillingPlan) return;
  await m.BillingPlan.deleteMany({});
  await m.BillingPolicy.deleteMany({});
  // Quarterly has a TEST-mode plan id stored; yearly has none yet.
  await m.BillingPlan.create({
    key: 'default', displayName: 'GrowwMatics AI', description: '', priceInr: 1999, features: [],
    durations: [
      { cycle: 'monthly', priceInr: 1999, enabled: true },
      { cycle: 'quarterly', priceInr: 5499, enabled: true, razorpayPlanId: 'plan_test_q', razorpayPlanPriceInr: 5499, razorpayPlanMode: 'test' },
      { cycle: 'halfyearly', priceInr: 10999, enabled: false },
      { cycle: 'yearly', priceInr: 9999, enabled: true },
    ],
  });
});

const oid = () => new m.mongoose.Types.ObjectId();

async function workspace(over: Record<string, unknown> = {}) {
  const userId = oid();
  const b = await m.Business.create({ name: `WS ${++phoneSeq}`, category: 'Bakery', address: 'Pune', userId, organizationId: oid(), ...over } as any);
  await m.User.create({
    _id: userId, fullName: `Owner ${phoneSeq}`, email: `owner${phoneSeq}@example.invalid`,
    phone: `+9198765${String(phoneSeq).padStart(5, '0')}`, isPhoneVerified: true, role: 'CLIENT', businessIds: [b._id],
  } as any);
  ctx = { userId: String(userId), businessId: String(b._id) };
  return ctx;
}

async function checkout(body: Record<string, unknown>) {
  const res = await m.route.POST(new Request('http://localhost/api/billing/checkout', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}

test('interceptors are active (the route uses the fake Razorpay and context)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.ok(fired.tenant > 0, 'lib/tenant intercepted');
  assert.ok(fired.razorpay > 0, 'lib/billing/razorpay intercepted');
});

test('live checkout: the stored TEST plan id is never used; the new checkout link records live mode', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId } = await workspace();
  const r = await checkout({ cycle: 'quarterly' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(rz.calls.includes('plans.create:549900'), 'a live plan was created for ₹5,499');
  assert.ok(!rz.calls.some((c) => c.includes('plan_test_q')), 'test plan id never sent');
  const subId = r.json.checkout.subscriptionId;
  assert.match(subId, /^sub_live_/);
  const ws: any = await m.Business.findById(businessId).lean();
  assert.equal(ws.razorpaySubscriptionId, subId);
  assert.deepEqual(ws.razorpaySubscriptionEnv, { subscriptionId: subId, mode: 'live' });
});

test('a previous checkout recorded as TEST does not block a live checkout and is not touched', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await workspace({ subscriptionStatus: 'trialing', razorpaySubscriptionId: 'sub_test_old', razorpaySubscriptionEnv: { subscriptionId: 'sub_test_old', mode: 'test' } });
  const r = await checkout({ cycle: 'quarterly' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(!rz.calls.some((c) => c.endsWith(':sub_test_old')), 'never fetched or cancelled');
  assert.equal(rz.calls.filter((c) => c.startsWith('subscriptions.create')).length, 1);
});

test('a legacy previous checkout (no recorded mode) that live keys cannot find → 503, nothing created', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await workspace({ subscriptionStatus: 'trialing', razorpaySubscriptionId: 'sub_legacy' });
  const r = await checkout({ cycle: 'quarterly' });
  assert.equal(r.status, 503);
  assert.equal(r.json.code, 'CHECKOUT_UNAVAILABLE');
  assert.ok(rz.calls.includes('fetch:sub_legacy'));
  assert.equal(rz.calls.filter((c) => c.startsWith('subscriptions.create')).length, 0);
});

test('a previous LIVE checkout that may be paying → refused, never cancelled', async (t) => {
  if (skipReason) return t.skip(skipReason);
  rz.subs.set('sub_live_paying', { status: 'authenticated', paid_count: 0, mode: 'live' });
  await workspace({ subscriptionStatus: 'trialing', razorpaySubscriptionId: 'sub_live_paying', razorpaySubscriptionEnv: { subscriptionId: 'sub_live_paying', mode: 'live' } });
  const r = await checkout({ cycle: 'quarterly' });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'PAYMENT_IN_PROGRESS');
  assert.ok(!rz.calls.includes('cancel:sub_live_paying'));
  assert.equal(rz.calls.filter((c) => c.startsWith('subscriptions.create')).length, 0);
});

test('trial checkout records live mode on the offer and the link; a second tab reuses it', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await m.BillingPolicy.create({ key: 'default', trial: { offerEnabled: true, trialMonths: 3, eligibleCycle: 'yearly' }, version: 1 } as any);
  const { businessId } = await workspace();
  const first = await checkout({ cycle: 'yearly' });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.ok(first.json.trial, 'trial terms returned');
  const subId = first.json.checkout.subscriptionId;
  const claim: any = await m.TrialClaim.findOne({ razorpaySubscriptionId: subId }).lean();
  assert.equal(claim.offer.razorpayMode, 'live');
  assert.match(claim.offer.razorpayPlanId, /^plan_live_/);
  assert.deepEqual((await m.Business.findById(businessId).lean() as any).razorpaySubscriptionEnv, { subscriptionId: subId, mode: 'live' });

  const second = await checkout({ cycle: 'yearly' });
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.equal(second.json.checkout.subscriptionId, subId, 'same subscription handed back');
  assert.equal(rz.calls.filter((c) => c.startsWith('subscriptions.create')).length, 1, 'no second subscription');
});

test('trial reuse: a reservation attached in TEST mode is never handed to a live checkout (and not looked up)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await m.BillingPolicy.create({ key: 'default', trial: { offerEnabled: true, trialMonths: 3, eligibleCycle: 'yearly' }, version: 1 } as any);
  rz.mode = 'test';
  await workspace();
  const first = await checkout({ cycle: 'yearly' });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const testSub = first.json.checkout.subscriptionId;
  assert.match(testSub, /^sub_test_/);

  rz.mode = 'live';
  rz.calls = [];
  const second = await checkout({ cycle: 'yearly' });
  assert.equal(second.status, 503);
  assert.equal(second.json.code, 'CHECKOUT_UNAVAILABLE');
  assert.ok(!rz.calls.includes(`fetch:${testSub}`), 'not looked up with live keys');
  assert.equal(rz.calls.filter((c) => c.startsWith('subscriptions.create')).length, 0);
});

test('PLAN_CHANGED: the price changes while its Razorpay plan is created → 409, no subscription', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId } = await workspace();
  rz.onPlanCreate = async () => {
    await m.BillingPlan.updateOne({ key: 'default', 'durations.cycle': 'yearly' }, { $set: { 'durations.$.priceInr': 10999 } });
  };
  const r = await checkout({ cycle: 'yearly' });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'PLAN_CHANGED');
  assert.equal(rz.calls.filter((c) => c.startsWith('subscriptions.create')).length, 0);
  const ws: any = await m.Business.findById(businessId).lean();
  assert.equal(ws.razorpaySubscriptionId, undefined, 'nothing linked');
});
