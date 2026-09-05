import dbConnect from '@/lib/mongodb';
import Subscription from '@/models/Subscription';
import User from '@/models/User';
import Business from '@/models/Business';
import { notifyBusinessUsers } from '@/services/notifications';
import { maybeStartContentAutopilot } from '@/lib/contentAutopilot';
import { sendPaymentFailedEmail, sendCancellationEmail } from './billingEmails';
import {
  ALL_MODULES,
  buildModulesMap,
  DEFAULT_FREE_MODULES,
  PAID_PLAN_TYPE,
} from './planCatalog';

/**
 * Fetches the workspace owner's email/name for a billing email. Best-effort —
 * returns null on any failure so a lookup problem can never block the
 * entitlement flip these functions exist for.
 */
async function resolveBillingContact(businessId: string): Promise<{ email: string; fullName?: string } | null> {
  try {
    const business = await Business.findById(businessId).select('userId').lean() as any;
    if (!business?.userId) return null;
    const owner = await User.findById(business.userId).select('email fullName').lean() as any;
    if (!owner?.email) return null;
    return { email: owner.email, fullName: owner.fullName };
  } catch (e: any) {
    console.error('[billing] resolveBillingContact failed:', e.message);
    return null;
  }
}

/**
 * Per-workspace access gate (src/proxy.ts reads Business.subscriptionStatus).
 * These mirror the user-level entitlement helpers below but flip a single
 * workspace's access. The webhook calls both: the workspace functions unlock
 * THIS business's dashboard, while the user-level activatePlan keeps
 * User.subscriptionPlan in sync for usage limits.
 *
 * Each one fires the customer-facing signal (in-app notification, and email
 * for the two that need one) right here, at the same point the DB field
 * actually flips — not from the webhook route — so nothing can call these
 * and skip the notification, and the two can never drift out of sync.
 */
export async function activateBusinessPlan(
  businessId: string,
  opts: {
    currentPeriodEnd?: Date;
    /** Distinguishes first activation from a recurring renewal charge, for notification copy only — both flip the same fields. */
    eventType?: 'subscription.activated' | 'subscription.charged';
  } = {}
): Promise<void> {
  await dbConnect();
  const business = await Business.findOneAndUpdate(
    { _id: businessId },
    {
      $set: {
        subscriptionStatus: 'active',
        // A successful (re)activation clears any pending cancel + reminder state.
        subscriptionCancelAtPeriodEnd: false,
        subscriptionRemindersSent: [],
        // Admin sales pipeline: a real payment is an unambiguous conversion
        // event, so this always wins over whatever stage the admin had it in.
        pipelineStage: 'Customer',
        ...(opts.currentPeriodEnd && { subscriptionCurrentPeriodEnd: opts.currentPeriodEnd }),
      },
    },
    { new: true }
  ).select('name').lean() as any;

  const isRenewal = opts.eventType === 'subscription.charged';
  const workspaceName = business?.name || 'your workspace';
  try {
    await notifyBusinessUsers(businessId, {
      type: isRenewal ? 'billing_renewed' : 'billing_activated',
      title: isRenewal ? 'Payment received' : 'Subscription activated',
      body: isRenewal
        ? `Your GrowwMatics AI subscription for ${workspaceName} was renewed successfully.`
        : `Your GrowwMatics AI subscription for ${workspaceName} is now active — every feature is unlocked.`,
      link: '/dashboard/billing',
    });
  } catch (e: any) {
    console.error('[billing] activateBusinessPlan notification failed:', e.message);
  }

  // If this workspace's Google Business Profile was already connected before
  // now, activation is the second of the two conditions weekly content
  // autopilot waits on — this fires its first batch immediately instead of
  // waiting for the next hourly safety-net pass. No-op (fast) if GBP isn't
  // connected yet, or autopilot already started for this business.
  await maybeStartContentAutopilot(businessId);
}

export async function markBusinessPastDue(businessId: string): Promise<void> {
  await dbConnect();
  const business = await Business.findOneAndUpdate(
    { _id: businessId },
    { $set: { subscriptionStatus: 'past_due' } },
    { new: true }
  ).select('name').lean() as any;
  const workspaceName = business?.name || 'your workspace';

  try {
    await notifyBusinessUsers(businessId, {
      type: 'billing_past_due',
      title: 'Payment failed',
      body: `We couldn't process your payment for ${workspaceName}. Update your payment method to avoid losing access.`,
      link: '/dashboard/billing',
    });
  } catch (e: any) {
    console.error('[billing] markBusinessPastDue notification failed:', e.message);
  }

  const contact = await resolveBillingContact(businessId);
  if (contact) {
    const result = await sendPaymentFailedEmail(contact.email, { fullName: contact.fullName, businessName: business?.name });
    if (!result.success) {
      console.error(`[billing] payment-failed email to ${contact.email} did not send:`, (result as any).error);
    }
  } else {
    console.warn(`[billing] markBusinessPastDue: no contact email resolved for business ${businessId} — email skipped.`);
  }
}

export async function cancelBusinessPlan(businessId: string): Promise<void> {
  await dbConnect();
  // Fully canceled now — clear the "pending cancel" flag so the gate locks it.
  const business = await Business.findOneAndUpdate(
    { _id: businessId },
    { $set: { subscriptionStatus: 'canceled', subscriptionCancelAtPeriodEnd: false } },
    { new: true }
  ).select('name').lean() as any;
  const workspaceName = business?.name || 'your workspace';

  try {
    await notifyBusinessUsers(businessId, {
      type: 'billing_canceled',
      title: 'Subscription canceled',
      body: `The subscription for ${workspaceName} has been canceled. Reactivate any time from Billing.`,
      link: '/dashboard/billing',
    });
  } catch (e: any) {
    console.error('[billing] cancelBusinessPlan notification failed:', e.message);
  }

  const contact = await resolveBillingContact(businessId);
  if (contact) {
    const result = await sendCancellationEmail(contact.email, { fullName: contact.fullName, businessName: business?.name });
    if (!result.success) {
      console.error(`[billing] cancellation email to ${contact.email} did not send:`, (result as any).error);
    }
  } else {
    console.warn(`[billing] cancelBusinessPlan: no contact email resolved for business ${businessId} — email skipped.`);
  }
}

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
