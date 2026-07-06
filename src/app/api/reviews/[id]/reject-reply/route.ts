import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Review from "@/models/Review";
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

    if (review.replyStatus === 'POSTED') {
      return NextResponse.json({ error: "Reply has already been posted" }, { status: 400 });
    }

    review.replyStatus = 'REJECTED';
    await review.save();

    return NextResponse.json({ success: true, review });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
