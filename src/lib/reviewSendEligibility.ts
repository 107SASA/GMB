import Business from '@/models/Business';
import Customer from '@/models/Customer';
import { isWhatsAppSuppressed } from '@/services/messaging/inboundOptOut';
import ReviewRequest from '@/models/ReviewRequest';
import { checkUsageLimit } from '@/lib/featureGating';
import {
  REVIEW_SEND_COOLDOWN_ENFORCED,
  decideReviewSendEligibility,
  type ReviewSendSource,
} from '@/lib/reviewRequestFlow';

/**
 * One eligibility check for web send, web quick-add, mobile send, campaign
 * launch, and retry. The customer-level "3 attempts / 24 hours" rule is not
 * applied: REVIEW_SEND_COOLDOWN_ENFORCED stays false.
 *
 * A number that replied STOP to this business (MessagingSuppression) is
 * treated as opted out even when the Customer record says otherwise — a
 * deleted-and-re-added customer, or an owner un-ticking "opted out", does not
 * make it messageable again. The Customer flag is brought back in line.
 */
export async function evaluateReviewSendEligibility(opts: {
  source: ReviewSendSource;
  businessId: string;
  userId?: string;
  customer: { _id: unknown; optedOut?: boolean; phone?: string | null };
  campaignId?: string;
}): Promise<{ allowed: boolean; code: string; message: string }> {
  const business = await Business.findById(opts.businessId).select('placeId userId').lean<{
    placeId?: string;
    userId?: { toString(): string };
  }>();

  let dailyLimitReached = false;
  let dailyLimitMessage: string | undefined;
  const userId = opts.userId || business?.userId?.toString();
  if (userId) {
    const usage = await checkUsageLimit(userId, opts.businessId, 'whatsappMessages');
    if (!usage.allowed) {
      dailyLimitReached = true;
      dailyLimitMessage = usage.reason;
    }
  }

  let hasActiveCampaignRequest = false;
  if (opts.source === 'campaign' && opts.campaignId) {
    hasActiveCampaignRequest = !!(await ReviewRequest.exists({
      campaignId: opts.campaignId,
      customerId: opts.customer._id,
      automationStatus: 'Active',
    }));
  }

  let optedOut = !!opts.customer.optedOut;
  if (!optedOut && await isWhatsAppSuppressed(opts.businessId, opts.customer.phone)) {
    optedOut = true;
    await Customer.updateOne({ _id: opts.customer._id, businessId: opts.businessId }, { $set: { optedOut: true } }).catch(() => {});
  }

  return decideReviewSendEligibility({
    source: opts.source,
    optedOut,
    hasPhone: !!opts.customer.phone,
    hasPlaceId: !!business?.placeId,
    dailyLimitReached,
    dailyLimitMessage,
    hasActiveCampaignRequest,
    cooldownActive: REVIEW_SEND_COOLDOWN_ENFORCED,
  });
}
