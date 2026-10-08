import mongoose, { Schema, Document } from 'mongoose';

export interface IReview extends Document {
  tenantId?: string;
  organizationId?: string;
  providerReviewId?: string;
  businessId: mongoose.Types.ObjectId;
  requestId?: mongoose.Types.ObjectId;
  reviewer: string;
  /** Reviewer's Google profile photo, when the source provider exposed one. */
  reviewerPhotoUrl?: string;
  rating: number;
  reviewText: string;
  sentiment: string;
  sentimentScore?: number;
  response: string;
  aiSuggestedReply?: string;
  /**
   * PENDING (no draft) → DRAFT (AI draft passed the fact check) or NEEDS_REVIEW
   * (failed it after one regeneration) → APPROVED (owner, or auto-reply with
   * consent) → POSTED (Google confirmed). REJECTED by the owner; FAILED when
   * Google rejected the publish.
   */
  replyStatus?: 'PENDING' | 'DRAFT' | 'NEEDS_REVIEW' | 'APPROVED' | 'REJECTED' | 'POSTED' | 'FAILED';
  /** Fact/policy/quality check of the current reply text (services/reviews/validateReply.ts). */
  replyValidation?: { ok: boolean; reasons: string[]; attempts?: number; checkedAt?: Date };
  /** Where the facts in the draft came from (business profile, website, SEO plan, …). */
  replySources?: string[];
  replyApprovedBy?: 'owner' | 'auto';
  replyApprovedAt?: Date;
  /** Last publish attempt: published (Google confirmed) / blocked (live writes off) / failed. */
  replyPublishStatus?: 'published' | 'blocked' | 'failed';
  replyGoogleResponse?: string;
  /** Only set when replyStatus is 'FAILED' — cleared on the next successful attempt. */
  replyFailureReason?: string;
  replyTone?: string;
  sourcePlatform?: string;
  /**
   * Which review provider fetched this review (see src/services/reviews/).
   * 'gbp_api' reviews carry a REAL Google review id and can have a reply
   * posted back to the live profile; 'serpapi'/'mock' reviews are read-only
   * previews (SerpApi's synthetic ids aren't valid Google review ids — see
   * the reply-gating in src/app/api/reviews/[id]/post-reply/route.ts).
   * Missing on reviews synced before this field existed — treated the same
   * as a non-Google source (never reply-eligible) everywhere it's checked.
   */
  source?: 'gbp_api' | 'serpapi' | 'mock';
  /**
   * When the customer posted the review on Google. createdAt is only the
   * sync time (Mongoose timestamps strip createdAt from upserts), so any
   * date math (trends, "days since last review") must use postedAt.
   */
  postedAt?: Date;
  /**
   * Last sync that READ the owner-reply state for this review (Sep 2026+).
   * Missing on records synced before reply capture existed — their reply
   * status is unknown, so they are never counted as unanswered.
   */
  replyCheckedAt?: Date;
  /**
   * Execution record for a posted reply: 'growwmatics_auto' (auto-reply mode),
   * 'growwmatics_owner_approved' (owner approved, GrowwMatics posted) or
   * 'external' (the reply already existed on Google when we synced).
   */
  replyPostedBy?: 'growwmatics_auto' | 'growwmatics_owner_approved' | 'external';
  replyPostedAt?: Date;
  /** true only when a GrowwMatics-posted reply actually reached Google. */
  replyLiveWriteApplied?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewSchema: Schema = new Schema(
  {
    tenantId: { type: String, index: true },
    organizationId: { type: String, index: true },
    providerReviewId: { type: String, index: true, sparse: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    requestId: { type: Schema.Types.ObjectId, ref: 'ReviewRequest', index: true, unique: true, sparse: true },
    reviewer: { type: String, required: true },
    reviewerPhotoUrl: { type: String },
    rating: { type: Number, required: true },
    reviewText: { type: String },
    sentiment: { type: String, enum: ['positive', 'neutral', 'negative', 'critical'] },
    sentimentScore: { type: Number },
    response: { type: String },
    aiSuggestedReply: { type: String },
    replyStatus: { type: String, enum: ['PENDING', 'DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'POSTED', 'FAILED'], default: 'PENDING' },
    replyValidation: { type: Schema.Types.Mixed },
    replySources: [{ type: String }],
    replyApprovedBy: { type: String, enum: ['owner', 'auto'] },
    replyApprovedAt: { type: Date },
    replyPublishStatus: { type: String, enum: ['published', 'blocked', 'failed'] },
    replyGoogleResponse: { type: String },
    replyFailureReason: { type: String },
    replyTone: { type: String },
    sourcePlatform: { type: String, default: 'Google' },
    source: { type: String, enum: ['gbp_api', 'serpapi', 'mock'] },
    replyCheckedAt: { type: Date },
    replyPostedBy: { type: String, enum: ['growwmatics_auto', 'growwmatics_owner_approved', 'external'] },
    replyPostedAt: { type: Date },
    replyLiveWriteApplied: { type: Boolean },
    postedAt: { type: Date, index: true },
  },
  { timestamps: true }
);

// Review identity is per workspace: { businessId, providerReviewId } (the
// key services/reviews/syncReviews.ts upserts on). Unique only where a
// provider id exists — manual / request-linked reviews have none.
// The legacy global unique `providerReviewId_1` is removed by
// scripts/migrate-review-identity.ts --apply. This field stays a non-unique
// sparse lookup index so that script is not undone by a later index sync.
ReviewSchema.index(
  { businessId: 1, providerReviewId: 1 },
  { unique: true, partialFilterExpression: { providerReviewId: { $type: 'string' } } },
);

export default mongoose.models.Review || mongoose.model<IReview>('Review', ReviewSchema);
