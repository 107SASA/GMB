import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import { requireBusinessContext } from "@/lib/tenant";
import { requireModule } from "@/lib/moduleGating";
import { publishReply } from '@/services/reviews/replyPipeline';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'reputation_agent');
    if (!gate.ok) return gate.response;

    await dbConnect();
    const { id } = await params;

    // Requires owner approval; re-checks the exact text; POSTED only when Google confirms.
    const r = await publishReply(ctx.businessId, id);
    if (r.outcome === 'refused') {
      return NextResponse.json({ success: false, error: r.reason, review: r.review }, { status: r.review ? 400 : 404 });
    }
    if (r.outcome === 'failed') {
      return NextResponse.json({ success: false, error: r.reason, review: r.review }, { status: 502 });
    }
    if (r.outcome === 'blocked') {
      return NextResponse.json({ success: false, blocked: true, message: r.reason, review: r.review }, { status: 200 });
    }
    return NextResponse.json({ success: true, message: "Reply posted to Google", review: r.review });
  } catch (error: any) {
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
