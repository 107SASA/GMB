import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { displayPersonName } from '@/lib/personName';
import User from '@/models/User';
import Business from '@/models/Business';
import Subscription from '@/models/Subscription';
import { realUserFilter, workspacePlanLabel, primaryBusinessByOwner } from '@/lib/admin/realAccounts';
import { summarizeOwners, type ActivitySummary } from '@/lib/admin/customerActivity';

const ACTIVITY_FILTERS = ['needs_call', 'active', 'slipping', 'inactive'] as const;
/** Cap for the in-memory activity filter (status is computed, not stored). */
const ACTIVITY_SCAN_CAP = 2000;

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
    const activityParam = searchParams.get('activity') || 'all';
    const activity = (ACTIVITY_FILTERS as readonly string[]).includes(activityParam) ? activityParam : null;

    // Unclaimed shadow accounts (see src/lib/shadowAccount.ts — created
    // automatically by lead-gen flows like /free-report) are hidden from the
    // customer list by default so they don't inflate real-signup counts —
    // unless they became customers (trial, paid or past due): see realAccounts.ts.
    const includeShadow = searchParams.get('includeShadow') === 'true';
    const shadowFilter = includeShadow ? {} : await realUserFilter();
    const query: any = { role: { $nin: ['SUPER_ADMIN', 'GROWTH_PARTNER'] }, $and: [shadowFilter] };

    if (search.trim()) {
      query.$or = [
        { fullName: { $regex: search.trim(), $options: 'i' } },
        { email:    { $regex: search.trim(), $options: 'i' } },
      ];
    }

    if (plan !== 'all') {
      query.subscriptionPlan = plan;
    }

    // Activity filters need every matching customer's computed status, so
    // they scan (capped) and paginate in memory; the plain list stays a
    // normal DB page.
    const userSelect = 'fullName email phone subscriptionPlan createdAt onboardingCompleted businessIds activeBusinessId lastLoginAt lastSeenAt lastSeenClient';
    const [users, total] = activity
      ? [await User.find(query).sort({ createdAt: -1 }).limit(ACTIVITY_SCAN_CAP).select(userSelect).lean(), 0]
      : await Promise.all([
          User.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).select(userSelect).lean(),
          User.countDocuments(query),
        ]);

    const userIds     = users.map((u: any) => u._id);

    const [businesses, subscriptions] = await Promise.all([
      Business.find({ userId: { $in: userIds } })
        .select('userId name category address city subscriptionStatus trialEndsAt googleConnected')
        .lean(),
      Subscription.find({ userId: { $in: userIds } })
        .select('userId planType billingStatus trialStatus')
        .lean(),
    ]);

    // The owner's most significant workspace: paid, then trial, then past due, then any.
    const businessMap: Record<string, any> = primaryBusinessByOwner(businesses as any[]);

    const activityMap: Map<string, ActivitySummary> = await summarizeOwners(users.map((u: any) => {
      const biz = businessMap[u._id.toString()];
      return {
        userId: u._id.toString(),
        createdAt: u.createdAt,
        lastSeenAt: u.lastSeenAt,
        lastSeenClient: u.lastSeenClient,
        lastLoginAt: u.lastLoginAt,
        business: biz ? { _id: String(biz._id), googleConnected: biz.googleConnected } : null,
      };
    }));

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
        fullName:         displayPersonName(u.fullName, biz?.name, u.phone),
        email:            u.email,
        phone:            u.phone,
        createdAt:        u.createdAt,
        subscriptionPlan: u.subscriptionPlan || 'Free',
        onboardingCompleted: u.onboardingCompleted,
        business: biz
          ? { _id: biz._id, name: biz.name, category: biz.category, address: biz.address, city: biz.city }
          : null,
        // The real plan state, from the workspace (the user-level plan reads "Free" during a trial).
        workspaceStatus: biz?.subscriptionStatus ?? null,
        workspacePlan: workspacePlanLabel(biz?.subscriptionStatus),
        trialEndsAt: biz?.subscriptionStatus === 'trial_active' ? biz?.trialEndsAt ?? null : null,
        subscription: sub
          ? { planType: sub.planType, billingStatus: sub.billingStatus, trialActive: sub.trialStatus?.isActive }
          : null,
        isActive,
        activity: activityMap.get(uid) ?? null,
      };
    });

    let totalOut = total;
    if (activity) {
      const order: Record<string, number> = { inactive: 0, slipping: 1, active: 2 };
      enriched = enriched.filter((u) => {
        const st = u.activity?.status;
        return activity === 'needs_call' ? st === 'inactive' || st === 'slipping' : st === activity;
      });
      if (activity === 'needs_call') {
        // Worst first, then longest quiet. Anyone with a follow-up date still
        // in the future was already handled — push them to the bottom.
        const now = Date.now();
        const handled = (u: any) => (u.activity?.lastCall?.followUpAt && Date.parse(u.activity.lastCall.followUpAt) > now ? 1 : 0);
        enriched.sort((a, b) =>
          handled(a) - handled(b) ||
          order[a.activity!.status] - order[b.activity!.status] ||
          (b.activity!.daysQuiet ?? 9999) - (a.activity!.daysQuiet ?? 9999));
      }
      totalOut = enriched.length;
      enriched = enriched.slice(skip, skip + limit);
    }

    if (status === 'active') {
      enriched = enriched.filter(u => u.isActive);
    } else if (status === 'inactive') {
      enriched = enriched.filter(u => !u.isActive);
    }

    // Stats
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [newThisWeek, proCount, enterpriseCount] = await Promise.all([
      User.countDocuments({ role: { $nin: ['SUPER_ADMIN', 'GROWTH_PARTNER'] }, ...shadowFilter, createdAt: { $gte: sevenDaysAgo } }),
      User.countDocuments({ role: { $nin: ['SUPER_ADMIN', 'GROWTH_PARTNER'] }, ...shadowFilter, subscriptionPlan: 'Pro' }),
      User.countDocuments({ role: { $nin: ['SUPER_ADMIN', 'GROWTH_PARTNER'] }, ...shadowFilter, subscriptionPlan: 'Enterprise' }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        users: enriched,
        total: totalOut,
        page,
        totalPages: Math.ceil(totalOut / limit),
        stats: {
          totalUsers:      activity ? await User.countDocuments(query) : total,
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
