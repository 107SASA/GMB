import { NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { isAutoPublishActive, replyModeUpdate } from '@/lib/reviewReplyConsent';
import { queueUnrepliedBacklog } from '@/services/reviews/replyBacklog';

/**
 * Review reply-mode toggle (web Review Management + the app's Review
 * settings). 'auto' (DEFAULT): drafts that pass the fact check are posted
 * without waiting; drafts that fail wait for the owner. 'manual': every reply
 * is a fact-checked draft the owner approves before it is posted.
 * See lib/reviewReplyConsent.ts.
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
    autoPublishSince: active ? s?.autoPublishConsentAt ?? null : null,
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
      reviewReplySettings?: { mode?: string; autoPublishConsentAt?: Date; autoPublishConsentBy?: string };
    }>();
    const wasAuto = isAutoPublishActive(before?.reviewReplySettings);

    // Turning auto on records who switched it on (only fact-checked replies publish).
    await Business.updateOne(
      { _id: ctx.businessId },
      replyModeUpdate({ mode, tone, wasAuto, ownerUserId: String(ctx.userId) })
    );

    // Switching ON auto-reply (from manual, or the first time) means "all
    // reviews get a reply" per how this was asked for — not just ones that
    // arrive from now on. Queue the full existing backlog of unreplied
    // reviews for the same background job a normal sync would use.
    const queued = mode === 'auto' && !wasAuto ? await queueUnrepliedBacklog(String(ctx.businessId)) : 0;

    return NextResponse.json({ success: true, mode, tone, queued });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: toFriendlyMessage(error) }, { status: 500 });
  }
}
