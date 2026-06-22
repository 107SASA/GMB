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

    const [
      totalLeads,
      newLeadsToday,
      convertedLeads,
      pipelineBreakdownRaw,
      recentLeadsRaw,
      topBusinessesRaw,
    ] = await Promise.all([
      Lead.countDocuments(),
      Lead.countDocuments({ createdAt: { $gte: todayStart } }),
      Lead.countDocuments({ pipelineStage: 'Converted' }),

      Lead.aggregate([
        { $group: { _id: '$pipelineStage', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      Lead.find()
        .sort({ createdAt: -1 })
        .limit(20)
        .select('businessId name source pipelineStage aiLeadScore createdAt')
        .lean(),

      Lead.aggregate([
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

    const recentLeads = recentLeadsRaw.map((l: any) => ({
      _id: l._id,
      businessName: bizMap[l.businessId?.toString()] ?? 'Unknown',
      name: l.name,
      source: l.source,
      pipelineStage: l.pipelineStage ?? 'None',
      aiLeadScore: l.aiLeadScore ?? null,
      createdAt: l.createdAt,
    }));

    const topBusinessesByLeads = topBusinessesRaw.map((r: any) => ({
      businessId: r._id?.toString(),
      businessName: bizMap[r._id?.toString()] ?? 'Unknown',
      totalLeads: r.totalLeads,
    }));

    const pipelineBreakdown = pipelineBreakdownRaw.map((r: any) => ({
      stage: r._id ?? 'None',
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
