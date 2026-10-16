import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Audit trail of every Razorpay billing event the app processed — applied or
 * ignored, and why (services/billing/billingEvents.ts). Ids, amounts and
 * decisions only; no payment credentials.
 */
export interface IBillingEvent extends Document {
  businessId?: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  razorpaySubscriptionId?: string;
  razorpayEventId?: string;
  eventType: string;
  source: 'webhook' | 'reconcile' | 'recovery' | 'admin';
  eventAt: Date;
  /** Workspace status before → after. */
  statusBefore?: string;
  statusAfter?: string;
  actions: string[];
  note: string;
  amountPaise?: number;
  currency?: string;
  /** A failed or ambiguous Razorpay operation an operator should look at. */
  needsReview?: boolean;
  reviewedAt?: Date;
  createdAt: Date;
}

const BillingEventSchema = new Schema<IBillingEvent>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    razorpaySubscriptionId: { type: String, index: true },
    razorpayEventId: { type: String },
    eventType: { type: String, required: true },
    source: { type: String, enum: ['webhook', 'reconcile', 'recovery', 'admin'], required: true },
    eventAt: { type: Date, required: true },
    statusBefore: { type: String },
    statusAfter: { type: String },
    actions: { type: [String], default: [] },
    note: { type: String, default: '' },
    amountPaise: { type: Number },
    currency: { type: String },
    needsReview: { type: Boolean, index: true },
    reviewedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const BillingEvent: Model<IBillingEvent> =
  (mongoose.models.BillingEvent as Model<IBillingEvent>) ||
  mongoose.model<IBillingEvent>('BillingEvent', BillingEventSchema);

export default BillingEvent;
