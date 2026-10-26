import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import Lead from '@/models/Lead';
import Business from '@/models/Business';
import mongoose from 'mongoose';

/** Midnight in India (where the customers are), not the server's UTC midnight. */
function startOfTodayIst(now = new Date()): Date {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 330 * 60_000);
}

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const todayStart = startOfTodayIst();

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
        // A lead without a stage is Open, the same as 'initial' — one bar, not two.
        { $group: { _id: { $ifNull: ['$lifeCycleStage', 'initial'] }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      Lead.find(clientLeads)
        .sort({ createdAt: -1 })
        .limit(20)
        .select('businessId tenantId name source lifeCycleStage aiLeadScore createdAt')
        .lean(),

      Lead.aggregate([
        { $match: clientLeads },
        // Older leads carry only their workspace id (tenantId), not businessId.
        { $group: { _id: { $ifNull: ['$businessId', '$tenantId'] }, totalLeads: { $sum: 1 } } },
        { $sort: { totalLeads: -1 } },
        { $limit: 50 },
      ]),
    ]);

    // Business names. A lead links its business by businessId; older ones
    // only by tenantId, which is the business id or its organization id.
    const keyOf = (l: any) => (l.businessId ?? l.tenantId)?.toString();
    const allKeys = [
      ...new Set([
        ...recentLeadsRaw.map(keyOf),
        ...topBusinessesRaw.map((r: any) => r._id?.toString()),
      ]),
    ].filter((id): id is string => !!id && mongoose.isValidObjectId(id));

    const businesses = await Business.find({ $or: [{ _id: { $in: allKeys } }, { organizationId: { $in: allKeys } }] })
      .select('name organizationId')
      .lean();
    const bizMap: Record<string, string> = {};
    const bizIdOf: Record<string, string> = {};
    // The stored field is `name` (reading `businessName` left every name blank).
    businesses.forEach((b: any) => {
      bizMap[b._id.toString()] = b.name;
      bizIdOf[b._id.toString()] = b._id.toString();
      const org = b.organizationId?.toString();
      if (org && !bizMap[org]) { bizMap[org] = b.name; bizIdOf[org] = b._id.toString(); }
    });

    const LIFECYCLE_LABELS: Record<string, string> = {
      initial: 'Open',
      active: 'Active',
      converted: 'Converted',
      closed: 'Closed',
    };

    const recentLeads = recentLeadsRaw.map((l: any) => ({
      _id: l._id,
      businessName: bizMap[keyOf(l)] ?? 'Unknown',
      name: l.name,
      source: l.source,
      pipelineStage: LIFECYCLE_LABELS[l.lifeCycleStage] ?? 'Open',
      aiLeadScore: l.aiLeadScore ?? null,
      createdAt: l.createdAt,
    }));

    // One row per business, whichever id its leads were linked by.
    const byBusiness = new Map<string, { businessId: string; businessName: string; totalLeads: number }>();
    for (const r of topBusinessesRaw as any[]) {
      const key = r._id?.toString() || 'unknown';
      const id = bizIdOf[key] || key;
      const row = byBusiness.get(id) || { businessId: id, businessName: bizMap[key] ?? 'Unknown', totalLeads: 0 };
      row.totalLeads += r.totalLeads;
      byBusiness.set(id, row);
    }
    const topBusinessesByLeads = [...byBusiness.values()].sort((a, b) => b.totalLeads - a.totalLeads).slice(0, 5);

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
