import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import Review from '@/models/Review';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

/**
 * Review Management's reply-mode toggle: 'manual' (AI drafts, owner
 * approves — the existing generate/approve/post flow) or 'auto' (AI drafts
 * AND posts on its own). See services/reviews/autoReply.ts for what 'auto'
 * actually does, and Business.reviewReplySettings for where it's stored.
 */
const bodySchema = z.object({
  mode: z.enum(['manual', 'auto']),
  tone: z.enum(['Professional', 'Friendly', 'Apology', 'Empathetic']).optional(),
});

export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  await dbConnect();
  const business = await Business.findById(ctx.businessId).select('reviewReplySettings').lean<{
    reviewReplySettings?: { mode?: string; tone?: string };
  }>();

  return NextResponse.json({
    success: true,
    mode: business?.reviewReplySettings?.mode ?? 'manual',
    tone: business?.reviewReplySettings?.tone ?? 'Professional',
  });
}

export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const gate = await requireModule(ctx.userId, 'reputation_agent');
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }
    const { mode, tone } = parsed.data;

    await dbConnect();

    const before = await Business.findById(ctx.businessId).select('reviewReplySettings').lean<{
      reviewReplySettings?: { mode?: string };
    }>();
    const wasAuto = before?.reviewReplySettings?.mode === 'auto';

    await Business.updateOne(
      { _id: ctx.businessId },
      {
        $set: {
          'reviewReplySettings.mode': mode,
          ...(tone ? { 'reviewReplySettings.tone': tone } : {}),
        },
      }
    );

    // Switching ON auto-reply (from manual, or the first time) means "all
    // reviews get a reply" per how this was asked for — not just ones that
    // arrive from now on. Queue the full existing backlog of unreplied
    // reviews for the same background job a normal sync would use.
    let queued = 0;
    if (mode === 'auto' && !wasAuto) {
      const pending = await Review.find({
        businessId: ctx.businessId,
        response: { $in: [null, undefined, ''] },
        replyStatus: { $ne: 'POSTED' },
      }).select('_id').lean();

      if (pending.length > 0) {
        const { inngest } = await import('@/services/inngest/client');
        await inngest.send({
          name: 'reviews/auto-reply-batch',
          data: { businessId: ctx.businessId, reviewIds: pending.map((r) => r._id.toString()) },
        });
        queued = pending.length;
      }
    }

    return NextResponse.json({ success: true, mode, tone, queued });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
