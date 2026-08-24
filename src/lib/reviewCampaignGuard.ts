import Business from '@/models/Business';

/**
 * A review request's first message to any given customer is, by definition,
 * almost always "cold" (WhatsApp's 24h customer-service window — the
 * customer hasn't messaged the AI agent first). The free-text send then
 * gets rejected, and the only recovery is retrying via the approved
 * `growwmatics_review_request` Content Template (src/services/inngest/functions.ts,
 * sendReviewRequest) — which needs the business's Google Place ID to build
 * its "Leave a Review" button. Without one, that fallback is skipped
 * entirely and the request just fails with nothing sent.
 *
 * Call this before queuing any `campaigns/review.request.start` event so the
 * owner gets a clear, actionable error up front instead of a customer
 * silently never getting a message.
 */
export async function requirePlaceIdForReviews(businessId: string): Promise<string | null> {
  const business = await Business.findById(businessId).select('placeId').lean<{ placeId?: string }>();
  if (!business?.placeId) {
    return 'Connect and verify your Google Business Profile before sending review requests. Without it, WhatsApp cannot deliver a review request to a customer who hasn\'t messaged you before — go to Settings → Google Business Profile to connect it.';
  }
  return null;
}
