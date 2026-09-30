import dbConnect from '@/lib/mongodb';

/**
 * The one publish transition for GBP posts (scheduled cron + manual button):
 *
 *   scheduled|approved|draft → publishing (atomic claim — never two publishers)
 *     → published  only when Google's API returned the created post (liveWriteApplied + post name)
 *     → blocked    when GBP live writes are disabled (nothing reached Google)
 *     → failed     when Google rejected it (reason stored)
 *
 * A post stuck in 'publishing' (process died mid-call) is swept to 'failed'
 * with an "outcome unknown" reason — never retried blindly, because Google
 * may already have the post and a retry would duplicate it.
 */

export const BLOCKED_REASON = 'Scheduled in GrowwMatics — Google publishing has not been executed. Live Google Business Profile writes are turned off, so this post is not on Google.';
export const STALE_PUBLISHING_MS = 30 * 60_000;

export type PublishOutcome =
  | { outcome: 'published'; postName?: string }
  | { outcome: 'blocked'; reason: string }
  | { outcome: 'failed'; reason: string }
  | { outcome: 'skipped'; reason: string };

export async function publishPost(postId: string, opts: { allowFrom?: string[]; businessId?: string; deps?: { writesEnabled?: () => boolean; createLocalPost?: (businessId: string, input: { summary: string; mediaUrl?: string }) => Promise<{ liveWriteApplied: boolean; postName?: string }> } } = {}): Promise<PublishOutcome> {
  await dbConnect();
  const { default: Post } = await import('@/models/Post');
  const allowFrom = opts.allowFrom ?? ['scheduled'];
  const claim: any = await Post.findOneAndUpdate(
    { _id: postId, status: { $in: allowFrom }, ...(opts.businessId ? { businessId: opts.businessId } : {}) },
    { $set: { status: 'publishing' }, $unset: { failureReason: 1 } },
    { returnDocument: 'after' },
  );
  if (!claim) return { outcome: 'skipped', reason: 'Post is not in a publishable state (already publishing, published, or changed).' };

  const writesEnabled = opts.deps?.writesEnabled ?? (await import('@/lib/gbpSafety')).gbpWritesEnabled;
  if (!writesEnabled()) {
    await Post.updateOne({ _id: claim._id }, { $set: { status: 'blocked', failureReason: BLOCKED_REASON, liveWriteApplied: false } });
    return { outcome: 'blocked', reason: BLOCKED_REASON };
  }

  const create = opts.deps?.createLocalPost ?? (await import('@/lib/gbpClient')).createLocalPost;
  const summary = [claim.title, claim.content].filter(Boolean).join('\n\n').slice(0, 1500);
  let res: { liveWriteApplied: boolean; postName?: string };
  try {
    res = await create(String(claim.businessId), { summary, mediaUrl: claim.imageUrl || undefined });
  } catch (err: any) {
    const reason = String(err?.message || 'Failed to publish to Google Business Profile.').slice(0, 500);
    await Post.updateOne({ _id: claim._id }, { $set: { status: 'failed', failureReason: reason, liveWriteApplied: false } });
    return { outcome: 'failed', reason };
  }
  if (!res.liveWriteApplied) {
    // Gate flipped off between the check and the call — nothing reached Google.
    await Post.updateOne({ _id: claim._id }, { $set: { status: 'blocked', failureReason: BLOCKED_REASON, liveWriteApplied: false } });
    return { outcome: 'blocked', reason: BLOCKED_REASON };
  }
  const now = new Date();
  await Post.updateOne({ _id: claim._id }, {
    $set: { status: 'published', publishedAt: now, liveWriteApplied: true, ...(res.postName ? { gbpPostName: res.postName } : {}) },
    $unset: { failureReason: 1 },
  });
  return { outcome: 'published', postName: res.postName };
}

/** Posts left in 'publishing' by a crashed run → failed, outcome unknown (checked by the hourly cron). */
export async function sweepStalePublishing(now = new Date()): Promise<number> {
  await dbConnect();
  const { default: Post } = await import('@/models/Post');
  const r = await Post.updateMany(
    { status: 'publishing', updatedAt: { $lt: new Date(now.getTime() - STALE_PUBLISHING_MS) } },
    { $set: { status: 'failed', failureReason: 'Publishing was interrupted — the outcome on Google is unknown. Check your Google Business Profile before publishing again.' } },
  );
  return r.modifiedCount || 0;
}
