import mongoose, { Schema, Document } from 'mongoose';

export interface IReviewReply extends Document {
  reviewId: mongoose.Types.ObjectId;
  generatedReply: string;
  approved: boolean;
  posted: boolean;
  tone: string;
  aiGenerated: boolean;
  /** Audit trail (Sep 2026): one row per draft / publish attempt. */
  businessId?: mongoose.Types.ObjectId;
  event?: 'drafted' | 'approved' | 'publish_attempt';
  sources?: string[];
  validation?: { ok: boolean; reasons: string[]; attempts?: number };
  approvalStatus?: 'draft' | 'needs_review' | 'approved' | 'rejected';
  approvedBy?: 'owner' | 'auto';
  publishStatus?: 'published' | 'blocked' | 'failed' | 'not_attempted';
  googleResponse?: string;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewReplySchema: Schema = new Schema(
  {
    reviewId: { type: Schema.Types.ObjectId, ref: 'Review', required: true, index: true },
    generatedReply: { type: String, required: true },
    approved: { type: Boolean, default: false },
    posted: { type: Boolean, default: false },
    tone: { type: String, default: 'Professional' },
    aiGenerated: { type: Boolean, default: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    event: { type: String, enum: ['drafted', 'approved', 'publish_attempt'] },
    sources: [{ type: String }],
    validation: { type: Schema.Types.Mixed },
    approvalStatus: { type: String, enum: ['draft', 'needs_review', 'approved', 'rejected'] },
    approvedBy: { type: String, enum: ['owner', 'auto'] },
    publishStatus: { type: String, enum: ['published', 'blocked', 'failed', 'not_attempted'] },
    googleResponse: { type: String },
    error: { type: String },
  },
  { timestamps: true }
);

export default mongoose.models.ReviewReply || mongoose.model<IReviewReply>('ReviewReply', ReviewReplySchema);
