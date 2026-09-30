import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import Review from '@/models/Review';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { isAutoPublishActive } from '@/services/reviews/replyPipeline';

/**
 * Review Management's reply-mode toggle. 'manual' (DEFAULT): every reply is a
 * fact-checked draft the owner approves before it is posted. 'auto': drafts
 * that pass the fact check are posted without waiting; drafts that fail wait
 * for the owner. Auto is active only when the owner switched it on here
 * (autoPublishConsentAt recorded) — a legacy mode:'auto' saved before the
 * fact-checked flow existed is treated as manual until re-enabled.
 * See services/reviews/replyPipeline.ts.
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
    reviewReplySettings?: { mode?: string; tone?: string; autoPublishConsentAt?: Date };
  }>();
  const s = business?.reviewReplySettings;
  const active = isAutoPublishActive(s);

  return NextResponse.json({
    success: true,
    mode: active ? 'auto' : 'manual',
    tone: s?.tone ?? 'Professional',
    autoPublishSince: active ? s?.autoPublishConsentAt : null,
    // Saved as 'auto' before replies were fact-checked — paused until the owner turns it on again.
    legacyAutoPaused: s?.mode === 'auto' && !active,
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
      reviewReplySettings?: { mode?: string; autoPublishConsentAt?: Date };
    }>();
    const wasAuto = isAutoPublishActive(before?.reviewReplySettings);

    await Business.updateOne(
      { _id: ctx.businessId },
      mode === 'auto'
        ? {
            $set: {
              'reviewReplySettings.mode': 'auto',
              // The owner's explicit opt-in to automatic publishing (only fact-checked replies).
              ...(wasAuto ? {} : { 'reviewReplySettings.autoPublishConsentAt': new Date(), 'reviewReplySettings.autoPublishConsentBy': ctx.userId }),
              ...(tone ? { 'reviewReplySettings.tone': tone } : {}),
            },
          }
        : {
            $set: { 'reviewReplySettings.mode': 'manual', ...(tone ? { 'reviewReplySettings.tone': tone } : {}) },
            $unset: { 'reviewReplySettings.autoPublishConsentAt': 1, 'reviewReplySettings.autoPublishConsentBy': 1 },
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
        replyStatus: { $in: [null, 'PENDING'] },
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
