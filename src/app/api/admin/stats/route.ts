import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import User from '@/models/User';
import Business from '@/models/Business';
import ContentGenerationLog from '@/models/ContentGenerationLog';

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
    const [
      totalUsers,
      totalBusinesses,
      totalContentGenerated,
      recentSignups,
      newUsersLast7Days,
      newBusinessesLast7Days,
    ] = await Promise.all([
      User.countDocuments({ role: { $ne: 'super_admin' } }),
      Business.countDocuments(),
      ContentGenerationLog.countDocuments(),
      // Recent signups (last 10 users, non-super_admin)
      User.find({ role: { $ne: 'super_admin' } })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('fullName email role createdAt subscriptionPlan')
        .lean(),
      User.countDocuments({
        role: { $ne: 'super_admin' },
        createdAt: { $gte: sevenDaysAgo },
      }),
      Business.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
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
