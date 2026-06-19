import mongoose, { Schema, Document } from 'mongoose';

export interface ISubscriptionUsage extends Document {
  businessId: mongoose.Types.ObjectId;
  month: string; // e.g., '2023-10'
  auditsUsed: number;
  postsUsed: number;
  reviewRequestsUsed: number;
  whatsappMessagesUsed: number;
  leadsCreated: number;
  businessesUsed: number;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionUsageSchema: Schema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    month: { type: String, required: true },
    auditsUsed: { type: Number, default: 0 },
    postsUsed: { type: Number, default: 0 },
    reviewRequestsUsed: { type: Number, default: 0 },
    whatsappMessagesUsed: { type: Number, default: 0 },
    leadsCreated: { type: Number, default: 0 },
    businessesUsed: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Compound index to quickly find the usage for a specific business and month
SubscriptionUsageSchema.index({ businessId: 1, month: 1 }, { unique: true });

export default mongoose.models.SubscriptionUsage || mongoose.model<ISubscriptionUsage>('SubscriptionUsage', SubscriptionUsageSchema);
