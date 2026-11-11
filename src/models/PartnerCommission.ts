import mongoose, { Schema, Document } from 'mongoose';

/**
 * One Growth Partner commission — earned on one captured customer payment
 * (one CompanyInvoice), or an adjustment (a clawback of a commission that was
 * already paid and later reversed, netted into the next payout).
 *
 * `paymentKey` (= the Razorpay payment id, set only on real commissions) is
 * unique, so a payment can never earn commission twice — the invoice job,
 * its retries and the daily sweep all converge on the same row.
 *
 * Status: pending (on hold until `availableAt`, then ready) → approved (by an
 * admin) → paid (in a PartnerPayout). `reversed` cancels it.
 */
export interface IPartnerCommission extends Document {
  partnerId: mongoose.Types.ObjectId;
  kind: 'first' | 'recurring' | 'adjustment';
  paymentKey?: string;
  businessId?: mongoose.Types.ObjectId;
  leadId?: mongoose.Types.ObjectId | null;
  invoiceId?: mongoose.Types.ObjectId;
  invoiceNumber?: string;
  attribution?: 'lead' | 'referral' | 'admin';
  customerName?: string;
  paidAt: Date;
  paymentAmount: number;
  baseAmount: number;
  ratePercent: number;
  amount: number;
  currency: string;
  availableAt: Date;
  status: 'pending' | 'approved' | 'paid' | 'reversed';
  approvedAt?: Date;
  approvedBy?: mongoose.Types.ObjectId;
  payoutId?: mongoose.Types.ObjectId | null;
  reversedAt?: Date;
  reversedBy?: mongoose.Types.ObjectId;
  reversalReason?: string;
  /** Adjustment rows: the paid commission this claws back. */
  sourceCommissionId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PartnerCommissionSchema = new Schema<IPartnerCommission>(
  {
    partnerId: { type: Schema.Types.ObjectId, ref: 'GrowthPartner', required: true, index: true },
    kind: { type: String, enum: ['first', 'recurring', 'adjustment'], required: true },
    paymentKey: { type: String, unique: true, sparse: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', default: null },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'CompanyInvoice' },
    invoiceNumber: { type: String },
    attribution: { type: String, enum: ['lead', 'referral', 'admin'] },
    customerName: { type: String, default: '' },
    paidAt: { type: Date, required: true },
    paymentAmount: { type: Number, default: 0 },
    baseAmount: { type: Number, default: 0 },
    ratePercent: { type: Number, default: 0 },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    availableAt: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'approved', 'paid', 'reversed'], default: 'pending', index: true },
    approvedAt: Date,
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    payoutId: { type: Schema.Types.ObjectId, ref: 'PartnerPayout', default: null, index: true },
    reversedAt: Date,
    reversedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reversalReason: String,
    sourceCommissionId: { type: Schema.Types.ObjectId, ref: 'PartnerCommission' },
  },
  { timestamps: true }
);

PartnerCommissionSchema.index({ partnerId: 1, paidAt: -1 });
PartnerCommissionSchema.index({ partnerId: 1, status: 1 });

export default (mongoose.models.PartnerCommission as mongoose.Model<IPartnerCommission>) ||
  mongoose.model<IPartnerCommission>('PartnerCommission', PartnerCommissionSchema);
