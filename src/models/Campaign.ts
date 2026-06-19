import mongoose, { Schema, Document } from 'mongoose';

export interface ICampaign extends Document {
  businessId: mongoose.Types.ObjectId;
  name: string;
  channel: 'WHATSAPP' | 'EMAIL' | 'SMS';
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  day2Reminder: boolean;
  day5Reminder: boolean;
  stopOnReview: boolean;
  sendOnlyBizHours: boolean;
  scheduledAt?: Date;
  completedAt?: Date;
  
  // Tracking
  totalRequests: number;
  delivered: number;
  clicked: number;
  reviewsReceived: number;

  createdAt: Date;
  updatedAt: Date;
}

const CampaignSchema: Schema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    name: { type: String, required: true },
    channel: { type: String, enum: ['WHATSAPP', 'EMAIL', 'SMS'], required: true },
    status: { 
      type: String, 
      enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED'], 
      default: 'DRAFT',
      index: true
    },
    day2Reminder: { type: Boolean, default: true },
    day5Reminder: { type: Boolean, default: true },
    stopOnReview: { type: Boolean, default: true },
    sendOnlyBizHours: { type: Boolean, default: true },
    scheduledAt: { type: Date },
    completedAt: { type: Date },

    totalRequests: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    clicked: { type: Number, default: 0 },
    reviewsReceived: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.models.Campaign || mongoose.model<ICampaign>('Campaign', CampaignSchema);
