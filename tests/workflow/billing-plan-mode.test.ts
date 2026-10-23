/**
 * Razorpay test/live isolation of plan ids and checkout links, through the REAL
 * plan catalog / recovery code against an in-memory MongoDB. Razorpay is a
 * fake (createPlan / fetch / create are injected): nothing is contacted. The
 * key ids below are fake strings that only select test vs live mode.
 *
 * Run: npx tsx --test tests/workflow/billing-plan-mode.test.ts
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|RESEND|SENDGRID|GROQ|OPENAI|INNGEST)_/.test(k)) delete process.env[k];

function setMode(mode: 'test' | 'live' | null) {
  if (!mode) {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    return;
  }
  process.env.RAZORPAY_KEY_ID = `rzp_${mode}_FAKEKEYFORTESTS`;
  process.env.RAZORPAY_KEY_SECRET = 'fake-secret-not-used';
}

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
  process.env.MONGODB_URI = memoryServer.getUri(`gm_plan_mode_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    BillingPlan: (await import('../../src/models/BillingPlan')).default,
    Business: (await import('../../src/models/Business')).default,
    TrialClaim: (await import('../../src/models/TrialClaim')).default,
    catalog: await import('../../src/lib/billing/planCatalog'),
    recovery: await import('../../src/lib/billing/paymentRecovery'),
    guard: await import('../../src/lib/billing/checkoutGuard'),
    claims: await import('../../src/lib/billing/trialClaims'),
  };
  await m.BillingPlan.syncIndexes();
});

after(async () => {
  setMode(null);
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

beforeEach(async () => {
  setMode(null);
  delete process.env.RAZORPAY_PLAN_ID_PRO;
  if (m.BillingPlan) await m.BillingPlan.deleteMany({});
});

const oid = () => new m.mongoose.Types.ObjectId();

/** A fake Razorpay plans.create that records the amounts it was asked for. */
function fakePlans(prefix = 'plan_new') {
  const created: Array<{ id: string; amount: number }> = [];
  let n = 0;
  return {
    created,
    createPlan: async (params: any) => {
      const plan = { id: `${prefix}_${++n}`, amount: params.item.amount };
      created.push(plan);
      return { id: plan.id };
    },
  };
}

async function savePlan(durations: any[], extra: Record<string, unknown> = {}) {
  await m.BillingPlan.create({ key: 'default', displayName: 'GrowwMatics AI', description: '', priceInr: 1999, features: [], durations, ...extra });
}

const DURATIONS = (over: Record<string, any> = {}) => [
  { cycle: 'monthly', priceInr: 1999, enabled: true, ...over.monthly },
  { cycle: 'quarterly', priceInr: 5499, enabled: true, ...over.quarterly },
  { cycle: 'halfyearly', priceInr: 10999, enabled: false, ...over.halfyearly },
  { cycle: 'yearly', priceInr: 9999, enabled: true, ...over.yearly },
];

async function stored(cycle: string) {
  const doc: any = await m.BillingPlan.findOne({ key: 'default' }).lean();
  return doc.durations.find((d: any) => d.cycle === cycle);
}

test('1+9. a TEST plan id is not used under LIVE keys; checkout (incl. the yearly trial cycle) gets a new live plan, mode recorded', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await savePlan(DURATIONS({ yearly: { razorpayPlanId: 'plan_test_y', razorpayPlanPriceInr: 9999, razorpayPlanMode: 'test' } }));

  setMode('live');
  const plan = await m.catalog.getActivePlan();
  assert.equal(plan.durations.find((d: any) => d.cycle === 'yearly').razorpayPlanId, null);

  const rp = fakePlans('plan_live');
  const dur = await m.catalog.ensureRazorpayPlanIdForCycle('yearly', { createPlan: rp.createPlan });
  assert.equal(dur.razorpayPlanId, 'plan_live_1');
  assert.deepEqual(rp.created, [{ id: 'plan_live_1', amount: 999900 }]);
  const y = await stored('yearly');
  assert.equal(y.razorpayPlanId, 'plan_live_1');
  assert.equal(y.razorpayPlanMode, 'live');
  assert.equal(y.razorpayPlanPriceInr, 9999);
  assert.equal(y.priceInr, 9999, 'price unchanged');

  // Reused afterwards in live mode — no second plan.
  assert.equal((await m.catalog.ensureRazorpayPlanIdForCycle('yearly', { createPlan: rp.createPlan })).razorpayPlanId, 'plan_live_1');
  assert.equal(rp.created.length, 1);
});

test('2. a LIVE plan id is not used under TEST keys', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await savePlan(DURATIONS({ quarterly: { razorpayPlanId: 'plan_live_q', razorpayPlanPriceInr: 5499, razorpayPlanMode: 'live' } }));
  setMode('test');
  const plan = await m.catalog.getActivePlan();
  assert.equal(plan.durations.find((d: any) => d.cycle === 'quarterly').razorpayPlanId, null);
  setMode('live');
  assert.equal((await m.catalog.getActivePlan()).durations.find((d: any) => d.cycle === 'quarterly').razorpayPlanId, 'plan_live_q');
});

test('3. a legacy plan id (no mode) is reused under test keys only, never under live keys', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await savePlan(DURATIONS({ monthly: { razorpayPlanId: 'plan_legacy', razorpayPlanPriceInr: 1999 } }));

  setMode('test');
  const rpTest = fakePlans();
  assert.equal((await m.catalog.ensureRazorpayPlanIdForCycle('monthly', { createPlan: rpTest.createPlan })).razorpayPlanId, 'plan_legacy');
  assert.equal(rpTest.created.length, 0, 'test mode: legacy id still used');

  setMode('live');
  assert.equal((await m.catalog.getActivePlan()).razorpayPlanId, null);
  const rpLive = fakePlans('plan_live');
  assert.equal((await m.catalog.ensureRazorpayPlanIdForCycle('monthly', { createPlan: rpLive.createPlan })).razorpayPlanId, 'plan_live_1');
  assert.equal((await stored('monthly')).razorpayPlanMode, 'live');
});

test('3b. legacy top-level plan id and RAZORPAY_PLAN_ID_PRO cannot cross into live mode', async (t) => {
  if (skipReason) return t.skip(skipReason);
  // No BillingPlan document: the env fallback is test-only.
  process.env.RAZORPAY_PLAN_ID_PRO = 'plan_from_env';
  setMode('test');
  assert.equal((await m.catalog.getActivePlan()).razorpayPlanId, 'plan_from_env');
  setMode('live');
  assert.equal((await m.catalog.getActivePlan()).razorpayPlanId, null);
  delete process.env.RAZORPAY_PLAN_ID_PRO;

  // Document saved before durations existed: legacy top-level id, no mode.
  await savePlan([], { razorpayPlanId: 'plan_top_legacy', razorpayPlanPriceInr: 1999 });
  setMode('test');
  assert.equal((await m.catalog.getActivePlan()).razorpayPlanId, 'plan_top_legacy');
  setMode('live');
  assert.equal((await m.catalog.getActivePlan()).razorpayPlanId, null);
  // Creating the live plan fills in the four duration slots and keeps pricing / enablement policy.
  const rp = fakePlans('plan_live');
  assert.equal((await m.catalog.ensureRazorpayPlanIdForCycle('monthly', { createPlan: rp.createPlan })).razorpayPlanId, 'plan_live_1');
  const doc: any = await m.BillingPlan.findOne({ key: 'default' }).lean();
  assert.deepEqual(doc.durations.map((d: any) => [d.cycle, d.priceInr, d.enabled]), [
    ['monthly', 1999, true], ['quarterly', 5997, false], ['halfyearly', 11994, false], ['yearly', 23988, false],
  ]);
  assert.equal(doc.durations[0].razorpayPlanMode, 'live');
});

test('4. an unchanged-price admin save keeps the stored plan id AND its mode; a changed price drops it', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await savePlan(DURATIONS({
    yearly: { razorpayPlanId: 'plan_live_y', razorpayPlanPriceInr: 9999, razorpayPlanMode: 'live' },
    monthly: { razorpayPlanId: 'plan_legacy_m', razorpayPlanPriceInr: 1999 },
  }));
  const doc: any = await m.BillingPlan.findOne({ key: 'default' }).lean();
  // Exactly what PATCH /api/admin/billing-plan spreads into each saved duration.
  assert.deepEqual(m.catalog.storedPlanFieldsForPrice(doc, 'yearly', 9999), { razorpayPlanId: 'plan_live_y', razorpayPlanPriceInr: 9999, razorpayPlanMode: 'live' });
  assert.deepEqual(m.catalog.storedPlanFieldsForPrice(doc, 'monthly', 1999), { razorpayPlanId: 'plan_legacy_m', razorpayPlanPriceInr: 1999 }, 'legacy stays legacy (no mode invented)');
  assert.equal(m.catalog.storedPlanFieldsForPrice(doc, 'yearly', 10999), null, 'price changed → new plan needed');
  assert.equal(m.catalog.storedPlanFieldsForPrice(doc, 'quarterly', 5499), null, 'nothing stored');

  // Through the admin save itself (saveAdminPlan, used by PATCH /api/admin/billing-plan).
  assert.equal(await m.catalog.saveAdminPlan({ fields: { updatedBy: 'super-admin' }, durations: DURATIONS().map(({ cycle, priceInr, enabled }: any) => ({ cycle, priceInr, enabled })) }), 'saved');
  const y = await stored('yearly');
  assert.equal(y.razorpayPlanId, 'plan_live_y');
  assert.equal(y.razorpayPlanMode, 'live');
  setMode('live');
  assert.equal((await m.catalog.getActivePlan()).durations.find((d: any) => d.cycle === 'yearly').razorpayPlanId, 'plan_live_y');
});

const adminDurations = (over: Record<string, any> = {}) =>
  DURATIONS(over).map(({ cycle, priceInr, enabled }: any) => ({ cycle, priceInr, enabled }));

test('race: a plan id attached after the admin save read the plan is kept, and every admin change still lands', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await savePlan(DURATIONS());
  setMode('live');
  const rp = fakePlans('plan_live');
  let interleaved = 0;
  const result = await m.catalog.saveAdminPlan(
    { fields: { features: ['New bullet'], updatedBy: 'super-admin' }, durations: adminDurations({ quarterly: { priceInr: 5999 } }) },
    {
      afterRead: async () => {
        // A checkout attaches the yearly plan between the admin's read and write (first attempt only).
        if (interleaved++ === 0) await m.catalog.ensureRazorpayPlanIdForCycle('yearly', { createPlan: rp.createPlan });
      },
    }
  );
  assert.equal(result, 'saved');
  assert.equal(interleaved, 2, 'the first write lost the compare-and-set and was retried');
  const doc: any = await m.BillingPlan.findOne({ key: 'default' }).lean();
  assert.deepEqual(doc.features, ['New bullet'], 'admin change kept');
  assert.equal(doc.durations.find((d: any) => d.cycle === 'quarterly').priceInr, 5999, 'admin price change kept');
  const y = doc.durations.find((d: any) => d.cycle === 'yearly');
  assert.equal(y.razorpayPlanId, 'plan_live_1', 'plan id attached meanwhile kept');
  assert.equal(y.razorpayPlanMode, 'live');
});

test('race: if the admin changes that same price, the plan attached for the old price is dropped', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await savePlan(DURATIONS());
  setMode('live');
  const rp = fakePlans('plan_live');
  let interleaved = 0;
  const result = await m.catalog.saveAdminPlan(
    { fields: { updatedBy: 'super-admin' }, durations: adminDurations({ yearly: { priceInr: 10999 } }) },
    { afterRead: async () => { if (interleaved++ === 0) await m.catalog.ensureRazorpayPlanIdForCycle('yearly', { createPlan: rp.createPlan }); } }
  );
  assert.equal(result, 'saved');
  const y = await stored('yearly');
  assert.equal(y.priceInr, 10999);
  assert.equal(y.razorpayPlanId, undefined, 'a ₹9,999 plan is never kept for ₹10,999');
});

test('race: repeated collisions end in "conflict" without writing', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await savePlan(DURATIONS());
  const result = await m.catalog.saveAdminPlan(
    { fields: { displayName: 'Never saved', updatedBy: 'super-admin' } },
    { afterRead: async () => { await m.BillingPlan.updateOne({ key: 'default' }, { $inc: { revision: 1 } }); } }
  );
  assert.equal(result, 'conflict');
  const doc: any = await m.BillingPlan.findOne({ key: 'default' }).lean();
  assert.equal(doc.displayName, 'GrowwMatics AI');
});

test('first admin save (no plan document yet) still creates it with the defaults filled in', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal(await m.catalog.saveAdminPlan({ fields: { displayName: 'Growth', updatedBy: 'super-admin' }, durations: adminDurations() }), 'saved');
  const doc: any = await m.BillingPlan.findOne({ key: 'default' }).lean();
  assert.equal(doc.displayName, 'Growth');
  assert.equal(doc.priceInr, 1999);
  assert.equal(doc.durations.length, 4);
  assert.equal(doc.revision, 1);
});

test('5. an admin price change during plan creation is not overwritten, and the stale plan is not attached', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await savePlan(DURATIONS());
  setMode('live');
  const adminSaved = DURATIONS({ yearly: { priceInr: 10999 }, quarterly: { enabled: false } });
  const rp = fakePlans('plan_live');
  const racing = async (params: any) => {
    // The super admin saves new prices while Razorpay is creating the plan.
    await m.BillingPlan.updateOne({ key: 'default' }, { $set: { durations: adminSaved } });
    return rp.createPlan(params);
  };
  await assert.rejects(m.catalog.ensureRazorpayPlanIdForCycle('yearly', { createPlan: racing }), (err: any) => err.code === 'PLAN_CHANGED');

  const doc: any = await m.BillingPlan.findOne({ key: 'default' }).lean();
  assert.deepEqual(doc.durations.map((d: any) => [d.cycle, d.priceInr, d.enabled]), adminSaved.map((d: any) => [d.cycle, d.priceInr, d.enabled]), "admin's save stands");
  const y = doc.durations.find((d: any) => d.cycle === 'yearly');
  assert.equal(y.razorpayPlanId, undefined, 'the plan created for ₹9,999 is not attached to ₹10,999');

  // The next checkout creates a plan for the new price.
  const next = fakePlans('plan_next');
  assert.equal((await m.catalog.ensureRazorpayPlanIdForCycle('yearly', { createPlan: next.createPlan })).razorpayPlanId, 'plan_next_1');
  assert.equal(next.created[0].amount, 1_099_900);
});

test('6. plans created at the same time for different durations are both kept', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await savePlan(DURATIONS());
  setMode('live');
  // Both creations are in flight together before either is saved.
  let release!: () => void;
  const bothStarted = new Promise<void>((r) => (release = r));
  let started = 0;
  const rp = fakePlans('plan_live');
  const createPlan = async (params: any) => {
    if (++started === 2) release();
    await bothStarted;
    return rp.createPlan(params);
  };
  const [q, y] = await Promise.all([
    m.catalog.ensureRazorpayPlanIdForCycle('quarterly', { createPlan }),
    m.catalog.ensureRazorpayPlanIdForCycle('yearly', { createPlan }),
  ]);
  assert.ok(q.razorpayPlanId && y.razorpayPlanId);
  assert.equal((await stored('quarterly')).razorpayPlanId, q.razorpayPlanId);
  assert.equal((await stored('yearly')).razorpayPlanId, y.razorpayPlanId);
  const plan = await m.catalog.getActivePlan();
  assert.equal(plan.durations.find((d: any) => d.cycle === 'quarterly').razorpayPlanId, q.razorpayPlanId);
  assert.equal(plan.durations.find((d: any) => d.cycle === 'yearly').razorpayPlanId, y.razorpayPlanId);
});

test('7. a checkout recorded as test-mode no longer blocks a live checkout; a stale record never applies to another id', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const b = await m.Business.create({
    name: 'WS guard', category: 'Bakery', address: 'Pune', userId: oid(), organizationId: oid(),
    subscriptionStatus: 'trialing', razorpaySubscriptionId: 'sub_test_old',
    razorpaySubscriptionEnv: { subscriptionId: 'sub_test_old', mode: 'test' },
  } as any);
  const ws: any = await m.Business.findById(b._id).lean();
  const previous = m.guard.previousUnpaidCheckout(ws);
  const noRazorpay = {
    fetchSubscription: async () => { throw new Error('The id provided does not exist'); },
    cancelSubscription: async () => { throw new Error('must not cancel'); },
  };
  const live = await m.guard.retirePreviousCheckout(noRazorpay, previous, { previousMode: m.guard.recordedCheckoutMode(ws, previous), currentMode: 'live' });
  assert.equal(live.kind, 'test_checkout_ignored');

  // razorpaySubscriptionId later rewritten by another path (e.g. a webhook) without a mode: unknown again → fail-closed.
  await m.Business.updateOne({ _id: b._id }, { $set: { razorpaySubscriptionId: 'sub_other' } });
  const ws2: any = await m.Business.findById(b._id).lean();
  const prev2 = m.guard.previousUnpaidCheckout(ws2);
  assert.equal(m.guard.recordedCheckoutMode(ws2, prev2), null);
  assert.equal((await m.guard.retirePreviousCheckout(noRazorpay, prev2, { previousMode: null, currentMode: 'live' })).kind, 'unavailable');
});

test('9. payment recovery: plan id is live-safe and the replacement checkout records its mode; an unreachable original stays blocked', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await savePlan(DURATIONS({ yearly: { razorpayPlanId: 'plan_test_y', razorpayPlanPriceInr: 9999, razorpayPlanMode: 'test' } }));
  setMode('live');
  const pastDue = async (sub: string) => String((await m.Business.create({
    name: `WS ${sub}`, category: 'Bakery', address: 'Pune', userId: oid(), organizationId: oid(),
    subscriptionStatus: 'past_due', billingSubscriptionId: sub, razorpaySubscriptionId: sub, paymentFailureKind: 'renewal', paymentFailedAt: new Date(),
  } as any))._id);

  const rp = fakePlans('plan_live');
  const usedPlans: string[] = [];
  const deps = (states: Record<string, any>) => ({
    Business: m.Business,
    razorpayMode: 'live' as const,
    now: () => new Date(),
    fetchSubscription: async (id: string) => {
      if (!states[id]) throw new Error('The id provided does not exist');
      return states[id];
    },
    cancelSubscription: async () => {},
    // Same steps as services/billing/paymentRecoveryService.ts createSubscription.
    createSubscription: async () => {
      const duration = await m.catalog.ensureRazorpayPlanIdForCycle('yearly', { createPlan: rp.createPlan });
      usedPlans.push(duration.razorpayPlanId);
      return { id: 'sub_recovery_live' };
    },
    reconcilePaid: async () => {},
    record: async () => {},
  });

  const businessId = await pastDue('sub_orig_live');
  const r = await m.recovery.prepareRecoveryCheckout(deps({ sub_orig_live: { status: 'cancelled', paidCount: 2 } }), { businessId, userId: String(oid()), cycle: 'yearly' });
  assert.equal(r.kind, 'checkout');
  assert.deepEqual(usedPlans, ['plan_live_1'], 'never the stored test plan');
  const ws: any = await m.Business.findById(businessId).lean();
  assert.deepEqual(ws.razorpaySubscriptionEnv, { subscriptionId: 'sub_recovery_live', mode: 'live' });

  // A past-due workspace whose original can't be looked up (e.g. a test-mode original under live keys): nothing created.
  const blockedId = await pastDue('sub_orig_unknown');
  const blocked = await m.recovery.prepareRecoveryCheckout(deps({}), { businessId: blockedId, userId: String(oid()), cycle: 'yearly' });
  assert.equal(blocked.kind, 'unavailable');
  assert.equal(usedPlans.length, 1);
});

test('9b. trial checkout: the offer snapshot keeps the Razorpay mode with the attached subscription', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const businessId = oid();
  const claim = await m.TrialClaim.create({
    phoneHash: `hash_mode_${Date.now()}`, status: 'reserved', userId: oid(), businessId, holderBusinessId: businessId,
    reservedAt: new Date(), reservedUntil: new Date(Date.now() + 86_400_000),
  } as any);
  const offer = { trialMonths: 3, trialEndsAt: new Date('2027-04-15T10:00:00Z'), razorpayPlanId: 'plan_live_1', amountPaise: 999_900, currency: 'INR', policyVersion: 1, decidedAt: new Date(), razorpayMode: 'live' };
  const attached = await m.claims.attachSubscriptionToClaim(m.TrialClaim, { claimId: claim._id, businessId, razorpaySubscriptionId: 'sub_trial_live', now: new Date(), offer });
  assert.equal(attached.offer.razorpayMode, 'live');
  assert.equal(attached.razorpaySubscriptionId, 'sub_trial_live');
});
