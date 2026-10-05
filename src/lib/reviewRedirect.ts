import dbConnect from '@/lib/mongodb';
import ReviewRequest from '@/models/ReviewRequest';
import Business from '@/models/Business';
import Campaign from '@/models/Campaign';
import {
  GENERIC_REVIEW_REDIRECT,
  applyClick,
  buildGoogleReviewUrl,
  extractReviewToken,
  isSafeReviewToken,
} from '@/lib/reviewRequestFlow';

async function resolveClickedRedirect(reviewRequest: {
  clicked?: boolean;
  clickCount?: number;
  clickedAt?: Date;
  businessId: unknown;
  campaignId?: unknown;
  save: () => Promise<unknown>;
}): Promise<string> {
  const business = await Business.findById(reviewRequest.businessId).select('placeId googlePlaceId verifiedLocation.placeId').lean() as {
    placeId?: string;
    googlePlaceId?: string;
    verifiedLocation?: { placeId?: string };
  } | null;

  const reviewUrl = buildGoogleReviewUrl(business);
  const click = applyClick(reviewRequest);
  reviewRequest.clickCount = click.clickCount;
  if (click.setClickedAt) {
    reviewRequest.clicked = true;
    reviewRequest.clickedAt = new Date();
  }
  await reviewRequest.save();

  if (click.incrementCampaignClicked && reviewRequest.campaignId) {
    await Campaign.findByIdAndUpdate(reviewRequest.campaignId, { $inc: { clicked: 1 } });
  }

  return reviewUrl;
}

/** Existing /go/[id] and /api/campaigns/track/[requestId] lookup. */
export async function handleReviewRedirect(requestId: string): Promise<string> {
  await dbConnect();

  const reviewRequest = await ReviewRequest.findById(requestId);
  if (!reviewRequest) return GENERIC_REVIEW_REDIRECT;
  return resolveClickedRedirect(reviewRequest);
}

/**
 * Public /review/[token] lookup. An unknown or malformed token redirects to
 * a generic Google URL and does not describe why.
 */
export async function handleReviewRedirectByToken(token: string): Promise<string> {
  const reviewToken = extractReviewToken(token);
  if (!isSafeReviewToken(reviewToken)) return GENERIC_REVIEW_REDIRECT;

  await dbConnect();
  const reviewRequest = await ReviewRequest.findOne({ token: reviewToken });
  if (!reviewRequest) return GENERIC_REVIEW_REDIRECT;
  return resolveClickedRedirect(reviewRequest);
}
