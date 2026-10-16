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
} from '../../src/lib/billing/billingPolicy.ts';
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
