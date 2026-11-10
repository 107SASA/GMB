import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { displayPersonName } from '@/lib/personName';
import User from '@/models/User';
import Business from '@/models/Business';
import Subscription from '@/models/Subscription';
import CustomerCallLog from '@/models/CustomerCallLog';
import { primaryBusinessByOwner, workspacePlanLabel } from '@/lib/admin/realAccounts';
import { ACTIVITY_RULES, buildTimeline, summarizeOwners, talkingPoints } from '@/lib/admin/customerActivity';

/**
 * GET /api/admin/customers/[userId]/activity
 * Everything the customer detail page needs: profile, workspace, billing
 * basics, activity summary + status, talking points, timeline and call log.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const { userId } = await params;
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return NextResponse.json({ success: false, error: 'Invalid customer id' }, { status: 400 });
  }

  try {
    await dbConnect();
    const user = await User.findById(userId)
      .select('fullName email phone role subscriptionPlan createdAt onboardingCompleted lastLoginAt lastSeenAt lastSeenClient')
      .lean() as any;
    if (!user || user.role === 'SUPER_ADMIN') {
      return NextResponse.json({ success: false, error: 'Customer not found' }, { status: 404 });
    }

    const [businesses, subscription, calls] = await Promise.all([
      Business.find({ userId, isDeleted: { $ne: true } })
        .select('userId name category address city subscriptionStatus trialEndsAt googleConnected createdAt')
        .lean(),
      Subscription.findOne({ userId }).select('planType billingStatus trialStatus currentPeriodEnd').lean() as any,
      CustomerCallLog.find({ userId }).sort({ createdAt: -1 }).limit(50).lean(),
    ]);
    const biz = primaryBusinessByOwner(businesses as any[])[userId] as any;

    const summaries = await summarizeOwners([{
      userId,
      createdAt: user.createdAt,
      lastSeenAt: user.lastSeenAt,
      lastSeenClient: user.lastSeenClient,
      lastLoginAt: user.lastLoginAt,
      business: biz ? { _id: String(biz._id), googleConnected: biz.googleConnected } : null,
    }]);
    const summary = summaries.get(userId)!;

    const timeline = await buildTimeline({
      userId,
      businessId: biz ? String(biz._id) : null,
      lastLoginAt: user.lastLoginAt,
      days: 60,
    });

    return NextResponse.json({
      success: true,
      data: {
        customer: {
          _id: userId,
          fullName: displayPersonName(user.fullName, biz?.name, user.phone),
          email: user.email,
          phone: user.phone,
          createdAt: user.createdAt,
          onboardingCompleted: !!user.onboardingCompleted,
        },
        business: biz
          ? {
              _id: String(biz._id),
              name: biz.name,
              category: biz.category,
              address: [biz.address, biz.city].filter(Boolean).join(', '),
              googleConnected: !!biz.googleConnected,
              subscriptionStatus: biz.subscriptionStatus ?? null,
              workspacePlan: workspacePlanLabel(biz.subscriptionStatus),
              trialEndsAt: biz.trialEndsAt ?? null,
            }
          : null,
        otherBusinesses: (businesses as any[])
          .filter((b) => !biz || String(b._id) !== String(biz._id))
          .map((b) => ({ _id: String(b._id), name: b.name, workspacePlan: workspacePlanLabel(b.subscriptionStatus) })),
        subscription: subscription
          ? {
              planType: subscription.planType,
              billingStatus: subscription.billingStatus,
              trialActive: !!subscription.trialStatus?.isActive,
              currentPeriodEnd: subscription.currentPeriodEnd ?? null,
            }
          : null,
        summary,
        talkingPoints: talkingPoints(summary, biz?.name),
        rules: ACTIVITY_RULES,
        timeline,
        calls: (calls as any[]).map((c) => ({
          _id: String(c._id),
          at: c.createdAt,
          outcome: c.outcome,
          note: c.note,
          followUpAt: c.followUpAt ?? null,
          adminName: c.adminName,
        })),
      },
    });
  } catch (error: any) {
    console.error('[admin/customers/activity] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load customer activity' }, { status: 500 });
  }
}
