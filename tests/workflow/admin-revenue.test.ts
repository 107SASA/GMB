/**
 * Platform revenue + workspace-status metrics: the pure calculation
 * (lib/admin/revenueMetrics.ts), the REAL Razorpay event path recording
 * cycle / amount / cancel time, and the REAL /api/admin/revenue and
 * /api/admin/stats routes against an in-memory MongoDB.
 *
 * Run: npx tsx --test tests/workflow/admin-revenue.test.ts
 */
import { signInAsSuperAdmin, startMemoryDb, stopMemoryDb } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|INNGEST)_?/.test(k) && k !== 'INNGEST_DEV') delete process.env[k];
process.env.WHATSAPP_PROVIDER = 'twilio';

let skipReason: string | null = null;
let m: any = {};

before(async () => {
  skipReason = await startMemoryDb('admin_revenue');
  if (skipReason) return;
  const client = await import('../../src/services/inngest/client');
  (client.inngest as any).send = async () => ({ ids: [] });
  m = {
    mongoose: (await import('mongoose')).default,
    metrics: await import('../../src/lib/admin/revenueMetrics'),
    revenueRoute: await import('../../src/app/api/admin/revenue/route'),
    statsRoute: await import('../../src/app/api/admin/stats/route'),
    events: await import('../../src/services/billing/billingEvents'),
    entitlements: await import('../../src/lib/billing/applyEntitlements'),
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    BillingPlan: (await import('../../src/models/BillingPlan')).default,
    BillingEvent: (await import('../../src/models/BillingEvent')).default,
  };
  await m.BillingPlan.collection.insertOne({
    key: 'default', displayName: 'Growwmatics Pro', priceInr: 1499,
    durations: [
      { cycle: 'monthly', priceInr: 1499, enabled: true },
      { cycle: 'quarterly', priceInr: 3999, enabled: false },
      { cycle: 'yearly', priceInr: 9999, enabled: true },
    ],
  });
});
after(stopMemoryDb);

const prices = () => m.metrics.planPricesFrom({ priceInr: 1499, durations: [{ cycle: 'monthly', priceInr: 1499 }, { cycle: 'quarterly', priceInr: 3999 }, { cycle: 'yearly', priceInr: 9999 }] });

test('pure: monthly equivalent per cycle, one count per Razorpay subscription, estimates flagged', (t) => {
  if (skipReason) return t.skip(skipReason);
  const r = m.metrics.computeMrr([
    { id: 'a', billingSubscriptionId: 'sub_a', billingCycle: 'yearly', billingAmountInr: 9999 },
    { id: 'a2', billingSubscriptionId: 'sub_a', billingCycle: 'yearly', billingAmountInr: 9999 }, // same subscription twice
    { id: 'b', billingSubscriptionId: 'sub_b', billingCycle: 'monthly', billingAmountInr: 1499 },
    { id: 'c', billingSubscriptionId: 'sub_c', lastChargeInr: 3999 }, // legacy: cycle from the charged amount
    { id: 'd', billingSubscriptionId: 'sub_d' }, // nothing known → monthly price, estimated
  ], prices());
  assert.equal(r.payingSubscriptions, 4);
  assert.equal(r.mrr, Math.round(9999 / 12 + 1499 + 3999 / 3 + 1499));
  assert.equal(r.arr, r.mrr * 12);
  assert.equal(r.estimated, 1);
  assert.equal(r.byCycle.yearly.count, 1);
  assert.equal(r.byCycle.quarterly.count, 1);
  assert.equal(r.byCycle.unknown.count, 1);
  assert.equal(m.metrics.cycleForAmount(1234, prices()), null);
});

test('pure: month start is computed in IST, not server time', (t) => {
  if (skipReason) return t.skip(skipReason);
  // 31 Oct 2026 20:00 UTC is already 1 Nov 01:30 in India.
  const start = m.metrics.startOfMonthIn('Asia/Kolkata', new Date('2026-10-31T20:00:00Z'));
  assert.equal(start.toISOString(), '2026-10-31T18:30:00.000Z');
  assert.equal(m.metrics.startOfMonthIn('Asia/Kolkata', new Date('2026-10-15T10:00:00Z')).toISOString(), '2026-09-30T18:30:00.000Z');
  assert.equal(m.metrics.workspaceStatusLabel('trialing'), 'Never paid');
  assert.equal(m.metrics.workspaceStatusLabel('trial_active'), 'Free trial');
});

let seq = 0;
async function workspace(over: Record<string, unknown> = {}) {
  const n = ++seq;
  const userId = new m.mongoose.Types.ObjectId();
  const b = await m.Business.create({ name: `Studio ${n}`, category: 'Salon', address: 'Pune', userId, organizationId: new m.mongoose.Types.ObjectId(), ...over } as any);
  await m.User.create({ _id: userId, fullName: `Owner ${n}`, email: `rev${n}@example.invalid`, phone: `+9198770${String(n).padStart(5, '0')}`, role: 'CLIENT', businessIds: [b._id] } as any);
  return { businessId: String(b._id), userId: String(userId), subId: `sub_rev_${n}` };
}

test('a verified charge records the cycle and amount; a cancel stamps its time once', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const w = await workspace();
  await m.events.applyRazorpayEvent({
    type: 'subscription.activated', eventAt: new Date(), source: 'webhook',
    subEntity: { id: w.subId, status: 'active', plan_id: 'plan_y', paid_count: 1, current_end: Math.floor(Date.now() / 1000) + 365 * 86400, notes: { businessId: w.businessId, userId: w.userId, planType: 'Pro', billingCycle: 'yearly' } },
    paymentEntity: { id: 'pay_rev_1', status: 'captured', amount: 999_900, currency: 'INR' },
  });
  let b: any = await m.Business.findById(w.businessId).lean();
  assert.equal(b.subscriptionStatus, 'active');
  assert.equal(b.billingCycle, 'yearly');
  assert.equal(b.billingAmountInr, 9999);

  await m.entitlements.cancelBusinessPlan(w.businessId);
  b = await m.Business.findById(w.businessId).lean();
  assert.equal(b.subscriptionStatus, 'canceled');
  assert.equal(b.subscriptionCanceledReason, 'canceled');
  const first = b.subscriptionCanceledAt.getTime();
  await m.entitlements.cancelBusinessPlan(w.businessId); // duplicate cancel event
  assert.equal((await m.Business.findById(w.businessId).lean()).subscriptionCanceledAt.getTime(), first, 'first cancel time kept');
});

test('revenue + stats routes: one definition — trials are not "trialing", MRR follows real cycles, cancels from real dates', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await m.Business.deleteMany({});
  await m.BillingEvent.deleteMany({});
  await workspace({ subscriptionStatus: 'active', billingSubscriptionId: 'sub_y', billingCycle: 'yearly', billingAmountInr: 9999 });
  await workspace({ subscriptionStatus: 'active', billingSubscriptionId: 'sub_m', billingCycle: 'monthly', billingAmountInr: 1499 });
  const legacy = await workspace({ subscriptionStatus: 'active', billingSubscriptionId: 'sub_legacy' });
  await m.BillingEvent.create({ businessId: legacy.businessId, eventType: 'subscription.charged', source: 'webhook', eventAt: new Date(), actions: ['activate_paid'], amountPaise: 399_900 });
  await workspace({ subscriptionStatus: 'trial_active', trialEndsAt: new Date(Date.now() + 80 * 86400_000) });
  await workspace({}); // never paid (schema default 'trialing')
  await workspace({ subscriptionStatus: 'trialing' });
  await workspace({ subscriptionStatus: 'past_due' });
  await workspace({ subscriptionStatus: 'canceled', subscriptionCanceledAt: new Date(), subscriptionCanceledReason: 'canceled' });
  await workspace({ subscriptionStatus: 'canceled', subscriptionCanceledAt: new Date(), subscriptionCanceledReason: 'trial_ended' });
  await workspace({ subscriptionStatus: 'canceled', subscriptionCanceledAt: new Date('2025-01-01') }); // last year
  // A canceled workspace edited today (the old updatedAt rule counted it) — canceled long ago per the audit trail.
  const oldCancel = await workspace({ subscriptionStatus: 'canceled' });
  await m.BillingEvent.create({ businessId: oldCancel.businessId, eventType: 'subscription.cancelled', source: 'webhook', eventAt: new Date('2025-02-01'), statusBefore: 'active', statusAfter: 'canceled', actions: ['cancel'] });
  await m.Business.updateOne({ _id: oldCancel.businessId }, { $set: { name: 'Renamed today' } });

  await signInAsSuperAdmin('rev-admin@example.invalid');
  const rev = (await (await m.revenueRoute.GET()).json()).data;
  assert.equal(rev.activeCount, 3);
  assert.equal(rev.payingSubscriptions, 3);
  assert.equal(rev.mrr, Math.round(9999 / 12 + 1499 + 3999 / 3));
  assert.equal(rev.arr, rev.mrr * 12);
  assert.equal(rev.trialActiveCount, 1, 'only the authorised trial');
  assert.equal(rev.neverPaidCount, 2, 'default and explicit trialing');
  assert.equal(rev.pastDueCount, 1);
  assert.equal(rev.canceledThisMonth, 1, 'trial run-outs, last year and an old cancel edited today are excluded');
  assert.equal(rev.trialsEndedThisMonth, 1);
  assert.equal(rev.estimatedCount, 0);

  const stats = (await (await m.statsRoute.GET()).json()).data.stats;
  assert.equal(stats.activeBusinesses, 4, 'paying + authorised trial');
  assert.equal(stats.payingBusinesses, 3);
  assert.equal(stats.trialBusinesses, 1);
  assert.equal(stats.totalBusinesses, 11);
});
