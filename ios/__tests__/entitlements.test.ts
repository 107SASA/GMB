import { computeEntitlements } from '../src/entitlements/compute';

const NOW = Date.parse('2026-12-01T00:00:00.000Z');
const FUTURE = '2027-01-15T10:00:00.000Z';
const PAST = '2026-11-01T00:00:00.000Z';
const FREE_MODULES = { google_ranking_agent: { enabled: true } };
const ALL_ON = Object.fromEntries(
  ['google_ranking_agent', 'reputation_agent', 'sales_agent', 'content_studio', 'marketing_automation'].map((k) => [k, { enabled: true }])
);

describe('computeEntitlements (mirrors the server requireModule)', () => {
  it('an authorized offer trial unlocks every module and counts days left', () => {
    const e = computeEntitlements(
      { billingStatus: 'Trialing', trialSource: 'offer', trialStatus: { isActive: true, endsAt: FUTURE }, modules: FREE_MODULES },
      NOW
    );
    expect(e.isTrialing).toBe(true);
    expect(e.trialDaysLeft).toBe(46);
    expect(Object.values(e.modules).every(Boolean)).toBe(true);
  });

  it('the old 14-day "Trialing" default (no trialSource) is NOT a trial', () => {
    const e = computeEntitlements({ billingStatus: 'Trialing', trialStatus: { isActive: true, endsAt: FUTURE }, modules: FREE_MODULES }, NOW);
    expect(e.isTrialing).toBe(false);
    expect(e.modules.sales_agent).toBe(false);
    expect(e.modules.google_ranking_agent).toBe(true);
  });

  it('an expired trial, or one without an end date, is not a trial', () => {
    for (const trialStatus of [{ isActive: true, endsAt: PAST }, { isActive: true, endsAt: null }, { isActive: false, endsAt: FUTURE }]) {
      const e = computeEntitlements({ billingStatus: 'Trialing', trialSource: 'offer', trialStatus, modules: FREE_MODULES }, NOW);
      expect(e.isTrialing).toBe(false);
      expect(e.modules.content_studio).toBe(false);
    }
  });

  it('past due keeps only the always-free module, even if the modules map still says enabled', () => {
    const e = computeEntitlements({ planType: 'Pro', billingStatus: 'PastDue', trialStatus: null, modules: ALL_ON }, NOW);
    expect(e.isPastDue).toBe(true);
    expect(e.modules.google_ranking_agent).toBe(true);
    expect(e.modules.sales_agent).toBe(false);
    expect(e.modules.marketing_automation).toBe(false);
  });

  it('a paid account follows its modules map', () => {
    const e = computeEntitlements({ planType: 'Pro', billingStatus: 'Active', trialStatus: null, modules: ALL_ON }, NOW);
    expect(Object.values(e.modules).every(Boolean)).toBe(true);
  });

  it('a legacy account with no subscription block is unlocked (unchanged)', () => {
    expect(Object.values(computeEntitlements(null, NOW).modules).every(Boolean)).toBe(true);
  });

  it('payment failure: every module during grace, then only the unrestricted ones', () => {
    const graceEnd = '2026-12-04T00:00:00.000Z';
    const base = { planType: 'Pro', billingStatus: 'PastDue', trialStatus: null, modules: ALL_ON, paymentGraceEndsAt: graceEnd };
    const during = computeEntitlements(base, NOW);
    expect(Object.values(during.modules).every(Boolean)).toBe(true);
    const after = computeEntitlements({ ...base, restrictedModules: ['content_studio'] }, Date.parse('2026-12-05T00:00:00.000Z'));
    expect(after.modules.content_studio).toBe(false);
    expect(after.modules.sales_agent).toBe(true);
    expect(after.modules.google_ranking_agent).toBe(true);
  });

  it('recovery held for review locks paid modules until released', () => {
    const e = computeEntitlements({ planType: 'Pro', billingStatus: 'Active', trialStatus: null, modules: ALL_ON, accessHold: true }, NOW);
    expect(e.modules.sales_agent).toBe(false);
    expect(e.modules.google_ranking_agent).toBe(true);
  });
});
