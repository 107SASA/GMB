import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/mongodb';
import Subscription from '@/models/Subscription';
import Business from '@/models/Business';
import { requireClient } from '@/lib/auth';
import { isWorkspaceUnlocked } from '@/lib/workspaceAccess';

export const dynamic = 'force-dynamic';

/**
 * Resolves the per-workspace subscription gate state for the active workspace
 * (the `activeBusinessId` cookie), so the UI can show whether THIS workspace is
 * locked. `isActive` mirrors src/proxy.ts: unlocked when the workspace is
 * subscribed OR the user has a paid user-level plan. Additive — null when no
 * workspace is selected.
 */
async function getWorkspaceStatus(userSubscriptionPlan?: string) {
  const cookieStore = await cookies();
  const businessId = cookieStore.get('activeBusinessId')?.value;
  if (!businessId) return null;
  const business = await Business.findById(businessId)
    .select('name subscriptionStatus freeAuditUsed subscriptionCurrentPeriodEnd')
    .lean() as any;
  if (!business) return null;
  return {
    businessId,
    name: business.name,
    subscriptionStatus: business.subscriptionStatus ?? 'trialing',
    freeAuditUsed: Boolean(business.freeAuditUsed),
    isActive: isWorkspaceUnlocked({
      subscriptionStatus: business.subscriptionStatus,
      userSubscriptionPlan,
    }),
    currentPeriodEnd: business.subscriptionCurrentPeriodEnd ?? null,
  };
}

/**
 * Current subscription for the signed-in user — the same block
 * /api/auth/me returns, plus billing-specific fields for the web UI, plus the
 * per-workspace gate state for the active workspace.
 */
export async function GET() {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  await dbConnect();

  const workspace = await getWorkspaceStatus((auth.user as any).subscriptionPlan);

  const subscription = await Subscription.findOne({ userId: auth.userId })
    .select('planType billingStatus trialStatus modules razorpaySubscriptionId currentPeriodEnd')
    .lean() as any;

  if (!subscription) {
    return NextResponse.json({
      success: true,
      subscription: {
        planType: 'Free',
        billingStatus: 'Trialing',
        trialStatus: { isActive: false },
        modules: {},
        hasPaymentMethod: false,
        currentPeriodEnd: null,
      },
      workspace,
    });
  }

  return NextResponse.json({
    success: true,
    subscription: {
      planType: subscription.planType,
      billingStatus: subscription.billingStatus,
      trialStatus: subscription.trialStatus,
      modules: subscription.modules,
      hasPaymentMethod: Boolean(subscription.razorpaySubscriptionId),
      currentPeriodEnd: subscription.currentPeriodEnd ?? null,
    },
    workspace,
  });
}
