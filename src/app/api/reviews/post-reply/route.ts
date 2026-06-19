import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Review from '@/models/Review';
import AutomationLog from '@/models/AutomationLog';
import { requireBusinessContext } from '@/lib/tenant';
import { googleProvider } from '@/services/reviews/providers/MockGoogleProvider';

export async function POST(req: Request) {
  try {
    const { reviewId, replyText } = await req.json();

    if (!reviewId || !replyText) {
      return NextResponse.json({ error: 'reviewId and replyText are required' }, { status: 400 });
    }

    await dbConnect();
    const review = await Review.findById(reviewId);
    if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 });

    if (!review.providerReviewId) {
      return NextResponse.json({ error: 'Review lacks provider ID' }, { status: 400 });
    }

    // Verify the caller owns the business this review belongs to
    const ctx = await requireBusinessContext({
      businessIdFromBody: review.businessId?.toString(),
    });
    if (!ctx.ok) return ctx.response;

    await googleProvider.postReply(review.providerReviewId, replyText);

    review.response = replyText;
    review.replyStatus = 'POSTED';
    await review.save();

    await AutomationLog.create({
      tenantId: ctx.organizationId,
      businessId: ctx.businessId,
      type: 'ai_generation',
      workflow: 'review-reply',
      action: 'post_reply',
      status: 'success',
      message: `Successfully posted reply to review ${review.providerReviewId}`,
    });

    return NextResponse.json({ success: true, review });
  } catch (error: any) {
    console.error('Failed to post reply:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
