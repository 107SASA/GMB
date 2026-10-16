import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * One unresolved payment failure of one workspace, and its WhatsApp recovery
 * reminders (lib/billing/recoveryReminders.ts). Day 0 = failedAt, frozen when
 * the failure opened; later Razorpay retries in the same failure never reset
 * it. At most ONE open episode per workspace (partial unique index).
 *
 * Each step is claimed atomically before sending and records the provider
 * message id. "sent" means Twilio ACCEPTED the message; deliveryStatus comes
 * only from Twilio's status callback.
 */
export type ReminderStepStatus = 'pending' | 'retry' | 'claimed' | 'sent' | 'failed' | 'ambiguous' | 'skipped' | 'stopped';

export interface IReminderStep {
  key: string;
  offsetDays: number;
  final: boolean;
  dueAt: Date;
  nextAttemptAt: Date;
  status: ReminderStepStatus;
  attempts: number;
  claimToken?: string;
  claimedAt?: Date;
  sentAt?: Date;
  templateSid?: string;
  providerMessageId?: string;
  deliveryStatus?: string;
  deliveryUpdatedAt?: Date;
  lastError?: string;
  lastErrorCode?: string;
}

export interface IBillingRecoveryEpisode extends Document {
  businessId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  razorpaySubscriptionId?: string;
  failureKind?: string;
  failedAt: Date;
  status: 'open' | 'resolved' | 'stopped';
  stopReason?: string;
  closedAt?: Date;
  steps: IReminderStep[];
  remindersSent: number;
  needsReview: boolean;
  reviewNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const StepSchema = new Schema<IReminderStep>(
  {
    key: { type: String, required: true },
    offsetDays: { type: Number, required: true },
    final: { type: Boolean, default: false },
    dueAt: { type: Date, required: true },
    nextAttemptAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending', 'retry', 'claimed', 'sent', 'failed', 'ambiguous', 'skipped', 'stopped'],
      default: 'pending',
    },
    attempts: { type: Number, default: 0 },
    claimToken: { type: String },
    claimedAt: { type: Date },
    sentAt: { type: Date },
    templateSid: { type: String },
    providerMessageId: { type: String },
    deliveryStatus: { type: String },
    deliveryUpdatedAt: { type: Date },
    lastError: { type: String },
    lastErrorCode: { type: String },
  },
  { _id: false }
);

const BillingRecoveryEpisodeSchema = new Schema<IBillingRecoveryEpisode>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    razorpaySubscriptionId: { type: String },
    failureKind: { type: String },
    failedAt: { type: Date, required: true },
    status: { type: String, enum: ['open', 'resolved', 'stopped'], default: 'open' },
    stopReason: { type: String },
    closedAt: { type: Date },
    steps: { type: [StepSchema], default: [] },
    remindersSent: { type: Number, default: 0 },
    needsReview: { type: Boolean, default: false },
    reviewNote: { type: String },
  },
  { timestamps: true }
);

BillingRecoveryEpisodeSchema.index({ businessId: 1 }, { unique: true, partialFilterExpression: { status: 'open' } });
BillingRecoveryEpisodeSchema.index({ status: 1, 'steps.nextAttemptAt': 1 });
BillingRecoveryEpisodeSchema.index({ 'steps.providerMessageId': 1 }, { sparse: true });

const BillingRecoveryEpisode: Model<IBillingRecoveryEpisode> =
  (mongoose.models.BillingRecoveryEpisode as Model<IBillingRecoveryEpisode>) ||
  mongoose.model<IBillingRecoveryEpisode>('BillingRecoveryEpisode', BillingRecoveryEpisodeSchema);

export default BillingRecoveryEpisode;
