import Groq from 'groq-sdk';
import dbConnect from '@/lib/mongodb';
import { GROQ_MODEL } from '@/lib/aiModel';
import { withGroqRetry } from '@/lib/groqRetry';
import { logAIUsage } from '@/lib/logAIUsage';
import { checkDurableRateLimit } from '@/lib/durableRateLimit';
import { findReviewRequestByToken } from '@/lib/reviewRedirect';
import { usablePersonName } from '@/lib/personName';
import {
  MAX_FEEDBACK_CHARS,
  QUALITY_CHIPS,
  buildDraftPrompt,
  buildServiceChips,
  chooseKeyword,
  cleanDraft,
  cleanNote,
  fallbackDraft,
  isValidRating,
  pickedChips,
  wantsDraft,
} from '@/lib/reviewAssist';

/**
 * Server side of the review assistant (lib/reviewAssist.ts has the rules).
 * Public, token-addressed: nothing here returns ids, phone numbers or the
 * keyword list itself — only the chips the customer sees and the draft.
 */

export interface ReviewPageContext {
  businessId: string;
  userId: string | null;
  businessName: string;
  category: string;
  firstName: string | null;
  serviceChips: string[];
  qualityChips: string[];
  /** Server only — never sent to the page. */
  keywords: string[];
}

const split = (s?: string) => String(s || '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);

export async function reviewPageContext(reviewRequest: { businessId: unknown; customerId?: unknown }): Promise<ReviewPageContext | null> {
  await dbConnect();
  const [{ default: Business }, { default: Customer }, { getActiveSeoPlan }, { targetKeywords }] = await Promise.all([
    import('@/models/Business'),
    import('@/models/Customer'),
    import('@/services/seoPlan/seoPlanService'),
    import('@/services/seo/keywordSet'),
  ]);
  const businessId = String(reviewRequest.businessId);
  const [b, customer, plan]: any[] = await Promise.all([
    Business.findById(businessId).select('name category userDefinedCategory services userId').lean(),
    reviewRequest.customerId ? Customer.findById(reviewRequest.customerId).select('name').lean() : null,
    getActiveSeoPlan(businessId).catch(() => null),
  ]);
  if (!b) return null;

  const brandWord = String(b.name || '').toLowerCase().split(/\s+/)[0];
  const targets = targetKeywords(plan?.keywordSet);
  const removed = new Set((plan?.ownerRemovedKeywords || []).map((k: unknown) => String(k).trim().toLowerCase()));
  const keywords = (targets.length
    ? targets.map((k) => k.keyword)
    : (plan?.keywordTable || []).filter((r: any) => (r.rankStatus ?? 'ok') === 'ok').map((r: any) => r.keyword)
  )
    .map((k: unknown) => String(k || '').trim())
    .filter((k: string) => k && !removed.has(k.toLowerCase()) && !(brandWord.length >= 3 && k.toLowerCase().includes(brandWord)))
    .slice(0, 8);

  const name = usablePersonName(String(customer?.name || ''));
  return {
    businessId,
    userId: b.userId ? String(b.userId) : null,
    businessName: String(b.name || ''),
    category: String(b.userDefinedCategory || b.category || ''),
    firstName: name ? name.split(/\s+/)[0] : null,
    serviceChips: buildServiceChips({
      keywordServices: targets.map((k) => k.service),
      ownerServices: split(b.services),
      businessName: b.name,
    }),
    qualityChips: [...QUALITY_CHIPS],
    keywords,
  };
}

export type DraftResult =
  | { ok: true; draft: string; source: 'ai' | 'template' }
  | { ok: false; status: number; error: string };

async function aiDraft(ctx: ReviewPageContext, prompt: string): Promise<string | null> {
  if (!process.env.GROQ_API_KEY) return null;
  const started = Date.now();
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    // The customer is waiting on the page: one short retry, then the template.
    const res: any = await withGroqRetry(
      () => groq.chat.completions.create({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.9,
        // gpt-oss is a reasoning model; its reasoning counts against max_tokens.
        max_tokens: 1200,
        reasoning_effort: 'low',
      } as any),
      { retries: 1, maxWaitMs: 4000, reason: 'review_draft' },
    );
    const draft = cleanDraft(res?.choices?.[0]?.message?.content);
    if (ctx.userId) {
      void logAIUsage({
        userId: ctx.userId,
        businessId: ctx.businessId,
        promptType: 'review_draft',
        aiModel: GROQ_MODEL,
        promptTokens: res?.usage?.prompt_tokens ?? 0,
        completionTokens: res?.usage?.completion_tokens ?? 0,
        status: draft ? 'success' : 'partial',
        durationMs: Date.now() - started,
      });
    }
    return draft;
  } catch (err: any) {
    console.warn('[reviewAssist] AI draft failed, using template:', err?.message);
    if (ctx.userId) {
      void logAIUsage({ userId: ctx.userId, businessId: ctx.businessId, promptType: 'review_draft', aiModel: GROQ_MODEL, status: 'failed', errorMessage: String(err?.message || '').slice(0, 300), durationMs: Date.now() - started });
    }
    return null;
  }
}

/** Per link and per visitor IP; past the limit the customer still gets a template draft. */
const DRAFTS_PER_LINK_PER_HOUR = 8;
const DRAFTS_PER_IP_PER_HOUR = 30;
const FEEDBACK_PER_LINK_PER_DAY = 3;

export async function draftForToken(token: string, body: { rating?: unknown; picked?: unknown; note?: unknown; variant?: unknown }, ip: string): Promise<DraftResult> {
  if (!isValidRating(body.rating)) return { ok: false, status: 400, error: 'Pick a star rating first.' };
  const rating = body.rating;
  if (!wantsDraft(rating)) return { ok: false, status: 400, error: 'Drafts are only offered for 4 and 5 stars.' };

  const reviewRequest: any = await findReviewRequestByToken(token);
  if (!reviewRequest) return { ok: false, status: 404, error: 'This review link is not valid.' };
  const ctx = await reviewPageContext(reviewRequest);
  if (!ctx) return { ok: false, status: 404, error: 'This review link is not valid.' };

  const picked = pickedChips(body.picked, [...ctx.serviceChips, ...ctx.qualityChips]);
  const note = cleanNote(body.note);
  const variant = Number.isFinite(Number(body.variant)) ? Math.floor(Number(body.variant)) : 0;
  const keyword = chooseKeyword(ctx.keywords, picked);

  const hour = 60 * 60 * 1000;
  const [perLink, perIp] = await Promise.all([
    checkDurableRateLimit(`review-draft:${reviewRequest._id}`, DRAFTS_PER_LINK_PER_HOUR, hour),
    checkDurableRateLimit(`review-draft-ip:${ip || 'unknown'}`, DRAFTS_PER_IP_PER_HOUR, hour),
  ]);

  let draft: string | null = null;
  if (perLink.allowed && perIp.allowed) {
    draft = await aiDraft(ctx, buildDraftPrompt({ businessName: ctx.businessName, category: ctx.category, rating, picked, note, keyword, variant }));
  }
  const source: 'ai' | 'template' = draft ? 'ai' : 'template';
  if (!draft) {
    draft = fallbackDraft({ businessName: ctx.businessName, rating, picked, serviceChips: ctx.serviceChips, note });
  }

  reviewRequest.assist = {
    ...(reviewRequest.assist?.toObject?.() ?? reviewRequest.assist ?? {}),
    rating,
    picked,
    drafts: (reviewRequest.assist?.drafts || 0) + 1,
    lastDraftAt: new Date(),
  };
  await reviewRequest.save().catch((e: any) => console.warn('[reviewAssist] save failed:', e?.message));

  return { ok: true, draft, source };
}

export async function feedbackForToken(token: string, body: { rating?: unknown; feedback?: unknown }): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!isValidRating(body.rating)) return { ok: false, status: 400, error: 'Pick a star rating first.' };
  const feedback = cleanNote(body.feedback, MAX_FEEDBACK_CHARS);
  if (feedback.length < 3) return { ok: false, status: 400, error: 'Please write a few words.' };

  const reviewRequest: any = await findReviewRequestByToken(token);
  if (!reviewRequest) return { ok: false, status: 404, error: 'This review link is not valid.' };

  const limit = await checkDurableRateLimit(`review-feedback:${reviewRequest._id}`, FEEDBACK_PER_LINK_PER_DAY, 24 * 60 * 60 * 1000);
  if (!limit.allowed) return { ok: false, status: 429, error: 'Thanks — we already have your message.' };

  reviewRequest.assist = {
    ...(reviewRequest.assist?.toObject?.() ?? reviewRequest.assist ?? {}),
    rating: body.rating,
    feedback,
    feedbackAt: new Date(),
  };
  await reviewRequest.save();

  const [{ notifyBusinessUsers }, { default: Customer }] = await Promise.all([
    import('@/services/notifications'),
    import('@/models/Customer'),
  ]);
  const customer: any = reviewRequest.customerId ? await Customer.findById(reviewRequest.customerId).select('name').lean() : null;
  const who = usablePersonName(String(customer?.name || '')) || 'A customer';
  await notifyBusinessUsers(String(reviewRequest.businessId), {
    type: 'review_private_feedback',
    title: `${who} sent private feedback (${body.rating}★)`,
    body: feedback.length > 160 ? `${feedback.slice(0, 157)}…` : feedback,
    link: '/dashboard/reviews',
  });
  return { ok: true };
}
