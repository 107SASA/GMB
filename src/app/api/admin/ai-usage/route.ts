import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import AIUsageLog from '@/models/AIUsageLog';
import ContentGenerationLog from '@/models/ContentGenerationLog';
import MessageQueue from '@/models/MessageQueue';
import AutomationLog from '@/models/AutomationLog';
import User from '@/models/User';

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const tab  = searchParams.get('tab') || 'ai';
    const range = searchParams.get('range') || '7';
    const days  = Math.min(90, Math.max(1, parseInt(range)));

    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    // ── API USAGE TAB ─────────────────────────────────────────────────────────
    if (tab === 'api') {
      const [groqTotal, groqTokensAgg, groqCostAgg, groqByDay,
             twilioSent, twilioFailed, twilioPending, twilioByDay,
             serpCount] = await Promise.all([
        AIUsageLog.countDocuments({ createdAt: { $gte: since }, aiModel: { $regex: /groq/i } }),
        AIUsageLog.aggregate([
          { $match: { createdAt: { $gte: since }, aiModel: { $regex: /groq/i } } },
          { $group: { _id: null, total: { $sum: '$tokensUsed' } } },
        ]),
        AIUsageLog.aggregate([
          { $match: { createdAt: { $gte: since }, aiModel: { $regex: /groq/i } } },
          { $group: { _id: null, total: { $sum: '$estimatedCost' } } },
        ]),
        AIUsageLog.aggregate([
          { $match: { createdAt: { $gte: since }, aiModel: { $regex: /groq/i } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, calls: { $sum: 1 }, tokens: { $sum: '$tokensUsed' } } },
          { $sort: { _id: 1 } },
        ]),
        MessageQueue.countDocuments({ createdAt: { $gte: since }, direction: 'OUTBOUND', status: 'SENT' }),
        MessageQueue.countDocuments({ createdAt: { $gte: since }, direction: 'OUTBOUND', status: 'FAILED' }),
        MessageQueue.countDocuments({ createdAt: { $gte: since }, direction: 'OUTBOUND', status: 'PENDING' }),
        MessageQueue.aggregate([
          { $match: { createdAt: { $gte: since }, direction: 'OUTBOUND' } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, sent: { $sum: { $cond: [{ $eq: ['$status', 'SENT'] }, 1, 0] } }, failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } }, pending: { $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] } } } },
          { $sort: { _id: 1 } },
        ]),
        AutomationLog.countDocuments({
          createdAt: { $gte: since },
          $or: [{ workflow: { $regex: /serp/i } }, { action: { $regex: /serp/i } }],
        }),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          groq: {
            tracked: true,
            calls:   groqTotal,
            tokens:  groqTokensAgg[0]?.total ?? 0,
            cost:    Math.round((groqCostAgg[0]?.total ?? 0) * 10000) / 10000,
            byDay:   groqByDay,
          },
          twilio: {
            tracked: true,
            sent:    twilioSent,
            failed:  twilioFailed,
            pending: twilioPending,
            total:   twilioSent + twilioFailed + twilioPending,
            byDay:   twilioByDay,
          },
          serp: {
            tracked: serpCount > 0,
            calls:   serpCount,
            note: serpCount === 0
              ? 'No SerpApi entries found in AutomationLog for this period. Dedicated SerpApi log tracking is not yet configured.'
              : null,
          },
          googlePlaces: {
            tracked: false,
            note: 'Google Places API tracking requires a dedicated PlacesAPILog model. Not yet configured.',
          },
        },
      });
    }

    // ── AI USAGE TAB (original logic, unchanged) ──────────────────────────────
    const [totalGenerations, totalTokensAgg, totalCostAgg, failedCount, contentLogCount] =
      await Promise.all([
        AIUsageLog.countDocuments(),
        AIUsageLog.aggregate([{ $group: { _id: null, total: { $sum: '$tokensUsed' } } }]),
        AIUsageLog.aggregate([{ $group: { _id: null, total: { $sum: '$estimatedCost' } } }]),
        AIUsageLog.countDocuments({ status: 'failed' }),
        ContentGenerationLog.countDocuments(),
      ]);

    const totalTokens = totalTokensAgg[0]?.total ?? 0;
    const totalCost   = totalCostAgg[0]?.total   ?? 0;

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

    const dailyRaw = await AIUsageLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id:         { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          generations: { $sum: 1 },
          tokens:      { $sum: '$tokensUsed' },
          cost:        { $sum: '$estimatedCost' },
          failed:      { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

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

    const topUserIds  = topUsersRaw.map(u => u._id);
    const topUserDocs = await User.find({ _id: { $in: topUserIds } })
      .select('fullName email subscriptionPlan')
      .lean();
    const userMap: Record<string, any> = {};
    topUserDocs.forEach((u: any) => { userMap[u._id.toString()] = u; });

    const topUsers = topUsersRaw.map(u => ({
      userId:        u._id,
      fullName:      userMap[u._id.toString()]?.fullName        ?? 'Unknown',
      email:         userMap[u._id.toString()]?.email           ?? '—',
      plan:          userMap[u._id.toString()]?.subscriptionPlan ?? 'Free',
      generations:   u.generations,
      tokens:        u.tokens,
      estimatedCost: u.cost,
    }));

    const promptBreakdown = await AIUsageLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id:    '$promptType',
          count:  { $sum: 1 },
          tokens: { $sum: '$tokensUsed' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]);

    const recentActivity = await AIUsageLog.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('userId', 'fullName email')
      .lean();

    return NextResponse.json({
      success: true,
      data: {
        overview: {
          totalGenerations:  totalGenerations + contentLogCount,
          totalTokens,
          totalCost:         Math.round(totalCost * 10000) / 10000,
          failedGenerations: failedCount,
          successRate:
            totalGenerations > 0
              ? Math.round(((totalGenerations - failedCount) / totalGenerations) * 100)
              : 100,
        },
        period: {
          days,
          generations: periodGenerations,
          tokens:      periodTokensAgg[0]?.total ?? 0,
          cost:        Math.round((periodCostAgg[0]?.total ?? 0) * 10000) / 10000,
          failedCount: periodFailed,
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
