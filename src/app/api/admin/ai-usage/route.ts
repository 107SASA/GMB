import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import AIUsageLog from '@/models/AIUsageLog';
import ContentGenerationLog from '@/models/ContentGenerationLog';
import User from '@/models/User';

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const range = searchParams.get('range') || '7'; // days
    const days = Math.min(90, Math.max(1, parseInt(range)));

    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    // ── 1. OVERVIEW STATS ────────────────────────────────────────────────────
    const [
      totalGenerations,
      totalTokensAgg,
      totalCostAgg,
      failedCount,
      contentLogCount,
    ] = await Promise.all([
      AIUsageLog.countDocuments(),
      AIUsageLog.aggregate([
        { $group: { _id: null, total: { $sum: '$tokensUsed' } } },
      ]),
      AIUsageLog.aggregate([
        { $group: { _id: null, total: { $sum: '$estimatedCost' } } },
      ]),
      AIUsageLog.countDocuments({ status: 'failed' }),
      ContentGenerationLog.countDocuments(),
    ]);

    const totalTokens  = totalTokensAgg[0]?.total  ?? 0;
    const totalCost    = totalCostAgg[0]?.total     ?? 0;

    // ── 2. PERIOD STATS (within selected range) ───────────────────────────────
    const [periodGenerations, periodTokensAgg, periodCostAgg, periodFailed] =
      await Promise.all([
        AIUsageLog.countDocuments({ createdAt: { $gte: since } }),
        AIUsageLog.aggregate([
          { $match: { createdAt: { $gte: since } } },
          { $group: { _id: null, total: { $sum: '$tokensUsed' } } },
        ]),
        AIUsageLog.aggregate([
          { $match: { createdAt: { $gte: since } } },
          { $group: { _id: null, total: { $sum: '$estimatedCost' } } },
        ]),
        AIUsageLog.countDocuments({ status: 'failed', createdAt: { $gte: since } }),
      ]);

    // ── 3. DAILY BREAKDOWN ────────────────────────────────────────────────────
    const dailyRaw = await AIUsageLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          generations: { $sum: 1 },
          tokens:       { $sum: '$tokensUsed' },
          cost:         { $sum: '$estimatedCost' },
          failed:       { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Fill gaps so the chart has every day
    const dailyMap: Record<string, any> = {};
    dailyRaw.forEach(d => { dailyMap[d._id] = d; });
    const dailyStats = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      dailyStats.push({
        date:        key,
        generations: dailyMap[key]?.generations ?? 0,
        tokens:      dailyMap[key]?.tokens      ?? 0,
        cost:        dailyMap[key]?.cost        ?? 0,
        failed:      dailyMap[key]?.failed      ?? 0,
      });
    }

    // ── 4. TOP USERS ──────────────────────────────────────────────────────────
    const topUsersRaw = await AIUsageLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id:         '$userId',
          generations: { $sum: 1 },
          tokens:      { $sum: '$tokensUsed' },
          cost:        { $sum: '$estimatedCost' },
        },
      },
      { $sort: { generations: -1 } },
      { $limit: 10 },
    ]);

    const topUserIds = topUsersRaw.map(u => u._id);
    const topUserDocs = await User.find({ _id: { $in: topUserIds } })
      .select('fullName email subscriptionPlan')
      .lean();
    const userMap: Record<string, any> = {};
    topUserDocs.forEach((u: any) => { userMap[u._id.toString()] = u; });

    const topUsers = topUsersRaw.map(u => ({
      userId:          u._id,
      fullName:        userMap[u._id.toString()]?.fullName   ?? 'Unknown',
      email:           userMap[u._id.toString()]?.email      ?? '—',
      plan:            userMap[u._id.toString()]?.subscriptionPlan ?? 'Free',
      generations:     u.generations,
      tokens:          u.tokens,
      estimatedCost:   u.cost,
    }));

    // ── 5. PROMPT TYPE BREAKDOWN ──────────────────────────────────────────────
    const promptBreakdown = await AIUsageLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id:         '$promptType',
          count:       { $sum: 1 },
          tokens:      { $sum: '$tokensUsed' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]);

    // ── 6. RECENT AI ACTIVITY ─────────────────────────────────────────────────
    const recentActivity = await AIUsageLog.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('userId', 'fullName email')
      .lean();

    return NextResponse.json({
      success: true,
      data: {
        overview: {
          totalGenerations:   totalGenerations + contentLogCount,
          totalTokens,
          totalCost:          Math.round(totalCost * 10000) / 10000,
          failedGenerations:  failedCount,
          successRate:
            totalGenerations > 0
              ? Math.round(((totalGenerations - failedCount) / totalGenerations) * 100)
              : 100,
        },
        period: {
          days,
          generations:    periodGenerations,
          tokens:         periodTokensAgg[0]?.total ?? 0,
          cost:           Math.round((periodCostAgg[0]?.total ?? 0) * 10000) / 10000,
          failedCount:    periodFailed,
        },
        dailyStats,
        topUsers,
        promptBreakdown,
        recentActivity: recentActivity.map((log: any) => ({
          _id:           log._id,
          userId:        log.userId?._id,
          userName:      log.userId?.fullName ?? 'Unknown',
          userEmail:     log.userId?.email    ?? '—',
          promptType:    log.promptType,
          aiModel:       log.aiModel,
          tokensUsed:    log.tokensUsed,
          estimatedCost: log.estimatedCost,
          status:        log.status,
          createdAt:     log.createdAt,
        })),
      },
    });
  } catch (error: any) {
    console.error('Admin AI Usage Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch AI usage data' },
      { status: 500 }
    );
  }
}
