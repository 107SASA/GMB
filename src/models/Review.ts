import mongoose, { Schema, Document } from 'mongoose';

export interface IReview extends Document {
  tenantId?: string;
  organizationId?: string;
  providerReviewId?: string;
  businessId: mongoose.Types.ObjectId;
  requestId?: mongoose.Types.ObjectId;
  reviewer: string;
  rating: number;
  reviewText: string;
  sentiment: string;
  sentimentScore?: number;
  response: string;
  aiSuggestedReply?: string;
  replyStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'POSTED' | 'FAILED';
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
  createdAt: Date;
  updatedAt: Date;
}

const ReviewSchema: Schema = new Schema(
  {
    tenantId: { type: String, index: true },
    organizationId: { type: String, index: true },
    providerReviewId: { type: String, index: true, unique: true, sparse: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    requestId: { type: Schema.Types.ObjectId, ref: 'ReviewRequest', index: true, unique: true, sparse: true },
    reviewer: { type: String, required: true },
    rating: { type: Number, required: true },
    reviewText: { type: String },
    sentiment: { type: String, enum: ['positive', 'neutral', 'negative', 'critical'] },
    sentimentScore: { type: Number },
    response: { type: String },
    aiSuggestedReply: { type: String },
    replyStatus: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'POSTED', 'FAILED'], default: 'PENDING' },
    replyTone: { type: String },
    sourcePlatform: { type: String, default: 'Google' },
    source: { type: String, enum: ['gbp_api', 'serpapi', 'mock'] },
    postedAt: { type: Date, index: true },
  },
  { timestamps: true }
);

export default mongoose.models.Review || mongoose.model<IReview>('Review', ReviewSchema);
