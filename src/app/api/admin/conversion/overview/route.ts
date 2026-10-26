import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import Lead from '@/models/Lead';
import LeadEvent from '@/models/LeadEvent';
import { rangeScopeLabel, resolveDateRange, scoped } from '@/lib/admin/conversionFunnel';
import { SEGMENTS } from '@/lib/admin/leadMilestones';
import { conversionReport } from '@/services/admin/conversionReport';
import { platformRevenue } from '@/services/admin/platformMetrics';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/conversion/overview?range=all
 *
 * The SuperAdmin Conversion Overview in one call. Every lead number is for
 * the leads CREATED in the range (default: all time) and comes from the
 * segment registry in lib/admin/leadMilestones.ts — the same predicates
 * /admin/leads?segment=<key> filters with, so a KPI and its list match.
 * Demo BOOKINGS are reported separately from leads that reached a demo.
 * Revenue comes from the shared platform calculation (services/admin/platformMetrics.ts).
 */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const range = resolveDateRange(new URL(req.url).searchParams);
    const [report, revenue] = await Promise.all([conversionReport(range), platformRevenue()]);
    const platformIds = report.rows.map((r) => r.lead._id);

    // Recent activity — platform leads only (never a customer tenant's events).
    const platformEvent = (types: string[]) =>
      LeadEvent.find({ type: { $in: types }, conversationType: { $ne: 'tenant' }, $or: [{ leadId: { $exists: false } }, { leadId: { $in: platformIds } }] })
        .sort({ createdAt: -1 })
        .limit(6)
        .select('type phone payload actor createdAt leadId')
        .lean();
    const [recentLeads, recentDemoEvents, recentHandoffs, recentPayments] = await Promise.all([
      Lead.find(scoped()).sort({ createdAt: -1 }).limit(6).select('name phone currentStage currentAgent createdAt').lean(),
      platformEvent(['DEMO_REQUESTED', 'DEMO_SCHEDULED']),
      platformEvent(['HUMAN_HANDOFF']),
      platformEvent(['PAYMENT_SUCCESS', 'CUSTOMER_ACTIVATED']),
    ]);
    const recentCustomers = report.rows
      .filter((r) => r.reached.has('customer'))
      .sort((a, b) => new Date(b.lead.lastActivityAt || b.lead.createdAt).getTime() - new Date(a.lead.lastActivityAt || a.lead.createdAt).getTime())
      .slice(0, 6)
      .map((r) => ({ _id: r.lead._id, name: r.lead.name, phone: r.lead.phone, at: r.lead.lastActivityAt || r.lead.createdAt }));

    const s = report.segments;
    return NextResponse.json({
      success: true,
      range: { key: range.key, since: range.since, until: range.until, label: rangeScopeLabel(range.key) },
      kpis: {
        totalLeads: report.leads,
        activeSalesLeads: s.activeSales,
        demoInterested: s.demoInterest,
        demoScheduledLeads: s.demoScheduled,
        demoCompletedLeads: s.demoCompleted,
        purchaseIntent: s.purchaseIntent,
        convertedCustomers: s.customer,
        conversionRate: report.conversion.leadToCustomer.value ?? 0,
        withHuman: s.withHuman,
        optedOutOrLost: s.optedOutOrLost,
        pendingPayments: s.pendingPayment,
      },
      segments: Object.fromEntries(Object.entries(SEGMENTS).map(([k, d]) => [k, { label: d.label, description: d.description, kind: d.kind }])),
      bookings: report.bookings,
      revenue: {
        mrrInr: revenue.mrr,
        payingSubscriptions: revenue.payingSubscriptions,
        estimatedCount: revenue.estimated,
        trialActiveWorkspaces: revenue.statuses.trialActive,
        pastDueWorkspaces: revenue.statuses.pastDue,
      },
      funnel: report.funnel,
      conversion: report.conversion,
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
