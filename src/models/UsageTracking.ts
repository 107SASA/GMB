import mongoose, { Schema, Document } from 'mongoose';

export interface IUsageTracking extends Document {
  userId: mongoose.Types.ObjectId;
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
  
  metrics: {
    aiGenerations: number;
    whatsappMessages: number;
    reviewRequests: number;
    contentUsage: number;
  };
  
  limits: {
    aiGenerations: number;
    whatsappMessages: number;
    reviewRequests: number;
    contentUsage: number;
  };
  
  createdAt: Date;
  updatedAt: Date;
}

const UsageTrackingSchema: Schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    billingPeriodStart: { type: Date, required: true },
    billingPeriodEnd: { type: Date, required: true },
    
    metrics: {
      aiGenerations: { type: Number, default: 0 },
      whatsappMessages: { type: Number, default: 0 },
      reviewRequests: { type: Number, default: 0 },
      contentUsage: { type: Number, default: 0 },
    },
    
    limits: {
      aiGenerations: { type: Number, default: 100 },
      whatsappMessages: { type: Number, default: 50 },
      reviewRequests: { type: Number, default: 100 },
      contentUsage: { type: Number, default: 50 },
    }
  },
  { timestamps: true }
);

UsageTrackingSchema.index({ userId: 1, billingPeriodStart: -1 });

export default mongoose.models.UsageTracking || mongoose.model<IUsageTracking>('UsageTracking', UsageTrackingSchema);
