import dbConnect from '@/lib/mongodb';
import Subscription from '@/models/Subscription';
import User from '@/models/User';
import {
  ALL_MODULES,
  buildModulesMap,
  DEFAULT_FREE_MODULES,
  PAID_PLAN_TYPE,
} from './planCatalog';

/**
 * Applies the paid plan to a user's entitlements — there is only one, and it
 * unlocks every module. Two stores must stay in sync (confirmed by reading
 * the code, not the spec):
 *  - Subscription (userId 1:1): planType + billingStatus + modules map —
 *    what /api/auth/me and the mobile app read for module gating.
 *  - User.subscriptionPlan: the string featureGating.ts actually reads for
 *    usage limits (PlanConfig / PLAN_DEFAULTS lookup).
 */
export async function activatePlan(
  userId: string,
  opts: { razorpaySubscriptionId?: string; currentPeriodEnd?: Date } = {}
): Promise<void> {
  await dbConnect();

  await Subscription.findOneAndUpdate(
    { userId },
    {
      $set: {
        planType: PAID_PLAN_TYPE,
        billingStatus: 'Active',
        'trialStatus.isActive': false,
        modules: buildModulesMap(ALL_MODULES),
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
      // Single sellable plan (PAID_PLAN_TYPE) — kept from the single-plan
      // billing refactor rather than upstream's per-plan `planType`.
      subscriptionPlan: PAID_PLAN_TYPE,
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
