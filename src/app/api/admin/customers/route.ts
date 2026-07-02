import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import User from '@/models/User';
import Business from '@/models/Business';
import Subscription from '@/models/Subscription';

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const page   = Math.max(1, parseInt(searchParams.get('page')  || '1'));
    const limit  = Math.min(50, parseInt(searchParams.get('limit') || '20'));
    const search = searchParams.get('search') || '';
    const plan   = searchParams.get('plan')   || 'all';
    const status = searchParams.get('status') || 'all';
    const skip   = (page - 1) * limit;

    const query: any = { role: { $ne: 'SUPER_ADMIN' } };

    if (search.trim()) {
      query.$or = [
        { fullName: { $regex: search.trim(), $options: 'i' } },
        { email:    { $regex: search.trim(), $options: 'i' } },
      ];
    }

    if (plan !== 'all') {
      query.subscriptionPlan = plan;
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('fullName email phone subscriptionPlan createdAt onboardingCompleted businessIds activeBusinessId')
        .lean(),
      User.countDocuments(query),
    ]);

    const userIds     = users.map((u: any) => u._id);
    const businessIds = users.map((u: any) => u.activeBusinessId).filter(Boolean);

    const [businesses, subscriptions] = await Promise.all([
      Business.find({ userId: { $in: userIds } })
        .select('userId name category address city')
        .lean(),
      Subscription.find({ userId: { $in: userIds } })
        .select('userId planType billingStatus trialStatus')
        .lean(),
    ]);

    const businessMap: Record<string, any> = {};
    businesses.forEach((b: any) => {
      if (b.userId) businessMap[b.userId.toString()] = b;
    });

    const subscriptionMap: Record<string, any> = {};
    subscriptions.forEach((s: any) => {
      subscriptionMap[s.userId.toString()] = s;
    });

    let enriched = users.map((u: any) => {
      const uid = u._id.toString();
      const sub = subscriptionMap[uid];
      const biz = businessMap[uid];

      const isActive = sub
        ? sub.billingStatus === 'Active' || sub.billingStatus === 'Trialing'
        : true;

      return {
        _id:              uid,
        fullName:         u.fullName,
        email:            u.email,
        phone:            u.phone,
        createdAt:        u.createdAt,
        subscriptionPlan: u.subscriptionPlan || 'Free',
        onboardingCompleted: u.onboardingCompleted,
        business: biz
          ? { _id: biz._id, name: biz.name, category: biz.category, address: biz.address, city: biz.city }
          : null,
        subscription: sub
          ? { planType: sub.planType, billingStatus: sub.billingStatus, trialActive: sub.trialStatus?.isActive }
          : null,
        isActive,
      };
    });

    if (status === 'active') {
      enriched = enriched.filter(u => u.isActive);
    } else if (status === 'inactive') {
      enriched = enriched.filter(u => !u.isActive);
    }

    // Stats
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [newThisWeek, proCount, enterpriseCount] = await Promise.all([
      User.countDocuments({ role: { $ne: 'SUPER_ADMIN' }, createdAt: { $gte: sevenDaysAgo } }),
      User.countDocuments({ role: { $ne: 'SUPER_ADMIN' }, subscriptionPlan: 'Pro' }),
      User.countDocuments({ role: { $ne: 'SUPER_ADMIN' }, subscriptionPlan: 'Enterprise' }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        users: enriched,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        stats: {
          totalUsers:      total,
          newThisWeek,
          proUsers:        proCount,
          enterpriseUsers: enterpriseCount,
        },
      },
    });
  } catch (error: any) {
    console.error('Admin Customers Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch customers' },
      { status: 500 }
    );
  }
}
