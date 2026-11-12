import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import User from '@/models/User';
import Business from '@/models/Business';
import ContentGenerationLog from '@/models/ContentGenerationLog';
import Lead from '@/models/Lead';
import { workspaceStatusCounts } from '@/services/admin/platformMetrics';
import { realUserFilter, workspacePlanLabel, CUSTOMER_STATUSES } from '@/lib/admin/realAccounts';

async function withWorkspacePlan(users: any[]): Promise<any[]> {
  const biz: any[] = await Business.find({ userId: { $in: users.map((u) => u._id) }, subscriptionStatus: { $in: [...CUSTOMER_STATUSES] } }).select('userId subscriptionStatus').lean();
  const rank = (s: string) => (CUSTOMER_STATUSES as readonly string[]).indexOf(s);
  return users.map((u) => {
    const best = biz.filter((b) => String(b.userId) === String(u._id)).sort((a, b) => rank(a.subscriptionStatus) - rank(b.subscriptionStatus))[0];
    return { ...u, workspacePlan: workspacePlanLabel(best?.subscriptionStatus) };
  });
}

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
    // …unless they became customers (trial, paid or past due) — see realAccounts.ts.
    const notShadow = await realUserFilter();

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
      statuses,
    ] = await Promise.all([
      User.countDocuments({ role: { $nin: ['SUPER_ADMIN', 'GROWTH_PARTNER', 'TEAM_MEMBER'] }, ...notShadow }),
      Business.countDocuments(),
      ContentGenerationLog.countDocuments(),
      // Recent signups (last 10 users, non-super_admin)
      User.find({ role: { $nin: ['SUPER_ADMIN', 'GROWTH_PARTNER', 'TEAM_MEMBER'] }, ...notShadow })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('fullName email role createdAt subscriptionPlan')
        .lean(),
      User.countDocuments({
        role: { $nin: ['SUPER_ADMIN', 'GROWTH_PARTNER', 'TEAM_MEMBER'] },
        ...notShadow,
        createdAt: { $gte: sevenDaysAgo },
      }),
      Business.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      Lead.countDocuments(clientLeads),
      Lead.countDocuments({ ...clientLeads, createdAt: { $gte: sevenDaysAgo } }),
      workspaceStatusCounts(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          totalUsers,
          totalBusinesses,
          // Paying + authorised free trials (same status definitions as /admin/revenue).
          activeBusinesses: statuses.active + statuses.trialActive,
          payingBusinesses: statuses.active,
          trialBusinesses: statuses.trialActive,
          totalContentGenerated,
          newUsersLast7Days,
          newBusinessesLast7Days,
          totalLeads,
          newLeadsLast7Days,
        },
        // Each signup's real plan state from their workspace ("Free trial", "Paid"…).
        recentSignups: await withWorkspacePlan(recentSignups as any[]),
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
