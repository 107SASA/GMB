import dbConnect from '@/lib/mongodb';
import ReviewRequest from '@/models/ReviewRequest';
import Business from '@/models/Business';
import Campaign from '@/models/Campaign';
import {
  GENERIC_REVIEW_REDIRECT,
  applyClick,
  buildGoogleReviewUrl,
  extractReviewToken,
  isLinkPreviewRequest,
  isSafeReviewToken,
} from '@/lib/reviewRequestFlow';

/** Who opened the link: a preview fetch is redirected but not recorded as a click. */
export interface ReviewLinkVisit {
  method?: string | null;
  userAgent?: string | null;
}

async function resolveClickedRedirect(reviewRequest: {
  clicked?: boolean;
  clickCount?: number;
  clickedAt?: Date;
  businessId: unknown;
  campaignId?: unknown;
  save: () => Promise<unknown>;
}, visit: ReviewLinkVisit = {}): Promise<string> {
  const business = await Business.findById(reviewRequest.businessId).select('placeId googlePlaceId verifiedLocation.placeId googleMapsUrl').lean() as {
    placeId?: string;
    googlePlaceId?: string;
    verifiedLocation?: { placeId?: string };
    googleMapsUrl?: string;
  } | null;

  const reviewUrl = buildGoogleReviewUrl(business);
  if (isLinkPreviewRequest(visit)) return reviewUrl;
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
export async function handleReviewRedirect(requestId: string, visit: ReviewLinkVisit = {}): Promise<string> {
  await dbConnect();

  const reviewRequest = await ReviewRequest.findById(requestId);
  if (!reviewRequest) return GENERIC_REVIEW_REDIRECT;
  return resolveClickedRedirect(reviewRequest, visit);
}

/**
 * Public /review/[token] lookup. An unknown or malformed token redirects to
 * a generic Google URL and does not describe why.
 */
export async function handleReviewRedirectByToken(token: string, visit: ReviewLinkVisit = {}): Promise<string> {
  const reviewToken = extractReviewToken(token);
  if (!isSafeReviewToken(reviewToken)) return GENERIC_REVIEW_REDIRECT;

  await dbConnect();
  const reviewRequest = await ReviewRequest.findOne({ token: reviewToken });
  if (!reviewRequest) return GENERIC_REVIEW_REDIRECT;
  return resolveClickedRedirect(reviewRequest, visit);
}
