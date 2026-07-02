import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Review from '@/models/Review';
import Business from '@/models/Business';
import { generateReviewReply } from '@/services/ai/replyEngine';
import { requireBusinessContext } from '@/lib/tenant';
import { logAIUsage } from '@/lib/logAIUsage';
import { checkUsageLimit } from '@/lib/featureGating';

export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    const { reviewId, tone } = await req.json();

    if (!reviewId || !tone) {
      return NextResponse.json({ error: 'reviewId and tone are required' }, { status: 400 });
    }

    // Check AI generation limit
    const limitCheck = await checkUsageLimit(ctx.userId, ctx.businessId, 'aiGenerations');
    if (!limitCheck.allowed) {
      return NextResponse.json(
        { error: limitCheck.reason, code: limitCheck.code ?? 'UPGRADE_REQUIRED', limit: limitCheck.limit, used: limitCheck.used },
        { status: 403 }
      );
    }

    await dbConnect();

    const review = await Review.findOne({ _id: reviewId, businessId: ctx.businessId });
    if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 });

    const business = await Business.findById(ctx.businessId);
    const businessName = business?.name || 'Local Business';

    const startMs = Date.now();
    const { reply: aiReply, promptTokens, completionTokens } = await generateReviewReply({
      reviewText: review.reviewText,
      rating: review.rating,
      tone,
      businessName
    });

    void logAIUsage({
      userId: ctx.userId,
      businessId: ctx.businessId,
      promptType: 'review_reply',
      aiModel: 'llama-3.3-70b-versatile',
      promptTokens,
      completionTokens,
      status: 'success',
      durationMs: Date.now() - startMs,
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
