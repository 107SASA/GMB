/**
 * Growth Partner commissions & payouts — maths, terms-at-payment-date,
 * recurring window, hold period, and the money-safety guarantees.
 * Run: node --experimental-strip-types --test tests/integration/growth-partner-commissions.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  availableAt,
  commissionAmount,
  commissionBase,
  commissionStage,
  payoutTotals,
  termsAt,
  withinRecurringWindow,
} from '../../src/lib/partners/commissionRules.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('maths: base excludes GST, rounded to paise', () => {
  assert.equal(commissionBase(5899, 899), 5000);
  assert.equal(commissionBase(4999, 0), 4999);
  assert.equal(commissionBase(100, 200), 0, 'never negative');
  assert.equal(commissionAmount(4999, 30), 1499.7);
  assert.equal(commissionAmount(1999, 12.5), 249.88);
});

test('terms: the rate in force on the payment date, not today’s', () => {
  const history = [
    { firstPaymentRate: 30, recurringRate: 15, holdDays: 15, changedAt: '2026-01-01T00:00:00Z' },
    { firstPaymentRate: 40, recurringRate: 20, holdDays: 7, changedAt: '2026-06-01T00:00:00Z' },
  ];
  const current = { firstPaymentRate: 40, recurringRate: 20, holdDays: 7 };
  assert.equal(termsAt(history, current, new Date('2026-03-10')).firstPaymentRate, 30);
  assert.equal(termsAt(history, current, new Date('2026-07-10')).recurringRate, 20);
  assert.equal(termsAt(history, current, new Date('2025-12-01')).firstPaymentRate, 30, 'before any history → earliest terms');
  assert.equal(termsAt([], current, new Date()).firstPaymentRate, 40);
});

test('recurring window: optional months limit from the first payment', () => {
  const first = new Date('2026-01-15T00:00:00Z');
  assert.equal(withinRecurringWindow(first, new Date('2030-01-01'), null), true, 'no limit');
  assert.equal(withinRecurringWindow(first, new Date('2026-12-01'), 12), true);
  assert.equal(withinRecurringWindow(first, new Date('2027-02-01'), 12), false);
});

test('hold period and stages', () => {
  const paid = new Date('2026-11-01T00:00:00Z');
  const avail = availableAt(paid, 15);
  assert.equal(avail.toISOString(), '2026-11-16T00:00:00.000Z');
  assert.equal(commissionStage({ status: 'pending', availableAt: avail }, new Date('2026-11-10')), 'on_hold');
  assert.equal(commissionStage({ status: 'pending', availableAt: avail }, new Date('2026-11-20')), 'ready');
  assert.equal(commissionStage({ status: 'paid', availableAt: avail }), 'paid');
});

test('payout totals: TDS optional (not decided yet), clawbacks net off', () => {
  assert.deepEqual(payoutTotals([1499.7, 249.88], 0), { gross: 1749.58, tdsPercent: 0, tds: 0, net: 1749.58 });
  assert.deepEqual(payoutTotals([1000, -200], 5), { gross: 800, tdsPercent: 5, tds: 40, net: 760 });
  assert.equal(payoutTotals([1000], null).net, 1000);
});

test('one commission per payment, ever', () => {
  assert.match(read('src/models/PartnerCommission.ts'), /paymentKey: \{ type: String, unique: true, sparse: true \}/);
  const svc = read('src/services/partners/partnerCommissions.ts');
  assert.match(svc, /PartnerCommission\.exists\(\{ paymentKey: inv\.razorpayPaymentId \}\)/);
  assert.match(svc, /err\?\.code === 11000\) return \{ created: false, reason: 'exists' \}/);
});

test('commission is created after each invoice, with a daily sweep as the safety net', () => {
  const fn = read('src/services/inngest/invoiceFunctions.ts');
  assert.match(fn, /step\.run\('partner-commission'[\s\S]{0,200}createCommissionForInvoice\(issued\.id\)/);
  assert.match(fn, /step\.run\('partner-commissions-sweep'[\s\S]{0,200}sweepMissingCommissions\(7\)/);
});

test('first vs renewal, rate snapshot, hold, attribution', () => {
  const svc = read('src/services/partners/partnerCommissions.ts');
  assert.match(svc, /const kind: 'first' \| 'recurring' = earlier \? 'recurring' : 'first'/);
  assert.match(svc, /termsAt\(partner\.termsHistory, partner, paidAt\)/);
  assert.match(svc, /availableAt: availableAt\(paidAt, terms\.holdDays\)/);
  assert.match(svc, /commissionBase\(inv\.amount, inv\.taxAmount\)/);
  // Lead partner first, then the workspace's referral partner — nobody else.
  assert.match(svc, /if \(lead\?\.partnerId\)[\s\S]{0,300}if \(business\.partnerId\)/);
});

test('approval only after the hold period; payout only with verified KYC', () => {
  const svc = read('src/services/partners/partnerCommissions.ts');
  assert.match(svc, /status: 'pending', availableAt: \{ \$lte: new Date\(\) \}/);
  const payout = svc.slice(svc.indexOf('export async function createPayout'), svc.indexOf('export async function adminPayoutList'));
  assert.match(payout, /kycStatus !== 'verified'\) return fail\(409/);
  assert.match(payout, /status === 'suspended'\) return fail\(409/);
  assert.match(payout, /status: 'approved', payoutId: null \}/, 'claims only unpaid approved rows');
  assert.match(payout, /claim\.modifiedCount !== due\.length/, 'a concurrent payout can’t double-pay');
});

test('reversal: unpaid → cancelled, paid → clawed back from the next payout', () => {
  const svc = read('src/services/partners/partnerCommissions.ts');
  const rev = svc.slice(svc.indexOf('export async function reverseCommission'), svc.indexOf('export async function createPayout'));
  assert.match(rev, /c\.status === 'paid'[\s\S]{0,400}kind: 'adjustment'[\s\S]{0,300}amount: -Math\.abs\(c\.amount\)/);
  assert.match(rev, /sourceCommissionId: c\._id \}\)\) return fail\(409, 'Already clawed back\.'\)/);
});

test('partner endpoints are read-only and scoped to the session partner', () => {
  for (const f of ['src/app/api/partner/commissions/route.ts', 'src/app/api/partner/payouts/route.ts']) {
    const src = read(f);
    assert.match(src, /requireGrowthPartner\(\)/);
    assert.match(src, /String\(auth\.partner\._id\)/);
    assert.doesNotMatch(src, /export async function (POST|PATCH|PUT|DELETE)/);
  }
  for (const f of [
    'src/app/api/admin/growth-partners/commissions/route.ts',
    'src/app/api/admin/growth-partners/commissions/approve/route.ts',
    'src/app/api/admin/growth-partners/commissions/[commissionId]/reverse/route.ts',
    'src/app/api/admin/growth-partners/[id]/payouts/route.ts',
    'src/app/api/admin/growth-partners/payouts/route.ts',
    'src/app/api/admin/growth-partners/payouts/export/route.ts',
  ]) {
    assert.match(read(f), /requireSuperAdmin\(\)/, f);
  }
});
