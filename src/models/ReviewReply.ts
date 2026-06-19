import mongoose, { Schema, Document } from 'mongoose';

export interface IReviewReply extends Document {
  reviewId: mongoose.Types.ObjectId;
  generatedReply: string;
  approved: boolean;
  posted: boolean;
  tone: string;
  aiGenerated: boolean;
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
  },
  { timestamps: true }
);

export default mongoose.models.ReviewReply || mongoose.model<IReviewReply>('ReviewReply', ReviewReplySchema);
