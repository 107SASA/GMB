/**
 * Razorpay mode handling for the PAYING subscription: propagation on
 * activation, and cancellation / payment recovery under the other keys.
 * Real handlers (applyRazorpayEvent, POST /api/billing/cancel,
 * POST /api/billing/checkout) against an in-memory MongoDB; intercepted only:
 * lib/tenant, lib/auth (requireClient), next/headers and lib/billing/razorpay
 * (a fake client whose ids exist only in the mode they were created in).
 * Nothing is sent to Razorpay or any messaging provider.
 *
 * Run: npx tsx --test tests/workflow/billing-mode-cancel-recovery.test.ts
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|RESEND|SENDGRID|GROQ|OPENAI|INNGEST|DO_SPACES)_/.test(k)) delete process.env[k];

const rz = {
  mode: 'live' as 'test' | 'live',
  /** Configured keys for getRazorpayMode(); null = keys not configured. */
  configured: 'live' as 'test' | 'live' | null,
  calls: [] as string[],
  subs: new Map<string, { status: string; paid_count: number; mode: 'test' | 'live' }>(),
  seq: 0,
};
const notFound = () => Object.assign(new Error('BAD_REQUEST_ERROR'), { statusCode: 400, error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' } });
const find = (id: string) => {
  const s = rz.subs.get(id);
  if (!s || s.mode !== rz.mode) throw notFound();
  return s;
};
const fakeClient = {
  plans: { create: async (p: any) => { rz.calls.push(`plans.create:${p.item.amount}`); return { id: `plan_${rz.mode}_${++rz.seq}` }; } },
  subscriptions: {
    create: async (p: any) => {
      rz.calls.push(`subscriptions.create:${p.plan_id}`);
      const id = `sub_${rz.mode}_new${++rz.seq}`;
      rz.subs.set(id, { status: 'created', paid_count: 0, mode: rz.mode });
      return { id, status: 'created' };
    },
    fetch: async (id: string) => { rz.calls.push(`fetch:${id}`); const s = find(id); return { id, status: s.status, paid_count: s.paid_count }; },
    cancel: async (id: string, atCycleEnd?: boolean) => {
      rz.calls.push(`cancel:${id}`);
      const s = find(id);
      if (!atCycleEnd) s.status = 'cancelled';
      return { id, status: s.status };
    },
  },
};

let ctx = { userId: '', businessId: '' };
const fired = { tenant: 0, auth: 0, headers: 0, razorpay: 0 };
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/lib[\\/]tenant(\.ts)?$/.test(request)) {
    fired.tenant++;
    return { requireBusinessContext: async () => ({ ok: true, userId: ctx.userId, organizationId: 'org', businessId: ctx.businessId, business: {} }) };
  }
  if (/lib[\\/]auth(\.ts)?$/.test(request)) {
    fired.auth++;
    return { ...origLoad.call(this, request, ...rest), requireClient: async () => ({ ok: true, userId: ctx.userId, user: {} }) };
  }
  if (/^next[\\/]headers(\.js)?$/.test(request)) {
    fired.headers++;
    return {
      ...origLoad.call(this, request, ...rest),
      headers: async () => new Headers({ 'x-business-id': ctx.businessId }),
      cookies: async () => ({ get: () => undefined }),
    };
  }
  if (/(^\.|lib[\\/]billing)[\\/]razorpay(\.ts)?$/.test(request)) {
    fired.razorpay++;
    return { getRazorpay: () => fakeClient, getRazorpayKeyId: () => `rzp_${rz.mode}_FAKEKEYFORTESTS`, getRazorpayMode: () => (rz.configured === undefined ? rz.mode : rz.configured) };
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
  process.env.MONGODB_URI = memoryServer.getUri(`gm_mode_cancel_recovery_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    BillingPlan: (await import('../../src/models/BillingPlan')).default,
    BillingEvent: (await import('../../src/models/BillingEvent')).default,
    TrialClaim: (await import('../../src/models/TrialClaim')).default,
    events: await import('../../src/services/billing/billingEvents'),
    cancel: await import('../../src/app/api/billing/cancel/route'),
    checkout: await import('../../src/app/api/billing/checkout/route'),
  };
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
  rz.mode = 'live';
  rz.configured = 'live';
  rz.calls = [];
  if (!m.BillingPlan) return;
  await m.BillingPlan.deleteMany({});
  await m.BillingPlan.create({
    key: 'default', displayName: 'GrowwMatics AI', description: '', priceInr: 1999, features: [],
    durations: [
      { cycle: 'monthly', priceInr: 1999, enabled: true },
      { cycle: 'quarterly', priceInr: 5499, enabled: true },
      { cycle: 'halfyearly', priceInr: 10999, enabled: false },
      { cycle: 'yearly', priceInr: 9999, enabled: true },
    ],
  });
});

const oid = () => new m.mongoose.Types.ObjectId();
let seq = 0;
async function workspace(over: Record<string, unknown> = {}) {
  const userId = oid();
  const b = await m.Business.create({ name: `WS ${++seq}`, category: 'Bakery', address: 'Pune', userId, organizationId: oid(), ...over } as any);
  await m.User.create({ _id: userId, fullName: `Owner ${seq}`, email: `owner${seq}@example.invalid`, phone: `+9198766${String(seq).padStart(5, '0')}`, isPhoneVerified: true, role: 'CLIENT', businessIds: [b._id] } as any);
  ctx = { userId: String(userId), businessId: String(b._id) };
  return ctx;
}
const ws = async () => (await m.Business.findById(ctx.businessId).lean()) as any;
const providerCalls = () => rz.calls.filter((c) => !c.startsWith('plans.create'));
async function postCancel() {
  const res = await m.cancel.POST();
  return { status: res.status, json: await res.json() };
}
async function postCheckout(body: Record<string, unknown> = { cycle: 'monthly' }) {
  const res = await m.checkout.POST(new Request('http://localhost/api/billing/checkout', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}
const charged = (subId: string, businessId: string, userId: string, paid = 1) => ({
  type: 'subscription.charged', eventAt: new Date(), source: 'webhook' as const,
  subEntity: { id: subId, status: 'active', plan_id: 'plan_x', paid_count: paid, current_end: Math.floor(Date.now() / 1000) + 30 * 86400, notes: { businessId, userId, planType: 'Pro', trial: '0' } },
  paymentEntity: { id: `pay_${subId}_${paid}`, amount: 199_900, currency: 'INR', status: 'captured' },
});

test('interceptors are active', async (t) => {
  if (skipReason) return t.skip(skipReason);
  for (const [name, n] of Object.entries(fired)) assert.ok(n > 0, `${name} intercepted`);
});

// ── propagation ─────────────────────────────────────────────────────────────

test('propagation: a paid checkout whose link records its mode → the paying subscription gets that mode', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId, userId } = await workspace({ razorpaySubscriptionId: 'sub_live_A', razorpaySubscriptionEnv: { subscriptionId: 'sub_live_A', mode: 'live' } });
  await m.events.applyRazorpayEvent(charged('sub_live_A', businessId, userId));
  const w = await ws();
  assert.equal(w.subscriptionStatus, 'active');
  assert.equal(w.billingSubscriptionId, 'sub_live_A');
  assert.deepEqual(w.billingSubscriptionEnv, { subscriptionId: 'sub_live_A', mode: 'live' });

  // A later renewal while the link names a newer checkout: the recorded mode for sub_live_A stays (never dropped or guessed).
  await m.Business.updateOne({ _id: businessId }, { $set: { razorpaySubscriptionId: 'sub_newer', razorpaySubscriptionEnv: { subscriptionId: 'sub_newer', mode: 'test' } } });
  await m.events.applyRazorpayEvent(charged('sub_live_A', businessId, userId, 2));
  assert.deepEqual((await ws()).billingSubscriptionEnv, { subscriptionId: 'sub_live_A', mode: 'live' });
});

test('propagation: no mode when the link names another id or records nothing (never inferred)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a = await workspace({ razorpaySubscriptionId: 'sub_B', razorpaySubscriptionEnv: { subscriptionId: 'sub_B', mode: 'live' } });
  await m.events.applyRazorpayEvent(charged('sub_A', a.businessId, a.userId));
  let w = await ws();
  assert.equal(w.billingSubscriptionId, 'sub_A');
  assert.equal(w.billingSubscriptionEnv, undefined);

  const b = await workspace({ razorpaySubscriptionId: 'sub_legacy' });
  await m.events.applyRazorpayEvent(charged('sub_legacy', b.businessId, b.userId));
  w = await ws();
  assert.equal(w.billingSubscriptionId, 'sub_legacy');
  assert.equal(w.billingSubscriptionEnv, undefined);
});

test('propagation: a trial started from a checkout link with a recorded mode carries it', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const trialEnd = new Date('2027-04-15T10:00:00Z');
  const { businessId, userId } = await workspace({ razorpaySubscriptionId: 'sub_trial_live', razorpaySubscriptionEnv: { subscriptionId: 'sub_trial_live', mode: 'live' } });
  await m.TrialClaim.create({
    phoneHash: `hash_mode_${Date.now()}`, status: 'reserved', userId, businessId, holderBusinessId: businessId, razorpaySubscriptionId: 'sub_trial_live',
    reservedAt: new Date(), reservedUntil: new Date(Date.now() + 86_400_000),
    offer: { trialMonths: 3, trialEndsAt: trialEnd, razorpayPlanId: 'plan_live_y', amountPaise: 999_900, currency: 'INR', policyVersion: 1, decidedAt: new Date(), razorpayMode: 'live' },
  } as any);
  await m.events.applyRazorpayEvent({
    type: 'subscription.authenticated', eventAt: new Date(), source: 'webhook',
    subEntity: { id: 'sub_trial_live', status: 'authenticated', plan_id: 'plan_live_y', paid_count: 0, start_at: Math.floor(trialEnd.getTime() / 1000), notes: { businessId, userId, planType: 'Pro', trial: '1' } },
    paymentEntity: null,
  });
  const w = await ws();
  assert.equal(w.subscriptionStatus, 'trial_active');
  assert.deepEqual(w.billingSubscriptionEnv, { subscriptionId: 'sub_trial_live', mode: 'live' });
});

// ── cancellation ────────────────────────────────────────────────────────────

test('cancel: a TEST-mode paying subscription under LIVE keys → clear support response, nothing called or changed', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await workspace({ subscriptionStatus: 'active', billingSubscriptionId: 'sub_test_pay', billingSubscriptionEnv: { subscriptionId: 'sub_test_pay', mode: 'test' }, razorpaySubscriptionId: 'sub_test_pay' });
  const r = await postCancel();
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'SUBSCRIPTION_NEEDS_SUPPORT');
  assert.match(r.json.error, /test mode/);
  assert.deepEqual(providerCalls(), []);
  assert.equal((await ws()).subscriptionCancelAtPeriodEnd, false);
});

test('cancel: a TEST-mode trial under LIVE keys → support response; the trial is not marked cancelled', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await workspace({ subscriptionStatus: 'trial_active', trialEndsAt: new Date('2027-04-15'), billingSubscriptionId: 'sub_test_trial', billingSubscriptionEnv: { subscriptionId: 'sub_test_trial', mode: 'test' }, razorpaySubscriptionId: 'sub_test_trial' });
  const r = await postCancel();
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'SUBSCRIPTION_NEEDS_SUPPORT');
  assert.deepEqual(providerCalls(), []);
  assert.equal((await ws()).trialCancelledAt, undefined);
});

test('cancel: legacy paid workspace whose checkout link records TEST → support response', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await workspace({ subscriptionStatus: 'active', razorpaySubscriptionId: 'sub_test_legacy', razorpaySubscriptionEnv: { subscriptionId: 'sub_test_legacy', mode: 'test' } });
  const r = await postCancel();
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'SUBSCRIPTION_NEEDS_SUPPORT');
  assert.deepEqual(providerCalls(), []);
});

test('cancel: UNKNOWN mode that live keys cannot find → fail-closed 502, no raw provider error, nothing changed', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await workspace({ subscriptionStatus: 'active', billingSubscriptionId: 'sub_unknown', razorpaySubscriptionId: 'sub_unknown' });
  const r = await postCancel();
  assert.equal(r.status, 502);
  assert.equal(r.json.code, 'PROVIDER_UNAVAILABLE');
  assert.doesNotMatch(r.json.error, /does not exist/i);
  assert.deepEqual(providerCalls(), ['cancel:sub_unknown'], 'still attempted (mode unknown), never classified as test');
  assert.equal((await ws()).subscriptionCancelAtPeriodEnd, false);
});

test('cancel: a LIVE subscription under LIVE keys still cancels at period end (unchanged)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  rz.subs.set('sub_live_pay', { status: 'active', paid_count: 1, mode: 'live' });
  await workspace({ subscriptionStatus: 'active', billingSubscriptionId: 'sub_live_pay', billingSubscriptionEnv: { subscriptionId: 'sub_live_pay', mode: 'live' }, razorpaySubscriptionId: 'sub_live_pay' });
  const r = await postCancel();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(providerCalls(), ['cancel:sub_live_pay']);
  assert.equal((await ws()).subscriptionCancelAtPeriodEnd, true);
});

// ── payment recovery ────────────────────────────────────────────────────────

const pastDue = (over: Record<string, unknown> = {}) =>
  workspace({ subscriptionStatus: 'past_due', paymentFailureKind: 'renewal', paymentFailedAt: new Date(), ...over });

test('recovery: a TEST-mode original under LIVE keys → support response; not looked up, cancelled, superseded or replaced; flagged', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await pastDue({ billingSubscriptionId: 'sub_test_orig', billingSubscriptionEnv: { subscriptionId: 'sub_test_orig', mode: 'test' }, razorpaySubscriptionId: 'sub_test_orig' });
  const r = await postCheckout();
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'SUBSCRIPTION_NEEDS_SUPPORT');
  assert.deepEqual(providerCalls(), []);
  const w = await ws();
  assert.equal(w.supersededSubscriptionIds, undefined);
  assert.equal(w.recoveryCheckout?.subscriptionId, undefined);
  assert.equal(w.razorpaySubscriptionId, 'sub_test_orig');
  const ev: any = await m.BillingEvent.findOne({ businessId: ctx.businessId, eventType: 'recovery.support_required' }).lean();
  assert.equal(ev?.needsReview, true);
});

test('recovery: UNKNOWN-mode original that cannot be looked up → fail-closed 503, nothing created', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await pastDue({ billingSubscriptionId: 'sub_unknown_orig', razorpaySubscriptionId: 'sub_unknown_orig' });
  const r = await postCheckout();
  assert.equal(r.status, 503);
  assert.equal(r.json.code, 'RECOVERY_UNAVAILABLE');
  assert.deepEqual(providerCalls(), ['fetch:sub_unknown_orig']);
});

test('recovery: an open LIVE recovery checkout is reused (no new subscription, nothing cancelled)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  rz.subs.set('sub_live_rec', { status: 'created', paid_count: 0, mode: 'live' });
  await pastDue({
    billingSubscriptionId: 'sub_live_orig', razorpaySubscriptionId: 'sub_live_rec', supersededSubscriptionIds: ['sub_live_orig'],
    recoveryCheckout: { subscriptionId: 'sub_live_rec', replacesSubscriptionId: 'sub_live_orig', cycle: 'monthly', createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000), mode: 'live' },
  });
  const r = await postCheckout();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.recovery, true);
  assert.equal(r.json.checkout.subscriptionId, 'sub_live_rec');
  assert.deepEqual(providerCalls(), ['fetch:sub_live_rec']);
});

test('recovery: an open recovery checkout recorded in TEST mode under LIVE keys → support response, not looked up or replaced', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await pastDue({
    billingSubscriptionId: 'sub_test_orig2', razorpaySubscriptionId: 'sub_test_rec', supersededSubscriptionIds: ['sub_test_orig2'],
    recoveryCheckout: { subscriptionId: 'sub_test_rec', replacesSubscriptionId: 'sub_test_orig2', cycle: 'monthly', createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000), mode: 'test' },
  });
  const r = await postCheckout();
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'SUBSCRIPTION_NEEDS_SUPPORT');
  assert.deepEqual(providerCalls(), []);
  assert.equal((await ws()).recoveryCheckout.subscriptionId, 'sub_test_rec', 'left as it was');
});

test('recovery: an open recovery checkout with UNKNOWN mode that cannot be looked up → fail-closed 503', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await pastDue({
    billingSubscriptionId: 'sub_o3', razorpaySubscriptionId: 'sub_r3', supersededSubscriptionIds: ['sub_o3'],
    recoveryCheckout: { subscriptionId: 'sub_r3', replacesSubscriptionId: 'sub_o3', cycle: 'monthly', createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) },
  });
  const r = await postCheckout();
  assert.equal(r.status, 503);
  assert.equal(r.json.code, 'RECOVERY_UNAVAILABLE');
  assert.deepEqual(providerCalls(), ['fetch:sub_r3']);
});

test('recovery: a new replacement under LIVE keys records live mode on the recovery checkout and the link', async (t) => {
  if (skipReason) return t.skip(skipReason);
  rz.subs.set('sub_live_ended', { status: 'cancelled', paid_count: 3, mode: 'live' });
  await pastDue({ billingSubscriptionId: 'sub_live_ended', billingSubscriptionEnv: { subscriptionId: 'sub_live_ended', mode: 'live' }, razorpaySubscriptionId: 'sub_live_ended' });
  const r = await postCheckout();
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const newId = r.json.checkout.subscriptionId;
  const w = await ws();
  assert.equal(w.recoveryCheckout.subscriptionId, newId);
  assert.equal(w.recoveryCheckout.mode, 'live');
  assert.deepEqual(w.razorpaySubscriptionEnv, { subscriptionId: newId, mode: 'live' });
});

// ── webhook mode guard ──────────────────────────────────────────────────────

const later = (days: number) => Math.floor(Date.now() / 1000) + days * 86400;
const chargedEvt = (subId: string, businessId: string, userId: string, opts: { paid?: number; currentEnd?: number; source?: 'webhook' | 'reconcile' } = {}) => ({
  type: 'subscription.charged', eventAt: new Date(), source: opts.source ?? ('webhook' as const), razorpayEventId: `evt_${subId}_${opts.paid ?? 1}_${Date.now()}`,
  subEntity: { id: subId, status: 'active', plan_id: 'plan_x', paid_count: opts.paid ?? 1, current_end: opts.currentEnd ?? later(30), notes: { businessId, userId, planType: 'Pro', trial: '0' } },
  paymentEntity: { id: `pay_${subId}_${opts.paid ?? 1}`, amount: 199_900, currency: 'INR', status: 'captured' },
});
const reviewEvents = (subId: string) => m.BillingEvent.find({ razorpaySubscriptionId: subId, needsReview: true }).lean();

test('webhook guard: MATCHING recorded mode (live under live) is applied normally, no review', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId, userId } = await workspace({ razorpaySubscriptionId: 'sub_live_ok', razorpaySubscriptionEnv: { subscriptionId: 'sub_live_ok', mode: 'live' } });
  const r = await m.events.applyRazorpayEvent(chargedEvt('sub_live_ok', businessId, userId));
  assert.deepEqual(r.decision.actions.map((a: any) => a.kind), ['activate_paid']);
  assert.equal((await ws()).subscriptionStatus, 'active');
  assert.equal((await reviewEvents('sub_live_ok')).length, 0);
});

test('webhook guard: CONFLICTING (test-mode paying subscription under live) renewal does NOT extend access', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const paidUntil = new Date('2026-11-10T00:00:00Z');
  const { businessId, userId } = await workspace({
    subscriptionStatus: 'active', subscriptionCurrentPeriodEnd: paidUntil,
    billingSubscriptionId: 'sub_test_paid', billingSubscriptionEnv: { subscriptionId: 'sub_test_paid', mode: 'test' }, razorpaySubscriptionId: 'sub_test_paid',
  });
  const r = await m.events.applyRazorpayEvent(chargedEvt('sub_test_paid', businessId, userId, { paid: 2, currentEnd: later(400) }));
  assert.deepEqual(r.decision.actions, []);
  assert.equal(new Date((await ws()).subscriptionCurrentPeriodEnd).toISOString(), paidUntil.toISOString(), 'paid-until not extended');
  const rev: any[] = await reviewEvents('sub_test_paid');
  assert.equal(rev.length, 1);
  assert.match(rev[0].note, /created in test mode but live keys/);
});

test('webhook guard: CONFLICTING first charge does NOT activate; an other-mode cancellation does NOT cancel', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a = await workspace({ razorpaySubscriptionId: 'sub_test_new', razorpaySubscriptionEnv: { subscriptionId: 'sub_test_new', mode: 'test' } });
  await m.events.applyRazorpayEvent(chargedEvt('sub_test_new', a.businessId, a.userId));
  let w = await ws();
  assert.notEqual(w.subscriptionStatus, 'active');
  assert.equal(w.billingSubscriptionId, undefined);

  // A live-recorded paying subscription is not cancelled by an event while TEST keys are configured.
  rz.configured = 'test';
  const p = await workspace({ subscriptionStatus: 'active', billingSubscriptionId: 'sub_live_pay2', billingSubscriptionEnv: { subscriptionId: 'sub_live_pay2', mode: 'live' }, razorpaySubscriptionId: 'sub_live_pay2' });
  await m.events.applyRazorpayEvent({
    type: 'subscription.cancelled', eventAt: new Date(), source: 'webhook',
    subEntity: { id: 'sub_live_pay2', status: 'cancelled', plan_id: 'plan_x', paid_count: 3, notes: { businessId: p.businessId, userId: p.userId, planType: 'Pro', trial: '0' } },
    paymentEntity: null,
  });
  w = await ws();
  assert.equal(w.subscriptionStatus, 'active', 'not cancelled by an event from the other mode');
});

test('webhook guard: CONFLICTING trial authorization (test offer under live) does not start a trial or touch the claim', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const trialEnd = new Date('2027-04-15T10:00:00Z');
  const { businessId, userId } = await workspace({ razorpaySubscriptionId: 'sub_test_trial2' });
  await m.TrialClaim.create({
    phoneHash: `hash_guard_${Date.now()}`, status: 'reserved', userId, businessId, holderBusinessId: businessId, razorpaySubscriptionId: 'sub_test_trial2',
    reservedAt: new Date(), reservedUntil: new Date(Date.now() + 86_400_000),
    offer: { trialMonths: 3, trialEndsAt: trialEnd, razorpayPlanId: 'plan_test_y', amountPaise: 999_900, currency: 'INR', policyVersion: 1, decidedAt: new Date(), razorpayMode: 'test' },
  } as any);
  await m.events.applyRazorpayEvent({
    type: 'subscription.authenticated', eventAt: new Date(), source: 'webhook',
    subEntity: { id: 'sub_test_trial2', status: 'authenticated', plan_id: 'plan_test_y', paid_count: 0, start_at: Math.floor(trialEnd.getTime() / 1000), notes: { businessId, userId, planType: 'Pro', trial: '1' } },
    paymentEntity: null,
  });
  assert.notEqual((await ws()).subscriptionStatus, 'trial_active');
  assert.equal(((await m.TrialClaim.findOne({ razorpaySubscriptionId: 'sub_test_trial2' }).lean()) as any).status, 'reserved');
  assert.equal((await reviewEvents('sub_test_trial2')).length, 1);
});

test('webhook guard: UNKNOWN (records disagree) applies nothing and is flagged', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const paidUntil = new Date('2027-01-01T00:00:00Z');
  const { businessId, userId } = await workspace({
    subscriptionStatus: 'active', subscriptionCurrentPeriodEnd: paidUntil,
    billingSubscriptionId: 'sub_mixed', billingSubscriptionEnv: { subscriptionId: 'sub_mixed', mode: 'test' },
    razorpaySubscriptionId: 'sub_mixed', razorpaySubscriptionEnv: { subscriptionId: 'sub_mixed', mode: 'live' },
  });
  const r = await m.events.applyRazorpayEvent(chargedEvt('sub_mixed', businessId, userId, { paid: 2, currentEnd: later(400) }));
  assert.deepEqual(r.decision.actions, []);
  assert.equal(new Date((await ws()).subscriptionCurrentPeriodEnd).toISOString(), paidUntil.toISOString());
  const rev: any[] = await reviewEvents('sub_mixed');
  assert.match(rev[0].note, /records disagree/);
});

test('webhook guard: MISSING record (legacy) under live is applied as before (never guessed) but flagged for review', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId, userId } = await workspace({ subscriptionStatus: 'active', razorpaySubscriptionId: 'sub_legacy_paid', subscriptionCurrentPeriodEnd: new Date('2026-11-10T00:00:00Z') });
  const r = await m.events.applyRazorpayEvent(chargedEvt('sub_legacy_paid', businessId, userId, { paid: 2 }));
  assert.deepEqual(r.decision.actions.map((a: any) => a.kind), ['activate_paid'], 'unchanged behaviour');
  const rev: any[] = await reviewEvents('sub_legacy_paid');
  assert.equal(rev.length, 1);
  assert.match(rev[0].note, /not recorded/);
});

test('webhook guard: keys not configured (no current mode) keeps unchanged behaviour', async (t) => {
  if (skipReason) return t.skip(skipReason);
  rz.configured = null;
  const { businessId, userId } = await workspace({ razorpaySubscriptionId: 'sub_nokeys', razorpaySubscriptionEnv: { subscriptionId: 'sub_nokeys', mode: 'test' } });
  const r = await m.events.applyRazorpayEvent(chargedEvt('sub_nokeys', businessId, userId));
  assert.deepEqual(r.decision.actions.map((a: any) => a.kind), ['activate_paid']);
  assert.equal((await reviewEvents('sub_nokeys')).length, 0);
});

test('webhook guard: the self-heal (reconcile) source follows the same rule', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId, userId } = await workspace({ razorpaySubscriptionId: 'sub_test_rec2', razorpaySubscriptionEnv: { subscriptionId: 'sub_test_rec2', mode: 'test' } });
  const r = await m.events.applyRazorpayEvent(chargedEvt('sub_test_rec2', businessId, userId, { source: 'reconcile' }));
  assert.deepEqual(r.decision.actions, []);
  assert.notEqual((await ws()).subscriptionStatus, 'active');
});

test('webhook guard: no subscription in the payload is ignored as before (nothing guessed)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await workspace();
  const r = await m.events.applyRazorpayEvent({ type: 'subscription.charged', eventAt: new Date(), source: 'webhook', subEntity: null, paymentEntity: null });
  assert.deepEqual(r.decision.actions, []);
  assert.match(r.decision.note, /no subscription/);
});
