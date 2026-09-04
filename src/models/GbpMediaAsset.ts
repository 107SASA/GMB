import mongoose, { Schema, Document } from 'mongoose';
import type { GbpMediaCategory } from '@/lib/gbpClient';

/**
 * Local record of a GBP media upload (logo / cover / additional photo).
 *
 * WHY THIS EXISTS: previously there was no local persistence for uploaded
 * media at all — a file went to DigitalOcean Spaces and, if
 * GBP_LIVE_WRITES_ENABLED was on, straight to the live Google profile. With
 * writes off (the default), the upload vanished the instant the request
 * finished — nothing tracked it, so there was no way to preview, manage, or
 * even know it had happened. This model is the source of truth the
 * dashboard now reads from; the live Google profile (when connected) is
 * reconciled into it on read, not the other way around.
 *
 * Status lifecycle:
 *   staged    → uploaded to Spaces, NOT yet pushed to Google. Fully editable
 *               (category, replace, delete) and safe to discard.
 *   published → live on the real Google Business Profile (`googleMediaName`
 *               set). Category is locked (Google's API has no way to move a
 *               live photo between categories — only delete + re-upload,
 *               which would silently lose Google's view/insight history on
 *               it, so we don't do that implicitly).
 *   failed    → a publish attempt to Google errored; stays editable/
 *               retryable like `staged`, with `failureReason` set.
 *
 * LOGO/COVER are singleton slots: at most one `published` and one `staged`
 * row per (businessId, category) for those two — enforced in the API layer
 * (createOrReplaceStaged), not a DB constraint, since "replace the pending
 * staged one" is an upsert, not a rejection. ADDITIONAL/PROFILE are a plain
 * multi-item gallery with no such limit.
 *
 * `scheduledFor` (Aug 2026): an optional future auto-publish date on a
 * `staged` asset — mirrors Post.scheduledDate exactly, including the
 * publish mechanism (publishScheduledMediaCron polls every 15 min, same
 * pattern as publishScheduledPostsCron in services/inngest/functions.ts).
 * Only meaningful while status is still 'staged'; cleared once published.
 */

export type GbpMediaStatus = 'staged' | 'published' | 'failed';
export type GbpMediaType = 'photo' | 'video';

export interface IGbpMediaAsset extends Document {
  businessId: mongoose.Types.ObjectId;
  organizationId?: string;
  uploadedBy?: mongoose.Types.ObjectId;
  category: GbpMediaCategory;
  /** photo (default) or video. Video is ADDITIONAL-only and, since Google's
   *  v4 media API is unreliable for programmatic video, publish is
   *  best-effort with a manual-post fallback (failureReason spells it out). */
  mediaType: GbpMediaType;
  url: string;
  status: GbpMediaStatus;
  /** Full v4 resource name once live on Google, e.g. "accounts/x/locations/y/media/z". */
  googleMediaName?: string;
  publishedAt?: Date;
  failureReason?: string;
  scheduledFor?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const GbpMediaAssetSchema: Schema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    organizationId: { type: String, index: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    category: { type: String, enum: ['LOGO', 'COVER', 'ADDITIONAL', 'PROFILE'], required: true },
    mediaType: { type: String, enum: ['photo', 'video'], default: 'photo' },
    url: { type: String, required: true },
    status: { type: String, enum: ['staged', 'published', 'failed'], default: 'staged', index: true },
    googleMediaName: { type: String },
    publishedAt: { type: Date },
    failureReason: { type: String },
    scheduledFor: { type: Date },
  },
  { timestamps: true }
);

// The dashboard's media grid always loads "everything for this business,
// grouped by category" — this is that exact access path.
GbpMediaAssetSchema.index({ businessId: 1, category: 1, status: 1 });
// publishScheduledMediaCron's exact query shape (status + scheduledFor range).
GbpMediaAssetSchema.index({ status: 1, scheduledFor: 1 });

export default mongoose.models.GbpMediaAsset ||
  mongoose.model<IGbpMediaAsset>('GbpMediaAsset', GbpMediaAssetSchema);
