import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import Lead from '@/models/Lead';
import Business from '@/models/Business';

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Scope every query to real tenant CRM leads only. leadType:'Platform
    // Prospect' is GrowwMatics' own acquisition funnel (free-report/book-demo
    // signups, see /admin/leads "GrowwMatics Pipeline") — mixing it in here
    // would inflate/distort what's meant to be customer-lead activity.
    const clientLeads = { leadType: 'Client Prospect' };

    const [
      totalLeads,
      newLeadsToday,
      convertedLeads,
      pipelineBreakdownRaw,
      recentLeadsRaw,
      topBusinessesRaw,
    ] = await Promise.all([
      Lead.countDocuments(clientLeads),
      Lead.countDocuments({ ...clientLeads, createdAt: { $gte: todayStart } }),
      // Conversion lives in lifeCycleStage ('initial'|'active'|'converted'|
      // 'closed'), the fixed field every lead-creation path sets. pipelineStage
      // is a legacy/optional per-business free-Kanban field — most leads have
      // it null, so counting 'Converted' there undercounts almost to zero.
      Lead.countDocuments({ ...clientLeads, lifeCycleStage: 'converted' }),

      Lead.aggregate([
        { $match: clientLeads },
        { $group: { _id: '$lifeCycleStage', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      Lead.find(clientLeads)
        .sort({ createdAt: -1 })
        .limit(20)
        .select('businessId name source lifeCycleStage aiLeadScore createdAt')
        .lean(),

      Lead.aggregate([
        { $match: clientLeads },
        { $group: { _id: '$businessId', totalLeads: { $sum: 1 } } },
        { $sort: { totalLeads: -1 } },
        { $limit: 5 },
      ]),
    ]);

    // Populate business names
    const allBizIds = [
      ...new Set([
        ...recentLeadsRaw.map((l: any) => l.businessId?.toString()),
        ...topBusinessesRaw.map((r: any) => r._id?.toString()),
      ]),
    ].filter(Boolean);

    const businesses = await Business.find({ _id: { $in: allBizIds } })
      .select('businessName')
      .lean();
    const bizMap: Record<string, string> = {};
    businesses.forEach((b: any) => { bizMap[b._id.toString()] = b.businessName; });

    const LIFECYCLE_LABELS: Record<string, string> = {
      initial: 'Open',
      active: 'Active',
      converted: 'Converted',
      closed: 'Closed',
    };

    const recentLeads = recentLeadsRaw.map((l: any) => ({
      _id: l._id,
      businessName: bizMap[l.businessId?.toString()] ?? 'Unknown',
      name: l.name,
      source: l.source,
      pipelineStage: LIFECYCLE_LABELS[l.lifeCycleStage] ?? 'Open',
      aiLeadScore: l.aiLeadScore ?? null,
      createdAt: l.createdAt,
    }));

    const topBusinessesByLeads = topBusinessesRaw.map((r: any) => ({
      businessId: r._id?.toString(),
      businessName: bizMap[r._id?.toString()] ?? 'Unknown',
      totalLeads: r.totalLeads,
    }));

    // Grouped by lifeCycleStage (fixed 4-value enum) rather than the
    // business-customizable subStage/pipelineStage labels, so this chart
    // stays meaningful across tenants that name their own stages differently.
    const pipelineBreakdown = pipelineBreakdownRaw.map((r: any) => ({
      stage: LIFECYCLE_LABELS[r._id] ?? 'Open',
      count: r.count,
    }));

    const conversionRate =
      totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100 * 10) / 10 : 0;

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          totalLeads,
          newLeadsToday,
          convertedLeads,
          conversionRate,
        },
        pipelineBreakdown,
        recentLeads,
        topBusinessesByLeads,
      },
    });
  } catch (error: any) {
    console.error('CRM Monitor Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch CRM data' },
      { status: 500 }
    );
  }
}
