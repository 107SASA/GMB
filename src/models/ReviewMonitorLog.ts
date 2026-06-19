import mongoose, { Schema, Document } from 'mongoose';

export interface IReviewMonitorLog extends Document {
  businessId: mongoose.Types.ObjectId;
  reviewsFetched: number;
  newReviewsDetected: number;
  aiRepliesGenerated: number;
  errorLogs: string[];
  createdAt: Date;
  updatedAt: Date;
}

const ReviewMonitorLogSchema: Schema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    reviewsFetched: { type: Number, default: 0 },
    newReviewsDetected: { type: Number, default: 0 },
    aiRepliesGenerated: { type: Number, default: 0 },
    errorLogs: [{ type: String }],
  },
  { timestamps: true }
);

export default mongoose.models.ReviewMonitorLog || mongoose.model<IReviewMonitorLog>('ReviewMonitorLog', ReviewMonitorLogSchema);
