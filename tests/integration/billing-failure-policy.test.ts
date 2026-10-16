/**
 * Failed-payment policy: grace periods, restricted capabilities, recovery
 * hold — pure rules, fixed clock.
 * Run: node --experimental-strip-types --test tests/integration/billing-failure-policy.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFailurePolicy,
  validateFailurePolicyUpdate,
  failureSnapshot,
  DEFAULT_FAILURE_POLICY,
  PAID_MODULE_KEYS,
} from '../../src/lib/billing/billingPolicy.ts';
import {
  workspaceHasPlanAccess,
  workspaceAccessState,
  userCanUseModule,
  limitsPlanFor,
} from '../../src/lib/billing/entitlements.ts';
import { isWorkspaceUnlocked } from '../../src/lib/workspaceAccess.ts';

const DAY = 86_400_000;
const FAILED = new Date('2027-01-15T10:05:00.000Z');
const at = (days: number) => new Date(FAILED.getTime() + days * DAY);
const ALL_ON = Object.fromEntries(['google_ranking_agent', ...PAID_MODULE_KEYS].map((k) => [k, { enabled: true }]));

test('agreed defaults: trial-end failure immediate, renewal 3-day grace, every paid module restricted, auto-restore', () => {
  assert.deepEqual(parseFailurePolicy(null), DEFAULT_FAILURE_POLICY);
  assert.deepEqual(DEFAULT_FAILURE_POLICY.firstCharge, { mode: 'immediate', graceDays: 0 });
  assert.deepEqual(DEFAULT_FAILURE_POLICY.renewal, { mode: 'grace', graceDays: 3 });
  assert.deepEqual([...DEFAULT_FAILURE_POLICY.restrictedModules].sort(), [...PAID_MODULE_KEYS].sort());
  assert.equal(DEFAULT_FAILURE_POLICY.restoreAccessOnRecovery, true);
});

test('missing or malformed configuration falls back part by part, and never opens more', () => {
  for (const doc of [{}, { failure: null }, { failure: 'x' }, 'garbage', { failure: { firstCharge: { mode: 'forever' } } }]) {
    assert.deepEqual(parseFailurePolicy(doc), DEFAULT_FAILURE_POLICY, JSON.stringify(doc));
  }
  const partial = parseFailurePolicy({ failure: { renewal: { mode: 'grace', graceDays: 7 }, restrictedModules: ['nope'], restoreAccessOnRecovery: 'yes' } });
  assert.deepEqual(partial.renewal, { mode: 'grace', graceDays: 7 });
  assert.deepEqual(partial.firstCharge, DEFAULT_FAILURE_POLICY.firstCharge);
  assert.deepEqual([...partial.restrictedModules].sort(), [...PAID_MODULE_KEYS].sort(), 'bad list → restrict everything');
  assert.equal(partial.restoreAccessOnRecovery, true);
  assert.deepEqual(parseFailurePolicy({ failure: { renewal: { mode: 'grace', graceDays: 999 } } }).renewal, DEFAULT_FAILURE_POLICY.renewal);
  // The always-free module in the stored list is invalid → restrict every paid module.
  assert.deepEqual([...parseFailurePolicy({ failure: { restrictedModules: ['google_ranking_agent'] } }).restrictedModules].sort(), [...PAID_MODULE_KEYS].sort());
});

test('admin updates are validated server-side', () => {
  const ok = { firstCharge: { mode: 'immediate' }, renewal: { mode: 'grace', graceDays: 5 }, restrictedModules: ['content_studio'], restoreAccessOnRecovery: false };
  const v = validateFailurePolicyUpdate(ok);
  assert.equal(v.ok, true);
  assert.deepEqual((v as any).value.firstCharge, { mode: 'immediate', graceDays: 0 });
  const bad: unknown[] = [
    null,
    { ...ok, renewal: { mode: 'grace', graceDays: 0 } },
    { ...ok, renewal: { mode: 'grace', graceDays: 31 } },
    { ...ok, renewal: { mode: 'grace', graceDays: 2.5 } },
    { ...ok, firstCharge: { mode: 'later' } },
    { ...ok, restrictedModules: ['google_ranking_agent'] },
    { ...ok, restrictedModules: ['admin_panel'] },
    { ...ok, restrictedModules: 'content_studio' },
    { ...ok, restoreAccessOnRecovery: 'no' },
    { ...ok, alwaysAccessible: { login: true, free_report: true, billing: false, payment_recovery: true, support: true } },
  ];
  for (const b of bad) assert.equal(validateFailurePolicyUpdate(b).ok, false, JSON.stringify(b));
});

test('Day-0 snapshot: first charge restricts at once, renewal gets the configured grace', () => {
  const first = failureSnapshot(DEFAULT_FAILURE_POLICY, 'first_charge', FAILED);
  assert.equal(first.graceEndsAt.getTime(), FAILED.getTime());
  const renewal = failureSnapshot(DEFAULT_FAILURE_POLICY, 'renewal', FAILED);
  assert.equal(renewal.graceEndsAt.toISOString(), at(3).toISOString());
});

test('a policy change after Day 0 does not move an open failure (the snapshot is what is enforced)', () => {
  const snap = failureSnapshot(DEFAULT_FAILURE_POLICY, 'renewal', FAILED);
  const changed = parseFailurePolicy({ failure: { ...DEFAULT_FAILURE_POLICY, renewal: { mode: 'grace', graceDays: 10 } } });
  const ws = { subscriptionStatus: 'past_due', paymentGraceEndsAt: snap.graceEndsAt, paymentRestrictedModules: snap.restrictedModules };
  assert.equal(changed.renewal.graceDays, 10);
  assert.equal(workspaceHasPlanAccess(ws, at(4)), false, 'still the 3 days frozen at Day 0');
});

test('renewal failure: full access during grace, restricted after — never "active"', () => {
  const snap = failureSnapshot(DEFAULT_FAILURE_POLICY, 'renewal', FAILED);
  const ws = { subscriptionStatus: 'past_due', paymentGraceEndsAt: snap.graceEndsAt, paymentRestrictedModules: snap.restrictedModules };
  assert.equal(workspaceHasPlanAccess(ws, at(1)), true);
  assert.equal(isWorkspaceUnlocked({ ...ws, businessCreatedAt: new Date('2026-09-01'), now: at(1) }), true);
  assert.equal(workspaceAccessState(ws, at(1)).mode, 'grace');
  assert.equal(workspaceHasPlanAccess(ws, at(3.01)), false);
  assert.equal(isWorkspaceUnlocked({ ...ws, businessCreatedAt: new Date('2026-09-01'), now: at(3.01) }), false);
  const after = workspaceAccessState(ws, at(3.01));
  assert.equal(after.mode, 'restricted');
  assert.deepEqual([...after.restrictedModules!].sort(), [...PAID_MODULE_KEYS].sort());
  // Even a legacy workspace whose owner's plan still says Pro is locked after grace.
  assert.equal(isWorkspaceUnlocked({ ...ws, userSubscriptionPlan: 'Pro', businessCreatedAt: new Date('2026-01-01'), now: at(4) }), false);
});

test('first-charge failure after the trial: restricted immediately', () => {
  const snap = failureSnapshot(DEFAULT_FAILURE_POLICY, 'first_charge', FAILED);
  const ws = { subscriptionStatus: 'past_due', paymentGraceEndsAt: snap.graceEndsAt, paymentRestrictedModules: snap.restrictedModules };
  assert.equal(workspaceHasPlanAccess(ws, new Date(FAILED.getTime() + 1)), false);
  assert.equal(workspaceAccessState(ws, new Date(FAILED.getTime() + 1)).mode, 'restricted');
});

test('module APIs follow the same snapshot: grace → all, after → restricted locked, unrestricted and free open', () => {
  const sub = (graceEndsAt: Date, restrictedModules?: string[]) => ({ billingStatus: 'PastDue', paymentGraceEndsAt: graceEndsAt, restrictedModules, modules: ALL_ON });
  const inGrace = sub(at(3));
  for (const m of PAID_MODULE_KEYS) assert.equal(userCanUseModule(inGrace, m, at(1)), true, m);
  const partial = sub(at(3), ['content_studio']);
  assert.equal(userCanUseModule(partial, 'content_studio', at(4)), false);
  assert.equal(userCanUseModule(partial, 'sales_agent', at(4)), true);
  assert.equal(userCanUseModule(partial, 'google_ranking_agent', at(4)), true);
  const noList = sub(at(3));
  for (const m of PAID_MODULE_KEYS) assert.equal(userCanUseModule(noList, m, at(4)), false, `${m} (missing list = all restricted)`);
  // A trial's failure in grace (modules map still free) still gets the paid plan.
  assert.equal(userCanUseModule({ billingStatus: 'PastDue', paymentGraceEndsAt: at(3), modules: { google_ranking_agent: { enabled: true } } }, 'sales_agent', at(1)), true);
});

test('usage limits: paid plan during grace, Free after (for a trial that failed)', () => {
  const trialFailure = { billingStatus: 'PastDue', paymentGraceEndsAt: at(3) };
  assert.equal(limitsPlanFor('Free', trialFailure, at(1)), 'Pro');
  assert.equal(limitsPlanFor('Free', trialFailure, at(4)), 'Free');
});

test('recovery held for review: paid, but locked until a super admin releases it', () => {
  const held = { subscriptionStatus: 'active', paymentAccessHold: true };
  assert.equal(workspaceHasPlanAccess(held), false);
  assert.equal(workspaceAccessState(held).mode, 'held');
  assert.equal(isWorkspaceUnlocked({ ...held, businessCreatedAt: new Date('2026-09-01') }), false);
  assert.equal(userCanUseModule({ billingStatus: 'Active', accessHold: true, modules: ALL_ON }, 'sales_agent'), false);
  assert.equal(userCanUseModule({ billingStatus: 'Active', accessHold: true, modules: ALL_ON }, 'google_ranking_agent'), true);
  assert.equal(workspaceHasPlanAccess({ subscriptionStatus: 'active' }), true);
});
