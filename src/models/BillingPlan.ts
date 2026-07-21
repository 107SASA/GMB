import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * The ONE sellable plan, editable by the super admin (price / name / copy).
 * Singleton document (key: 'default'); planCatalog.ts falls back to
 * hardcoded defaults when it doesn't exist yet.
 *
 * Razorpay plan amounts are immutable, so every price change requires a new
 * Razorpay Plan (plan_...). razorpayPlanPriceInr records which price the
 * stored razorpayPlanId was created for — a mismatch means a fresh Razorpay
 * plan must be created before checkout (see ensureRazorpayPlanId).
 */
export interface IBillingPlan extends Document {
  key: 'default';
  displayName: string;
  description: string;
  /** Price per month in INR (whole rupees). */
  priceInr: number;
  razorpayPlanId?: string;
  razorpayPlanPriceInr?: number;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const BillingPlanSchema = new Schema<IBillingPlan>(
  {
    key:                  { type: String, required: true, unique: true, default: 'default' },
    displayName:          { type: String, required: true },
    description:          { type: String, default: '' },
    priceInr:             { type: Number, required: true, min: 1 },
    razorpayPlanId:       { type: String },
    razorpayPlanPriceInr: { type: Number },
    updatedBy:            { type: String, default: '' },
  },
  { timestamps: true }
);

const BillingPlan: Model<IBillingPlan> =
  mongoose.models.BillingPlan ||
  mongoose.model<IBillingPlan>('BillingPlan', BillingPlanSchema);

export default BillingPlan;
