import mongoose, { Schema, Document } from 'mongoose';

/**
 * Log of real, already-happened changes to a business's Google Business
 * Profile — powers the mobile Home "AI Actions" feed's activity cards
 * (alongside audit priorityFixes/quickWins and published posts, which were
 * already there — see gbpMediaService.ts / gbp/profile route.ts for writers).
 *
 * IMPORTANT — only log things that actually happened. This does NOT include
 * an autonomous "AI edits your profile for you" capability; no such feature
 * exists in this codebase (GBP writes are gated behind GBP_LIVE_WRITES_ENABLED
 * and today are all owner-initiated). `updatedBy` reflects who really made
 * the change — the signed-in user's name for profile edits, "GrowwMatics AI"
 * only for changes the AI genuinely made unattended (none yet). Do not
 * relabel a manual edit as AI-driven to match a competitor's copy — that
 * would be a fabricated claim in the product, not just marketing copy.
 */

export type ProfileActivityType = 'profile_updated' | 'photo_published';

export interface IProfileActivity extends Document {
  businessId: mongoose.Types.ObjectId;
  organizationId?: string;
  type: ProfileActivityType;
  title: string;
  detail?: string;
  /** Who/what actually made the change — a real name, never a placeholder. */
  updatedBy: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const ProfileActivitySchema: Schema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    organizationId: { type: String, index: true },
    type: { type: String, enum: ['profile_updated', 'photo_published'], required: true },
    title: { type: String, required: true },
    detail: { type: String },
    updatedBy: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ProfileActivitySchema.index({ businessId: 1, createdAt: -1 });

export default mongoose.models.ProfileActivity ||
  mongoose.model<IProfileActivity>('ProfileActivity', ProfileActivitySchema);
