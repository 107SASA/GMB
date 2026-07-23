import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import JobQueue from '@/models/JobQueue';
import MessageQueue from '@/models/MessageQueue';
import AutomationLog from '@/models/AutomationLog';
import mongoose from 'mongoose';
import { getProviderHealth } from '@/lib/providerHealth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const [
      dbPing,
      pendingJobs,
      failedJobs24h,
      messageBacklog,
      recentErrors,
      providers,
    ] = await Promise.all([
      mongoose.connection.db?.command({ ping: 1 }).then(() => true).catch(() => false),
      JobQueue.countDocuments({ status: 'PENDING' }),
      AutomationLog.countDocuments({
        status: 'failed',
        createdAt: { $gte: twentyFourHoursAgo },
      }),
      MessageQueue.countDocuments({ status: 'PENDING' }),
      AutomationLog.find({ status: 'failed' })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('workflow action error message businessId createdAt')
        .lean(),
      getProviderHealth(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        database: { status: dbPing ? 'healthy' : 'down' },
        jobs: { pendingJobs, failedJobs24h },
        messages: { messageBacklog },
        recentErrors,
        providers,
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('System Health Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch system health' },
      { status: 500 }
    );
  }
}