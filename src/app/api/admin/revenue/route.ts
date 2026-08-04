import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import Business from '@/models/Business';
import BillingPlan from '@/models/BillingPlan';

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    // Real per-workspace billing state (src/lib/workspaceAccess.ts is the
    // single source of truth for this — Business.subscriptionStatus, set by
    // the Razorpay webhook). The old Subscription model (userId-scoped,
    // Free/Pro/Enterprise) predates the per-workspace billing migration and
    // no longer reflects who's actually paying.
    const plan = await BillingPlan.findOne({ key: 'default' }).lean();
    const monthlyPriceInr =
      (plan as any)?.durations?.find((d: any) => d.cycle === 'monthly' && d.enabled)?.priceInr
      ?? (plan as any)?.priceInr
      ?? 0;

    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [statusCounts, canceledThisMonth] = await Promise.all([
      Business.aggregate([
        { $group: { _id: '$subscriptionStatus', count: { $sum: 1 } } },
      ]),
      Business.countDocuments({
        subscriptionStatus: 'canceled',
        updatedAt: { $gte: startOfMonth },
      }),
    ]);

    const countFor = (status: string) =>
      statusCounts.find((s: any) => s._id === status)?.count ?? 0;

    const activeCount = countFor('active');
    // Monthly-equivalent MRR: billing cycle (monthly/quarterly/yearly) isn't
    // tracked per-workspace, so this treats every active workspace as paying
    // the plan's monthly rate. Understates true revenue for anyone on a
    // longer, discounted cycle, but unlike the old hardcoded 3-tier USD price
    // list, every number here is derived from real subscriptions and the
    // actual editable plan price.
    const mrr = activeCount * monthlyPriceInr;
    const arr = mrr * 12;

    return NextResponse.json({
      success: true,
      data: {
        mrr,
        arr,
        activeCount,
        trialingCount: countFor('trialing'),
        pastDueCount: countFor('past_due'),
        canceledThisMonth,
        monthlyPriceInr,
        planName: (plan as any)?.displayName ?? 'Pro',
      },
    });
  } catch (error: any) {
    console.error('Revenue Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch revenue data' },
      { status: 500 }
    );
  }
}
