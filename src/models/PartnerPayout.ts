import mongoose, { Schema, Document } from 'mongoose';

/**
 * A settlement to one Growth Partner: the approved commissions (and any
 * clawback adjustments) it pays, the totals, and the bank transfer reference
 * the admin entered. The bank details are a masked snapshot at payout time.
 */
export interface IPartnerPayout extends Document {
  partnerId: mongoose.Types.ObjectId;
  commissionIds: mongoose.Types.ObjectId[];
  grossAmount: number;
  tdsPercent: number;
  tdsAmount: number;
  netAmount: number;
  currency: string;
  method: 'bank_transfer' | 'upi' | 'other';
  reference: string;
  paidAt: Date;
  note?: string | null;
  bank?: { accountHolderName?: string; accountLast4?: string; ifsc?: string; bankName?: string };
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const PartnerPayoutSchema = new Schema<IPartnerPayout>(
  {
    partnerId: { type: Schema.Types.ObjectId, ref: 'GrowthPartner', required: true, index: true },
    commissionIds: [{ type: Schema.Types.ObjectId, ref: 'PartnerCommission' }],
    grossAmount: { type: Number, required: true },
    tdsPercent: { type: Number, default: 0 },
    tdsAmount: { type: Number, default: 0 },
    netAmount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    method: { type: String, enum: ['bank_transfer', 'upi', 'other'], default: 'bank_transfer' },
    reference: { type: String, required: true, trim: true },
    paidAt: { type: Date, required: true },
    note: { type: String, default: null },
    bank: {
      accountHolderName: String,
      accountLast4: String,
      ifsc: String,
      bankName: String,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

PartnerPayoutSchema.index({ partnerId: 1, paidAt: -1 });

export default (mongoose.models.PartnerPayout as mongoose.Model<IPartnerPayout>) ||
  mongoose.model<IPartnerPayout>('PartnerPayout', PartnerPayoutSchema);
