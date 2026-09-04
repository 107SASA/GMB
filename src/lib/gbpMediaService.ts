import dbConnect from '@/lib/mongodb';
import GbpMediaAsset, { type IGbpMediaAsset } from '@/models/GbpMediaAsset';
import {
  uploadLocationPhoto,
  deleteLocationMedia,
  listLocationMedia,
  type GbpMediaCategory,
} from '@/lib/gbpClient';
import { gbpWritesEnabled } from '@/lib/gbpSafety';
import { logProfileActivity } from '@/lib/logProfileActivity';

/**
 * Business logic for the GBP media CRUD layer — kept out of the route
 * handlers (which stay thin HTTP plumbing) per the pattern the rest of this
 * codebase already uses (see shadowAccount.ts, startAudit.ts). See
 * GbpMediaAsset.ts for the full status-lifecycle writeup.
 */

const SINGLETON_CATEGORIES: GbpMediaCategory[] = ['LOGO', 'COVER'];

/**
 * Returns every media asset for this business, after reconciling with the
 * live Google profile (when connected): anything live on Google that we
 * don't have a local record for yet gets one created (status: 'published'),
 * and any local 'published' record for a photo that's no longer live gets
 * dropped. Staged/failed records are never touched by reconciliation — they
 * only exist locally by definition.
 *
 * Reconciliation is best-effort: if the live read fails (token expired,
 * transient API error, deprecated/unauthorized endpoint), it's skipped and
 * local state is returned as-is rather than failing the whole request — but
 * the failure reason is now returned as `liveSyncError` instead of only a
 * server console.warn. Previously this was swallowed silently: a business
 * whose Google reconciliation was failing on *every* request (e.g. an
 * expired scope) would see the same unchanging local photo count forever,
 * with literally no signal anywhere — pull-to-refresh, re-login, reinstall,
 * nothing would ever help, and nothing said why (Aug 2026 bug report:
 * "still only 4 photos after refresh").
 */
export async function listMediaAssets(
  businessId: string,
  isConnected: boolean
): Promise<{ media: IGbpMediaAsset[]; liveSyncError: string | null }> {
  await dbConnect();
  let liveSyncError: string | null = null;

  if (isConnected) {
    try {
      const liveItems = await listLocationMedia(businessId);
      const liveNames = new Set(liveItems.map((i) => i.name).filter(Boolean));

      for (const item of liveItems) {
        if (!item.name) continue;
        const exists = await GbpMediaAsset.findOne({ businessId, googleMediaName: item.name });
        if (!exists) {
          await GbpMediaAsset.create({
            businessId,
            // item.category is already translated to our schema's
            // GbpMediaCategory (LOGO for Google's real "PROFILE" singleton,
            // etc.) — see fromGoogleCategory in gbpClient.ts.
            category: item.category,
            url: item.url || item.thumbnailUrl,
            status: 'published',
            googleMediaName: item.name,
            publishedAt: new Date(),
          });
        }
      }

      // A published local record whose Google item is gone (deleted directly
      // on Google, outside this app) no longer reflects reality — drop it.
      await GbpMediaAsset.deleteMany({
        businessId,
        status: 'published',
        googleMediaName: { $exists: true, $nin: [...liveNames] },
      });
    } catch (err) {
      liveSyncError = (err as Error).message;
      console.warn(
        `[gbpMediaService] Live reconciliation failed for business ${businessId}, showing local state only:`,
        liveSyncError
      );
    }
  }

  const media = await GbpMediaAsset.find({ businessId }).sort({ category: 1, createdAt: -1 }).lean();
  return { media, liveSyncError };
}

/**
 * Stages a newly-uploaded file. LOGO/COVER are singleton slots: if a staged
 * (not-yet-published) replacement already exists for that category, this
 * overwrites it in place instead of accumulating multiple pending
 * replacements. ADDITIONAL/PROFILE always create a new gallery item.
 */
export async function createOrReplaceStagedAsset(params: {
  businessId: string;
  organizationId?: string;
  uploadedBy?: string;
  category: GbpMediaCategory;
  url: string;
  mediaType?: 'photo' | 'video';
}): Promise<IGbpMediaAsset> {
  await dbConnect();
  const { businessId, organizationId, uploadedBy, category, url, mediaType = 'photo' } = params;

  if (SINGLETON_CATEGORIES.includes(category)) {
    const existingStaged = await GbpMediaAsset.findOne({ businessId, category, status: 'staged' });
    if (existingStaged) {
      existingStaged.url = url;
      existingStaged.mediaType = mediaType;
      existingStaged.uploadedBy = uploadedBy as any;
      existingStaged.failureReason = undefined;
      await existingStaged.save();
      return existingStaged;
    }
  }

  return GbpMediaAsset.create({ businessId, organizationId, uploadedBy, category, url, mediaType, status: 'staged' });
}

/** Category can only move while a photo is still staged — see GbpMediaAsset.ts. */
export async function updateAssetCategory(
  businessId: string,
  assetId: string,
  newCategory: GbpMediaCategory
): Promise<IGbpMediaAsset> {
  await dbConnect();
  const asset = await GbpMediaAsset.findOne({ _id: assetId, businessId });
  if (!asset) throw new Error('Photo not found.');
  if (asset.status !== 'staged') {
    throw new Error('This photo is already live on Google — its category can no longer be changed.');
  }

  if (SINGLETON_CATEGORIES.includes(newCategory)) {
    // Two staged items can't both hold the same singleton slot — the one
    // being moved here wins, matching "uploading again replaces the pending
    // one" semantics used elsewhere in this flow.
    await GbpMediaAsset.deleteOne({ businessId, category: newCategory, status: 'staged', _id: { $ne: asset._id } });
  }

  asset.category = newCategory;
  await asset.save();
  return asset;
}

/**
 * Sets (or clears, when `date` is null) a future auto-publish date on a
 * staged photo. publishScheduledMediaCron (services/inngest/functions.ts)
 * polls for staged assets whose scheduledFor has arrived and publishes them
 * via publishAsset below — same mechanism Posts already use for
 * scheduledDate, just for media.
 */
export async function scheduleAsset(
  businessId: string,
  assetId: string,
  date: Date | null
): Promise<IGbpMediaAsset> {
  await dbConnect();
  const asset = await GbpMediaAsset.findOne({ _id: assetId, businessId });
  if (!asset) throw new Error('Photo not found.');
  if (asset.status !== 'staged') {
    throw new Error('Only a staged (not-yet-published) photo can be scheduled.');
  }
  if (date && date.getTime() <= Date.now()) {
    throw new Error('Scheduled time must be in the future.');
  }
  asset.scheduledFor = date ?? undefined;
  await asset.save();
  return asset;
}

export interface PublishResult {
  asset: IGbpMediaAsset;
  liveWriteApplied: boolean;
}

/**
 * Pushes a staged photo to the live Google profile. For LOGO/COVER, the
 * previous published photo in that category (if any) is removed afterward —
 * done at publish time, not upload time, so the OLD one stays live right up
 * until the NEW one is confirmed live, never leaving the slot empty.
 *
 * `actor` is who clicked publish — this is always a real, owner-initiated
 * action (there's no autonomous auto-publish anywhere in this codebase), so
 * the activity log entry it creates always names a real person, never "AI".
 */
export async function publishAsset(
  businessId: string,
  assetId: string,
  actor?: { organizationId?: string; name: string }
): Promise<PublishResult> {
  await dbConnect();
  const asset = await GbpMediaAsset.findOne({ _id: assetId, businessId });
  if (!asset) throw new Error('Photo not found.');
  if (asset.status === 'published') return { asset, liveWriteApplied: true };

  try {
    const { liveWriteApplied, mediaName } = await uploadLocationPhoto(
      businessId,
      asset.category as GbpMediaCategory,
      asset.url,
      asset.mediaType === 'video' ? 'VIDEO' : 'PHOTO'
    );

    if (!liveWriteApplied) {
      // Not a failure — live publishing is platform-wide disabled right now
      // (GBP_LIVE_WRITES_ENABLED=false). Stays staged, not failed.
      return { asset, liveWriteApplied: false };
    }

    if (SINGLETON_CATEGORIES.includes(asset.category as GbpMediaCategory)) {
      const prev = await GbpMediaAsset.findOne({
        businessId,
        category: asset.category,
        status: 'published',
        _id: { $ne: asset._id },
      });
      if (prev) {
        if (prev.googleMediaName) {
          try {
            await deleteLocationMedia(businessId, prev.googleMediaName);
          } catch (cleanupErr) {
            // Don't block the new photo going live just because cleaning up
            // the old one on Google failed — log and continue; the stale
            // local record still gets removed below so the UI is correct,
            // and it'll self-heal on the next reconciliation pass either way.
            console.warn(`[gbpMediaService] Failed to delete previous ${asset.category} on Google:`, (cleanupErr as Error).message);
          }
        }
        await GbpMediaAsset.deleteOne({ _id: prev._id });
      }
    }

    asset.status = 'published';
    asset.googleMediaName = mediaName;
    asset.publishedAt = new Date();
    asset.failureReason = undefined;
    asset.scheduledFor = undefined; // no longer meaningful once actually live
    await asset.save();

    if (actor) {
      void logProfileActivity({
        businessId,
        organizationId: actor.organizationId,
        type: 'photo_published',
        title: 'A new photo went live on your Google Business Profile',
        detail: `${asset.category === 'ADDITIONAL' ? 'Photo' : asset.category === 'LOGO' ? 'Logo' : asset.category === 'COVER' ? 'Cover photo' : 'Photo'} published`,
        updatedBy: actor.name,
      });
    }

    return { asset, liveWriteApplied: true };
  } catch (err) {
    asset.status = 'failed';
    asset.failureReason =
      asset.mediaType === 'video'
        ? `Google rejected the video upload (${(err as Error).message}). Google's API is unreliable for video — post this video to your profile manually from the Google Business app.`
        : (err as Error).message;
    await asset.save();
    throw err;
  }
}

/**
 * Deletes a photo. Staged/failed photos are local-only — just remove the
 * record. Published photos require live writes to be enabled (same gate as
 * every other write) since deleting one actually calls Google's API.
 */
export async function deleteAsset(businessId: string, assetId: string): Promise<void> {
  await dbConnect();
  const asset = await GbpMediaAsset.findOne({ _id: assetId, businessId });
  if (!asset) throw new Error('Photo not found.');

  if (asset.status === 'published' && asset.googleMediaName) {
    if (!gbpWritesEnabled()) {
      throw new Error(
        "This photo is live on Google, and live GBP writes are currently disabled — it can't be removed until live writes are enabled."
      );
    }
    await deleteLocationMedia(businessId, asset.googleMediaName);
  }

  await GbpMediaAsset.deleteOne({ _id: asset._id });
}
