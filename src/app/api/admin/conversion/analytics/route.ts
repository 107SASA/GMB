import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import LeadEvent from '@/models/LeadEvent';
import { rangeScopeLabel, resolveDateRange } from '@/lib/admin/conversionFunnel';
import { conversionReport, type LeadRow } from '@/services/admin/conversionReport';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/conversion/analytics?range=all
 *
 * Conversion + agent performance for the leads CREATED in the range (default
 * all time), from the same report and segment definitions as the Conversion
 * Overview (services/admin/conversionReport.ts). Any metric that can't be
 * derived honestly is `{ value: null, unavailable: 'reason' }`.
 */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const range = resolveDateRange(new URL(req.url).searchParams);
    const report = await conversionReport(range);
    return NextResponse.json({
      success: true,
      range: { key: range.key, since: range.since, until: range.until, label: rangeScopeLabel(range.key) },
      leads: report.leads,
      conversion: report.conversion,
      agents: await agentPerformance(report.rows, report),
    });
  } catch (error: any) {
    console.error('[admin/conversion/analytics] failed:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}

/**
 * Outcome-oriented per-agent metrics over the same cohort — never raw
 * message counts, and never a customer tenant's leads or bookings.
 */
async function agentPerformance(rows: LeadRow[], report: Awaited<ReturnType<typeof conversionReport>>) {
  const ids = rows.map((r) => r.lead._id);
  const salesHandoffs = ids.length
    ? (await LeadEvent.distinct('leadId', { type: 'HUMAN_HANDOFF', actor: 'sales-agent', leadId: { $in: ids } })).length
    : 0;
  const b = report.bookings;
  return {
    sales: {
      activeLeads: report.segments.activeSales,
      demosGenerated: report.segments.demoInterest,
      purchaseIntent: report.segments.purchaseIntent,
      conversions: report.segments.customer,
      humanHandoffs: salesHandoffs,
      optOuts: report.segments.everOptedOut,
    },
    demo: {
      requested: b.total,
      scheduled: b.upcoming,
      completed: b.completed,
      cancelled: b.cancelled,
      noShow: b.noShow,
      rescheduled: b.confirmed,
    },
    inHouse: {
      activatedCustomers: rows.filter((r) => r.lead.currentAgent === 'IN_HOUSE').length,
      onboardingActivity: { value: null, unavailable: 'in-house onboarding activity is not separately instrumented yet' },
    },
  };
}
