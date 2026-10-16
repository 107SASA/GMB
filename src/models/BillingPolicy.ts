import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Super-admin billing policy (singleton, key 'default'). Read through
 * lib/billing/billingPolicy.ts parseTrialPolicy(), which treats a missing or
 * malformed document as "offer OFF" — a bad config can never grant a trial.
 *
 * The trial offer is decided once, when a checkout is created, and frozen into
 * that checkout's snapshot (TrialClaim.offer + Razorpay notes). Changing this
 * document never alters a checkout that already exists or a trial already
 * authorized.
 */
export interface IBillingPolicy extends Document {
  key: 'default';
  trial: {
    offerEnabled: boolean;
    trialMonths: number;
    eligibleCycle: 'yearly';
  };
  /**
   * Failed-payment policy (lib/billing/billingPolicy.ts parseFailurePolicy):
   * malformed parts fall back to the defaults. Frozen into each failure at
   * Day 0 (Business.payment*), so editing it never changes an open failure.
   */
  failure?: {
    firstCharge: { mode: 'immediate' | 'grace'; graceDays: number };
    renewal: { mode: 'immediate' | 'grace'; graceDays: number };
    restrictedModules: string[];
    restoreAccessOnRecovery: boolean;
  };
  /** WhatsApp payment-recovery reminders (parseReminderPolicy — off by default). */
  reminders?: Record<string, unknown>;
  /** Bumped on every save; stored in each checkout snapshot. */
  version: number;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const BillingPolicySchema = new Schema<IBillingPolicy>(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    trial: {
      offerEnabled: { type: Boolean, default: false },
      trialMonths: { type: Number, default: 3, min: 1, max: 12 },
      eligibleCycle: { type: String, enum: ['yearly'], default: 'yearly' },
    },
    failure: {
      firstCharge: {
        mode: { type: String, enum: ['immediate', 'grace'], default: 'immediate' },
        graceDays: { type: Number, default: 0, min: 0, max: 30 },
      },
      renewal: {
        mode: { type: String, enum: ['immediate', 'grace'], default: 'grace' },
        graceDays: { type: Number, default: 3, min: 0, max: 30 },
      },
      restrictedModules: {
        type: [String],
        default: ['reputation_agent', 'sales_agent', 'content_studio', 'marketing_automation'],
      },
      restoreAccessOnRecovery: { type: Boolean, default: true },
    },
    // Validated as a whole by validateReminderPolicyUpdate before saving and
    // read defensively by parseReminderPolicy (malformed → defaults, never a send).
    reminders: { type: Schema.Types.Mixed },
    version: { type: Number, default: 0 },
    updatedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

const BillingPolicy: Model<IBillingPolicy> =
  (mongoose.models.BillingPolicy as Model<IBillingPolicy>) ||
  mongoose.model<IBillingPolicy>('BillingPolicy', BillingPolicySchema);

export default BillingPolicy;
