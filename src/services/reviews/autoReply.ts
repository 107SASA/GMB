import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import type { IReview } from '@/models/Review';
import { logAIUsage } from '@/lib/logAIUsage';
import { GROQ_MODEL } from '@/lib/aiModel';
import { approveReply, draftReply, isAutoPublishActive, publishReply, type ReplyDeps } from './replyPipeline';

/**
 * Background handling of a newly synced review (processAutoReplyBatchJob):
 * always drafts a fact-checked reply for the owner; publishes it ONLY when
 * the owner has switched on auto-reply (mode 'auto' + consent recorded) AND
 * the draft passed the check. Everything else waits for owner approval.
 */
export async function autoReplyToReview(businessId: string, review: IReview, deps?: ReplyDeps): Promise<{ drafted: string; published: string | null }> {
  // Never overwrite a reply that exists or a draft the owner is already handling.
  if (review.replyStatus === 'POSTED' || review.response) return { drafted: 'skipped', published: null };
  if (['DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED'].includes(String(review.replyStatus))) return { drafted: 'skipped', published: null };

  await dbConnect();
  const business = await Business.findById(businessId).select('userId reviewReplySettings').lean<{ userId?: { toString(): string }; reviewReplySettings?: any }>();
  const startMs = Date.now();
  const d = await draftReply(businessId, String(review._id), { deps });
  const ownerId = business?.userId?.toString();
  if (ownerId && d.usage) {
    void logAIUsage({ userId: ownerId, businessId, promptType: 'review_reply_auto', aiModel: GROQ_MODEL, promptTokens: d.usage.promptTokens, completionTokens: d.usage.completionTokens, status: d.error ? 'failed' : 'success', durationMs: Date.now() - startMs });
  }
  if (d.status !== 'DRAFT' || !isAutoPublishActive(business?.reviewReplySettings)) return { drafted: d.status, published: null };

  const a = await approveReply(businessId, String(review._id), { by: 'auto' });
  if (!a.ok) return { drafted: 'NEEDS_REVIEW', published: null };
  const p = await publishReply(businessId, String(review._id), { deps });
  return { drafted: d.status, published: p.outcome };
}
