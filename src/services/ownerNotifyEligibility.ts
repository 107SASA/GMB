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
  | 'review_reply_drafted';

/** Billing notices are about the subscription itself, not activity inside Google. */
const BILLING_OWNER_EVENTS = new Set<OwnerBusinessEvent>([
  'billing_activated',
  'billing_past_due',
  'billing_canceled',
]);

/** These three send even when the customer has turned business WhatsApp off. */
export function isBillingOwnerEvent(event: OwnerBusinessEvent): boolean {
  return BILLING_OWNER_EVENTS.has(event);
}

export function ownerBusinessWhatsAppAllowed(
  business: {
    subscriptionStatus?: string | null;
    googleConnected?: boolean | null;
    googleLocationId?: string | null;
  } | null | undefined,
  event: OwnerBusinessEvent,
): boolean {
  if (BILLING_OWNER_EVENTS.has(event)) return true;
  if (!business) return false;
  const subscribed = business.subscriptionStatus === 'active';
  const connected =
    business.googleConnected === true &&
    typeof business.googleLocationId === 'string' &&
    business.googleLocationId.trim().length > 0;
  return subscribed && connected;
}
