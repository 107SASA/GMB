/**
 * Who gets the paid plan right now — one rule for gates, automations and
 * usage limits. Pure, fixed clock.
 * Run: node --experimental-strip-types --test tests/integration/billing-entitlements.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  workspaceHasPlanAccess,
  isOfferTrialActive,
  limitsPlanFor,
  trialAccessEndsAt,
} from '../../src/lib/billing/entitlements.ts';
import { TRIAL_CHARGE_PROCESSING_MS } from '../../src/lib/billing/billingPolicy.ts';
import { classifyLegacyTrial, isLegacyDefaultTrial } from '../../src/lib/billing/legacyTrialCleanup.ts';
import { ownerBusinessWhatsAppAllowed } from '../../src/services/ownerNotifyEligibility.ts';
import { getPlanDefaults } from '../../src/lib/planDefaults.ts';

const NOW = new Date('2026-12-01T00:00:00.000Z');
const END = new Date('2027-01-15T10:00:00.000Z');
const PAST_END = new Date('2026-11-01T00:00:00.000Z');

test('workspace plan access per subscription state', () => {
  const cases: Array<[string, Record<string, unknown>, boolean]> = [
    ['paid', { subscriptionStatus: 'active' }, true],
    ['authorized trial', { subscriptionStatus: 'trial_active', trialEndsAt: END }, true],
    ['trial ended, charge processing', { subscriptionStatus: 'trial_active', trialEndsAt: new Date(NOW.getTime() - 3_600_000) }, true],
    ['trial ended, processing window over', { subscriptionStatus: 'trial_active', trialEndsAt: new Date(NOW.getTime() - TRIAL_CHARGE_PROCESSING_MS - 1) }, false],
    ['cancelled trial before its end', { subscriptionStatus: 'trial_active', trialEndsAt: END, trialCancelledAt: PAST_END }, true],
    ['cancelled trial after its end', { subscriptionStatus: 'trial_active', trialEndsAt: PAST_END, trialCancelledAt: PAST_END }, false],
    ['trial without an end date', { subscriptionStatus: 'trial_active' }, false],
    ['failed payment (past due)', { subscriptionStatus: 'past_due' }, false],
    ['cancelled', { subscriptionStatus: 'canceled' }, false],
    ['never paid (free report / default)', { subscriptionStatus: 'trialing' }, false],
    ['no status', {}, false],
  ];
  for (const [label, ws, expected] of cases) assert.equal(workspaceHasPlanAccess(ws as any, NOW), expected, label);
  assert.equal(workspaceHasPlanAccess(null, NOW), false);
  assert.equal(trialAccessEndsAt({ subscriptionStatus: 'trial_active', trialEndsAt: 'not a date' }), null);
});

test('user-level trial: only an authorized offer trial within its end date', () => {
  const offer = { billingStatus: 'Trialing', trialSource: 'offer', trialStatus: { isActive: true, endsAt: END } };
  assert.equal(isOfferTrialActive(offer, NOW), true);
  // The legacy 14-day schema default: Trialing, active, future end — but no source.
  assert.equal(isOfferTrialActive({ billingStatus: 'Trialing', trialStatus: { isActive: true, endsAt: END } }, NOW), false);
  assert.equal(isOfferTrialActive({ ...offer, trialSource: 'admin' }, NOW), false);
  assert.equal(isOfferTrialActive({ ...offer, trialStatus: { isActive: true, endsAt: PAST_END } }, NOW), false);
  assert.equal(isOfferTrialActive({ ...offer, trialStatus: { isActive: false, endsAt: END } }, NOW), false);
  assert.equal(isOfferTrialActive({ ...offer, trialStatus: { isActive: true } }, NOW), false);
  assert.equal(isOfferTrialActive({ ...offer, billingStatus: 'PastDue' }, NOW), false);
  assert.equal(isOfferTrialActive(null, NOW), false);
});

test('usage limits: a trial gets the paid plan (finite), never unlimited, never Free', () => {
  const trial = { billingStatus: 'Trialing', trialSource: 'offer', trialStatus: { isActive: true, endsAt: END } };
  assert.equal(limitsPlanFor('Free', trial, NOW), 'Pro');
  assert.equal(limitsPlanFor('Pro', null, NOW), 'Pro');
  assert.equal(limitsPlanFor('Enterprise', null, NOW), 'Enterprise');
  assert.equal(limitsPlanFor('Free', { billingStatus: 'Trialing', trialStatus: { isActive: true, endsAt: END } }, NOW), 'Free');
  assert.equal(limitsPlanFor('Free', { billingStatus: 'PastDue', trialSource: 'offer', trialStatus: { isActive: false } }, NOW), 'Free');
  assert.equal(limitsPlanFor(undefined, undefined, NOW), 'Free');
  const pro = getPlanDefaults(limitsPlanFor('Free', trial, NOW));
  for (const v of [pro.maxPostsPerMonth, pro.maxAIGenerations, pro.maxWhatsAppMessagesPerDay, pro.maxAuditsPerBusiness]) {
    assert.ok(Number.isFinite(v) && v > 0 && v < 10_000, `finite limit, got ${v}`);
  }
  assert.ok(pro.maxPostsPerMonth > getPlanDefaults('Free').maxPostsPerMonth);
});

test('owner business WhatsApp: an authorized trial counts as subscribed, an expired one does not', () => {
  const connected = { googleConnected: true, googleLocationId: 'locations/1' };
  assert.equal(ownerBusinessWhatsAppAllowed({ ...connected, subscriptionStatus: 'trial_active', trialEndsAt: new Date(Date.now() + 86_400_000) }, 'post_published'), true);
  assert.equal(ownerBusinessWhatsAppAllowed({ ...connected, subscriptionStatus: 'trial_active', trialEndsAt: new Date(Date.now() - 30 * 86_400_000) }, 'post_published'), false);
  assert.equal(ownerBusinessWhatsAppAllowed({ ...connected, subscriptionStatus: 'past_due' }, 'post_published'), false);
});

test('legacy cleanup: classifies default "Trialing" records, never touches payers or real trials', () => {
  assert.equal(isLegacyDefaultTrial({ billingStatus: 'Trialing' }), true);
  assert.equal(isLegacyDefaultTrial({ billingStatus: 'Trialing', trialSource: 'offer' }), false);
  assert.equal(isLegacyDefaultTrial({ billingStatus: 'Active' }), false);
  const live = { billingStatus: 'Trialing', trialStatus: { isActive: true, endsAt: END } };
  const free = { subscriptionPlan: 'Free', hasActiveWorkspace: false };
  assert.equal(classifyLegacyTrial(live, free, NOW), 'was_granting_access');
  assert.equal(classifyLegacyTrial({ billingStatus: 'Trialing', trialStatus: { isActive: true, endsAt: PAST_END } }, free, NOW), 'expired');
  assert.equal(classifyLegacyTrial(live, { subscriptionPlan: 'Pro', hasActiveWorkspace: false }, NOW), 'paying_customer_skip');
  assert.equal(classifyLegacyTrial(live, { subscriptionPlan: 'Free', hasActiveWorkspace: true }, NOW), 'paying_customer_skip');
});
