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
  },
  { timestamps: true }
);

export default mongoose.models.Review || mongoose.model<IReview>('Review', ReviewSchema);
