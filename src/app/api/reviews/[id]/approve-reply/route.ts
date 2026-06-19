import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Review from "@/models/Review";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    const { id } = await params;
    
    // Optional: Extract edited aiSuggestedReply if the user edited it before approving
    let updatedReply;
    try {
      const body = await request.json();
      if (body && body.aiSuggestedReply) {
        updatedReply = body.aiSuggestedReply;
      }
    } catch(e) {
      // Body is empty or unparseable, ignore
    }

    const review = await Review.findById(id);
    if (!review) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    if (updatedReply) {
      review.aiSuggestedReply = updatedReply;
    }
    
    review.replyStatus = 'APPROVED';
    await review.save();

    return NextResponse.json({ success: true, review });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
