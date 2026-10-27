import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { platformRevenue } from '@/services/admin/platformMetrics';

/**
 * GET /api/admin/revenue — the shared platform revenue calculation
 * (services/admin/platformMetrics.ts → lib/admin/revenueMetrics.ts), also
 * used by the Overview and Conversion Overview pages.
 */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    const r = await platformRevenue();
    return NextResponse.json({
      success: true,
      data: {
        mrr: r.mrr,
        arr: r.arr,
        activeCount: r.statuses.active,
        payingSubscriptions: r.payingSubscriptions,
        trialActiveCount: r.statuses.trialActive,
        neverPaidCount: r.statuses.neverPaid,
        pastDueCount: r.statuses.pastDue,
        canceledThisMonth: r.canceledThisMonth,
        trialsEndedThisMonth: r.trialsEndedThisMonth,
        estimatedCount: r.estimated,
        complimentaryCount: r.complimentary,
        byCycle: r.byCycle,
        monthlyPriceInr: r.monthlyPriceInr,
        planName: r.planName,
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
