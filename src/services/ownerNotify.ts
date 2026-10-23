import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import User from '@/models/User';
import OwnerNotifyDigest from '@/models/OwnerNotifyDigest';
import { sendOutboundMessage } from '@/services/whatsapp/send';
import {
  isBillingOwnerEvent,
  ownerBusinessWhatsAppAllowed,
  ownerWhatsAppDelivery,
  type OwnerBusinessEvent,
} from '@/services/ownerNotifyEligibility';
import { performanceUpdateClaimFilter, performanceUpdateClaimUpdate } from '@/lib/ownerWhatsAppLimits';
import { isoWeekKey } from '@/services/lifecycle/weekly';

/**
 * Owner-facing WhatsApp notification layer.
 *
 * This is PURELY the WhatsApp channel — it does not touch the in-app bell
 * (notifyBusinessUsers) or mobile push (sendPushToBusinessUsers). Call sites
 * keep their existing in-app/push calls; notifyOwner() is added alongside
 * them so the workspace owner also gets a WhatsApp message when something
 * needs them (a new lead, a critical review, billing, a report being ready).
 *
 * Which events reach WhatsApp at all — and how often — is decided here, for
 * every caller (OWNER_WHATSAPP_DELIVERY in ownerNotifyEligibility.ts):
 *  - immediate: sent now via the platform WhatsApp number.
 *  - performance_update: routine performance summaries; at most 2 per
 *    business in any rolling 15 days (lib/ownerWhatsAppLimits.ts), claimed
 *    atomically on the Business before sending and released if the send fails.
 *  - performance_priority: the monthly report summary — sent regardless of
 *    that limit (once per report), then recorded as one of its slots.
 *  - weekly: the reviews-need-attention reminder; one per business per ISO week.
 *  - off: routine activity (posts/photos published, content generated, review
 *    replies sent or drafted, festival prompts) — dashboard / in-app only.
 *    Nothing is sent or queued.
 *
 * Every send respects the owner's User.notificationPreferences:
 *  - `whatsAppNotificationsEnabled` is the master switch (off → nothing).
 *  - each event maps to one per-event toggle (below).
 * Billing notices are the exception — they are about the subscription itself.
 *
 * Best-effort: never throws. The result says what happened, for callers that
 * record it; a missing phone, an opted-out owner, a reached limit or a send
 * failure can never break the workflow that produced the activity.
 */

export type OwnerNotifyEvent = OwnerBusinessEvent;

type PrefKey =
  | 'newLeadWhatsApp'
  | 'demoBookingWhatsApp'
  | 'criticalReviewWhatsApp'
  | 'billingWhatsApp'
  | 'postPublishedWhatsApp'
  | 'reviewReplyWhatsApp'
  | 'reportReadyWhatsApp'
  | 'weeklyUpdateWhatsApp'
  | 'performanceDigestWhatsApp'
  | 'whatsAppNotificationsEnabled';

/** notificationPreferences key gating each event. */
const EVENT_PREF: Record<OwnerNotifyEvent, PrefKey> = {
  new_lead: 'newLeadWhatsApp',
  demo_booking: 'demoBookingWhatsApp',
  critical_review: 'criticalReviewWhatsApp',
  report_ready: 'reportReadyWhatsApp',
  billing_activated: 'billingWhatsApp',
  billing_past_due: 'billingWhatsApp',
  billing_canceled: 'billingWhatsApp',
  billing_trial_ending: 'billingWhatsApp',
  billing_trial_expired: 'billingWhatsApp',
  profile_incomplete: 'whatsAppNotificationsEnabled',
  monthly_report: 'reportReadyWhatsApp',
  weekly_update: 'weeklyUpdateWhatsApp',
  performance_digest: 'performanceDigestWhatsApp',
  review_attention: 'reviewReplyWhatsApp',
  festival_prompt: 'weeklyUpdateWhatsApp',
  review_reminder: 'weeklyUpdateWhatsApp',
  post_published: 'postPublishedWhatsApp',
  photo_published: 'postPublishedWhatsApp',
  review_reply_sent: 'reviewReplyWhatsApp',
  review_reply_drafted: 'reviewReplyWhatsApp',
  content_batch_generated: 'postPublishedWhatsApp',
};

/** Defaults for every WhatsApp-notification preference (all opt-out). */
export const OWNER_NOTIFY_PREF_DEFAULTS = {
  whatsAppNotificationsEnabled: true,
  dailyDigestWhatsApp: true,
  newLeadWhatsApp: true,
  demoBookingWhatsApp: true,
  criticalReviewWhatsApp: true,
  billingWhatsApp: true,
  postPublishedWhatsApp: true,
  reviewReplyWhatsApp: true,
  reportReadyWhatsApp: true,
  weeklyUpdateWhatsApp: true,
  weeklyReportAlwaysWhatsApp: false,
  performanceDigestWhatsApp: true,
} as const;

export interface NotifyOwnerInput {
  event: OwnerNotifyEvent;
  /** Full WhatsApp message text. */
  text: string;
  /** How many underlying items this represents (kept for older callers; digest-only). */
  count?: number;
  /** weekly events: the ISO week being claimed (defaults to the current week). */
  weekKey?: string;
}

export type NotifyOwnerResult =
  | { status: 'sent' }
  | {
      status: 'skipped';
      reason:
        | 'whatsapp_off_for_event'
        | 'no_business'
        | 'not_eligible'
        | 'opted_out'
        | 'no_phone'
        | 'performance_update_limit'
        | 'already_sent_this_week';
    }
  | { status: 'failed'; error?: string };

interface ResolvedOwner {
  businessId: string;
  businessName: string;
  userId?: string;
  phone?: string;
  prefs: Record<string, boolean>;
  subscriptionStatus?: string;
  trialEndsAt?: Date;
  trialCancelledAt?: Date;
  paymentGraceEndsAt?: Date;
  paymentAccessHold?: boolean;
  googleConnected?: boolean;
  googleLocationId?: string;
}

async function resolveOwner(businessId: string): Promise<ResolvedOwner | null> {
  const business = await Business.findById(businessId)
    .select('name userId phone subscriptionStatus trialEndsAt trialCancelledAt paymentGraceEndsAt paymentAccessHold googleConnected googleLocationId')
    .lean<{
      name?: string;
      userId?: { toString(): string };
      phone?: string;
      subscriptionStatus?: string;
      trialEndsAt?: Date;
      trialCancelledAt?: Date;
      paymentGraceEndsAt?: Date;
      paymentAccessHold?: boolean;
      googleConnected?: boolean;
      googleLocationId?: string;
    }>();
  if (!business) return null;

  let phone = business.phone || undefined;
  let userId: string | undefined;
  let prefs: Record<string, boolean> = { ...OWNER_NOTIFY_PREF_DEFAULTS };

  if (business.userId) {
    userId = business.userId.toString();
    const owner = await User.findById(userId)
      .select('phone notificationPreferences')
      .lean<{ phone?: string; notificationPreferences?: Record<string, boolean> }>();
    if (owner) {
      // Owner's account phone wins; fall back to the business phone on file.
      phone = owner.phone || phone;
      prefs = { ...OWNER_NOTIFY_PREF_DEFAULTS, ...(owner.notificationPreferences || {}) };
    }
  }

  return {
    businessId,
    businessName: business.name || 'your workspace',
    userId,
    phone,
    prefs,
    subscriptionStatus: business.subscriptionStatus,
    trialEndsAt: business.trialEndsAt,
    trialCancelledAt: business.trialCancelledAt,
    paymentGraceEndsAt: business.paymentGraceEndsAt,
    paymentAccessHold: business.paymentAccessHold,
    googleConnected: business.googleConnected,
    googleLocationId: business.googleLocationId,
  };
}

/** Whether the owner has opted into this specific event over WhatsApp. */
function isOptedIn(prefs: Record<string, boolean>, pref: PrefKey): boolean {
  if (prefs.whatsAppNotificationsEnabled === false) return false;
  if (prefs[pref] === false) return false;
  return true;
}

/**
 * Takes one of the business's routine performance-update slots, atomically.
 * Returns the claimed timestamp (to release on a failed send), or null when
 * the rolling limit is reached.
 */
async function claimPerformanceUpdateSlot(businessId: string, now: Date): Promise<Date | null> {
  const claimed = await Business.findOneAndUpdate(
    { _id: businessId, ...performanceUpdateClaimFilter(now) },
    performanceUpdateClaimUpdate(now),
    { returnDocument: 'after', projection: { _id: 1 } }
  ).lean();
  return claimed ? now : null;
}

async function releasePerformanceUpdateSlot(businessId: string, claimedAt: Date): Promise<void> {
  await Business.updateOne({ _id: businessId }, { $pull: { performanceUpdateSentAt: claimedAt } });
}

/** Claims this ISO week's review reminder. Returns the previous week key (to restore on a failed send), or false. */
async function claimWeeklySlot(businessId: string, weekKey: string): Promise<{ previous: string | null } | false> {
  const before = await Business.findOneAndUpdate(
    { _id: businessId, reviewAttentionWeekKey: { $ne: weekKey } },
    { $set: { reviewAttentionWeekKey: weekKey } },
    { returnDocument: 'before', projection: { reviewAttentionWeekKey: 1 } }
  ).lean<{ reviewAttentionWeekKey?: string }>();
  return before ? { previous: before.reviewAttentionWeekKey ?? null } : false;
}

async function releaseWeeklySlot(businessId: string, weekKey: string, previous: string | null): Promise<void> {
  await Business.updateOne(
    { _id: businessId, reviewAttentionWeekKey: weekKey },
    previous ? { $set: { reviewAttentionWeekKey: previous } } : { $unset: { reviewAttentionWeekKey: '' } }
  );
}

/**
 * Daily digest cron (~7pm IST). No owner event is digest-delivered any more
 * (routine activity is dashboard-only), so this only retires rows queued
 * before that change — marked sent, never messaged. Kept registered so an
 * already-scheduled run has something safe to call.
 */
export async function sendPendingOwnerDigests(): Promise<{ businesses: number; sent: number }> {
  await dbConnect();
  const businessIds: any[] = await OwnerNotifyDigest.distinct('businessId', { sentAt: null });
  if (businessIds.length) {
    await OwnerNotifyDigest.updateMany({ sentAt: null }, { $set: { sentAt: new Date() } });
  }
  return { businesses: businessIds.length, sent: 0 };
}

/** The owner's resolved WhatsApp preferences (defaults applied), for callers that gate on them. */
export async function ownerWhatsAppPrefs(businessId: string): Promise<{ phone?: string; prefs: Record<string, boolean> } | null> {
  await dbConnect();
  const o = await resolveOwner(businessId);
  return o ? { phone: o.phone, prefs: o.prefs } : null;
}

export async function notifyOwner(businessId: string, input: NotifyOwnerInput): Promise<NotifyOwnerResult> {
  try {
    const delivery = ownerWhatsAppDelivery(input.event);
    // Routine activity: dashboard / in-app only — no lookup, no queue, no send.
    if (delivery === 'off') return { status: 'skipped', reason: 'whatsapp_off_for_event' };

    await dbConnect();
    const owner = await resolveOwner(businessId);
    if (!owner) return { status: 'skipped', reason: 'no_business' };
    if (!ownerBusinessWhatsAppAllowed(owner, input.event)) return { status: 'skipped', reason: 'not_eligible' };
    // Billing reminders are not business-activity notifications.
    if (!isBillingOwnerEvent(input.event) && !isOptedIn(owner.prefs, EVENT_PREF[input.event])) {
      return { status: 'skipped', reason: 'opted_out' };
    }
    if (!owner.phone) return { status: 'skipped', reason: 'no_phone' };

    // Limits are claimed only once the message would otherwise go out, so an
    // opted-out owner or a missing phone never uses up a slot.
    let release: (() => Promise<void>) | null = null;
    if (delivery === 'performance_update') {
      const claimedAt = await claimPerformanceUpdateSlot(businessId, new Date());
      if (!claimedAt) return { status: 'skipped', reason: 'performance_update_limit' };
      release = () => releasePerformanceUpdateSlot(businessId, claimedAt);
    } else if (delivery === 'weekly') {
      const weekKey = input.weekKey || isoWeekKey(new Date());
      const claim = await claimWeeklySlot(businessId, weekKey);
      if (!claim) return { status: 'skipped', reason: 'already_sent_this_week' };
      release = () => releaseWeeklySlot(businessId, weekKey, claim.previous);
    }

    const res = await sendOutboundMessage(owner.phone, input.text, undefined, businessId, undefined, owner.businessName);
    if (res.success) {
      // The monthly summary takes priority: it was not checked against the
      // performance limit, but it counts toward it from now on.
      if (delivery === 'performance_priority') {
        await Business.updateOne({ _id: businessId }, performanceUpdateClaimUpdate(new Date())).catch((err) =>
          console.error(`[ownerNotify] could not record the ${input.event} performance slot for ${businessId}:`, err?.message));
      }
      return { status: 'sent' };
    }
    if (release) await release().catch(() => {});
    return { status: 'failed', error: res.error };
  } catch (err: any) {
    console.error(`[ownerNotify] ${input.event} for business ${businessId} failed:`, err?.message);
    return { status: 'failed', error: err?.message };
  }
}
