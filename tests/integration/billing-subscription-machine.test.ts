/**
 * Razorpay subscription lifecycle rules — pure state machine, fixed clock.
 * Run: node --experimental-strip-types --test tests/integration/billing-subscription-machine.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideBillingEvent,
  impliedEventFromState,
  subscriptionFactsFrom,
  type ClaimFacts,
  type SubscriptionFacts,
  type WorkspaceFacts,
} from '../../src/lib/billing/subscriptionMachine.ts';
import { isWorkspaceUnlocked } from '../../src/lib/workspaceAccess.ts';
import { TRIAL_CHARGE_PROCESSING_MS } from '../../src/lib/billing/billingPolicy.ts';

const T0 = new Date('2026-10-15T10:00:00.000Z');
const TRIAL_END = new Date('2027-01-15T10:00:00.000Z');
const PLAN = 'plan_yearly_9999';
const AMOUNT = 999_900;

const trialSub = (over: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({
  id: 'sub_trial',
  status: 'authenticated',
  planId: PLAN,
  startAt: Math.floor(TRIAL_END.getTime() / 1000),
  currentEnd: null,
  paidCount: 0,
  isTrial: true,
  ...over,
});
const paidSub = (over: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({
  id: 'sub_paid',
  status: 'active',
  planId: 'plan_monthly',
  startAt: null,
  currentEnd: Math.floor(new Date('2026-11-15T10:00:00Z').getTime() / 1000),
  paidCount: 1,
  isTrial: false,
  ...over,
});
const ws = (over: Partial<WorkspaceFacts> = {}): WorkspaceFacts => ({
  id: 'ws1',
  subscriptionStatus: 'trialing',
  billingSubscriptionId: null,
  razorpaySubscriptionId: 'sub_trial',
  trialEndsAt: null,
  trialCancelledAt: null,
  billingLastEventAt: null,
  ...over,
});
const claim = (over: Partial<ClaimFacts> = {}): ClaimFacts => ({
  status: 'reserved',
  businessId: 'ws1',
  attachedSubscriptionId: 'sub_trial',
  offer: { razorpayPlanId: PLAN, amountPaise: AMOUNT, currency: 'INR', trialEndsAt: TRIAL_END },
  ...over,
});
const trialWs = (over: Partial<WorkspaceFacts> = {}) =>
  ws({ subscriptionStatus: 'trial_active', billingSubscriptionId: 'sub_trial', trialEndsAt: TRIAL_END, billingLastEventAt: T0, ...over });
const captured = (amount = AMOUNT, currency = 'INR') => ({ amount, currency, status: 'captured' });

function decide(type: string, opts: Partial<Parameters<typeof decideBillingEvent>[0]> = {}) {
  return decideBillingEvent({
    type,
    eventAt: T0,
    sub: trialSub(),
    payment: null,
    workspace: ws(),
    claim: claim(),
    expectedPaidAmountPaise: null,
    ...opts,
  });
}
const kinds = (d: { actions: { kind: string }[] }) => d.actions.map((a) => a.kind);

// ── authorization ──
test('verified trial authorization by the claim owner starts the trial with the snapshot end date', () => {
  const d = decide('subscription.authenticated');
  assert.deepEqual(kinds(d), ['consume_claim', 'start_trial']);
  assert.equal((d.actions[1] as any).trialEndsAt.toISOString(), TRIAL_END.toISOString());
});

test('the offer switch is not an input: an authorized trial keeps its snapshot terms after OFF', () => {
  // decideBillingEvent never reads the global policy — only the claim snapshot.
  assert.deepEqual(kinds(decide('subscription.authenticated')), ['consume_claim', 'start_trial']);
});

test('a subscription that does not own the phone claim gets no trial (and is cancelled)', () => {
  assert.deepEqual(kinds(decide('subscription.authenticated', { claim: claim({ attachedSubscriptionId: 'sub_other' }) })), ['reject_trial']);
  assert.deepEqual(kinds(decide('subscription.authenticated', { claim: null })), ['reject_trial']);
  assert.deepEqual(kinds(decide('subscription.authenticated', { claim: claim({ status: 'released' }) })), ['reject_trial']);
});

test('a claim belonging to another workspace cannot start a trial here', () => {
  assert.deepEqual(kinds(decide('subscription.authenticated', { claim: claim({ businessId: 'ws_other' }) })), ['reject_trial']);
});

test('a subscription that differs from the checkout snapshot gets no trial', () => {
  assert.deepEqual(kinds(decide('subscription.authenticated', { sub: trialSub({ startAt: trialSub().startAt! + 86_400 }) })), ['reject_trial']);
  assert.deepEqual(kinds(decide('subscription.authenticated', { sub: trialSub({ planId: 'plan_cheaper' }) })), ['reject_trial']);
  assert.deepEqual(kinds(decide('subscription.authenticated', { claim: claim({ offer: null }) })), ['reject_trial']);
});

test('a checkout created while the offer was OFF never becomes a trial (no trial flag)', () => {
  const d = decide('subscription.authenticated', { sub: paidSub({ status: 'authenticated', paidCount: 0 }), claim: null });
  assert.deepEqual(kinds(d), []);
});

test('duplicate authorization does not restart the trial', () => {
  assert.deepEqual(kinds(decide('subscription.authenticated', { workspace: trialWs() })), ['consume_claim']);
});

test('an already-paid workspace never gets a trial', () => {
  assert.deepEqual(kinds(decide('subscription.authenticated', { workspace: ws({ subscriptionStatus: 'active' }) })), ['reject_trial']);
});

// ── the activated-means-paid bug ──
test('trial billing cycle starting (activated, paid_count 0) is NOT payment', () => {
  const d = decide('subscription.activated', { sub: trialSub({ status: 'active', paidCount: 0 }), workspace: trialWs() });
  assert.deepEqual(kinds(d), []);
  assert.match(d.note, /waiting for the charge/);
});

test('trial converts to paid only on a captured charge for the exact snapshot amount', () => {
  const sub = trialSub({ status: 'active', paidCount: 1, currentEnd: Math.floor(new Date('2028-01-15T10:00:00Z').getTime() / 1000) });
  const ok = decide('subscription.charged', { sub, workspace: trialWs(), payment: captured(), eventAt: new Date('2027-01-15T10:05:00Z') });
  assert.deepEqual(kinds(ok), ['activate_paid']);
  assert.equal((ok.actions[0] as any).periodEnd.toISOString(), '2028-01-15T10:00:00.000Z');

  // Captured but wrong amount/currency → no access; flagged (money was taken).
  for (const payment of [captured(AMOUNT - 100), captured(AMOUNT, 'USD')]) {
    const d = decide('subscription.charged', { sub, workspace: trialWs(), payment, eventAt: new Date('2027-01-15T10:05:00Z') });
    assert.deepEqual(kinds(d), ['flag_payment_review'], JSON.stringify(payment));
  }
  // Not captured → nothing at all.
  for (const payment of [{ amount: AMOUNT, currency: 'INR', status: 'failed' }, null]) {
    const d = decide('subscription.charged', { sub, workspace: trialWs(), payment, eventAt: new Date('2027-01-15T10:05:00Z') });
    assert.deepEqual(kinds(d), [], JSON.stringify(payment));
  }
  // No snapshot to check the amount against → no activation (flagged for review).
  assert.deepEqual(kinds(decide('subscription.charged', { sub, workspace: trialWs(), payment: captured(), claim: null, eventAt: new Date('2027-01-15T10:05:00Z') })), ['flag_payment_review']);
});

test('existing non-trial checkout behaviour is preserved', () => {
  const live = ws({ razorpaySubscriptionId: 'sub_paid' });
  assert.deepEqual(kinds(decide('subscription.activated', { sub: paidSub(), workspace: live, claim: null })), ['activate_paid']);
  assert.deepEqual(kinds(decide('subscription.charged', { sub: paidSub(), workspace: live, claim: null, payment: captured(199_900) })), ['activate_paid']);
  // Known plan price: a wrong amount is refused (no access) and flagged for review.
  assert.deepEqual(kinds(decide('subscription.charged', { sub: paidSub(), workspace: live, claim: null, payment: captured(100), expectedPaidAmountPaise: 199_900 })), ['flag_payment_review']);
});

// ── failures ──
test('a charge failing at trial end marks the workspace past due (Day 0)', () => {
  const d = decide('subscription.pending', { sub: trialSub({ status: 'pending' }), workspace: trialWs(), eventAt: new Date('2027-01-15T10:05:00Z') });
  assert.deepEqual(kinds(d), ['payment_failed']);
  assert.equal((d.actions[0] as any).halted, false);
  const h = decide('subscription.halted', { sub: trialSub({ status: 'halted' }), workspace: trialWs({ subscriptionStatus: 'past_due' }), eventAt: new Date('2027-01-20T10:00:00Z') });
  assert.equal((h.actions[0] as any).halted, true);
});

test('a declined checkout (payment.failed) never fails or locks anyone — CRM stage only', () => {
  for (const w of [ws(), trialWs(), ws({ subscriptionStatus: 'active' })]) {
    assert.deepEqual(kinds(decide('payment.failed', { workspace: w })), ['lead_payment_failed']);
  }
});

test('failure events for a never-paid workspace or another subscription are ignored', () => {
  assert.deepEqual(kinds(decide('subscription.pending', { sub: trialSub({ status: 'pending' }) })), []);
  assert.deepEqual(kinds(decide('subscription.pending', { sub: paidSub({ id: 'sub_old', status: 'pending' }), workspace: trialWs() })), []);
});

test('recovery: a successful charge after a failure restores access', () => {
  const d = decide('subscription.charged', {
    sub: trialSub({ status: 'active', paidCount: 1 }),
    workspace: trialWs({ subscriptionStatus: 'past_due', billingLastEventAt: new Date('2027-01-15T10:05:00Z') }),
    payment: captured(),
    eventAt: new Date('2027-01-16T08:00:00Z'),
  });
  assert.deepEqual(kinds(d), ['activate_paid']);
});

// ── out-of-order / duplicates ──
test('late, older events are ignored: an old failure cannot undo a newer payment', () => {
  const afterPayment = trialWs({ subscriptionStatus: 'active', billingLastEventAt: new Date('2027-01-16T08:00:00Z') });
  assert.deepEqual(kinds(decide('subscription.pending', { sub: trialSub({ status: 'pending' }), workspace: afterPayment, eventAt: new Date('2027-01-15T10:05:00Z') })), []);
});

test('an old charge replayed after a newer failure does not restore access', () => {
  const failed = trialWs({ subscriptionStatus: 'past_due', billingLastEventAt: new Date('2028-01-15T10:05:00Z') });
  const d = decide('subscription.charged', { sub: trialSub({ status: 'active', paidCount: 1 }), workspace: failed, payment: captured(), eventAt: new Date('2027-01-15T10:05:00Z') });
  assert.deepEqual(kinds(d), []);
});

test('the self-heal applies Razorpay current state (not subject to event ordering)', () => {
  const failed = trialWs({ subscriptionStatus: 'past_due', billingLastEventAt: new Date('2028-01-15T10:05:00Z') });
  const d = decideBillingEvent({
    type: 'subscription.charged', eventAt: new Date('2027-01-01T00:00:00Z'), sub: trialSub({ status: 'active', paidCount: 2 }),
    payment: captured(), workspace: failed, claim: claim({ status: 'consumed' }), expectedPaidAmountPaise: null, authoritative: true,
  });
  assert.deepEqual(kinds(d), ['activate_paid']);
});

// ── cancellation / expiry ──
test('cancelling during the trial keeps access to the trial end, no charge', () => {
  assert.deepEqual(kinds(decide('subscription.cancelled', { sub: trialSub({ status: 'cancelled' }), workspace: trialWs(), claim: claim({ status: 'consumed' }), eventAt: new Date('2026-11-01T00:00:00Z') })), ['trial_cancelled']);
});

test('an unauthorized trial checkout that expires or is cancelled settles its claim (Razorpay re-checked)', () => {
  // The end is remembered on the claim first (an authorization delivered late must not start a running trial).
  assert.deepEqual(kinds(decide('subscription.expired', { sub: trialSub({ status: 'expired' }) })), ['record_trial_subscription_ended', 'settle_claim']);
  assert.deepEqual(kinds(decide('subscription.cancelled', { sub: trialSub({ status: 'cancelled' }) })), ['record_trial_subscription_ended', 'settle_claim']);
});

test('an expired or cancelled unpaid checkout never cancels the workspace (no "subscription cancelled" email)', () => {
  assert.deepEqual(kinds(decide('subscription.expired', { sub: paidSub({ id: 'sub_trial', status: 'expired', paidCount: 0 }), claim: null })), []);
});

test('a stale cancellation for an old subscription cannot cancel the one that is paying', () => {
  const live = ws({ subscriptionStatus: 'active', billingSubscriptionId: 'sub_new', razorpaySubscriptionId: 'sub_new' });
  assert.deepEqual(kinds(decide('subscription.cancelled', { sub: paidSub({ id: 'sub_old', status: 'cancelled' }), workspace: live, claim: null })), []);
  assert.deepEqual(kinds(decide('subscription.cancelled', { sub: paidSub({ id: 'sub_new', status: 'cancelled' }), workspace: live, claim: null, eventAt: new Date('2027-01-01') })), ['cancel_paid']);
});

// ── self-heal mapping ──
test('Razorpay state → implied event for the self-heal', () => {
  assert.equal(impliedEventFromState(trialSub()), 'subscription.authenticated');
  assert.equal(impliedEventFromState(trialSub({ status: 'active', paidCount: 0 })), null);
  assert.equal(impliedEventFromState(trialSub({ status: 'active', paidCount: 1 })), 'subscription.charged');
  assert.equal(impliedEventFromState(trialSub({ status: 'pending' })), 'subscription.pending');
  assert.equal(impliedEventFromState(trialSub({ status: 'created' })), null);
  assert.equal(subscriptionFactsFrom({ id: 'sub_x', status: 'authenticated', notes: { trial: '1' }, start_at: 1, paid_count: 0 })!.isTrial, true);
  assert.equal(subscriptionFactsFrom({ id: 'sub_x', status: 'authenticated', notes: { trial: 'true' } })!.isTrial, false);
});

// ── access ──
const unlocked = (over: Record<string, unknown>, now: Date) =>
  isWorkspaceUnlocked({ subscriptionStatus: 'trial_active', trialEndsAt: TRIAL_END, businessCreatedAt: new Date('2026-10-01'), now, ...over });

test('trial access: open during the trial, while the first charge processes, then closed', () => {
  assert.equal(unlocked({}, T0), true);
  assert.equal(unlocked({}, new Date(TRIAL_END.getTime() + 60_000)), true);
  assert.equal(unlocked({}, new Date(TRIAL_END.getTime() + TRIAL_CHARGE_PROCESSING_MS + 1)), false);
});

test('a cancelled trial ends exactly at the original trial end', () => {
  assert.equal(unlocked({ trialCancelledAt: T0 }, new Date(TRIAL_END.getTime() - 1)), true);
  assert.equal(unlocked({ trialCancelledAt: T0 }, new Date(TRIAL_END.getTime() + 1)), false);
});

test('no end date, a confirmed failure, or a never-paid workspace means no access', () => {
  assert.equal(unlocked({ trialEndsAt: null }, T0), false);
  assert.equal(isWorkspaceUnlocked({ subscriptionStatus: 'past_due', businessCreatedAt: new Date('2026-10-01'), now: T0 }), false);
  assert.equal(isWorkspaceUnlocked({ subscriptionStatus: 'trialing', businessCreatedAt: new Date('2026-10-01'), now: T0 }), false);
  assert.equal(isWorkspaceUnlocked({ subscriptionStatus: 'active', businessCreatedAt: new Date('2026-10-01'), now: T0 }), true);
});

test('a failed or cancelled legacy workspace is not unlocked by the owner\'s stale user-level plan', () => {
  const legacy = new Date('2026-01-01T00:00:00Z'); // before per-workspace billing
  assert.equal(isWorkspaceUnlocked({ subscriptionStatus: 'past_due', userSubscriptionPlan: 'Pro', businessCreatedAt: legacy, now: T0 }), false);
  assert.equal(isWorkspaceUnlocked({ subscriptionStatus: 'canceled', userSubscriptionPlan: 'Pro', businessCreatedAt: legacy, now: T0 }), false);
  // Unchanged: a legacy paid workspace that never got a status still unlocks.
  assert.equal(isWorkspaceUnlocked({ subscriptionStatus: 'trialing', userSubscriptionPlan: 'Pro', businessCreatedAt: legacy, now: T0 }), true);
  assert.equal(isWorkspaceUnlocked({ subscriptionStatus: null, userSubscriptionPlan: 'Pro', businessCreatedAt: legacy, now: T0 }), true);
});
