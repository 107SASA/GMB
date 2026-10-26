import dbConnect from '@/lib/mongodb';
import Subscription from '@/models/Subscription';
import User from '@/models/User';
import Business from '@/models/Business';
import { notifyBusinessUsers } from '@/services/notifications';
import { notifyOwner } from '@/services/ownerNotify';
import { maybeStartContentAutopilot } from '@/lib/contentAutopilot';
import { maybeStartAuditAutopilot } from '@/lib/auditAutopilot';
import { sendPaymentFailedEmail, sendCancellationEmail } from './billingEmails';
import {
  ALL_MODULES,
  buildModulesMap,
  DEFAULT_FREE_MODULES,
  PAID_PLAN_TYPE,
} from './planCatalog';
import { TRIAL_CHARGE_PROCESSING_MS, failureSnapshot, type FailureKind, type FailureSnapshot } from './billingPolicy';
import { planAccessWorkspaceFilter } from './entitlements';
import { getFailurePolicy, getReminderPolicy } from '@/services/billing/trialPolicyStore';

/** Absolute Billing page link for WhatsApp copy (falls back to the public domain). */
const billingLink = () => `${(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://growwmatics.com').replace(/\/$/, '')}/dashboard/billing`;

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
    /** The Razorpay subscription that was paid — becomes the one granting access. */
    subscriptionId?: string;
    /** Mode recorded for subscriptionId by its checkout link (never inferred); omitted when unknown. */
    subscriptionMode?: 'test' | 'live' | null;
    /** Razorpay event time, so older events delivered later are ignored. */
    eventAt?: Date;
    /** Cycle and per-cycle amount of this verified charge — recorded for revenue reporting only. */
    billingCycle?: 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';
    amountInr?: number;
  } = {}
): Promise<{ held: boolean }> {
  await dbConnect();
  // Recovery from a payment failure: the policy frozen at Day 0 decides
  // whether access comes back by itself or waits for a super admin.
  const before = await Business.findById(businessId)
    .select('subscriptionStatus paymentRestoreOnRecovery paymentAccessHold')
    .lean<{ subscriptionStatus?: string; paymentRestoreOnRecovery?: boolean; paymentAccessHold?: boolean }>();
  const held =
    before?.paymentAccessHold === true ||
    (before?.subscriptionStatus === 'past_due' && before?.paymentRestoreOnRecovery === false);
  const business = await Business.findOneAndUpdate(
    { _id: businessId },
    {
      ...(opts.eventAt && { $max: { billingLastEventAt: opts.eventAt } }),
      // A verified payment closes any open payment failure.
      $unset: {
        paymentFailedAt: '',
        paymentFailureReason: '',
        paymentFailureKind: '',
        paymentGraceEndsAt: '',
        paymentRestrictedModules: '',
        paymentRestoreOnRecovery: '',
        recoveryCheckout: '',
      },
      $set: {
        ...(held && { paymentAccessHold: true }),
        ...(opts.subscriptionId && { billingSubscriptionId: opts.subscriptionId }),
        ...(opts.subscriptionId && opts.subscriptionMode && { billingSubscriptionEnv: { subscriptionId: opts.subscriptionId, mode: opts.subscriptionMode } }),
        subscriptionStatus: 'active',
        // A successful (re)activation clears any pending cancel + reminder state.
        subscriptionCancelAtPeriodEnd: false,
        subscriptionRemindersSent: [],
        // Admin sales pipeline: a real payment is an unambiguous conversion
        // event, so this always wins over whatever stage the admin had it in.
        pipelineStage: 'Customer',
        ...(opts.currentPeriodEnd && { subscriptionCurrentPeriodEnd: opts.currentPeriodEnd }),
        ...(opts.billingCycle && { billingCycle: opts.billingCycle }),
        ...(typeof opts.amountInr === 'number' && opts.amountInr > 0 && { billingAmountInr: opts.amountInr }),
      },
    },
    { new: true }
  ).select('name').lean() as any;

  const isRenewal = opts.eventType === 'subscription.charged';
  const workspaceName = business?.name || 'your workspace';
  if (held) {
    try {
      await notifyBusinessUsers(businessId, {
        type: 'billing_renewed',
        title: 'Payment received',
        body: `We received your payment for ${workspaceName}. Our team will restore full access shortly.`,
        link: '/dashboard/billing',
      });
    } catch (e: any) {
      console.error('[billing] activateBusinessPlan (held) notification failed:', e.message);
    }
    return { held: true };
  }
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

  // The payment WhatsApp (first payment vs renewal, decided from Razorpay's
  // paid_count, one per charge) is sent by the caller after activation —
  // services/billing/billingWhatsApp.ts notifyPaymentConfirmed.

  // If this workspace's Google Business Profile was already connected before
  // now, activation is the second of the two conditions weekly content
  // autopilot waits on — this fires its first batch immediately instead of
  // waiting for the next hourly safety-net pass. No-op (fast) if GBP isn't
  // connected yet, or autopilot already started for this business.
  await maybeStartContentAutopilot(businessId);

  // Same idea for the automatic audit: if Google is already connected and a
  // real category is on file, generate the first report now instead of
  // waiting for the hourly auditAutopilotCron. No-op if not yet qualified.
  await maybeStartAuditAutopilot(businessId);
  return { held: false };
}

/**
 * A charge failed on the subscription granting access (Razorpay
 * subscription.pending / halted). Only a workspace that currently has access
 * moves to past_due — a never-paid workspace (e.g. a declined checkout) is
 * left alone. paymentFailedAt is Day 0 of this failure; Razorpay's retries
 * within the same episode don't reset it or re-send the notices.
 * Returns true when this call opened the failure.
 */
export async function markBusinessPastDue(
  businessId: string,
  opts: { reason?: string; eventAt?: Date } = {}
): Promise<FailureSnapshot | null> {
  await dbConnect();
  const now = new Date();
  const current = await Business.findById(businessId).select('subscriptionStatus').lean<{ subscriptionStatus?: string }>();
  if (current?.subscriptionStatus !== 'active' && current?.subscriptionStatus !== 'trial_active') {
    // Already past_due (a retry failed again), or nothing to fail — keep the
    // frozen Day-0 snapshot; only keep the event time current.
    if (opts.eventAt) await Business.updateOne({ _id: businessId }, { $max: { billingLastEventAt: opts.eventAt } });
    return null;
  }
  // First charge after a free trial vs. a renewal for a paying customer —
  // the billing policy treats them differently (immediate vs. grace).
  const kind: FailureKind = current.subscriptionStatus === 'trial_active' ? 'first_charge' : 'renewal';
  const snapshot = failureSnapshot(await getFailurePolicy(), kind, now);
  const business = await Business.findOneAndUpdate(
    // Conditional on the status just read, so two concurrent failure events
    // can't both open (and re-date) the episode.
    { _id: businessId, subscriptionStatus: current.subscriptionStatus },
    {
      $set: {
        subscriptionStatus: 'past_due',
        paymentFailedAt: now,
        paymentFailureReason: opts.reason ?? 'charge_failed',
        paymentFailureKind: snapshot.kind,
        paymentGraceEndsAt: snapshot.graceEndsAt,
        paymentRestrictedModules: snapshot.restrictedModules,
        paymentRestoreOnRecovery: snapshot.restoreAccessOnRecovery,
      },
      ...(opts.eventAt && { $max: { billingLastEventAt: opts.eventAt } }),
    },
    { new: true }
  ).select('name').lean() as any;
  if (!business) return null;
  const workspaceName = business?.name || 'your workspace';
  // Copy follows the frozen policy: a grace period names its end date;
  // an immediate restriction says paid features are paused now.
  const hasGrace = snapshot.graceEndsAt.getTime() > now.getTime();
  const graceLabel = snapshot.graceEndsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const consequence = hasGrace
    ? `Update your payment method by ${graceLabel} to keep full access.`
    : 'Paid features are paused until the payment goes through — your data is safe.';

  try {
    await notifyBusinessUsers(businessId, {
      type: 'billing_past_due',
      title: 'Payment failed',
      body: `We couldn't process your payment for ${workspaceName}. ${consequence}`,
      link: '/dashboard/billing',
    });
  } catch (e: any) {
    console.error('[billing] markBusinessPastDue notification failed:', e.message);
  }

  // When the recovery-reminder scheduler is on it sends the Day-0 WhatsApp
  // (approved template, opt-outs, sending hours) — don't send a second one.
  if (!(await getReminderPolicy()).enabled) {
    await notifyOwner(businessId, {
      event: 'billing_past_due',
      text: `Hi ${workspaceName},\n\nThere is an issue with your Growwmatics subscription payment — we couldn't process it. ${consequence}\n\nManage billing: ${billingLink()}\n\n— Team Growwmatics`,
    });
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
  return snapshot;
}

/**
 * Verified authorization of a trial subscription: the workspace gets full
 * access until trialEndsAt (= Razorpay start_at, the first charge). Never
 * touches a workspace that is already paid. Not a payment — no payment
 * messages, no CRM "Customer" stage.
 */
export async function startTrialAccess(
  businessId: string,
  userId: string | null,
  /** cancelled: the subscription's cancellation was processed before this authorization
   *  (out-of-order delivery) — the trial starts already cancelled: access until
   *  trialEndsAt, no charge, and no "trial started" notice. */
  opts: { subscriptionId: string; trialEndsAt: Date; eventAt?: Date; cancelled?: boolean; subscriptionMode?: 'test' | 'live' | null }
): Promise<boolean> {
  await dbConnect();
  const now = new Date();
  const business = await Business.findOneAndUpdate(
    { _id: businessId, subscriptionStatus: { $ne: 'active' } },
    {
      $set: {
        subscriptionStatus: 'trial_active',
        trialStartedAt: now,
        trialEndsAt: opts.trialEndsAt,
        billingSubscriptionId: opts.subscriptionId,
        ...(opts.subscriptionMode && { billingSubscriptionEnv: { subscriptionId: opts.subscriptionId, mode: opts.subscriptionMode } }),
        razorpaySubscriptionId: opts.subscriptionId,
        subscriptionCancelAtPeriodEnd: false,
        ...(opts.cancelled && { trialCancelledAt: now }),
      },
      $unset: { ...(!opts.cancelled && { trialCancelledAt: '' }), paymentFailedAt: '', paymentFailureReason: '' },
      ...(opts.eventAt && { $max: { billingLastEventAt: opts.eventAt } }),
    },
    { new: true }
  ).select('name').lean() as any;
  if (!business) return false;

  if (userId) {
    // User-level entitlement (requireModule / mobile): a trial with an end date.
    // Ends a little after trialEndsAt while the first charge processes, same as
    // the workspace gate (isWorkspaceUnlocked).
    await Subscription.findOneAndUpdate(
      { userId },
      {
        $set: {
          billingStatus: 'Trialing',
          trialSource: 'offer',
          'trialStatus.isActive': true,
          // A cancelled trial ends exactly at trialEndsAt (no charge to wait for).
          'trialStatus.endsAt': opts.cancelled ? opts.trialEndsAt : new Date(opts.trialEndsAt.getTime() + TRIAL_CHARGE_PROCESSING_MS),
          razorpaySubscriptionId: opts.subscriptionId,
        },
        $setOnInsert: { planType: 'Free' },
      },
      { upsert: true }
    );
  }

  const endLabel = opts.trialEndsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  try {
    await notifyBusinessUsers(
      businessId,
      opts.cancelled
        ? {
            type: 'billing_trial_cancelled',
            title: 'Free trial cancelled',
            body: `Your free trial for ${business.name || 'your workspace'} was cancelled. You keep full access until ${endLabel} and won't be charged.`,
            link: '/dashboard/billing',
          }
        : {
            type: 'billing_trial_started',
            title: 'Free trial started',
            body: `Your free trial for ${business.name || 'your workspace'} is active until ${endLabel}. Your yearly plan starts then unless you cancel before.`,
            link: '/dashboard/billing',
          }
    );
  } catch (e: any) {
    console.error('[billing] startTrialAccess notification failed:', e.message);
  }

  // The trial is the paid plan: start weekly content and the monthly audit
  // now if Google is already connected (no-ops otherwise), same as activation.
  await maybeStartContentAutopilot(businessId);
  await maybeStartAuditAutopilot(businessId);
  return true;
}

/**
 * Trial cancelled (by the customer, or the subscription ended on Razorpay
 * before charging): access continues until the ORIGINAL trialEndsAt, never
 * extended, and the user-level trial ends at the same moment.
 */
export async function markTrialCancelled(
  businessId: string,
  userId: string | null,
  opts: { eventAt?: Date } = {}
): Promise<void> {
  await dbConnect();
  const business = await Business.findOneAndUpdate(
    { _id: businessId, subscriptionStatus: 'trial_active', trialCancelledAt: { $exists: false } },
    {
      $set: { trialCancelledAt: new Date() },
      ...(opts.eventAt && { $max: { billingLastEventAt: opts.eventAt } }),
    },
    { new: true }
  ).select('trialEndsAt').lean() as any;
  if (business?.trialEndsAt && userId) {
    await Subscription.updateOne(
      { userId, billingStatus: 'Trialing', trialSource: 'offer' },
      { $set: { 'trialStatus.endsAt': business.trialEndsAt } }
    );
  }
}

export async function cancelBusinessPlan(
  businessId: string,
  /** trialEnded: an unpaid trial reached its end — the caller sends the trial-expired WhatsApp instead of "cancelled". */
  opts: { trialEnded?: boolean } = {}
): Promise<void> {
  await dbConnect();
  // Stamp the moment it became canceled (once — a repeated cancel event keeps the first time).
  await Business.updateOne(
    { _id: businessId, subscriptionStatus: { $ne: 'canceled' } },
    { $set: { subscriptionCanceledAt: new Date(), subscriptionCanceledReason: opts.trialEnded ? 'trial_ended' : 'canceled' } }
  );
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

  if (!opts.trialEnded) {
    await notifyOwner(businessId, {
      event: 'billing_canceled',
      text: `Hi ${workspaceName},\n\nYour Growwmatics subscription has been cancelled. You can reactivate it any time.\n\nManage billing: ${billingLink()}\n\n— Team Growwmatics`,
    });
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
  opts: { razorpaySubscriptionId?: string; currentPeriodEnd?: Date; held?: boolean } = {}
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
        // Recovery held for a super-admin release (policy) — see activateBusinessPlan.
        ...(opts.held && { accessHold: true }),
      },
      // A verified payment closes the payment failure.
      $unset: { paymentGraceEndsAt: '', restrictedModules: '' },
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

/**
 * Marks the subscription past-due (payment failed); a trial ends with it.
 * `snapshot` is the workspace's Day-0 policy (grace end, restricted modules).
 * Without one (a retry failing again) the existing frozen values are kept;
 * a user with none at all is restricted immediately on every paid module.
 */
export async function markPastDue(userId: string, snapshot: FailureSnapshot | null = null): Promise<void> {
  await dbConnect();
  await Subscription.findOneAndUpdate(
    { userId },
    {
      $set: {
        billingStatus: 'PastDue',
        'trialStatus.isActive': false,
        ...(snapshot && { paymentGraceEndsAt: snapshot.graceEndsAt, restrictedModules: snapshot.restrictedModules }),
      },
    }
  );
}

/**
 * True when the user owns another (not deleted) workspace that still has the
 * paid plan — paid, an authorized trial, or a failure inside its grace.
 * The user-level entitlements below are shared by every workspace the user
 * owns, so one workspace ending or failing must not downgrade them while
 * another one is still paid for (its data APIs would answer MODULE_LOCKED).
 */
export async function userHasOtherPlanWorkspace(userId: string, exceptBusinessId: string | null): Promise<boolean> {
  await dbConnect();
  const found = await Business.exists({
    userId,
    ...(exceptBusinessId && { _id: { $ne: exceptBusinessId } }),
    isDeleted: { $ne: true },
    ...planAccessWorkspaceFilter(),
  });
  return !!found;
}

/** cancelPlan, unless another workspace of this user still has the paid plan. */
export async function endUserPlanUnlessOtherWorkspacePaid(userId: string, endedBusinessId: string | null): Promise<void> {
  if (await userHasOtherPlanWorkspace(userId, endedBusinessId)) return;
  await cancelPlan(userId);
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
