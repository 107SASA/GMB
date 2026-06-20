import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Review from "@/models/Review";
import { requireBusinessContext } from "@/lib/tenant";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();
    const { id } = await params;

    const review = await Review.findOne({ _id: id, businessId: ctx.businessId });
    if (!review) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    let updatedReply: string | undefined;
    try {
      const body = await request.json();
      if (body?.aiSuggestedReply) updatedReply = body.aiSuggestedReply;
    } catch {
      // empty or unparseable body — keep existing aiSuggestedReply
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
