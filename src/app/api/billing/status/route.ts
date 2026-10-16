import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Subscription from '@/models/Subscription';
import Business from '@/models/Business';
import { requireClient } from '@/lib/auth';
import { isWorkspaceUnlocked } from '@/lib/workspaceAccess';
import { workspaceAccessState } from '@/lib/billing/entitlements';
import { reconcileWorkspaceSubscription } from '@/lib/billing/razorpayReconcile';

export const dynamic = 'force-dynamic';

/**
 * Resolves the per-workspace subscription gate state for the active workspace,
 * so the UI can show whether THIS workspace is locked. Mobile clients have no
 * activeBusinessId cookie, so fall back to the x-business-id header — same
 * precedence as requireBusinessContext in src/lib/tenant.ts. `isActive`
 * mirrors src/proxy.ts: unlocked when the workspace is subscribed OR the user
 * has a paid user-level plan. Additive — null when no workspace is selected.
 */
const WORKSPACE_FIELDS =
  'name subscriptionStatus freeAuditUsed subscriptionCurrentPeriodEnd subscriptionCancelAtPeriodEnd createdAt razorpaySubscriptionId ' +
  'trialStartedAt trialEndsAt trialCancelledAt paymentFailedAt paymentFailureKind paymentGraceEndsAt ' +
  'paymentRestrictedModules paymentAccessHold';

async function getWorkspaceStatus(user: any, userId: string) {
  const userSubscriptionPlan = user?.subscriptionPlan;
  const businessId =
    (await headers()).get('x-business-id') ?? (await cookies()).get('activeBusinessId')?.value;
  if (!businessId || !mongoose.isValidObjectId(businessId)) return null;
  // Tenant isolation — same ownership rule as requireBusinessContext: the
  // caller must own the workspace or share its organization (super admins:
  // any). Otherwise this would reveal another workspace's billing state and
  // trigger a Razorpay self-heal for it.
  const ownership =
    user?.role === 'SUPER_ADMIN'
      ? { _id: businessId }
      : {
          _id: businessId,
          $or: [{ userId }, ...(user?.organizationId ? [{ organizationId: user.organizationId }] : [])],
        };
  let business = await Business.findOne(ownership).select(WORKSPACE_FIELDS).lean() as any;
  if (!business) return null;

  let isActive = isWorkspaceUnlocked({
    subscriptionStatus: business.subscriptionStatus,
    userSubscriptionPlan,
    businessCreatedAt: business.createdAt,
    trialEndsAt: business.trialEndsAt,
    trialCancelledAt: business.trialCancelledAt,
    paymentGraceEndsAt: business.paymentGraceEndsAt,
    paymentAccessHold: business.paymentAccessHold,
  });

  // Every read of "is this workspace unlocked" doubles as a chance to
  // self-heal: if Razorpay's webhook is late, dropped, or (local dev)
  // unreachable, check directly with Razorpay and activate right here
  // instead of leaving the customer waiting on a webhook that may never
  // arrive. See razorpayReconcile.ts for the full reasoning — this is a
  // no-op unless the workspace has a linked, not-yet-active subscription.
  if (!isActive && business.razorpaySubscriptionId) {
    const result = await reconcileWorkspaceSubscription(businessId).catch((err) => {
      console.error('[billing/status] reconcile threw:', err);
      return null;
    });
    if (result?.attempted) {
      business = await Business.findById(businessId).select(WORKSPACE_FIELDS).lean() as any;
      isActive = isWorkspaceUnlocked({
        subscriptionStatus: business.subscriptionStatus,
        userSubscriptionPlan,
        businessCreatedAt: business.createdAt,
        trialEndsAt: business.trialEndsAt,
        trialCancelledAt: business.trialCancelledAt,
        paymentGraceEndsAt: business.paymentGraceEndsAt,
        paymentAccessHold: business.paymentAccessHold,
      });
    }
  }

  return {
    businessId,
    name: business.name,
    subscriptionStatus: business.subscriptionStatus ?? 'trialing',
    freeAuditUsed: Boolean(business.freeAuditUsed),
    isActive,
    currentPeriodEnd: business.subscriptionCurrentPeriodEnd ?? null,
    // True while access continues but the subscription won't renew.
    cancelAtPeriodEnd: Boolean(business.subscriptionCancelAtPeriodEnd),
    // Free trial: the first charge happens at trialEndsAt unless cancelled.
    trial: business.trialEndsAt
      ? {
          startedAt: business.trialStartedAt ?? null,
          endsAt: business.trialEndsAt,
          cancelled: Boolean(business.trialCancelledAt),
        }
      : null,
    paymentFailedAt: business.paymentFailedAt ?? null,
    // Payment-failure policy in effect for this workspace (frozen at Day 0):
    // mode full | grace | restricted | held | none, the grace end, and — when
    // restricted — which paid modules are locked (the dashboard blurs only those).
    access: {
      ...workspaceAccessState(business),
      failureKind: business.paymentFailureKind ?? null,
    },
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

  const workspace = await getWorkspaceStatus(auth.user, auth.userId);

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
