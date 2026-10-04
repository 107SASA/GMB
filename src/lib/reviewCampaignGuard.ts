import Business from '@/models/Business';
import { PLACE_ID_REQUIRED_MESSAGE } from '@/lib/reviewRequestFlow';

/**
 * A review request's first message to any given customer is, by definition,
 * almost always "cold" (WhatsApp's 24h customer-service window — the
 * customer hasn't messaged the AI agent first). The free-text send then
 * gets rejected. Recovery is an approved Content Template, which still needs
 * the business's Google Place ID so the click redirect can open the right
 * Google review form. Without one, the send is refused up front.
 *
 * Call this before queuing any `campaigns/review.request.start` event so the
 * owner gets a clear, actionable error up front instead of a customer
 * silently never getting a message.
 */
export async function requirePlaceIdForReviews(businessId: string): Promise<string | null> {
  const business = await Business.findById(businessId).select('placeId').lean<{ placeId?: string }>();
  if (!business?.placeId) {
    return PLACE_ID_REQUIRED_MESSAGE;
  }
  return null;
}
