import axios from 'axios';
import { z } from 'zod';
import { api } from '../client';

/**
 * Reviews — mirrors the web ReviewsDashboard flow:
 *   generate-reply → approve-reply (with optional edited text) → post-reply.
 * replyStatus: PENDING → APPROVED → POSTED (or REJECTED / FAILED).
 */

export const reviewSchema = z.object({
  _id: z.string(),
  reviewer: z.string().catch('Anonymous'),
  rating: z.number().catch(0),
  reviewText: z.string().nullable().catch(null),
  sentiment: z.string().nullable().catch(null),
  response: z.string().nullable().catch(null),
  aiSuggestedReply: z.string().nullable().catch(null),
  replyStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'POSTED', 'FAILED']).catch('PENDING'),
  replyTone: z.string().nullable().catch(null),
  sourcePlatform: z.string().catch('Google'),
  /** When the customer posted on Google — use for all date math/display. */
  postedAt: z.string().nullable().catch(null),
  /** DB sync time only; fallback for docs synced before postedAt existed. */
  createdAt: z.string().optional(),
});
export type Review = z.infer<typeof reviewSchema>;

/** GET /api/reviews — bare array, newest first. */
export async function fetchReviews(): Promise<Review[]> {
  const { data } = await api.get('/api/reviews');
  return z
    .array(reviewSchema.nullable().catch(null))
    .parse(data)
    .filter((r): r is Review => r !== null);
}

/** Thrown when generate-reply hits the plan's AI generation limit. */
export class PlanLimitError extends Error {}

/**
 * POST /api/reviews/generate-reply — returns the AI suggestion (also saved
 * on the review server-side). A 403 with the server's UPGRADE_REQUIRED
 * code means the current plan doesn't include this — the app surfaces a
 * neutral message only (store compliance).
 */
export async function generateReply(reviewId: string, tone: string): Promise<string> {
  try {
    const { data } = await api.post('/api/reviews/generate-reply', { reviewId, tone });
    return z.object({ success: z.literal(true), reply: z.string() }).parse(data).reply;
  } catch (error) {
    if (axios.isAxiosError(error) && (error.response?.data as any)?.code === 'UPGRADE_REQUIRED') {
      throw new PlanLimitError("This feature isn't included in your current plan.");
    }
    throw error;
  }
}

/** POST /api/reviews/[id]/approve-reply — approves, optionally with edited text. */
export async function approveReply(reviewId: string, replyText?: string): Promise<void> {
  await api.post(
    `/api/reviews/${reviewId}/approve-reply`,
    replyText ? { aiSuggestedReply: replyText } : {}
  );
}

/** POST /api/reviews/[id]/reject-reply — discards the suggestion (status REJECTED). */
export async function rejectReply(reviewId: string): Promise<void> {
  await api.post(`/api/reviews/${reviewId}/reject-reply`);
}

/** POST /api/reviews/[id]/post-reply — publishes an APPROVED reply to Google. */
export async function postReply(reviewId: string): Promise<void> {
  await api.post(`/api/reviews/${reviewId}/post-reply`);
}
