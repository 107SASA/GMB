import axios from 'axios';
import { z } from 'zod';
import { api } from '../client';

/**
 * Reviews — mirrors the web ReviewsDashboard flow:
 *   generate-reply → approve-reply (with optional edited text) → post-reply.
 * replyStatus: PENDING → DRAFT (passed the fact check) | NEEDS_REVIEW (failed
 * it) → APPROVED → POSTED (Google confirmed), or REJECTED / FAILED.
 * The server fact-checks every draft, approval and publish; a reply that
 * fails is never posted. When Google publishing is switched off the post call
 * answers `{ blocked: true }` — the reply is NOT on Google.
 */

export const reviewSchema = z.object({
  _id: z.string(),
  reviewer: z.string().catch('Anonymous'),
  reviewerPhotoUrl: z.string().nullable().optional(),
  rating: z.number().catch(0),
  reviewText: z.string().nullable().catch(null),
  sentiment: z.string().nullable().catch(null),
  response: z.string().nullable().catch(null),
  aiSuggestedReply: z.string().nullable().catch(null),
  replyStatus: z.enum(['PENDING', 'DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'POSTED', 'FAILED']).catch('PENDING'),
  /** Server fact check of the current reply text. */
  replyValidation: z
    .object({ ok: z.boolean().catch(false), reasons: z.array(z.string()).catch([]) })
    .nullable()
    .catch(null)
    .optional(),
  /** Last publish attempt: published (Google confirmed) / blocked (Google publishing off) / failed. */
  replyPublishStatus: z.enum(['published', 'blocked', 'failed']).nullable().catch(null).optional(),
  replyFailureReason: z.string().nullable().catch(null).optional(),
  replyTone: z.string().nullable().catch(null),
  sourcePlatform: z.string().catch('Google'),
  /** When the customer posted on Google — use for all date math/display. */
  postedAt: z.string().nullable().catch(null),
  /** DB sync time only; fallback for docs synced before postedAt existed. */
  createdAt: z.string().optional(),
});
export type Review = z.infer<typeof reviewSchema>;

/**
 * GET /api/reviews — newest first. The server now returns
 * `{ reviews, analytics }`; older deployments returned a bare array,
 * so accept both shapes.
 */
export async function fetchReviews(): Promise<Review[]> {
  const { data } = await api.get('/api/reviews');
  const list = Array.isArray(data) ? data : data?.reviews ?? [];
  return z
    .array(reviewSchema.nullable().catch(null))
    .parse(list)
    .filter((r): r is Review => r !== null);
}

/**
 * Thrown by syncReviews when the workspace has no Google Business Profile
 * connected — the UI turns this into a "connect Google" prompt rather than a
 * generic error.
 */
export class ReviewsNotConnectedError extends Error {}

/**
 * POST /api/reviews/fetch — pulls the latest reviews from Google for the
 * active workspace (x-business-id header) and upserts them, then returns how
 * many were synced. The web route answers 200 with `{ needsConnection: true }`
 * (not an HTTP error) when GBP isn't connected, so inspect the body.
 */
export async function syncReviews(): Promise<{ synced: number }> {
  const { data } = await api.post('/api/reviews/fetch', {});
  if (data?.needsConnection) {
    throw new ReviewsNotConnectedError(
      typeof data?.error === 'string'
        ? data.error
        : 'Connect your Google Business Profile to sync reviews.'
    );
  }
  if (data?.success === false) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Could not sync reviews.');
  }
  return { synced: Number(data?.synced ?? 0) };
}

/** Thrown when generate-reply hits the plan's AI generation limit. */
export class PlanLimitError extends Error {}

/**
 * POST /api/reviews/generate-reply — returns the AI suggestion (also saved
 * on the review server-side). A 403 with the server's UPGRADE_REQUIRED
 * code means the current plan doesn't include this — the app surfaces a
 * neutral message only (store compliance).
 */
export interface GeneratedReply {
  reply: string;
  /** DRAFT = passed the fact check; NEEDS_REVIEW = held with reasons. */
  status: 'DRAFT' | 'NEEDS_REVIEW' | string;
  reasons: string[];
}

export async function generateReply(reviewId: string, tone: string): Promise<GeneratedReply> {
  try {
    const { data } = await api.post('/api/reviews/generate-reply', { reviewId, tone });
    const parsed = z
      .object({
        success: z.literal(true),
        reply: z.string(),
        replyStatus: z.string().catch('DRAFT').optional(),
        validation: z.object({ reasons: z.array(z.string()).catch([]) }).nullable().catch(null).optional(),
      })
      .parse(data);
    return { reply: parsed.reply, status: parsed.replyStatus ?? 'DRAFT', reasons: parsed.validation?.reasons ?? [] };
  } catch (error) {
    if (axios.isAxiosError(error) && (error.response?.data as any)?.code === 'UPGRADE_REQUIRED') {
      throw new PlanLimitError("This feature isn't included in your current plan.");
    }
    throw error;
  }
}

/** Thrown when the server's fact check refuses a reply (HTTP 422) — carries the reasons. */
export class ReplyCheckError extends Error {
  constructor(message: string, public reasons: string[]) {
    super(message);
  }
}

/**
 * POST /api/reviews/[id]/approve-reply — approves, optionally with edited text.
 * The exact text must pass the server fact check; otherwise ReplyCheckError.
 */
export async function approveReply(reviewId: string, replyText?: string): Promise<void> {
  try {
    await api.post(`/api/reviews/${reviewId}/approve-reply`, replyText ? { aiSuggestedReply: replyText } : {});
  } catch (error) {
    const body = axios.isAxiosError(error) ? (error.response?.data as any) : null;
    if (axios.isAxiosError(error) && error.response?.status === 422) {
      throw new ReplyCheckError(
        "This reply can't be approved yet — edit it to remove the flagged claims.",
        Array.isArray(body?.reasons) ? body.reasons : []
      );
    }
    throw error;
  }
}

/** POST /api/reviews/[id]/reject-reply — discards the suggestion (status REJECTED). */
export async function rejectReply(reviewId: string): Promise<void> {
  await api.post(`/api/reviews/${reviewId}/reject-reply`);
}

export type PostReplyResult = { outcome: 'published' } | { outcome: 'blocked'; message: string };

/**
 * POST /api/reviews/[id]/post-reply — publishes an APPROVED reply to Google.
 * `blocked` means Google publishing is switched off: the reply is NOT on
 * Google. Refusals (not approved / failed the check) and Google errors throw.
 */
export async function postReply(reviewId: string): Promise<PostReplyResult> {
  const { data } = await api.post(`/api/reviews/${reviewId}/post-reply`);
  if (data?.blocked) {
    return {
      outcome: 'blocked',
      message:
        typeof data.message === 'string'
          ? data.message
          : 'Approved in GrowwMatics — Google publishing has not been executed.',
    };
  }
  if (data?.success === false) throw new Error(typeof data?.error === 'string' ? data.error : 'Could not post the reply.');
  return { outcome: 'published' };
}
