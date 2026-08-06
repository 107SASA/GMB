import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import Subscription from '@/models/Subscription';
import User from '@/models/User';
import Business from '@/models/Business';
import SubscriptionUsage from '@/models/SubscriptionUsage';
import AIUsageLog from '@/models/AIUsageLog';
import PlanConfig from '@/models/PlanConfig';
import { getPlanDefaults } from '@/lib/planDefaults';

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const page   = Math.max(1, parseInt(searchParams.get('page')  || '1'));
    const limit  = Math.min(50, parseInt(searchParams.get('limit') || '20'));
    const search = searchParams.get('search') || '';
    const plan   = searchParams.get('plan')   || 'all';   // all | Free | Pro | Enterprise
    const status = searchParams.get('status') || 'all';   // all | Active | Trialing | PastDue | Canceled
    const skip   = (page - 1) * limit;

    // ── 1. OVERVIEW COUNTS ────────────────────────────────────────────────────
    const [freeCount, proCount, enterpriseCount, trialingCount, activeCount, canceledCount] =
      await Promise.all([
        Subscription.countDocuments({ planType: 'Free' }),
        Subscription.countDocuments({ planType: 'Pro' }),
        Subscription.countDocuments({ planType: 'Enterprise' }),
        Subscription.countDocuments({ billingStatus: 'Trialing' }),
        Subscription.countDocuments({ billingStatus: 'Active' }),
        Subscription.countDocuments({ billingStatus: 'Canceled' }),
      ]);

    // ── 2. BUILD QUERY ────────────────────────────────────────────────────────
    const subQuery: any = {};
    if (plan   !== 'all') subQuery.planType      = plan;
    if (status !== 'all') subQuery.billingStatus = status;

    // Search is done on User fields — find matching userIds first
    let filteredUserIds: any[] | null = null;
    if (search.trim()) {
      const matchingUsers = await User.find({
        $or: [
          { fullName: { $regex: search.trim(), $options: 'i' } },
          { email:    { $regex: search.trim(), $options: 'i' } },
        ],
        role: { $ne: 'SUPER_ADMIN' },
      })
        .select('_id')
        .lean();
      filteredUserIds = matchingUsers.map((u: any) => u._id);
      subQuery.userId = { $in: filteredUserIds };
    }

    const [subscriptions, total] = await Promise.all([
      Subscription.find(subQuery)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'fullName email phone subscriptionPlan createdAt lastLoginAt')
        .lean(),
      Subscription.countDocuments(subQuery),
    ]);

    // ── 3. ENRICH WITH USAGE DATA ─────────────────────────────────────────────
    // Sourced from the same models the customer-facing billing page reads
    // (SubscriptionUsage + AIUsageLog — see /api/user/usage), not the legacy
    // per-user UsageTracking collection this route used before. UsageTracking
    // isn't written to by any current feature, so this admin table was
    // showing stale/zero numbers that didn't match what customers actually
    // saw on their own billing page.
    const userIds = subscriptions.map((s: any) => s.userId?._id).filter(Boolean);
    const month = new Date().toISOString().slice(0, 7);
    const startOfMonth = new Date(`${month}-01T00:00:00.000Z`);
    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setUTCMonth(endOfMonth.getUTCMonth() + 1);

    const [ownedBusinesses, aiCounts, planConfigs] = await Promise.all([
      Business.find({ userId: { $in: userIds } }).select('_id userId').lean(),
      AIUsageLog.aggregate([
        { $match: { userId: { $in: userIds }, status: 'success', createdAt: { $gte: startOfMonth, $lt: endOfMonth } } },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
      ]),
      PlanConfig.find({}).lean(),
    ]);

    const businessIdsByUser: Record<string, string[]> = {};
    ownedBusinesses.forEach((b: any) => {
      const key = b.userId?.toString();
      if (!key) return;
      (businessIdsByUser[key] ??= []).push(b._id.toString());
    });
    const allBusinessIds = ownedBusinesses.map((b: any) => b._id);

    const subUsageRecords = allBusinessIds.length
      ? await SubscriptionUsage.find({ businessId: { $in: allBusinessIds }, month }).lean()
      : [];
    const subUsageByBusiness: Record<string, any> = {};
    subUsageRecords.forEach((u: any) => { subUsageByBusiness[u.businessId.toString()] = u; });

    const aiCountByUser: Record<string, number> = {};
    aiCounts.forEach((row: any) => { aiCountByUser[row._id.toString()] = row.count; });

    const planConfigByName: Record<string, any> = {};
    planConfigs.forEach((c: any) => { planConfigByName[c.plan] = c; });

    const usageMap: Record<string, any> = {};
    subscriptions.forEach((sub: any) => {
      const userId = sub.userId?._id?.toString();
      if (!userId || usageMap[userId]) return;

      const businessIds = businessIdsByUser[userId] ?? [];
      const totals = businessIds.reduce(
        (acc, bId) => {
          const u = subUsageByBusiness[bId];
          if (u) {
            acc.postsUsed += u.postsUsed ?? 0;
            acc.whatsappMessagesUsed += u.whatsappMessagesUsed ?? 0;
            acc.reviewRequestsUsed += u.reviewRequestsUsed ?? 0;
          }
          return acc;
        },
        { postsUsed: 0, whatsappMessagesUsed: 0, reviewRequestsUsed: 0 }
      );

      let planName = sub.userId?.subscriptionPlan || 'Free';
      if (planName === 'Enterprise') planName = 'Pro'; // legacy paid tier → THE paid plan
      const limits = planConfigByName[planName] ?? getPlanDefaults(planName);

      usageMap[userId] = {
        aiGenerations:      aiCountByUser[userId] ?? 0,
        aiGenerationsLimit: limits.maxAIGenerations ?? 0,
        whatsappMessages:   totals.whatsappMessagesUsed,
        reviewRequests:     totals.reviewRequestsUsed,
        contentUsage:       totals.postsUsed,
      };
    });

    const enriched = subscriptions.map((sub: any) => {
      const userId = sub.userId?._id?.toString();
      const usage  = userId ? usageMap[userId] : null;
      return {
        _id:           sub._id,
        planType:      sub.planType,
        billingStatus: sub.billingStatus,
        trialStatus:   sub.trialStatus,
        modules:       sub.modules,
        createdAt:     sub.createdAt,
        updatedAt:     sub.updatedAt,
        user: sub.userId
          ? {
              _id:              sub.userId._id,
              fullName:         sub.userId.fullName,
              email:            sub.userId.email,
              phone:            sub.userId.phone,
              subscriptionPlan: sub.userId.subscriptionPlan,
              joinedAt:         sub.userId.createdAt,
              lastLoginAt:      sub.userId.lastLoginAt,
            }
          : null,
        usage,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        overview: {
          total: freeCount + proCount + enterpriseCount,
          byPlan:   { Free: freeCount, Pro: proCount, Enterprise: enterpriseCount },
          byStatus: { Active: activeCount, Trialing: trialingCount, Canceled: canceledCount },
        },
        subscriptions: enriched,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: any) {
    console.error('Admin Subscriptions Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch subscriptions' },
      { status: 500 }
    );
  }
}
