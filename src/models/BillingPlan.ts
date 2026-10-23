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
export type BillingCycle = 'monthly' | 'quarterly' | 'halfyearly' | 'yearly';

/** One selectable billing duration with its own price + Razorpay plan. */
export interface IPlanDuration {
  cycle: BillingCycle;
  priceInr: number;
  enabled: boolean;
  /** Razorpay Plan id valid for THIS cycle's current price (immutable amounts). */
  razorpayPlanId?: string;
  razorpayPlanPriceInr?: number;
  /** Razorpay mode (test/live keys) the plan id was created in. Missing = legacy, test only. */
  razorpayPlanMode?: 'test' | 'live';
}

export interface IBillingPlan extends Document {
  key: 'default';
  displayName: string;
  description: string;
  /** Legacy monthly price (kept for back-compat; monthly duration mirrors it). */
  priceInr: number;
  razorpayPlanId?: string;
  razorpayPlanPriceInr?: number;
  razorpayPlanMode?: 'test' | 'live';
  /** Editable feature bullets shown on the pricing card / paywall. */
  features: string[];
  /** Per-duration pricing (monthly/quarterly/halfyearly/yearly). */
  durations: IPlanDuration[];
  /** Bumped by every write; the admin save only writes over the revision it read (no lost updates). */
  revision?: number;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const PlanDurationSchema = new Schema<IPlanDuration>(
  {
    cycle:                { type: String, enum: ['monthly', 'quarterly', 'halfyearly', 'yearly'], required: true },
    priceInr:             { type: Number, required: true, min: 1 },
    enabled:              { type: Boolean, default: false },
    razorpayPlanId:       { type: String },
    razorpayPlanPriceInr: { type: Number },
    razorpayPlanMode:     { type: String, enum: ['test', 'live'] },
  },
  { _id: false }
);

const BillingPlanSchema = new Schema<IBillingPlan>(
  {
    key:                  { type: String, required: true, unique: true, default: 'default' },
    displayName:          { type: String, required: true },
    description:          { type: String, default: '' },
    priceInr:             { type: Number, required: true, min: 1 },
    razorpayPlanId:       { type: String },
    razorpayPlanPriceInr: { type: Number },
    razorpayPlanMode:     { type: String, enum: ['test', 'live'] },
    features:             { type: [String], default: [] },
    durations:            { type: [PlanDurationSchema], default: [] },
    revision:             { type: Number },
    updatedBy:            { type: String, default: '' },
  },
  { timestamps: true }
);

const BillingPlan: Model<IBillingPlan> =
  mongoose.models.BillingPlan ||
  mongoose.model<IBillingPlan>('BillingPlan', BillingPlanSchema);

export default BillingPlan;
