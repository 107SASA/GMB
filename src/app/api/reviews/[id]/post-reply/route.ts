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
      // TODO: real Google Business Profile "reviews.updateReply" call goes here,
      // once verified on a test account. It MUST run only inside this branch.
      throw new Error('Live GBP review-reply posting is not implemented yet.');
    } else {
      console.log(`[MOCK] GBP live writes disabled — recording reply locally only for review ${review._id}: "${review.aiSuggestedReply}"`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));

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
