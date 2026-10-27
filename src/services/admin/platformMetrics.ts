import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import BillingPlan from '@/models/BillingPlan';
import BillingEvent from '@/models/BillingEvent';
import { computeMrr, planPricesFrom, startOfMonthIn, type MrrResult } from '@/lib/admin/revenueMetrics';

/**
 * Loads the rows behind lib/admin/revenueMetrics.ts — the ONE revenue and
 * workspace-status calculation used by Overview, Revenue and Conversion
 * Overview, so the three pages can't disagree.
 */
export interface WorkspaceStatusCounts {
  /** Paying (status active). */
  active: number;
  /** Authorised free trials (status trial_active) — not the never-paid default. */
  trialActive: number;
  /** Signed up, never started a trial or paid (status trialing, the default). */
  neverPaid: number;
  pastDue: number;
  canceled: number;
  total: number;
}

export interface PlatformRevenue extends MrrResult {
  monthlyPriceInr: number;
  planName: string;
  statuses: WorkspaceStatusCounts;
  /** Paying subscriptions that ended this calendar month (IST), excluding unpaid trials that simply ran out. */
  canceledThisMonth: number;
  /** Unpaid trials that reached their end this month without a payment. */
  trialsEndedThisMonth: number;
  /** Active workspaces with no Razorpay subscription and no recorded charge (e.g. the store reviewer demo) — not revenue. */
  complimentary: number;
}

export const REPORTING_TIMEZONE = 'Asia/Kolkata';

export async function workspaceStatusCounts(): Promise<WorkspaceStatusCounts> {
  await dbConnect();
  const rows: Array<{ _id: string | null; count: number }> = await Business.aggregate([
    { $group: { _id: '$subscriptionStatus', count: { $sum: 1 } } },
  ]);
  const n = (s: string) => rows.find((r) => r._id === s)?.count ?? 0;
  const total = rows.reduce((a, r) => a + r.count, 0);
  // A missing status is the schema default ('trialing').
  const missing = rows.find((r) => r._id === null || r._id === undefined)?.count ?? 0;
  return {
    active: n('active'),
    trialActive: n('trial_active'),
    neverPaid: n('trialing') + missing,
    pastDue: n('past_due'),
    canceled: n('canceled'),
    total,
  };
}

/** Cancellations this month: the stamped time, else (older rows) the audit-trail transition into 'canceled'. */
async function cancellationsThisMonth(since: Date): Promise<{ canceled: number; trialsEnded: number }> {
  const stamped: any[] = await Business.find({ subscriptionStatus: 'canceled', subscriptionCanceledAt: { $gte: since } })
    .select('_id subscriptionCanceledReason')
    .lean();
  const stampedIds = new Set(stamped.map((b) => String(b._id)));
  const unstamped: any[] = await Business.find({ subscriptionStatus: 'canceled', subscriptionCanceledAt: { $exists: false } })
    .select('_id')
    .lean();
  let legacy = 0;
  if (unstamped.length) {
    const ids = await BillingEvent.distinct('businessId', {
      businessId: { $in: unstamped.map((b) => b._id) },
      statusAfter: 'canceled',
      statusBefore: { $ne: 'canceled' },
      eventAt: { $gte: since },
    });
    legacy = ids.filter((id: any) => !stampedIds.has(String(id))).length;
  }
  const trialsEnded = stamped.filter((b) => b.subscriptionCanceledReason === 'trial_ended').length;
  return { canceled: stamped.length - trialsEnded + legacy, trialsEnded };
}

export async function platformRevenue(now = new Date()): Promise<PlatformRevenue> {
  await dbConnect();
  const plan: any = await BillingPlan.findOne({ key: 'default' }).lean();
  const prices = planPricesFrom(plan);

  const active: any[] = await Business.find({ subscriptionStatus: 'active' })
    .select('_id billingSubscriptionId razorpaySubscriptionId billingCycle billingAmountInr')
    .lean();

  // Workspaces paid before the cycle was recorded: their last verified charge.
  const needCharge = active.filter((b) => !b.billingCycle && !b.billingAmountInr).map((b) => b._id);
  const lastCharge = new Map<string, number>();
  if (needCharge.length) {
    const charges: any[] = await BillingEvent.aggregate([
      { $match: { businessId: { $in: needCharge }, actions: 'activate_paid', amountPaise: { $gt: 0 } } },
      { $sort: { eventAt: -1 } },
      { $group: { _id: '$businessId', amountPaise: { $first: '$amountPaise' } } },
    ]);
    for (const c of charges) lastCharge.set(String(c._id), c.amountPaise / 100);
  }

  // Active with no Razorpay subscription and no charge ever recorded = set
  // active by hand (store reviewer demo, comped account): not revenue.
  const paying = active.filter((b) =>
    b.billingSubscriptionId || b.razorpaySubscriptionId || b.billingCycle || b.billingAmountInr || lastCharge.has(String(b._id))
  );

  const mrr = computeMrr(
    paying.map((b) => ({
      id: String(b._id),
      billingSubscriptionId: b.billingSubscriptionId ?? null,
      billingCycle: b.billingCycle ?? null,
      billingAmountInr: b.billingAmountInr ?? null,
      lastChargeInr: lastCharge.get(String(b._id)) ?? null,
    })),
    prices
  );

  const [statuses, cancels] = await Promise.all([
    workspaceStatusCounts(),
    cancellationsThisMonth(startOfMonthIn(REPORTING_TIMEZONE, now)),
  ]);

  return {
    ...mrr,
    monthlyPriceInr: prices.monthlyPriceInr,
    planName: plan?.displayName ?? 'Pro',
    statuses,
    canceledThisMonth: cancels.canceled,
    trialsEndedThisMonth: cancels.trialsEnded,
    complimentary: active.length - paying.length,
  };
}
