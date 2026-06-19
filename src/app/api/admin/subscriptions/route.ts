import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import Subscription from '@/models/Subscription';
import User from '@/models/User';
import UsageTracking from '@/models/UsageTracking';

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
        role: { $ne: 'super_admin' },
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
    const userIds = subscriptions.map((s: any) => s.userId?._id).filter(Boolean);
    const usageRecords = await UsageTracking.find({ userId: { $in: userIds } })
      .sort({ billingPeriodStart: -1 })
      .lean();

    // Keep latest usage record per user
    const usageMap: Record<string, any> = {};
    usageRecords.forEach((u: any) => {
      const key = u.userId.toString();
      if (!usageMap[key]) usageMap[key] = u;
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
        usage: usage
          ? {
              aiGenerations:     usage.metrics?.aiGenerations     ?? 0,
              aiGenerationsLimit:usage.limits?.aiGenerations      ?? 0,
              whatsappMessages:  usage.metrics?.whatsappMessages  ?? 0,
              reviewRequests:    usage.metrics?.reviewRequests    ?? 0,
              contentUsage:      usage.metrics?.contentUsage      ?? 0,
            }
          : null,
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
