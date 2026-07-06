import mongoose, { Schema, Document } from 'mongoose';

export interface ICampaign extends Document {
  businessId: mongoose.Types.ObjectId;
  tenantId?: string;
  name: string;
  // WhatsApp is the only supported channel for review requests.
  channel: 'WHATSAPP';
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';

  // Targeting: customers whose tags include ANY of these. Empty = all customers.
  targetTags: string[];

  // Messages. Placeholders: {{name}}, {{service}}, {{business}}, {{link}}
  // initialMessage empty = AI generates a message per customer at send time.
  initialMessage: string;
  reminder1Enabled: boolean;
  reminder1AfterDays: number;
  reminder1Message: string;
  reminder2Enabled: boolean;
  reminder2AfterDays: number;
  reminder2Message: string;

  stopOnReview: boolean;
  sendOnlyBizHours: boolean;
  bizHoursStart: number; // 0-23, local server time
  bizHoursEnd: number;   // 0-23

  scheduledAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;

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
    tenantId: { type: String },
    name: { type: String, required: true },
    channel: { type: String, enum: ['WHATSAPP'], default: 'WHATSAPP' },
    status: {
      type: String,
      enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'],
      default: 'DRAFT',
      index: true
    },

    targetTags: [{ type: String }],

    initialMessage: { type: String, default: '' },
    reminder1Enabled: { type: Boolean, default: true },
    reminder1AfterDays: { type: Number, default: 2, min: 1, max: 60 },
    reminder1Message: { type: String, default: '' },
    reminder2Enabled: { type: Boolean, default: true },
    reminder2AfterDays: { type: Number, default: 5, min: 1, max: 60 },
    reminder2Message: { type: String, default: '' },

    stopOnReview: { type: Boolean, default: true },
    sendOnlyBizHours: { type: Boolean, default: true },
    bizHoursStart: { type: Number, default: 9, min: 0, max: 23 },
    bizHoursEnd: { type: Number, default: 20, min: 1, max: 24 },

    scheduledAt: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    cancelledAt: { type: Date },

    totalRequests: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    clicked: { type: Number, default: 0 },
    reviewsReceived: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.models.Campaign || mongoose.model<ICampaign>('Campaign', CampaignSchema);
