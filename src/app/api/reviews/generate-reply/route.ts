import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Review from '@/models/Review';
import { draftReply } from '@/services/reviews/replyPipeline';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { logAIUsage } from '@/lib/logAIUsage';
import { checkUsageLimit } from '@/lib/featureGating';
import { checkRateLimit } from '@/lib/rateLimit';
import { GROQ_MODEL } from '@/lib/aiModel';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

// Burst guard (per account, short window), independent of the plan's
// aiGenerations quota.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'reputation_agent');
    if (!gate.ok) return gate.response;

    const rl = checkRateLimit(`review-reply:${ctx.userId}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests — please wait a few minutes and try again.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }

    const { reviewId, tone } = await req.json();

    if (!reviewId || !tone) {
      return NextResponse.json({ error: 'reviewId and tone are required' }, { status: 400 });
    }

    // Check AI generation limit
    const limitCheck = await checkUsageLimit(ctx.userId, ctx.businessId, 'aiGenerations');
    if (!limitCheck.allowed) {
      return NextResponse.json(
        { error: limitCheck.reason, code: limitCheck.code ?? 'UPGRADE_REQUIRED', limit: limitCheck.limit, used: limitCheck.used },
        { status: 403 }
      );
    }

    await dbConnect();

    const review = await Review.findOne({ _id: reviewId, businessId: ctx.businessId });
    if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 });

    // Verified business + SEO context → AI draft → fact/policy/quality check
    // (one regeneration) → DRAFT or NEEDS_REVIEW. Never published from here.
    const startMs = Date.now();
    const d = await draftReply(ctx.businessId, String(review._id), { tone });
    if (d.error || !d.reply) {
      return NextResponse.json({ error: 'Could not draft a reply right now — try again.' }, { status: 502 });
    }

    void logAIUsage({
      userId: ctx.userId,
      businessId: ctx.businessId,
      promptType: 'review_reply',
      aiModel: GROQ_MODEL,
      promptTokens: d.usage?.promptTokens ?? 0,
      completionTokens: d.usage?.completionTokens ?? 0,
      status: 'success',
      durationMs: Date.now() - startMs,
    });

    return NextResponse.json({ success: true, reply: d.reply, replyStatus: d.status, validation: d.validation });
  } catch (error: any) {
    console.error('Failed to generate AI reply:', error);
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
