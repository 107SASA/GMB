import mongoose, { Schema, Document } from 'mongoose';

export interface IReviewRequest extends Document {
  tenantId: string;
  businessId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  channel: 'whatsapp' | 'email';
  message: string;
  status: 'Pending' | 'Sent' | 'Delivered' | 'Failed' | 'Cancelled';
  sentAt?: Date;
  clicked: boolean;
  clickedAt?: Date;
  reviewReceived: boolean;
  rating?: number;
  followUpStage: number; // 0=Initial, 1=Reminder 1, 2=Reminder 2
  automationStatus: 'Active' | 'Completed' | 'Stopped';
  inngestEventId?: string; // To allow cancellation
  createdAt: Date;
  updatedAt: Date;
}

const ReviewRequestSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    channel: { type: String, enum: ['whatsapp', 'email'], required: true },
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
    rating: { type: Number },
    followUpStage: { type: Number, default: 0 },
    automationStatus: {
      type: String,
      enum: ['Active', 'Completed', 'Stopped'],
      default: 'Active'
    },
    inngestEventId: { type: String }
  },
  { timestamps: true }
);

export default mongoose.models.ReviewRequest || mongoose.model<IReviewRequest>('ReviewRequest', ReviewRequestSchema);
