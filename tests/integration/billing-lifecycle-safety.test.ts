/**
 * Launch-critical trial / AutoPay lifecycle safety — pure rules plus the
 * claim store against an in-memory MongoDB (never MONGODB_URI):
 *  - a trial cancellation delivered BEFORE its authorization never starts a
 *    running trial (converges to the in-order result: used + cancelled);
 *  - a repeat failure event for an already-open failure changes nothing
 *    (no second Day 0, no repeated records), a NEW failure still opens one;
 *  - captured money that fails verification never grants access and is flagged;
 *  - a cancelled/expired trial checkout is never handed back to a second tab;
 *  - an unconfirmed trial charge is neither paid nor failed — flagged once.
 * Run: node --experimental-strip-types --test tests/integration/billing-lifecycle-safety.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import TrialClaim from '../../src/models/TrialClaim.ts';
import { decideBillingEvent, type ClaimFacts, type SubscriptionFacts, type WorkspaceFacts } from '../../src/lib/billing/subscriptionMachine.ts';
import { reserveTrialClaim, attachSubscriptionToClaim, trialPhoneHash } from '../../src/lib/billing/trialClaims.ts';
import { decideTrialCheckoutReuse } from '../../src/lib/billing/checkoutGuard.ts';
import { unconfirmedTrialNote, shouldFlagUnconfirmed } from '../../src/lib/billing/trialChargeVerification.ts';

const TRIAL_END = new Date('2027-04-15T10:00:00Z');
const AMOUNT = 999_900; // ₹9,999 yearly, in paise
const trialSub = (over: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({
  id: 'sub_trial', status: 'authenticated', planId: 'plan_yearly', startAt: Math.floor(TRIAL_END.getTime() / 1000),
  currentEnd: null, paidCount: 0, isTrial: true, ...over,
});
const claim = (over: Partial<ClaimFacts> = {}): ClaimFacts => ({
  status: 'reserved', businessId: 'w1', attachedSubscriptionId: 'sub_trial',
  offer: { razorpayPlanId: 'plan_yearly', amountPaise: AMOUNT, currency: 'INR', trialEndsAt: TRIAL_END }, subscriptionEndedAt: null, ...over,
});
const ws = (over: Partial<WorkspaceFacts> = {}): WorkspaceFacts => ({
  id: 'w1', subscriptionStatus: 'trialing', billingSubscriptionId: null, razorpaySubscriptionId: 'sub_trial',
  trialEndsAt: null, trialCancelledAt: null, billingLastEventAt: null, supersededSubscriptionIds: [], ...over,
});
const decide = (type: string, o: { sub?: SubscriptionFacts; workspace?: WorkspaceFacts; claim?: ClaimFacts | null; payment?: any; eventAt?: Date } = {}) =>
  decideBillingEvent({
    type, eventAt: o.eventAt ?? new Date('2027-01-15T10:00:00Z'), sub: o.sub ?? trialSub(), payment: o.payment ?? null,
    workspace: o.workspace ?? ws(), claim: o.claim === undefined ? claim() : o.claim, expectedPaidAmountPaise: null,
  });
const kinds = (d: { actions: Array<{ kind: string }> }) => d.actions.map((a) => a.kind);

// ── 1. out-of-order trial events ──────────────────────────────────────────

test('cancellation delivered before authorization: the end is recorded, then the late authorization starts NO running trial', () => {
  const cancelled = decide('subscription.cancelled', { sub: trialSub({ status: 'cancelled' }) });
  assert.deepEqual(kinds(cancelled), ['record_trial_subscription_ended', 'settle_claim']);

  const lateAuth = decide('subscription.authenticated', { claim: claim({ subscriptionEndedAt: new Date('2027-01-15T10:01:00Z') }) });
  assert.deepEqual(lateAuth.actions, [{ kind: 'consume_claim' }, { kind: 'start_trial', trialEndsAt: TRIAL_END, cancelled: true }], 'used and started already cancelled — never a running trial');
});

test('an in-order authorization starts a normal (not cancelled) trial', () => {
  const d = decide('subscription.authenticated');
  assert.deepEqual(d.actions, [{ kind: 'consume_claim' }, { kind: 'start_trial', trialEndsAt: TRIAL_END }]);
});

test('in-order and out-of-order deliveries converge (trial used, cancelled, access only to the trial end)', () => {
  // In order: authorization, then cancellation of the running trial.
  assert.deepEqual(kinds(decide('subscription.authenticated')), ['consume_claim', 'start_trial']);
  const running = ws({ subscriptionStatus: 'trial_active', billingSubscriptionId: 'sub_trial', trialEndsAt: TRIAL_END });
  assert.deepEqual(kinds(decide('subscription.cancelled', { sub: trialSub({ status: 'cancelled' }), workspace: running, claim: claim({ status: 'consumed' }) })), ['trial_cancelled']);
});

test('a late authorization after Razorpay confirmed the checkout was never authorized (claim released) is refused', () => {
  const d = decide('subscription.authenticated', { claim: claim({ status: 'released', subscriptionEndedAt: new Date() }) });
  assert.deepEqual(kinds(d), ['reject_trial']);
});

test('a duplicate authorization still does not restart a running trial', () => {
  const running = ws({ subscriptionStatus: 'trial_active', billingSubscriptionId: 'sub_trial', trialEndsAt: TRIAL_END });
  assert.deepEqual(kinds(decide('subscription.authenticated', { workspace: running, claim: claim({ status: 'consumed' }) })), ['consume_claim']);
});

// ── 2. repeated failures / self-heal re-reads ─────────────────────────────

test('a retry/re-read of an already-open failure changes nothing (no new Day 0); retries exhausted is noted', () => {
  const pastDue = ws({ subscriptionStatus: 'past_due', billingSubscriptionId: 'sub_paid', razorpaySubscriptionId: 'sub_paid' });
  const paid = trialSub({ id: 'sub_paid', isTrial: false, status: 'pending', paidCount: 3 });
  const pending = decide('subscription.pending', { sub: paid, workspace: pastDue, claim: null });
  assert.deepEqual(pending.actions, [{ kind: 'failure_continues', halted: false }]);
  const halted = decide('subscription.halted', { sub: { ...paid, status: 'halted' }, workspace: pastDue, claim: null });
  assert.deepEqual(halted.actions, [{ kind: 'failure_continues', halted: true }]);
});

test('a NEW failure on a paying or trial workspace still opens Day 0 (not suppressed)', () => {
  const active = ws({ subscriptionStatus: 'active', billingSubscriptionId: 'sub_paid', razorpaySubscriptionId: 'sub_paid' });
  const paid = trialSub({ id: 'sub_paid', isTrial: false, status: 'pending', paidCount: 3 });
  assert.deepEqual(kinds(decide('subscription.pending', { sub: paid, workspace: active, claim: null })), ['payment_failed']);
  const trial = ws({ subscriptionStatus: 'trial_active', billingSubscriptionId: 'sub_trial', trialEndsAt: TRIAL_END });
  assert.deepEqual(kinds(decide('subscription.pending', { sub: trialSub({ status: 'pending' }), workspace: trial, claim: claim({ status: 'consumed' }) })), ['payment_failed']);
});

test('an older failure delivered after a newer payment is still ignored', () => {
  const recovered = ws({ subscriptionStatus: 'active', billingSubscriptionId: 'sub_paid', razorpaySubscriptionId: 'sub_paid', billingLastEventAt: new Date('2027-02-01') });
  const old = decide('subscription.pending', { sub: trialSub({ id: 'sub_paid', isTrial: false, status: 'pending' }), workspace: recovered, claim: null, eventAt: new Date('2027-01-20') });
  assert.deepEqual(old.actions, []);
});

// ── 3. capture verification ───────────────────────────────────────────────

test('trial charge: only a captured ₹9,999 INR charge for the snapshot activates; captured mismatches are flagged, never activated', () => {
  const running = ws({ subscriptionStatus: 'trial_active', billingSubscriptionId: 'sub_trial', trialEndsAt: TRIAL_END });
  const charged = trialSub({ status: 'active', paidCount: 1 });
  const c = { claim: claim({ status: 'consumed' }), workspace: running, sub: charged };
  assert.deepEqual(kinds(decide('subscription.charged', { ...c, payment: { amount: AMOUNT, currency: 'INR', status: 'captured' } })), ['activate_paid']);
  for (const payment of [{ amount: 499_900, currency: 'INR', status: 'captured' }, { amount: AMOUNT, currency: 'USD', status: 'captured' }]) {
    const d = decide('subscription.charged', { ...c, payment });
    assert.deepEqual(kinds(d), ['flag_payment_review']);
    assert.match(d.note, /captured payment not accepted/);
  }
  for (const payment of [{ amount: AMOUNT, currency: 'INR', status: 'authorized' }, { amount: AMOUNT, currency: 'INR', status: 'failed' }, null]) {
    assert.deepEqual(kinds(decide('subscription.charged', { ...c, payment })), [], 'not captured → nothing');
  }
  // Mandate authorization alone is never payment.
  assert.deepEqual(kinds(decide('subscription.activated', { ...c, sub: trialSub({ status: 'active', paidCount: 0 }) })), []);
});

// ── 4. second-tab reuse of a trial checkout ───────────────────────────────

test('a trial checkout is handed back only while it can still be authorized', () => {
  assert.equal(decideTrialCheckoutReuse({ status: 'created', paidCount: 0 }), 'reuse');
  for (const status of ['cancelled', 'expired', 'completed']) assert.equal(decideTrialCheckoutReuse({ status, paidCount: 0 }), 'ended', status);
  for (const status of ['authenticated', 'active', 'pending', 'halted', 'paused']) assert.equal(decideTrialCheckoutReuse({ status, paidCount: 0 }), 'payment_in_progress', status);
  assert.equal(decideTrialCheckoutReuse({ status: 'created', paidCount: 1 }), 'payment_in_progress');
  assert.equal(decideTrialCheckoutReuse({ status: 'mystery', paidCount: 0 }), 'unknown');
});

// ── 5. unconfirmed trial charge ───────────────────────────────────────────

test('an unconfirmed trial charge is described as neither paid nor failed, and flagged once per open case', () => {
  const unreachable = unconfirmedTrialNote({ attempted: true, activated: false, reason: 'razorpay fetch failed' });
  assert.match(unreachable, /could not be checked/);
  assert.match(unreachable, /not treated as paid or failed/);
  assert.match(unconfirmedTrialNote({ attempted: true, activated: false, razorpayStatus: 'active' }), /reports "active"/);
  assert.equal(shouldFlagUnconfirmed(null), true);
  assert.equal(shouldFlagUnconfirmed({}), false, 'an open, unreviewed flag is not repeated');
  assert.equal(shouldFlagUnconfirmed({ reviewedAt: new Date() }), true, 'still unconfirmed after review → flagged again');
});

// ── claim store: the order-safety marker never leaks into a new reservation ─

let memoryServer: any = null;
let skipReason: string | null = null;
before(async () => {
  let uri = process.env.MONGODB_TEST_URI;
  if (!uri) {
    try {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create();
      uri = memoryServer.getUri();
    } catch (err: any) {
      skipReason = `no MONGODB_TEST_URI and mongodb-memory-server unavailable (${err?.message})`;
      return;
    }
  }
  await mongoose.connect(uri!, { dbName: `gm_lifecycle_${Date.now()}` });
  await TrialClaim.syncIndexes();
});
after(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

test('a released claim reserved again starts clean (no stale "subscription ended" marker)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const now = new Date('2027-01-15T10:00:00Z');
  const phoneHash = trialPhoneHash('+919800000001');
  const businessId = new mongoose.Types.ObjectId();
  const first = await reserveTrialClaim(TrialClaim, { phoneHash, userId: new mongoose.Types.ObjectId(), businessId, now });
  assert.equal(first.ok, true);
  await attachSubscriptionToClaim(TrialClaim, { claimId: (first as any).claim._id, businessId, razorpaySubscriptionId: 'sub_old', now });
  await TrialClaim.updateOne({ phoneHash }, { $set: { subscriptionEndedAt: now, status: 'released' }, $unset: { holderBusinessId: '' } });

  const again = await reserveTrialClaim(TrialClaim, { phoneHash, userId: new mongoose.Types.ObjectId(), businessId, now: new Date(now.getTime() + 60_000) });
  assert.equal(again.ok, true);
  const doc: any = await TrialClaim.findOne({ phoneHash }).lean();
  assert.equal(doc.status, 'reserved');
  assert.equal(doc.subscriptionEndedAt, undefined);
  assert.equal(doc.razorpaySubscriptionId, undefined);
});
