import dbConnect from '@/lib/mongodb';
import ReviewRequest from '@/models/ReviewRequest';
import Business from '@/models/Business';
import Campaign from '@/models/Campaign';

export async function handleReviewRedirect(requestId: string): Promise<string> {
  await dbConnect();

  const reviewRequest = await ReviewRequest.findById(requestId);
  if (!reviewRequest) {
    return 'https://google.com';
  }

  const business = await Business.findById(reviewRequest.businessId).select('placeId googleMapsUrl name').lean() as any;

  const reviewUrl = business?.placeId
    ? `https://search.google.com/local/writereview?placeid=${business.placeId}`
    : business?.googleMapsUrl
    ? business.googleMapsUrl
    : `https://google.com/search?q=${encodeURIComponent(business?.name || 'business review')}`;

  if (!reviewRequest.clicked) {
    reviewRequest.clicked = true;
    reviewRequest.clickedAt = new Date();
    await reviewRequest.save();

    if (reviewRequest.campaignId) {
      await Campaign.findByIdAndUpdate(reviewRequest.campaignId, { $inc: { clicked: 1 } });
    }
  }

  return reviewUrl;
}
