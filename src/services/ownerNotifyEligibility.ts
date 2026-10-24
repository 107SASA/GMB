import { workspaceHasPlanAccess } from '../lib/billing/entitlements.ts';

/**
 * Who may receive WhatsApp about activity inside their Google business.
 * A free-report phone is a sales lead until they subscribe and connect Google.
 */

export type OwnerBusinessEvent =
  | 'new_lead'
  | 'demo_booking'
  | 'critical_review'
  | 'report_ready'
  | 'billing_activated'
  | 'billing_past_due'
  | 'billing_canceled'
  | 'billing_trial_ending'
  | 'billing_trial_expired'
  | 'profile_incomplete'
  | 'monthly_report'
  | 'weekly_update'
  | 'festival_prompt'
  | 'review_reminder'
  | 'performance_digest'
  | 'post_published'
  | 'photo_published'
  | 'review_reply_sent'
  | 'content_batch_generated'
  | 'review_reply_drafted'
  | 'review_attention';

/**
 * WhatsApp policy per owner event (Oct 2026 — fewer, more meaningful messages).
 *
 *  - immediate:          action needed or transactional (new lead, critical
 *                        review, billing, report ready).
 *  - performance_priority: the monthly report summary. Never held back by
 *                        the performance limit (it is once per report), but
 *                        it USES one of the slots below, so the weekly update
 *                        and 15-day digest around it give way to it.
 *  - performance_update: routine performance summary — at most
 *                        PERFORMANCE_UPDATE_LIMIT per business per rolling
 *                        PERFORMANCE_UPDATE_WINDOW_DAYS (lib/ownerWhatsAppLimits.ts).
 *  - weekly:             the reviews-need-attention reminder, once per ISO week.
 *  - off:                routine activity. Stays in the dashboard / in-app
 *                        notifications; never sent over WhatsApp.
 */
export type OwnerWhatsAppDelivery = 'immediate' | 'performance_priority' | 'performance_update' | 'weekly' | 'off';

export const OWNER_WHATSAPP_DELIVERY: Record<OwnerBusinessEvent, OwnerWhatsAppDelivery> = {
  new_lead: 'immediate',
  demo_booking: 'immediate',
  critical_review: 'immediate',
  report_ready: 'immediate',
  billing_activated: 'immediate',
  billing_past_due: 'immediate',
  billing_canceled: 'immediate',
  billing_trial_ending: 'immediate',
  billing_trial_expired: 'immediate',
  profile_incomplete: 'immediate',
  monthly_report: 'performance_priority',
  weekly_update: 'performance_update',
  performance_digest: 'performance_update',
  review_attention: 'weekly',
  festival_prompt: 'off',
  review_reminder: 'off',
  post_published: 'off',
  photo_published: 'off',
  review_reply_sent: 'off',
  review_reply_drafted: 'off',
  content_batch_generated: 'off',
};

export function ownerWhatsAppDelivery(event: OwnerBusinessEvent): OwnerWhatsAppDelivery {
  return OWNER_WHATSAPP_DELIVERY[event] ?? 'off';
}

/** Billing notices are about the subscription itself, not activity inside Google. */
const BILLING_OWNER_EVENTS = new Set<OwnerBusinessEvent>([
  'billing_activated',
  'billing_past_due',
  'billing_canceled',
  'billing_trial_ending',
  'billing_trial_expired',
]);

/** Billing notices send even when the customer has turned business WhatsApp off (the trial notices check billingWhatsApp themselves). */
export function isBillingOwnerEvent(event: OwnerBusinessEvent): boolean {
  return BILLING_OWNER_EVENTS.has(event);
}

export function ownerBusinessWhatsAppAllowed(
  business: {
    subscriptionStatus?: string | null;
    trialEndsAt?: Date | string | null;
    trialCancelledAt?: Date | string | null;
    paymentGraceEndsAt?: Date | string | null;
    paymentAccessHold?: boolean | null;
    googleConnected?: boolean | null;
    googleLocationId?: string | null;
  } | null | undefined,
  event: OwnerBusinessEvent,
): boolean {
  if (BILLING_OWNER_EVENTS.has(event)) return true;
  if (!business) return false;
  // Paid, or an authorized free trial within its window.
  const subscribed = workspaceHasPlanAccess(business);
  const connected =
    business.googleConnected === true &&
    typeof business.googleLocationId === 'string' &&
    business.googleLocationId.trim().length > 0;
  return subscribed && connected;
}
