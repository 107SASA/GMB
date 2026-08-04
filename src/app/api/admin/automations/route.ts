import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import AutomationLog from '@/models/AutomationLog';

export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const workflow = searchParams.get('workflow');

    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    // Build filter. Filters by `workflow` (e.g. "content-scheduler",
    // "publish-cron") — the value an admin actually recognizes — not the raw
    // `type` enum ('scheduler'/'ai_generation'/'inngest_job'/'other'), which
    // is too coarse to be a useful admin-panel filter.
    const filter: any = {};
    if (status && status !== 'all') filter.status = status;
    if (workflow && workflow !== 'all') filter.workflow = workflow;

    const [
      totalRuns,
      successCount,
      failedCount,
      failedToday,
      recentLogs,
      byWorkflow,
    ] = await Promise.all([
      AutomationLog.countDocuments(),
      AutomationLog.countDocuments({ status: 'success' }),
      AutomationLog.countDocuments({ status: 'failed' }),
      AutomationLog.countDocuments({
        status: 'failed',
        createdAt: { $gte: twentyFourHoursAgo },
      }),
      AutomationLog.find(filter)
        .sort({ createdAt: -1 })
        .limit(50)
        .select('workflow action type status message error businessId createdAt duration')
        .lean(),
      AutomationLog.aggregate([
        { $group: { _id: '$workflow', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
    ]);

    const successRate = totalRuns > 0 ? Math.round((successCount / totalRuns) * 100) : 0;

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          totalRuns,
          successCount,
          failedCount,
          failedToday,
          successRate,
        },
        byWorkflow,
        recentLogs,
      },
    });
  } catch (error: any) {
    console.error('Automations Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch automations data' },
      { status: 500 }
    );
  }
}