import dbConnect from '@/lib/mongodb';
import SeoPlan from '@/models/SeoPlan';
import { gbpWritesEnabled } from '@/lib/gbpSafety';
import { updateLocationProfile } from '@/lib/gbpClient';

/**
 * Apply the active SEO plan's suggested title + description to the business.
 *
 * updateLocationProfile always mirrors the values into our own Business doc;
 * the live Google write only fires when GBP_LIVE_WRITES_ENABLED is on AND the
 * business is OAuth-connected. This function never flips that flag — with it
 * off, "apply" means "save the drafts onto the listing record locally".
 */
export interface ApplyPlanResult {
  applied: boolean;
  liveWriteApplied: boolean;
  title?: string;
  description?: string;
  reason?: string;
}

export async function applyActivePlanToProfile(
  businessId: string,
  opts: { fields?: Array<'title' | 'description'> } = {},
): Promise<ApplyPlanResult> {
  await dbConnect();
  const plan = await SeoPlan.findOne({ businessId, status: 'active' }).sort({ version: -1 }).lean();
  if (!plan) return { applied: false, liveWriteApplied: false, reason: 'No active SEO plan for this business.' };

  const fields = opts.fields ?? ['title', 'description'];
  const patch: { title?: string; description?: string } = {};
  if (fields.includes('title') && plan.suggestedTitle) {
    patch.title = plan.suggestedTitle.slice(0, 100);
  }
  if (fields.includes('description') && plan.suggestedDescription) {
    patch.description = plan.suggestedDescription.slice(0, 750);
  }
  if (!patch.title && !patch.description) {
    return { applied: false, liveWriteApplied: false, reason: 'The active plan has no title/description draft to apply.' };
  }

  const { liveWriteApplied } = await updateLocationProfile(businessId, patch);

  await SeoPlan.updateOne(
    { _id: plan._id },
    { $set: { appliedAt: new Date(), appliedLive: liveWriteApplied } },
  );

  return {
    applied: true,
    liveWriteApplied,
    title: patch.title,
    description: patch.description,
    reason: liveWriteApplied
      ? 'Applied to the live Google listing.'
      : gbpWritesEnabled()
        ? 'Saved locally — connect Google to push this to the live listing.'
        : 'Saved locally — live Google writes are disabled on this environment.',
  };
}
