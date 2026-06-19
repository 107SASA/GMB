import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Review from "@/models/Review";
import ReviewReply from "@/models/ReviewReply";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const { id } = await params;

    const review = await Review.findById(id);
    if (!review) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    if (review.replyStatus !== 'APPROVED') {
      return NextResponse.json({ error: "Reply must be approved before posting" }, { status: 400 });
    }

    // Simulate HTTP request to Google API
    console.log(`[MOCK API] Pushing reply to Google for review ID ${review._id}: "${review.aiSuggestedReply}"`);
    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
    
    review.replyStatus = 'POSTED';
    await review.save();

    await ReviewReply.create({
      reviewId: review._id,
      generatedReply: review.aiSuggestedReply,
      approved: true,
      posted: true,
      tone: review.replyTone || 'Professional',
      aiGenerated: true
    });

    return NextResponse.json({ success: true, message: "Reply posted successfully", review });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
