import { NextResponse } from 'next/server';
import { validateApiKey } from '@/middleware/apiKeyAuth';
import dbConnect from '@/lib/mongodb';
import Review from '@/models/Review';
import Business from '@/models/Business';
import { generateReviewReply } from '@/services/ai/replyEngine';

export async function POST(req: Request) {
  const auth = validateApiKey(req);
  if (!auth.ok) return auth.response;

  try {
    const { reviewId } = await req.json();

    if (!reviewId) {
      return NextResponse.json(
        { success: false, error: 'reviewId is required' },
        { status: 400 }
      );
    }

    await dbConnect();

    const review = await Review.findById(reviewId);
    if (!review) {
      return NextResponse.json({ success: false, error: 'Review not found' }, { status: 404 });
    }

    const business = await Business.findById(review.businessId).select('name').lean();
    const businessName = (business as any)?.name || 'Local Business';

    const { reply: aiReply } = await generateReviewReply({
      reviewText: review.reviewText,
      rating: review.rating,
      tone: 'Professional',
      businessName,
    });

    review.aiSuggestedReply = aiReply;
    review.replyTone = 'Professional';
    await review.save();

    return NextResponse.json({
      success: true,
      reviewId,
      replyText: aiReply,
    });
  } catch (error: any) {
    console.error('[n8n/generate-reply]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
