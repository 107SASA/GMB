import dbConnect from '@/lib/mongodb';
import Subscription from '@/models/Subscription';
import User from '@/models/User';
import {
  buildModulesMap,
  DEFAULT_FREE_MODULES,
  getSellablePlan,
  type SellablePlanType,
} from './planCatalog';

/**
 * Applies a paid plan to a user's entitlements. Two stores must stay in
 * sync (confirmed by reading the code, not the spec):
 *  - Subscription (userId 1:1): planType + billingStatus + modules map —
 *    what /api/auth/me and the mobile app read for module gating.
 *  - User.subscriptionPlan: the string featureGating.ts actually reads for
 *    usage limits (PlanConfig / PLAN_DEFAULTS lookup).
 */
export async function activatePlan(
  userId: string,
  planType: SellablePlanType,
  opts: { razorpaySubscriptionId?: string; currentPeriodEnd?: Date } = {}
): Promise<void> {
  const plan = getSellablePlan(planType);
  if (!plan) throw new Error(`Unknown sellable plan: ${planType}`);

  await dbConnect();

  await Subscription.findOneAndUpdate(
    { userId },
    {
      $set: {
        planType,
        billingStatus: 'Active',
        'trialStatus.isActive': false,
        modules: buildModulesMap(plan.modules),
        ...(opts.razorpaySubscriptionId && {
          razorpaySubscriptionId: opts.razorpaySubscriptionId,
        }),
        ...(opts.currentPeriodEnd && { currentPeriodEnd: opts.currentPeriodEnd }),
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  await User.findByIdAndUpdate(userId, {
    $set: {
      subscriptionPlan: planType,
      // Feature 1 — payment succeeded: remove the freemium audit-only
      // restriction. No-op for users who never had the gate set.
      'freemiumAuditGate.active': false,
    },
  });
}

/** Marks the subscription past-due (payment failed); entitlements unchanged. */
export async function markPastDue(userId: string): Promise<void> {
  await dbConnect();
  await Subscription.findOneAndUpdate({ userId }, { $set: { billingStatus: 'PastDue' } });
}

/**
 * Downgrades on cancel/expiry: paid modules off, schema-default modules
 * (google_ranking_agent) kept on, planType back to Free.
 */
export async function cancelPlan(userId: string): Promise<void> {
  await dbConnect();

  await Subscription.findOneAndUpdate(
    { userId },
    {
      $set: {
        planType: 'Free',
        billingStatus: 'Canceled',
        'trialStatus.isActive': false,
        modules: buildModulesMap(DEFAULT_FREE_MODULES),
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  await User.findByIdAndUpdate(userId, { $set: { subscriptionPlan: 'Free' } });
}
