import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Review from "@/models/Review";
import { requireBusinessContext } from "@/lib/tenant";
import { requireModule } from "@/lib/moduleGating";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'reputation_agent');
    if (!gate.ok) return gate.response;

    await dbConnect();

    const { searchParams } = new URL(req.url);
    const replyStatus = searchParams.get("replyStatus");
    const sentiment = searchParams.get("sentiment");

    const query: any = { businessId: ctx.businessId };
    if (replyStatus) query.replyStatus = replyStatus;
    if (sentiment) query.sentiment = sentiment;

    // postedAt = when the customer left the review on Google; createdAt is
    // only the sync time, kept as tiebreaker/fallback for pre-postedAt docs.
    const reviews = await Review.find(query).sort({ postedAt: -1, createdAt: -1 });
    return NextResponse.json(reviews);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'reputation_agent');
    if (!gate.ok) return gate.response;

    await dbConnect();
    const body = await request.json();

    const review = await Review.create({
      ...body,
      businessId: ctx.businessId,
      tenantId: ctx.organizationId,
      organizationId: ctx.organizationId,
    });
    return NextResponse.json(review, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
