import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import Lead from '@/models/Lead';
import LeadEvent from '@/models/LeadEvent';
import DemoBooking from '@/models/DemoBooking';
import {
  FUNNEL_FILTERS,
  createdAtFilter,
  resolveDateRange,
  scoped,
} from '@/lib/admin/conversionFunnel';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/conversion/analytics?range=90d
 *
 * Conversion + agent performance, computed from REAL data only. Any metric
 * that can't be reliably derived from what's stored is returned as
 * `{ value: null, unavailable: 'reason' }` — never a fabricated number.
 *
 * Rates use all-time cohorts by default (a % needs a denominator with
 * history); "average time to X" uses LeadEvent timestamps within the window.
 */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const range = resolveDateRange(new URL(req.url).searchParams);
    const dateF = createdAtFilter(range);

    const [leads, qualified, demoInterest, demoScheduled, demoCompleted, purchaseIntent, customers, lost, optedOut, humanHandoffs] =
      await Promise.all([
        Lead.countDocuments(scoped(dateF)),
        Lead.countDocuments(scoped({ ...dateF, ...FUNNEL_FILTERS.qualified })),
        Lead.countDocuments(scoped({ ...dateF, ...FUNNEL_FILTERS.demoInterest })),
        Lead.countDocuments(scoped({ ...dateF, currentStage: { $in: ['DEMO_SCHEDULED', 'DEMO_COMPLETED'] } })),
        Lead.countDocuments(scoped({ ...dateF, currentStage: 'DEMO_COMPLETED' })),
        Lead.countDocuments(scoped({ ...dateF, ...FUNNEL_FILTERS.purchaseIntent })),
        Lead.countDocuments(scoped({ ...dateF, ...FUNNEL_FILTERS.customer })),
        Lead.countDocuments(scoped({ ...dateF, ...FUNNEL_FILTERS.lost })),
        Lead.countDocuments(scoped({ ...dateF, ...FUNNEL_FILTERS.optedOut })),
        Lead.countDocuments(scoped({ ...dateF, ...FUNNEL_FILTERS.humanHandoff })),
      ]);

    const pct = (num: number, den: number) =>
      den > 0 ? { value: Math.round((num / den) * 1000) / 10, num, den } : { value: null, unavailable: 'no leads in range', num, den };

    // Demo → purchase: of leads that completed a demo, how many reached
    // purchase intent or converted.
    const demoCompletedLeadIds = (
      await Lead.find(scoped({ currentStage: { $in: ['DEMO_COMPLETED', 'CONVERSION_PENDING', 'PAYMENT_VERIFIED', 'CUSTOMER'] } }))
        .select('_id currentStage intent')
        .lean()
    ) as any[];
    const everCompletedDemo = await DemoBooking.distinct('leadId', { status: { $in: ['Completed', 'No Show'] } });
    const completedDemoSet = new Set(everCompletedDemo.map(String));
    const demoLeads = demoCompletedLeadIds.filter((l) => completedDemoSet.has(String(l._id)) || l.currentStage === 'DEMO_COMPLETED');
    const demoToPurchase = demoLeads.filter(
      (l) => ['PURCHASE_INTEREST', 'READY_TO_BUY'].includes(l.intent || '') || ['CONVERSION_PENDING', 'PAYMENT_VERIFIED', 'CUSTOMER'].includes(l.currentStage)
    ).length;

    // Average time to demo / to conversion — from LeadEvent timestamps.
    const avgTimeToDemo = await avgGapDays('LEAD_CREATED', ['DEMO_SCHEDULED'], range);
    const avgTimeToConversion = await avgGapDays('LEAD_CREATED', ['CUSTOMER_ACTIVATED', 'PAYMENT_SUCCESS'], range);

    // No-show rate (of demos that had a scheduled slot).
    const [noShowCount, completedCount] = await Promise.all([
      DemoBooking.countDocuments({ status: 'No Show' }),
      DemoBooking.countDocuments({ status: { $in: ['Completed', 'No Show'] } }),
    ]);

    return NextResponse.json({
      success: true,
      range: { key: range.key, since: range.since, until: range.until },
      conversion: {
        leadToQualified: pct(qualified, leads),
        leadToDemo: pct(demoInterest, leads),
        leadToDemoScheduled: pct(demoScheduled, leads),
        demoToPurchase: demoLeads.length > 0 ? { value: Math.round((demoToPurchase / demoLeads.length) * 1000) / 10, num: demoToPurchase, den: demoLeads.length } : { value: null, unavailable: 'no completed demos yet' },
        leadToCustomer: pct(customers, leads),
        humanHandoffRate: pct(humanHandoffs, leads),
        optOutRate: pct(optedOut, leads),
        lostRate: pct(lost, leads),
        noShowRate: completedCount > 0 ? { value: Math.round((noShowCount / completedCount) * 1000) / 10, num: noShowCount, den: completedCount } : { value: null, unavailable: 'no demos held yet' },
        avgTimeToDemoDays: avgTimeToDemo,
        avgTimeToConversionDays: avgTimeToConversion,
      },
      agents: await agentPerformance(range),
    });
  } catch (error: any) {
    console.error('[admin/conversion/analytics] failed:', error);
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}

/**
 * Mean days between the FIRST `startType` event and the FIRST of `endTypes`
 * for each phone that has both, within the window. Returns
 * { value: null, unavailable } when there isn't enough data.
 */
async function avgGapDays(
  startType: string,
  endTypes: string[],
  range: { since: Date | null; until: Date | null }
): Promise<{ value: number | null; sampleSize?: number; unavailable?: string }> {
  const match: any = { type: { $in: [startType, ...endTypes] } };
  if (range.since || range.until) {
    match.createdAt = {};
    if (range.since) match.createdAt.$gte = range.since;
    if (range.until) match.createdAt.$lte = range.until;
  }
  const events = (await LeadEvent.find(match).select('type phone leadId createdAt').sort({ createdAt: 1 }).lean()) as any[];
  const byKey = new Map<string, { start?: Date; end?: Date }>();
  for (const e of events) {
    const key = e.leadId ? `l:${e.leadId}` : e.phone ? `p:${e.phone}` : null;
    if (!key) continue;
    const rec = byKey.get(key) || {};
    if (e.type === startType && !rec.start) rec.start = e.createdAt;
    if (endTypes.includes(e.type) && !rec.end) rec.end = e.createdAt;
    byKey.set(key, rec);
  }
  const gaps: number[] = [];
  for (const { start, end } of byKey.values()) {
    if (start && end && end >= start) gaps.push((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  }
  if (gaps.length < 3) return { value: null, unavailable: `only ${gaps.length} data points — need at least 3`, sampleSize: gaps.length };
  return { value: Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10, sampleSize: gaps.length };
}

/**
 * Outcome-oriented per-agent metrics. Derived from current Lead state +
 * DemoBooking + LeadEvent — deliberately NOT raw message counts.
 */
async function agentPerformance(range: { since: Date | null; until: Date | null }) {
  const dateF = createdAtFilter(range as any);

  const [
    salesActive,
    salesDemoGenerated,
    salesPurchaseIntent,
    salesConversions,
    salesHandoffs,
    salesOptOuts,
    inHouseCustomers,
  ] = await Promise.all([
    Lead.countDocuments(scoped({ currentAgent: 'SALES', currentStage: { $in: ['QUALIFYING', 'NURTURING'] } })),
    Lead.countDocuments(scoped({ ...dateF, $or: [{ currentStage: { $in: ['DEMO_REQUESTED', 'DEMO_SCHEDULED', 'DEMO_COMPLETED'] } }, { intent: 'DEMO_INTEREST' }] })),
    Lead.countDocuments(scoped({ ...FUNNEL_FILTERS.purchaseIntent })),
    Lead.countDocuments(scoped({ ...dateF, ...FUNNEL_FILTERS.customer })),
    LeadEvent.countDocuments({ type: 'HUMAN_HANDOFF', actor: 'sales-agent', ...(dateF.createdAt ? { createdAt: dateF.createdAt } : {}) }),
    LeadEvent.countDocuments({ type: 'OPT_OUT', ...(dateF.createdAt ? { createdAt: dateF.createdAt } : {}) }),
    Lead.countDocuments(scoped({ currentAgent: 'IN_HOUSE' })),
  ]);

  const demoAgg = await DemoBooking.aggregate([{ $group: { _id: '$status', c: { $sum: 1 } } }]);
  const dc = (s: string) => demoAgg.find((d: any) => d._id === s)?.c ?? 0;

  return {
    sales: {
      activeLeads: salesActive,
      demosGenerated: salesDemoGenerated,
      purchaseIntent: salesPurchaseIntent,
      conversions: salesConversions,
      humanHandoffs: salesHandoffs,
      optOuts: salesOptOuts,
    },
    demo: {
      requested: dc('Pending') + dc('Confirmed') + dc('Completed') + dc('Cancelled') + dc('No Show') + dc('Rescheduled'),
      scheduled: dc('Pending') + dc('Confirmed'),
      completed: dc('Completed'),
      cancelled: dc('Cancelled'),
      noShow: dc('No Show'),
      rescheduled: dc('Rescheduled'),
    },
    inHouse: {
      activatedCustomers: inHouseCustomers,
      onboardingActivity: { value: null, unavailable: 'in-house onboarding activity is not separately instrumented yet' },
    },
  };
}
