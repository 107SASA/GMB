import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * One free trial per verified phone number, for one workspace — enforced by
 * the database, not the UI.
 *
 *  - `phoneHash` is UNIQUE: a phone number has at most one claim document,
 *    ever, across every account and workspace. A second checkout for the same
 *    phone hits the duplicate key and gets the normal paid flow.
 *  - `holderBusinessId` is UNIQUE (sparse): set while the claim is reserved or
 *    consumed, removed only on release. A workspace can hold at most one
 *    claim, so a team member with a different phone can't trial it again.
 *  - `consumed` is permanent. `reserved` is released only once Razorpay
 *    confirms the checkout can no longer be authorized (see
 *    services/billing/trialClaimStore.ts).
 *
 * Kept on account deletion (see purgePlan.ts NOT_PURGED): the phone is stored
 * only as a one-way hash, and deleting it would let a deleted-and-recreated
 * account take a second trial.
 */
export type TrialClaimStatus = 'reserved' | 'consumed' | 'released';

export interface ITrialClaimHistory {
  at: Date;
  status: TrialClaimStatus;
  reason: string;
  businessId?: mongoose.Types.ObjectId;
  razorpaySubscriptionId?: string;
}

export interface ITrialOfferSnapshot {
  trialMonths: number;
  /** = Razorpay start_at: the trial's end and the first charge. */
  trialEndsAt: Date;
  razorpayPlanId: string;
  amountPaise: number;
  currency: 'INR';
  policyVersion: number;
  decidedAt: Date;
}

export interface ITrialClaim extends Document {
  phoneHash: string;
  status: TrialClaimStatus;
  userId: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  holderBusinessId?: mongoose.Types.ObjectId;
  razorpaySubscriptionId?: string;
  reservedAt?: Date;
  reservedUntil?: Date;
  consumedAt?: Date;
  releasedAt?: Date;
  releaseReason?: string;
  /** Set when Razorpay's answer was ambiguous; the claim stays reserved until an admin looks. */
  needsReview?: boolean;
  /**
   * Immutable checkout snapshot, written once together with the subscription
   * id. The webhook grants the trial only if Razorpay's subscription matches
   * it — later policy changes (offer OFF, other trial length, new price) can't
   * alter a checkout that already exists.
   */
  offer?: ITrialOfferSnapshot;
  /** When a cancelled/expired/completed event for the attached subscription was processed (order safety). */
  subscriptionEndedAt?: Date;
  history: ITrialClaimHistory[];
  createdAt: Date;
  updatedAt: Date;
}

const HistorySchema = new Schema<ITrialClaimHistory>(
  {
    at: { type: Date, required: true },
    status: { type: String, enum: ['reserved', 'consumed', 'released'], required: true },
    reason: { type: String, required: true },
    businessId: { type: Schema.Types.ObjectId },
    razorpaySubscriptionId: { type: String },
  },
  { _id: false }
);

const TrialClaimSchema = new Schema<ITrialClaim>(
  {
    phoneHash: { type: String, required: true },
    status: { type: String, enum: ['reserved', 'consumed', 'released'], required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    holderBusinessId: { type: Schema.Types.ObjectId },
    razorpaySubscriptionId: { type: String },
    reservedAt: { type: Date },
    reservedUntil: { type: Date },
    consumedAt: { type: Date },
    releasedAt: { type: Date },
    releaseReason: { type: String },
    needsReview: { type: Boolean, default: false },
    offer: {
      type: new Schema<ITrialOfferSnapshot>(
        {
          trialMonths: { type: Number, required: true },
          trialEndsAt: { type: Date, required: true },
          razorpayPlanId: { type: String, required: true },
          amountPaise: { type: Number, required: true },
          currency: { type: String, enum: ['INR'], required: true },
          policyVersion: { type: Number, required: true },
          decidedAt: { type: Date, required: true },
        },
        { _id: false }
      ),
    },
    subscriptionEndedAt: { type: Date },
    history: { type: [HistorySchema], default: [] },
  },
  { timestamps: true }
);

TrialClaimSchema.index({ phoneHash: 1 }, { unique: true });
TrialClaimSchema.index({ holderBusinessId: 1 }, { unique: true, sparse: true });
TrialClaimSchema.index({ razorpaySubscriptionId: 1 }, { sparse: true });
TrialClaimSchema.index({ status: 1, reservedUntil: 1 });

const TrialClaim: Model<ITrialClaim> =
  (mongoose.models.TrialClaim as Model<ITrialClaim>) ||
  mongoose.model<ITrialClaim>('TrialClaim', TrialClaimSchema);

export default TrialClaim;
