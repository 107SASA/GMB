import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import User from '@/models/User';
import { isWorkspaceUnlocked } from '@/lib/workspaceAccess';

/**
 * "May this workspace's paid automation run?" for background jobs — the same
 * rule that unlocks its dashboard (src/proxy.ts): paid, an authorized trial,
 * a payment failure inside its grace period, a legacy workspace whose owner
 * has a paid plan, or a workspace owned by a Super Admin.
 *
 * Used by the recurring Google sync, AI review replies and scheduled post /
 * photo publishing, so a cancelled or unpaid workspace stops costing AI and
 * Google calls (and stops getting the service) until it pays. Nothing is
 * deleted: held work resumes on payment (resumeHeldWork).
 */

const BUSINESS_FIELDS = 'userId createdAt subscriptionStatus trialEndsAt trialCancelledAt paymentGraceEndsAt paymentAccessHold';

/** Business ids (as strings) among `ids` whose paid automation may run. */
export async function businessesWithPlanAccess(ids: Array<string | { toString(): string }>, now = new Date()): Promise<Set<string>> {
  const wanted = [...new Set(ids.map(String))].filter(Boolean);
  if (!wanted.length) return new Set();
  await dbConnect();
  const businesses: any[] = await Business.find({ _id: { $in: wanted }, isDeleted: { $ne: true } }).select(BUSINESS_FIELDS).lean();
  const owners: any[] = await User.find({ _id: { $in: businesses.map((b) => b.userId).filter(Boolean) } })
    .select('role subscriptionPlan').lean();
  const ownerById = new Map(owners.map((u) => [String(u._id), u]));
  const out = new Set<string>();
  for (const b of businesses) {
    const owner = ownerById.get(String(b.userId));
    if (owner?.role === 'SUPER_ADMIN' || isWorkspaceUnlocked({
      subscriptionStatus: b.subscriptionStatus,
      userSubscriptionPlan: owner?.subscriptionPlan,
      businessCreatedAt: b.createdAt,
      trialEndsAt: b.trialEndsAt,
      trialCancelledAt: b.trialCancelledAt,
      paymentGraceEndsAt: b.paymentGraceEndsAt,
      paymentAccessHold: b.paymentAccessHold,
      now,
    })) {
      out.add(String(b._id));
    }
  }
  return out;
}

export async function businessHasPlanAccess(businessId: string, now = new Date()): Promise<boolean> {
  return (await businessesWithPlanAccess([businessId], now)).has(String(businessId));
}

/** Reviews this recent still get an AI reply once a held workspace pays (older ones stay for the owner). */
export const RESUME_REVIEW_WINDOW_DAYS = 30;

/**
 * Called when a workspace gains access (payment, trial start). Reviews that
 * arrived while it was unpaid were synced but not replied to — review sync
 * is incremental, so they would never be picked up again. Queues the recent
 * ones for the AI reply pipeline. Held posts and photos need nothing: the
 * publish crons pick them up within the hour. Never throws.
 */
export async function resumeHeldWork(businessId: string): Promise<{ reviewsQueued: number }> {
  try {
    await dbConnect();
    const { default: Review } = await import('@/models/Review');
    const cutoff = new Date(Date.now() - RESUME_REVIEW_WINDOW_DAYS * 86_400_000);
    const pending = await Review.find({
      businessId,
      source: 'gbp_api',
      response: { $in: [null, undefined, ''] },
      replyStatus: { $in: [null, 'PENDING'] },
      $or: [{ postedAt: { $gte: cutoff } }, { postedAt: { $exists: false }, createdAt: { $gte: cutoff } }],
    }).select('_id').lean();
    if (!pending.length) return { reviewsQueued: 0 };
    const { inngest } = await import('@/services/inngest/client');
    await inngest.send({
      name: 'reviews/auto-reply-batch',
      data: { businessId: String(businessId), reviewIds: pending.map((r: any) => String(r._id)) },
    });
    return { reviewsQueued: pending.length };
  } catch (err: any) {
    console.warn(`[planAccess] resuming held work for ${businessId} failed:`, err?.message);
    return { reviewsQueued: 0 };
  }
}
