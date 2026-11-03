/**
 * Free-trial offer switch + checkout decision — pure, fixed clock.
 * Run: node --experimental-strip-types --test tests/integration/billing-trial-policy.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTrialPolicy,
  validateTrialPolicyUpdate,
  decideCheckoutTrial,
  offerAppliesToCycle,
  addMonthsUtc,
  effectiveTrialPrice,
  validateCustomTrialPriceUpdate,
  DEFAULT_CUSTOM_TRIAL_PRICE_INR,
} from '../../src/lib/billing/billingPolicy.ts';
import { chooseRecoveryPlan } from '../../src/lib/billing/paymentRecovery.ts';
import Subscription from '../../src/models/Subscription.ts';
import BillingPolicy from '../../src/models/BillingPolicy.ts';

const NOW = new Date('2026-10-15T10:00:00.000Z');
const ON = parseTrialPolicy({ trial: { offerEnabled: true, trialMonths: 3, eligibleCycle: 'yearly' }, version: 4 });
const OFF = parseTrialPolicy({ trial: { offerEnabled: false, trialMonths: 3, eligibleCycle: 'yearly' }, version: 5 });

test('the offer is OFF by default (no document, fresh document)', () => {
  assert.equal(parseTrialPolicy(null).offerEnabled, false);
  assert.equal(parseTrialPolicy(undefined).offerEnabled, false);
  const fresh = new BillingPolicy({}).toObject();
  assert.equal(fresh.trial.offerEnabled, false);
  assert.equal(parseTrialPolicy(fresh).offerEnabled, false);
});

test('missing or invalid configuration never grants a trial', () => {
  for (const doc of [
    {},
    { trial: null },
    { trial: { offerEnabled: 'true', trialMonths: 3 } },
    { trial: { offerEnabled: 1, trialMonths: 3 } },
    { trial: { offerEnabled: true } },
    { trial: { offerEnabled: true, trialMonths: 0 } },
    { trial: { offerEnabled: true, trialMonths: 13 } },
    { trial: { offerEnabled: true, trialMonths: 2.5 } },
    { trial: { offerEnabled: true, trialMonths: '3' } },
    { trial: { offerEnabled: true, trialMonths: 3, eligibleCycle: 'monthly' } },
    'garbage',
  ]) {
    const policy = parseTrialPolicy(doc);
    assert.equal(policy.offerEnabled, false, JSON.stringify(doc));
    assert.deepEqual(decideCheckoutTrial({ policy, cycle: 'yearly', eligible: true, now: NOW }), { trial: false, reason: 'offer_off' });
  }
});

test('offer ON: an eligible yearly checkout gets the configured trial', () => {
  const d = decideCheckoutTrial({ policy: ON, cycle: 'yearly', eligible: true, now: NOW });
  assert.equal(d.trial, true);
  assert.equal((d as any).trialMonths, 3);
  assert.equal((d as any).trialEndsAt.toISOString(), '2027-01-15T10:00:00.000Z');
});

test('offer OFF: a new customer gets no promotional trial', () => {
  assert.deepEqual(decideCheckoutTrial({ policy: OFF, cycle: 'yearly', eligible: true, now: NOW }), { trial: false, reason: 'offer_off' });
});

test('only the yearly plan gets the trial — monthly stays a normal paid plan', () => {
  assert.equal(offerAppliesToCycle(ON, 'monthly'), false);
  assert.deepEqual(decideCheckoutTrial({ policy: ON, cycle: 'monthly', eligible: true, now: NOW }), { trial: false, reason: 'cycle_not_eligible' });
  assert.equal(offerAppliesToCycle(ON, 'yearly'), true);
});

test('an ineligible customer (second workspace, used phone, paid customer) gets the normal paid checkout', () => {
  assert.deepEqual(decideCheckoutTrial({ policy: ON, cycle: 'yearly', eligible: false, now: NOW }), { trial: false, reason: 'not_eligible' });
});

test('client-side attempts to force a trial while OFF are ignored (the decision has no client input)', () => {
  const forged = { policy: OFF, cycle: 'yearly', eligible: true, now: NOW, trial: true, trialMonths: 12, startAt: 1 } as any;
  assert.deepEqual(decideCheckoutTrial(forged), { trial: false, reason: 'offer_off' });
});

test('trial end uses calendar months in UTC, clamped to month end', () => {
  assert.equal(addMonthsUtc(new Date('2026-10-31T05:00:00Z'), 3).toISOString(), '2027-01-31T05:00:00.000Z');
  assert.equal(addMonthsUtc(new Date('2026-11-30T05:00:00Z'), 3).toISOString(), '2027-02-28T05:00:00.000Z');
  assert.equal(addMonthsUtc(new Date('2027-11-30T05:00:00Z'), 3).toISOString(), '2028-02-29T05:00:00.000Z');
  assert.equal(addMonthsUtc(new Date('2026-12-15T18:30:00Z'), 3).toISOString(), '2027-03-15T18:30:00.000Z');
});

test('admin updates are validated: boolean switch, whole months 1–12', () => {
  assert.deepEqual(validateTrialPolicyUpdate({ offerEnabled: true, trialMonths: 3 }), { ok: true, value: { offerEnabled: true, trialMonths: 3 } });
  for (const bad of [null, {}, { offerEnabled: 'yes', trialMonths: 3 }, { offerEnabled: true, trialMonths: 0 }, { offerEnabled: true, trialMonths: 24 }, { offerEnabled: false, trialMonths: 1.5 }]) {
    assert.equal(validateTrialPolicyUpdate(bad).ok, false, JSON.stringify(bad));
  }
});

test('a new Subscription record is FREE — the legacy 14-day "Trialing" default is gone', () => {
  const sub = new Subscription({ userId: '64b000000000000000000001' }).toObject() as any;
  assert.equal(sub.billingStatus, 'Active');
  assert.equal(sub.trialStatus.isActive, false);
  assert.equal(sub.trialStatus.endsAt, undefined);
  assert.equal(sub.trialSource, undefined);
});

// ── Custom trial pricing ────────────────────────────────────────────────────

const STANDARD = 9999;
const policy = (offerEnabled: boolean, customEnabled: boolean, priceInr = 35999) =>
  parseTrialPolicy({ trial: { offerEnabled, trialMonths: 3, eligibleCycle: 'yearly', customPrice: { enabled: customEnabled, priceInr } }, version: 9 });

test('custom pricing: the four switch combinations', () => {
  // Trial ON + custom ON → the custom price after the trial.
  assert.deepEqual(effectiveTrialPrice(policy(true, true), STANDARD), { priceInr: 35999, source: 'custom' });
  // Trial ON + custom OFF → the standard yearly price after the trial.
  assert.deepEqual(effectiveTrialPrice(policy(true, false), STANDARD), { priceInr: 9999, source: 'standard' });
  // Trial OFF (custom ON or OFF) → standard, and no trial at all.
  for (const custom of [true, false]) {
    const p = policy(false, custom);
    assert.deepEqual(effectiveTrialPrice(p, STANDARD), { priceInr: 9999, source: 'standard' });
    assert.equal(offerAppliesToCycle(p, 'yearly'), false, 'no trial path → the normal ₹9,999 checkout');
  }
});

test('custom pricing: the configured amount is used as-is (never hardcoded)', () => {
  assert.equal(effectiveTrialPrice(policy(true, true, 12000), STANDARD).priceInr, 12000);
  assert.equal(effectiveTrialPrice(policy(true, true, 4999), STANDARD).priceInr, 4999);
});

test('custom pricing: documents without the new fields stay compatible (OFF, default amount)', () => {
  const legacy = parseTrialPolicy({ trial: { offerEnabled: true, trialMonths: 3, eligibleCycle: 'yearly' }, version: 2 });
  assert.equal(legacy.offerEnabled, true, 'existing trial setting unchanged');
  assert.deepEqual(legacy.customPrice, { enabled: false, priceInr: DEFAULT_CUSTOM_TRIAL_PRICE_INR });
  assert.deepEqual(effectiveTrialPrice(legacy, STANDARD), { priceInr: 9999, source: 'standard' });
  assert.deepEqual(parseTrialPolicy(null).customPrice, { enabled: false, priceInr: 35999 });
  const fresh = new BillingPolicy({}).toObject() as any;
  assert.equal(fresh.trial.customPrice.enabled, false);
  assert.equal(fresh.trial.customPrice.priceInr, 35999);
});

test('custom pricing: a malformed stored price falls back to the standard price', () => {
  for (const bad of [0, -5, 35999.5, '35999', 500001, null]) {
    const p = parseTrialPolicy({ trial: { offerEnabled: true, trialMonths: 3, customPrice: { enabled: true, priceInr: bad } } });
    assert.equal(p.customPrice.enabled, false, `price ${bad}`);
    assert.equal(effectiveTrialPrice(p, STANDARD).priceInr, 9999);
  }
  assert.equal(parseTrialPolicy({ trial: { offerEnabled: true, trialMonths: 3, customPrice: { enabled: 'true', priceInr: 35999 } } }).customPrice.enabled, false);
});

test('custom pricing: admin updates are validated (boolean switch, whole rupees 1–5,00,000)', () => {
  assert.deepEqual(validateCustomTrialPriceUpdate({ enabled: true, priceInr: 35999 }), { ok: true, value: { enabled: true, priceInr: 35999 } });
  assert.deepEqual(validateCustomTrialPriceUpdate({ enabled: false, priceInr: 500000 }), { ok: true, value: { enabled: false, priceInr: 500000 } });
  for (const bad of [
    null, {}, { enabled: 'yes', priceInr: 35999 }, { enabled: true }, { enabled: true, priceInr: 0 }, { enabled: true, priceInr: -1 },
    { enabled: true, priceInr: 35999.99 }, { enabled: true, priceInr: '35999' }, { enabled: true, priceInr: 500001 }, { enabled: true, priceInr: Number.NaN },
  ]) {
    assert.equal(validateCustomTrialPriceUpdate(bad).ok, false, JSON.stringify(bad));
  }
});

test('recovery plan: a trial customer stays on the exact plan and price they agreed to', () => {
  assert.deepEqual(chooseRecoveryPlan({ razorpayPlanId: 'plan_live_custom', amountPaise: 3599900, razorpayMode: 'live' }, 'live'), {
    kind: 'agreed', planId: 'plan_live_custom', amountPaise: 3599900, cycle: 'yearly',
  });
  assert.deepEqual(chooseRecoveryPlan({ razorpayPlanId: 'plan_live_std', amountPaise: 999900, razorpayMode: 'live' }, 'live'), {
    kind: 'agreed', planId: 'plan_live_std', amountPaise: 999900, cycle: 'yearly',
  });
  // No trial agreement → the existing standard-plan recovery.
  assert.deepEqual(chooseRecoveryPlan(null, 'live'), { kind: 'standard' });
});

test('recovery plan: test and live plans are never mixed — blocked, never a silent price change', () => {
  assert.equal(chooseRecoveryPlan({ razorpayPlanId: 'plan_test_x', amountPaise: 3599900, razorpayMode: 'test' }, 'live').kind, 'blocked');
  assert.equal(chooseRecoveryPlan({ razorpayPlanId: 'plan_live_x', amountPaise: 3599900, razorpayMode: 'live' }, 'test').kind, 'blocked');
  // Legacy (no recorded mode) is test-only, like every other legacy plan id.
  assert.equal(chooseRecoveryPlan({ razorpayPlanId: 'plan_old', amountPaise: 999900 }, 'live').kind, 'blocked');
  assert.equal(chooseRecoveryPlan({ razorpayPlanId: 'plan_old', amountPaise: 999900 }, 'test').kind, 'agreed');
});
