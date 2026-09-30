import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import { approveReply } from "@/services/reviews/replyPipeline";
import { requireBusinessContext } from "@/lib/tenant";
import { requireModule } from "@/lib/moduleGating";
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'reputation_agent');
    if (!gate.ok) return gate.response;

    await dbConnect();
    const { id } = await params;

    let updatedReply: string | undefined;
    try {
      const body = await request.json();
      if (body?.aiSuggestedReply) updatedReply = String(body.aiSuggestedReply);
    } catch {
      // No body — approve the stored draft as-is.
    }

    // The exact text (owner-edited or not) must pass the fact check to be approved.
    const r = await approveReply(ctx.businessId, id, { text: updatedReply, by: 'owner' });
    if (!r.review) return NextResponse.json({ error: "Review not found" }, { status: 404 });
    if (!r.ok) {
      return NextResponse.json({ success: false, error: `This reply can't be approved yet: ${r.reasons.join('; ')}`, reasons: r.reasons, review: r.review }, { status: 422 });
    }
    return NextResponse.json({ success: true, review: r.review });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
