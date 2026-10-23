import mongoose, { Schema, Document } from 'mongoose';
import type { GlobalReviewFollowUpSettings } from '@/lib/reviewFollowUpSettings';

export interface IReviewFollowUpPolicy extends GlobalReviewFollowUpSettings, Document {
  /** Singleton key. Only `global` is read. */
  key: 'global';
  /** Persisted form of GlobalReviewFollowUpSettings.stopOnClick. */
  stopOnLinkClick?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewFollowUpPolicySchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    enabled: { type: Boolean, default: true },
    initialFollowUpDelayDays: { type: Number, default: 2 },
    secondFollowUpDelayDays: { type: Number, default: 5 },
    maximumFollowUps: { type: Number, default: 2 },
    minimumIntervalDays: { type: Number, default: 1 },
    stopOnOptOut: { type: Boolean, default: true },
    /** Legacy — always written as false before Oct 2026 and no longer read. */
    stopOnClick: { type: Boolean, default: false },
    /** Skip pending follow-ups after the customer clicks the review link (default on). */
    stopOnLinkClick: { type: Boolean, default: true },
    stopOnReview: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.models.ReviewFollowUpPolicy ||
  mongoose.model<IReviewFollowUpPolicy>('ReviewFollowUpPolicy', ReviewFollowUpPolicySchema);
