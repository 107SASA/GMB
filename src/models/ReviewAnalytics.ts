import mongoose, { Schema, Document } from 'mongoose';

export interface IReviewAnalytics extends Document {
  tenantId: string;
  businessId: mongoose.Types.ObjectId;
  avgRating: number;
  responseRate: number;
  sentimentScore: number;
  unansweredCount: number;
  totalReviews: number;
  positiveReviews: number;
  negativeReviews: number;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewAnalyticsSchema: Schema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    avgRating: { type: Number, default: 0 },
    responseRate: { type: Number, default: 0 },
    sentimentScore: { type: Number, default: 0 },
    unansweredCount: { type: Number, default: 0 },
    totalReviews: { type: Number, default: 0 },
    positiveReviews: { type: Number, default: 0 },
    negativeReviews: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.models.ReviewAnalytics || mongoose.model<IReviewAnalytics>('ReviewAnalytics', ReviewAnalyticsSchema);
