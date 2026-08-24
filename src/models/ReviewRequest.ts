import mongoose, { Schema, Document } from 'mongoose';

export interface IReviewRequest extends Document {
  tenantId: string;
  businessId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  channel: 'whatsapp';
  message: string;
  status: 'Pending' | 'Sent' | 'Delivered' | 'Failed' | 'Cancelled';
  sentAt?: Date;
  clicked: boolean;
  clickedAt?: Date;
  reviewReceived: boolean;
  reviewedAt?: Date;
  rating?: number;
  followUpStage: number; // 0=Initial, 1=Reminder 1, 2=Reminder 2
  automationStatus: 'Active' | 'Completed' | 'Stopped';
  inngestEventId?: string;
  campaignId?: mongoose.Types.ObjectId;
  /**
   * Twilio SID (or Meta wamid) of the most recently sent message for this
   * request — initial send, then overwritten by each reminder. Lets the
   * delivery-status webhook (src/app/api/webhook/twilio/status/route.ts)
   * match an async delivered/failed receipt back to this document, since
   * "status: Sent" only ever meant "the provider's API accepted the send",
   * never "WhatsApp actually delivered it".
   */
  lastMessageSid?: string;
  /** Why status is 'Failed' — set by the sync send path or the async status webhook. */
  failedReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewRequestSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    channel: { type: String, enum: ['whatsapp'], default: 'whatsapp', required: true },
    message: { type: String, required: true },
    status: { 
      type: String, 
      enum: ['Pending', 'Sent', 'Delivered', 'Failed', 'Cancelled'], 
      default: 'Pending' 
    },
    sentAt: { type: Date },
    clicked: { type: Boolean, default: false },
    clickedAt: { type: Date },
    reviewReceived: { type: Boolean, default: false },
    reviewedAt: { type: Date },
    rating: { type: Number },
    followUpStage: { type: Number, default: 0 },
    automationStatus: {
      type: String,
      enum: ['Active', 'Completed', 'Stopped'],
      default: 'Active'
    },
    inngestEventId: { type: String },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', index: true },
    lastMessageSid: { type: String, index: true },
    failedReason: { type: String }
  },
  { timestamps: true }
);

export default mongoose.models.ReviewRequest || mongoose.model<IReviewRequest>('ReviewRequest', ReviewRequestSchema);
