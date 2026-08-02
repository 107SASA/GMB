import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Review from "@/models/Review";
import ReviewReply from "@/models/ReviewReply";
import { requireBusinessContext } from "@/lib/tenant";
import { requireModule } from "@/lib/moduleGating";
import { gbpWritesEnabled } from "@/lib/gbpSafety";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'reputation_agent');
    if (!gate.ok) return gate.response;

    await dbConnect();
    const { id } = await params;

    const review = await Review.findOne({ _id: id, businessId: ctx.businessId });
    if (!review) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    if (review.replyStatus !== 'APPROVED') {
      return NextResponse.json({ error: "Reply must be approved before posting" }, { status: 400 });
    }

    // SAFETY: writing a reply to a real Google Business Profile is gated behind
    // GBP_LIVE_WRITES_ENABLED (off by default). While disabled we only record
    // the reply in our own DB — nothing is pushed to the customer's live profile.
    // Do NOT add a real Google API call here without wrapping it in this guard.
    if (gbpWritesEnabled()) {
      // Real Google Business Profile reviews.updateReply (gated ON).
      // NOTE: this needs a REAL GBP review resource id. `providerReviewId` is
      // always present (SerpApi/mock reviews have one too, just a synthetic
      // one — see src/services/reviews/providers/SerpApiGoogleProvider.ts),
      // so checking for its mere presence isn't enough. Only `source ===
      // 'gbp_api'` means this review actually came from the official API and
      // can receive a reply — see src/services/reviews/syncReviews.ts.
      if (review.source !== 'gbp_api' || !review.providerReviewId) {
        throw new Error('Cannot post reply: this review is not from a connected Google Business Profile (connect Google to reply to it).');
      }
      const { replyToReview } = await import('@/lib/gbpClient');
      await replyToReview(ctx.businessId, review.providerReviewId, review.aiSuggestedReply);
    } else {
      console.log(`[MOCK] GBP live writes disabled — recording reply locally only for review ${review._id}: "${review.aiSuggestedReply}"`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    review.response = review.aiSuggestedReply;
    review.replyStatus = 'POSTED';
    await review.save();

    await ReviewReply.create({
      reviewId: review._id,
      generatedReply: review.aiSuggestedReply,
      approved: true,
      posted: true,
      tone: review.replyTone || 'Professional',
      aiGenerated: true,
    });

    return NextResponse.json({ success: true, message: "Reply posted successfully", review });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
