import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Review from "@/models/Review";
import ReviewReply from "@/models/ReviewReply";
import { requireBusinessContext } from "@/lib/tenant";
import { requireModule } from "@/lib/moduleGating";

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

    console.log(`[MOCK API] Pushing reply to Google for review ID ${review._id}: "${review.aiSuggestedReply}"`);
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
