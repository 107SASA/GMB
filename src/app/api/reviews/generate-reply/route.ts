import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Review from '@/models/Review';
import Business from '@/models/Business';
import { generateReviewReply } from '@/services/ai/replyEngine';
import { requireBusinessContext } from '@/lib/tenant';

export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    const { reviewId, tone } = await req.json();

    if (!reviewId || !tone) {
      return NextResponse.json({ error: 'reviewId and tone are required' }, { status: 400 });
    }

    await dbConnect();

    const review = await Review.findOne({ _id: reviewId, businessId: ctx.businessId });
    if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 });

    const business = await Business.findById(ctx.businessId);
    const businessName = business?.name || 'Local Business';

    const aiReply = await generateReviewReply({
      reviewText: review.reviewText,
      rating: review.rating,
      tone,
      businessName
    });

    review.aiSuggestedReply = aiReply;
    review.replyTone = tone;
    await review.save();

    return NextResponse.json({ success: true, reply: aiReply });
  } catch (error: any) {
    console.error('Failed to generate AI reply:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
