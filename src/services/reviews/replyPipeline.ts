import dbConnect from '@/lib/mongodb';
import { validateReply, type ReplyEvidence, type ReplyValidation } from './validateReply';

/**
 * Review reply workflow — the ONLY way a reply is drafted, approved or
 * published (manual buttons, auto-reply, n8n all come through here):
 *
 *   new review → verified business + SEO context → AI draft → fact/policy/
 *   quality check (one regeneration) → DRAFT (passed) | NEEDS_REVIEW (failed)
 *   → approval (owner; or auto-reply when the owner switched it on) →
 *   re-check of the exact text → publish to Google → POSTED only when Google
 *   confirms (blocked when live writes are off, FAILED with Google's error).
 *
 * Auto-publish is OFF unless the owner turned it on under this flow
 * (reviewReplySettings.mode 'auto' + autoPublishConsentAt). Nothing that fails
 * the check is ever published — not by auto-reply, not by the Post button.
 */

export const REPLY_BLOCKED_REASON = 'Approved in GrowwMatics — Google publishing has not been executed. Live Google Business Profile writes are turned off, so this reply is not on Google.';

export interface ReplyDeps {
  generate?: (p: any) => Promise<{ reply: string; promptTokens?: number; completionTokens?: number }>;
  postToGoogle?: (businessId: string, review: any) => Promise<{ liveWriteApplied: boolean; googleResponse?: string }>;
}

export function isAutoPublishActive(settings?: { mode?: string; autoPublishConsentAt?: Date | string | null } | null): boolean {
  return settings?.mode === 'auto' && !!settings?.autoPublishConsentAt;
}

const split = (s?: string) => String(s || '').split(/[,;\n]+/).map((x) => x.trim()).filter((x) => x.length >= 3);

/** Verified facts + SEO keywords the reply may use, and where each came from. DB reads only. */
export async function gatherReplyContext(businessId: string): Promise<{ evidence: ReplyEvidence; factsBlock: string; keywords: string[]; sources: string[] }> {
  await dbConnect();
  const [{ default: Business }, { default: WebsiteIntelligence }, { default: Audit }, { getActiveSeoPlan }, { normalizeOrigin }] = await Promise.all([
    import('@/models/Business'), import('@/models/WebsiteIntelligence'), import('@/models/Audit'),
    import('@/services/seoPlan/seoPlanService'), import('@/services/intel/websiteExtract'),
  ]);
  const b: any = await Business.findById(businessId).select('name category userDefinedCategory city area services description intake website').lean();
  const sources: string[] = ['business_record'];
  const category = b?.userDefinedCategory || b?.category || '';
  const ownerServices = split(b?.services);
  if (ownerServices.length) sources.push('owner_services');

  const origin = b?.website ? normalizeOrigin(String(b.website)) : null;
  const wi: any = origin ? await WebsiteIntelligence.findOne({ origin, status: { $ne: 'failed' } }).lean() : null;
  const siteServices: string[] = (wi?.services || []).map((s: any) => s.value).slice(0, 12);
  const siteFacts: string[] = [wi?.description?.value, ...(wi?.differentiators || []).map((c: any) => c.value), ...(wi?.credentials || []).map((c: any) => c.value)].filter(Boolean);
  if (wi) sources.push(`website:${origin}`);

  // Live GBP facts as captured by the latest connected audit (no extra API call).
  const audit: any = await Audit.findOne({ businessId, status: 'COMPLETED', 'auditData.facts.gbpProfile.fields': { $exists: true } })
    .sort({ createdAt: -1 }).select('auditData.facts.gbpProfile').lean();
  const gbp = audit?.auditData?.facts?.gbpProfile?.fields || {};
  const gbpCategories: string[] = [gbp.primaryCategory, ...(gbp.additionalCategories || [])].filter(Boolean);
  if (audit) sources.push(`gbp_profile:audit:${audit._id}`);

  const plan: any = await getActiveSeoPlan(businessId).catch(() => null);
  const brandWord = String(b?.name || '').toLowerCase().split(/\s+/)[0];
  const measured: string[] = (plan?.keywordTable || []).filter((r: any) => (r.rankStatus ?? 'ok') === 'ok' && !(brandWord && String(r.keyword).toLowerCase().includes(brandWord))).map((r: any) => r.keyword);
  const proposed: string[] = (plan?.draft?.proposedKeywords || []).map((p: any) => p.keyword).filter(Boolean);
  if (plan) sources.push(`seo_plan:${plan._id}`);

  const places = [b?.city, b?.area].filter(Boolean) as string[];
  const services = Array.from(new Set([...ownerServices, ...siteServices, ...gbpCategories]));
  const ownerDescription = [b?.description, b?.intake?.uniqueSellingPoints].filter(Boolean).join(' ');
  const factsBlock = [
    `Business: ${b?.name}`,
    category && `Category: ${category}`,
    places.length && `Location: ${places.join(', ')}`,
    ownerServices.length && `Services (owner-confirmed): ${ownerServices.join(', ')}`,
    siteServices.length && `Services the website lists: ${siteServices.join(', ')}`,
    gbpCategories.length && `Google Business Profile categories: ${gbpCategories.join(', ')}`,
    ownerDescription && `Owner description: ${ownerDescription}`,
    gbp.description && `Google Business Profile description: ${gbp.description}`,
    siteFacts.length && `Website says: ${siteFacts.join(' | ')}`,
  ].filter(Boolean).join('\n');
  const keywords = [...measured.slice(0, 4).map((k) => `${k} (measured)`), ...proposed.slice(0, 3).map((k) => `${k} (proposed)`)];

  return {
    evidence: {
      businessName: b?.name || '',
      category,
      places,
      services: [...services, category].filter(Boolean),
      factsText: [factsBlock, gbp.description].filter(Boolean).join(' '),
      keywords: [...measured, ...proposed],
    },
    factsBlock,
    keywords,
    sources,
  };
}

async function record(row: Record<string, unknown>) {
  const { default: ReviewReply } = await import('@/models/ReviewReply');
  await ReviewReply.create({ aiGenerated: true, approved: false, posted: false, ...row }).catch((e: any) => console.warn('[replyPipeline] audit row failed:', e?.message));
}

/** Draft (or redraft) a reply: generate → check → one regeneration → DRAFT | NEEDS_REVIEW. */
export async function draftReply(businessId: string, reviewId: string, opts: { tone?: string; deps?: ReplyDeps } = {}): Promise<{ status: string; reply?: string; validation?: ReplyValidation; error?: string; usage?: { promptTokens: number; completionTokens: number } }> {
  await dbConnect();
  const { default: Review } = await import('@/models/Review');
  const review: any = await Review.findOne({ _id: reviewId, businessId });
  if (!review) return { status: 'not_found', error: 'Review not found' };
  if (review.replyStatus === 'POSTED') return { status: 'POSTED', reply: review.response };

  const { default: Business } = await import('@/models/Business');
  const biz: any = await Business.findById(businessId).select('name reviewReplySettings').lean();
  const tone = opts.tone || biz?.reviewReplySettings?.tone || 'Professional';
  const ctx = await gatherReplyContext(businessId);
  const generate = opts.deps?.generate ?? (async (p: any) => (await import('@/services/ai/replyEngine')).generateReviewReply(p));
  const rv = { text: review.reviewText || '', rating: review.rating, reviewer: review.reviewer };
  const base = {
    reviewText: review.reviewText, rating: review.rating, tone, businessName: ctx.evidence.businessName || biz?.name || 'the business',
    reviewer: review.reviewer, factsBlock: ctx.factsBlock, keywords: ctx.keywords,
    previousReply: review.response && review.replyPostedBy === 'external' ? review.response : undefined,
  };

  let reply: string;
  let usage = { promptTokens: 0, completionTokens: 0 };
  try {
    const r = await generate(base);
    reply = r.reply;
    usage = { promptTokens: r.promptTokens ?? 0, completionTokens: r.completionTokens ?? 0 };
  } catch (err: any) {
    review.replyFailureReason = 'AI could not draft a reply right now — try again or write one yourself.';
    await review.save();
    return { status: review.replyStatus || 'PENDING', error: String(err?.message || err) };
  }
  let check = validateReply(reply, rv, ctx.evidence);
  let attempts = 1;
  if (!check.ok) {
    try {
      const again = await generate({ ...base, rejected: { reply, reasons: check.reasons } });
      attempts = 2;
      usage.promptTokens += again.promptTokens ?? 0;
      usage.completionTokens += again.completionTokens ?? 0;
      const recheck = validateReply(again.reply, rv, ctx.evidence);
      // Keep the better draft for the owner: the passing one, else the latest attempt.
      reply = again.reply;
      check = recheck;
    } catch { /* keep the first draft, flagged */ }
  }
  const status = check.ok ? 'DRAFT' : 'NEEDS_REVIEW';
  review.aiSuggestedReply = reply;
  review.replyTone = tone;
  review.replyStatus = status;
  review.replyValidation = { ok: check.ok, reasons: check.reasons, attempts, checkedAt: new Date() };
  review.replySources = ctx.sources;
  review.replyFailureReason = undefined;
  review.replyPublishStatus = undefined;
  await review.save();
  await record({ reviewId: review._id, businessId, event: 'drafted', generatedReply: reply, tone, sources: ctx.sources, validation: { ...check, attempts }, approvalStatus: check.ok ? 'draft' : 'needs_review', publishStatus: 'not_attempted' });
  return { status, reply, validation: check, usage };
}

/** Approve the current (optionally owner-edited) text — only if it passes the check. */
export async function approveReply(businessId: string, reviewId: string, opts: { text?: string; by: 'owner' | 'auto' }): Promise<{ ok: boolean; reasons: string[]; review?: any }> {
  await dbConnect();
  const { default: Review } = await import('@/models/Review');
  const review: any = await Review.findOne({ _id: reviewId, businessId });
  if (!review) return { ok: false, reasons: ['Review not found'] };
  if (review.replyStatus === 'POSTED') return { ok: false, reasons: ['This review already has a reply on Google.'], review };
  const text = (opts.text ?? review.aiSuggestedReply ?? '').trim();
  const ctx = await gatherReplyContext(businessId);
  const check = validateReply(text, { text: review.reviewText || '', rating: review.rating, reviewer: review.reviewer }, ctx.evidence);
  review.aiSuggestedReply = text;
  review.replyValidation = { ok: check.ok, reasons: check.reasons, attempts: review.replyValidation?.attempts, checkedAt: new Date() };
  review.replySources = ctx.sources;
  if (!check.ok) {
    review.replyStatus = 'NEEDS_REVIEW';
    await review.save();
    return { ok: false, reasons: check.reasons, review };
  }
  review.replyStatus = 'APPROVED';
  review.replyApprovedBy = opts.by;
  review.replyApprovedAt = new Date();
  await review.save();
  await record({ reviewId: review._id, businessId, event: 'approved', generatedReply: text, tone: review.replyTone || 'Professional', sources: ctx.sources, validation: check, approvalStatus: 'approved', approvedBy: opts.by, approved: true, publishStatus: 'not_attempted' });
  return { ok: true, reasons: [], review };
}

/** Publish an APPROVED reply. Re-checks the exact text first; POSTED only on Google's confirmation. */
export async function publishReply(businessId: string, reviewId: string, opts: { deps?: ReplyDeps } = {}): Promise<{ outcome: 'published' | 'blocked' | 'failed' | 'refused'; reason?: string; review?: any }> {
  await dbConnect();
  const { default: Review } = await import('@/models/Review');
  const review: any = await Review.findOne({ _id: reviewId, businessId });
  if (!review) return { outcome: 'refused', reason: 'Review not found' };
  if (review.replyStatus !== 'APPROVED') return { outcome: 'refused', reason: 'Reply must be approved before posting', review };
  const ctx = await gatherReplyContext(businessId);
  const check = validateReply(review.aiSuggestedReply || '', { text: review.reviewText || '', rating: review.rating, reviewer: review.reviewer }, ctx.evidence);
  if (!check.ok) {
    review.replyStatus = 'NEEDS_REVIEW';
    review.replyValidation = { ok: false, reasons: check.reasons, checkedAt: new Date() };
    await review.save();
    await record({ reviewId: review._id, businessId, event: 'publish_attempt', generatedReply: review.aiSuggestedReply || '-', sources: ctx.sources, validation: check, approvalStatus: 'needs_review', publishStatus: 'not_attempted', error: 'failed the fact check at publish time' });
    return { outcome: 'refused', reason: `Reply failed the fact check: ${check.reasons.join('; ')}`, review };
  }

  const post = opts.deps?.postToGoogle ?? (async (bid: string, r: any) => (await import('./postReply')).postReviewReplyToGoogle(bid, r));
  const approvedBy = review.replyApprovedBy === 'auto' ? 'auto' : 'owner';
  const base = { reviewId: review._id, businessId, event: 'publish_attempt', generatedReply: review.aiSuggestedReply, tone: review.replyTone || 'Professional', sources: ctx.sources, validation: check, approvalStatus: 'approved', approvedBy, approved: true };
  let res: { liveWriteApplied: boolean; googleResponse?: string };
  try {
    res = await post(businessId, review);
  } catch (err: any) {
    const reason = String(err?.message || 'Google rejected the reply.').slice(0, 500);
    review.replyStatus = 'FAILED';
    review.replyFailureReason = reason;
    review.replyPublishStatus = 'failed';
    review.replyGoogleResponse = reason;
    await review.save();
    await record({ ...base, publishStatus: 'failed', error: reason });
    return { outcome: 'failed', reason, review };
  }
  if (!res.liveWriteApplied) {
    // Nothing reached Google: stays APPROVED (not "replied"), with the reason shown.
    review.replyPublishStatus = 'blocked';
    review.replyFailureReason = REPLY_BLOCKED_REASON;
    await review.save();
    await record({ ...base, publishStatus: 'blocked', error: REPLY_BLOCKED_REASON });
    return { outcome: 'blocked', reason: REPLY_BLOCKED_REASON, review };
  }
  review.response = review.aiSuggestedReply;
  review.replyStatus = 'POSTED';
  review.replyPublishStatus = 'published';
  review.replyGoogleResponse = res.googleResponse;
  review.replyFailureReason = undefined;
  review.replyLiveWriteApplied = true;
  review.replyPostedBy = approvedBy === 'auto' ? 'growwmatics_auto' : 'growwmatics_owner_approved';
  review.replyPostedAt = new Date();
  await review.save();
  await record({ ...base, posted: true, publishStatus: 'published', googleResponse: res.googleResponse });
  return { outcome: 'published', review };
}
