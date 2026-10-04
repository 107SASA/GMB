import mongoose, { Schema, Document } from 'mongoose';

export interface IReviewMessageAttempt {
  sid?: string;
  templateSid?: string;
  templateKind?: 'utility' | 'legacy' | 'free_text';
  stage?: 'initial' | 'reminder1' | 'reminder2' | 'retry';
  sentAt?: Date;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  failedAt?: Date;
}

export interface IReviewRequest extends Document {
  tenantId: string;
  businessId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  channel: 'whatsapp';
  message: string;
  status: 'Pending' | 'Sent' | 'Delivered' | 'Read' | 'Failed' | 'Cancelled';
  sentAt?: Date;
  clicked: boolean;
  clickedAt?: Date;
  /** Repeat clicks. Campaign.clicked increments only on the first click. */
  clickCount: number;
  reviewReceived: boolean;
  reviewedAt?: Date;
  rating?: number;
  followUpStage: number; // 0=Initial, 1=Reminder 1, 2=Reminder 2
  automationStatus: 'Active' | 'Completed' | 'Stopped';
  inngestEventId?: string;
  campaignId?: mongoose.Types.ObjectId;
  /**
   * Twilio SID of the most recently sent message. Older SIDs stay in
   * messageSids / messageHistory so a late webhook can still match them.
   */
  lastMessageSid?: string;
  messageSids: string[];
  messageHistory: IReviewMessageAttempt[];
  /** Opaque public token used by /review/[token]. Not a Mongo id. */
  token?: string;
  templateSid?: string;
  deliveredAt?: Date;
  readAt?: Date;
  failedAt?: Date;
  errorCode?: string;
  errorMessage?: string;
  /** Why status is 'Failed' — kept so older readers still see a reason string. */
  failedReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewMessageAttemptSchema = new Schema(
  {
    sid: { type: String },
    templateSid: { type: String },
    templateKind: { type: String, enum: ['utility', 'legacy', 'free_text'] },
    stage: { type: String, enum: ['initial', 'reminder1', 'reminder2', 'retry'] },
    sentAt: { type: Date },
    status: { type: String },
    errorCode: { type: String },
    errorMessage: { type: String },
    failedAt: { type: Date },
  },
  { _id: false }
);

const ReviewRequestSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    channel: { type: String, enum: ['whatsapp'], default: 'whatsapp', required: true },
    message: { type: String, required: true },
    status: { 
      type: String, 
      enum: ['Pending', 'Sent', 'Delivered', 'Read', 'Failed', 'Cancelled'], 
      default: 'Pending' 
    },
    sentAt: { type: Date },
    clicked: { type: Boolean, default: false },
    clickedAt: { type: Date },
    clickCount: { type: Number, default: 0 },
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
    messageSids: { type: [String], default: [], index: true },
    messageHistory: { type: [ReviewMessageAttemptSchema], default: [] },
    token: { type: String },
    templateSid: { type: String },
    deliveredAt: { type: Date },
    readAt: { type: Date },
    failedAt: { type: Date },
    errorCode: { type: String, index: true },
    errorMessage: { type: String },
    failedReason: { type: String }
  },
  { timestamps: true }
);

// Sparse so existing requests without a token do not collide.
ReviewRequestSchema.index({ token: 1 }, { unique: true, sparse: true });

export default mongoose.models.ReviewRequest || mongoose.model<IReviewRequest>('ReviewRequest', ReviewRequestSchema);
