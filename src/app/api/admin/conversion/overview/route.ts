import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import Lead from '@/models/Lead';
import LeadEvent from '@/models/LeadEvent';
import DemoBooking from '@/models/DemoBooking';
import Business from '@/models/Business';
import BillingPlan from '@/models/BillingPlan';
import {
  FUNNEL_FILTERS,
  FUNNEL_STEPS,
  createdAtFilter,
  resolveDateRange,
  scoped,
} from '@/lib/admin/conversionFunnel';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/conversion/overview?range=30d
 *
 * The SuperAdmin conversion Overview in one call:
 *   - KPI counts (leads / new / active sales / demo interest / scheduled /
 *     completed / purchase intent / customers) for the date window
 *   - the conversion funnel (each step's count + drop-off), all-time by
 *     default so the shape is meaningful even with little recent data
 *   - side-state counts (lost / opted out / human handoffs)
 *   - revenue signals from real data (active workspaces × editable plan price)
 *   - compact "recent activity" lists
 *
 * Everything is platform-tenant scoped. No fake values — an empty platform
 * returns zeros and empty arrays; the UI shows "No data yet".
 */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const url = new URL(req.url);
    const range = resolveDateRange(url.searchParams);
    const dateF = createdAtFilter(range);

    // Windowed lead counts (respect the date filter).
    const windowMatch = (extra: Record<string, unknown> = {}) => scoped({ ...dateF, ...extra });

    const [
      totalLeadsAllTime,
      newLeadsInWindow,
      activeSales,
      demoInterest,
      purchaseIntent,
      lost,
      optedOut,
      humanHandoffs,
      customersAllTime,
      customersInWindow,
    ] = await Promise.all([
      Lead.countDocuments(scoped()),
      Lead.countDocuments(windowMatch()),
      Lead.countDocuments(scoped(FUNNEL_FILTERS.salesNurturing)),
      Lead.countDocuments(scoped(FUNNEL_FILTERS.demoInterest)),
      Lead.countDocuments(scoped(FUNNEL_FILTERS.purchaseIntent)),
      Lead.countDocuments(scoped(FUNNEL_FILTERS.lost)),
      Lead.countDocuments(scoped(FUNNEL_FILTERS.optedOut)),
      Lead.countDocuments(scoped(FUNNEL_FILTERS.humanHandoff)),
      Lead.countDocuments(scoped(FUNNEL_FILTERS.customer)),
      Lead.countDocuments(windowMatch(FUNNEL_FILTERS.customer)),
    ]);

    // Demo booking status counts (platform demos only — every DemoBooking has
    // a leadId; join to platform leads).
    const platformLeadIds = await Lead.find(scoped()).select('_id').lean();
    const idSet = platformLeadIds.map((l: any) => l._id);
    const demoAgg = await DemoBooking.aggregate([
      { $match: { leadId: { $in: idSet } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const demoCount = (s: string) => demoAgg.find((d: any) => d._id === s)?.count ?? 0;
    const demosScheduled = demoCount('Pending') + demoCount('Confirmed') + demoCount('Rescheduled');
    const demosCompleted = demoCount('Completed');

    // The funnel (all-time — shape needs history to be meaningful).
    const funnel = await Promise.all(
      FUNNEL_STEPS.map(async (step) => ({
        key: step.key,
        label: step.label,
        count: await Lead.countDocuments(scoped(step.filter)),
      }))
    );

    // Revenue signals — real data only. Active workspaces × editable plan
    // price (same method as /api/admin/revenue; understates longer cycles).
    const plan = await BillingPlan.findOne({ key: 'default' }).lean();
    const monthlyPriceInr =
      (plan as any)?.durations?.find((d: any) => d.cycle === 'monthly' && d.enabled)?.priceInr ??
      (plan as any)?.priceInr ??
      0;
    const [activeWorkspaces, trialingWorkspaces, pastDueWorkspaces] = await Promise.all([
      Business.countDocuments({ subscriptionStatus: 'active' }),
      Business.countDocuments({ subscriptionStatus: 'trialing' }),
      Business.countDocuments({ subscriptionStatus: 'past_due' }),
    ]);

    // Recent activity — compact, most-recent-first.
    const [recentLeads, recentDemoEvents, recentHandoffs, recentPayments, recentCustomers] = await Promise.all([
      Lead.find(scoped()).sort({ createdAt: -1 }).limit(6).select('name phone currentStage currentAgent createdAt').lean(),
      LeadEvent.find({ type: { $in: ['DEMO_REQUESTED', 'DEMO_SCHEDULED'] } })
        .sort({ createdAt: -1 })
        .limit(6)
        .select('type phone payload actor createdAt leadId')
        .lean(),
      LeadEvent.find({ type: 'HUMAN_HANDOFF' }).sort({ createdAt: -1 }).limit(6).select('phone payload actor createdAt leadId').lean(),
      LeadEvent.find({ type: { $in: ['PAYMENT_SUCCESS', 'CUSTOMER_ACTIVATED'] } })
        .sort({ createdAt: -1 })
        .limit(6)
        .select('type phone payload createdAt leadId')
        .lean(),
      Lead.find(scoped(FUNNEL_FILTERS.customer)).sort({ updatedAt: -1 }).limit(6).select('name phone updatedAt').lean(),
    ]);

    return NextResponse.json({
      success: true,
      range: { key: range.key, since: range.since, until: range.until },
      kpis: {
        totalLeads: totalLeadsAllTime,
        newLeads: newLeadsInWindow,
        activeSalesLeads: activeSales,
        demoInterested: demoInterest,
        demosScheduled,
        demosCompleted,
        purchaseIntent,
        convertedCustomers: customersAllTime,
        convertedInWindow: customersInWindow,
        conversionRate: totalLeadsAllTime > 0 ? Math.round((customersAllTime / totalLeadsAllTime) * 1000) / 10 : 0,
        lostLeads: lost,
        optedOut,
        humanHandoffs,
      },
      revenue: {
        monthlyPriceInr,
        activeWorkspaces,
        trialingWorkspaces,
        pastDueWorkspaces,
        mrrInr: activeWorkspaces * monthlyPriceInr,
        // Distinct from `activeWorkspaces`: pending = a lead that reached
        // purchase intent / conversion-pending but has no verified payment yet.
        pendingPayments: await Lead.countDocuments(
          scoped({ currentStage: 'CONVERSION_PENDING' })
        ),
      },
      funnel,
      recent: {
        leads: recentLeads,
        demoEvents: recentDemoEvents,
        handoffs: recentHandoffs,
        payments: recentPayments,
        customers: recentCustomers,
      },
    });
  } catch (error: any) {
    console.error('[admin/conversion/overview] failed:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
