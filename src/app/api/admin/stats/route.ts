import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import User from '@/models/User';
import Business from '@/models/Business';
import ContentGenerationLog from '@/models/ContentGenerationLog';
import Lead from '@/models/Lead';

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Run all queries in parallel
    // Unclaimed shadow accounts (see src/lib/shadowAccount.ts) are excluded
    // from these platform-wide counts by default so lead-gen traffic
    // (/free-report) doesn't inflate real-signup numbers.
    const notShadow = { isShadowAccount: { $ne: true } };

    // Real tenant CRM leads only — excludes leadType:'Platform Prospect'
    // (GrowwMatics' own acquisition funnel), same scoping as /admin/crm.
    const clientLeads = { leadType: 'Client Prospect' };

    const [
      totalUsers,
      totalBusinesses,
      totalContentGenerated,
      recentSignups,
      newUsersLast7Days,
      newBusinessesLast7Days,
      totalLeads,
      newLeadsLast7Days,
    ] = await Promise.all([
      User.countDocuments({ role: { $ne: 'SUPER_ADMIN' }, ...notShadow }),
      Business.countDocuments(),
      ContentGenerationLog.countDocuments(),
      // Recent signups (last 10 users, non-super_admin)
      User.find({ role: { $ne: 'SUPER_ADMIN' }, ...notShadow })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('fullName email role createdAt subscriptionPlan')
        .lean(),
      User.countDocuments({
        role: { $ne: 'SUPER_ADMIN' },
        ...notShadow,
        createdAt: { $gte: sevenDaysAgo },
      }),
      Business.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      Lead.countDocuments(clientLeads),
      Lead.countDocuments({ ...clientLeads, createdAt: { $gte: sevenDaysAgo } }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          totalUsers,
          totalBusinesses,
          totalContentGenerated,
          newUsersLast7Days,
          newBusinessesLast7Days,
          totalLeads,
          newLeadsLast7Days,
        },
        recentSignups,
      },
    });
  } catch (error: any) {
    console.error('Admin Stats Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch admin stats' },
      { status: 500 }
    );
  }
}
