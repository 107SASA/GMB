/**
 * One free trial per verified phone — the pure rules (no DB, no Razorpay).
 * Run: node --experimental-strip-types --test tests/integration/billing-trial-eligibility.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trialPhoneKey } from '../../src/lib/phone.ts';
import {
  trialPhoneHash,
  trialEligibility,
  workspaceHasBillingHistory,
  phoneHasPaidHistory,
  settleAction,
} from '../../src/lib/billing/trialClaims.ts';

const NOW = new Date('2026-10-15T10:00:00.000Z');
const HOUR = 3_600_000;
const noPaid = { userPlans: ['Free'], subscriptions: [], workspaces: [] };

test('Indian formats of one mobile number share one trial key', () => {
  const key = '+919876543210';
  for (const raw of ['+91 98765 43210', '919876543210', '09876543210', '9876543210', '0091-98765-43210']) {
    assert.equal(trialPhoneKey(raw), key, raw);
  }
  assert.equal(trialPhoneHash(trialPhoneKey('9876543210')!), trialPhoneHash(trialPhoneKey('+91 98765 43210')!));
});

test('invalid or ambiguous numbers get no key (no trial), never a guess', () => {
  for (const raw of ['', '12345', '+91 12345 67890', '+9109876543210', 'abc', '4155550100', '98765432101']) {
    assert.equal(trialPhoneKey(raw), null, raw);
  }
});

test('international numbers are never merged with an Indian number sharing the last 10 digits', () => {
  const us = trialPhoneKey('+1 987 654 3210');
  const uk = trialPhoneKey('+44 9876543210');
  assert.equal(us, '+19876543210');
  assert.notEqual(us, trialPhoneKey('9876543210'));
  assert.notEqual(uk, trialPhoneKey('9876543210'));
  assert.notEqual(trialPhoneHash(us!), trialPhoneHash(trialPhoneKey('9876543210')!));
});

test('a verified, valid phone with no history is eligible', () => {
  assert.deepEqual(
    trialEligibility({ phoneKey: '+919876543210', phoneVerified: true, workspace: { subscriptionStatus: 'trialing' }, phonePaid: noPaid }),
    { eligible: true }
  );
});

test('an unverified or invalid phone is never eligible', () => {
  assert.deepEqual(
    trialEligibility({ phoneKey: '+919876543210', phoneVerified: false, workspace: null, phonePaid: noPaid }),
    { eligible: false, reason: 'phone_unverified' }
  );
  assert.deepEqual(
    trialEligibility({ phoneKey: null, phoneVerified: true, workspace: null, phonePaid: noPaid }),
    { eligible: false, reason: 'phone_invalid' }
  );
});

test('a workspace that was ever paid for or trialled cannot get a trial (any team member)', () => {
  for (const ws of [
    { subscriptionStatus: 'active' },
    { subscriptionStatus: 'canceled', subscriptionCurrentPeriodEnd: new Date('2026-01-01') },
    { subscriptionStatus: 'past_due', subscriptionCurrentPeriodEnd: new Date('2026-09-01') },
    { subscriptionStatus: 'trialing', trialStartedAt: new Date('2026-08-01') },
  ]) {
    assert.equal(workspaceHasBillingHistory(ws), true, JSON.stringify(ws));
    assert.deepEqual(
      trialEligibility({ phoneKey: '+919876543210', phoneVerified: true, workspace: ws, phonePaid: noPaid }),
      { eligible: false, reason: 'workspace_history' }
    );
  }
});

test('a declined or expired checkout is not paid history (no paid-through date)', () => {
  assert.equal(workspaceHasBillingHistory({ subscriptionStatus: 'past_due' }), false);
  assert.equal(workspaceHasBillingHistory({ subscriptionStatus: 'canceled' }), false);
  assert.equal(workspaceHasBillingHistory({ subscriptionStatus: 'trialing' }), false);
});

test('existing paying customers (any account on the phone) are not eligible', () => {
  assert.equal(phoneHasPaidHistory({ userPlans: ['Free', 'Pro'], subscriptions: [], workspaces: [] }), true);
  assert.equal(phoneHasPaidHistory({ userPlans: ['Free'], subscriptions: [{ planType: 'Free', currentPeriodEnd: new Date('2025-12-01') }], workspaces: [] }), true);
  assert.equal(phoneHasPaidHistory({ userPlans: ['Free'], subscriptions: [], workspaces: [{ subscriptionStatus: 'active' }] }), true);
  assert.deepEqual(
    trialEligibility({
      phoneKey: '+919876543210',
      phoneVerified: true,
      workspace: { subscriptionStatus: 'trialing' },
      phonePaid: { userPlans: ['Free'], subscriptions: [{ planType: 'Pro' }], workspaces: [] },
    }),
    { eligible: false, reason: 'paid_history' }
  );
});

// ── settling an expired reservation ──
const reserved = (over: Record<string, unknown> = {}) => ({
  status: 'reserved',
  reservedUntil: new Date(NOW.getTime() - HOUR),
  razorpaySubscriptionId: 'sub_1',
  ...over,
});

test('only a reserved claim is ever settled', () => {
  assert.equal(settleAction({ status: 'consumed', razorpaySubscriptionId: 'sub_1' }, { status: 'expired' }, NOW), 'keep');
  assert.equal(settleAction({ status: 'released' }, null, NOW), 'keep');
});

test('a reservation with no subscription attached is released only after its window', () => {
  assert.equal(settleAction(reserved({ razorpaySubscriptionId: undefined }), null, NOW), 'release');
  assert.equal(
    settleAction(reserved({ razorpaySubscriptionId: undefined, reservedUntil: new Date(NOW.getTime() + HOUR) }), null, NOW),
    'not_expired'
  );
});

test('an authorized checkout (late webhook) consumes the trial instead of releasing it', () => {
  for (const status of ['authenticated', 'active', 'pending', 'halted', 'completed']) {
    assert.equal(settleAction(reserved(), { status }, NOW), 'consume', status);
  }
});

test('release only when Razorpay confirms the checkout can no longer be authorized', () => {
  assert.equal(settleAction(reserved(), { status: 'expired' }, NOW), 'release');
  assert.equal(settleAction(reserved(), { status: 'cancelled' }, NOW), 'release');
  assert.equal(settleAction(reserved(), { status: 'created' }, NOW), 'cancel_then_recheck');
  assert.equal(
    settleAction(reserved({ reservedUntil: new Date(NOW.getTime() + HOUR) }), { status: 'created' }, NOW),
    'not_expired'
  );
});

test('doubt never releases: Razorpay unreachable, unknown status, or cancelled-after-possible-auth', () => {
  assert.equal(settleAction(reserved(), 'unavailable', NOW), 'keep');
  assert.equal(settleAction(reserved(), { status: 'something_new' }, NOW), 'keep');
  assert.equal(settleAction(reserved(), { status: 'cancelled', hasPaymentMethod: true }, NOW), 'needs_review');
  assert.equal(settleAction(reserved(), { status: 'cancelled', paidCount: 1 }, NOW), 'needs_review');
  assert.equal(settleAction(reserved(), { status: 'cancelled', hasCustomer: true }, NOW), 'needs_review');
});
