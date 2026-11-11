import mongoose, { Schema, Document } from 'mongoose';

/**
 * A Growth Partner — an agency or individual who brings customers to
 * Growwmatics AI and earns commission on what those customers pay.
 *
 * Created when the super admin approves a PartnerApplication. The commercial
 * terms are set per partner, never globally:
 *  - firstPaymentRate — % of the referred customer's first payment
 *  - recurringRate    — % of every renewal payment after that
 *  - holdDays         — refund window before a commission can be paid out
 *  - recurringMonths  — optional cap on recurring commission (null = no limit)
 * Each commission (later phase) snapshots the rate in force on the day the
 * payment lands, so changing these never rewrites past commissions.
 *
 * `userId` stays empty until the partner accepts the invite and sets a
 * password (status 'invited' → 'active').
 */
export interface IGrowthPartner extends Document {
  applicationId?: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId | null;
  partnerCode: string;
  email: string;
  fullName: string;
  phone: string;
  companyName: string;
  website?: string | null;
  city: string;
  state: string;
  applicantType: 'agency' | 'freelancer' | 'individual' | 'other';
  status: 'invited' | 'active' | 'suspended';
  firstPaymentRate: number;
  recurringRate: number;
  holdDays: number;
  recurringMonths?: number | null;
  /** TDS handling is not decided yet — kept optional and unused until it is. */
  tdsPercent?: number | null;
  /** Visits through the partner's referral link. */
  referralClicks?: number;
  kycStatus: 'not_submitted' | 'submitted' | 'verified' | 'rejected';
  /**
   * KYC details (Phase 3). PAN and bank account number are encrypted
   * (lib/crypto encrypt) with only the last 4 kept in clear for display.
   * Aadhaar: only the last 4 digits — the full number is never stored.
   * Document files are encrypted before upload to private storage.
   */
  kyc?: {
    entityType?: 'company' | 'individual';
    legalName?: string;
    companyType?: string | null;
    gstin?: string | null;
    registrationNumber?: string | null;
    address?: string;
    pincode?: string;
    panEncrypted?: string;
    panLast4?: string;
    aadhaarLast4?: string | null;
    bank?: {
      accountHolderName?: string;
      accountNumberEncrypted?: string;
      accountLast4?: string;
      ifsc?: string;
      bankName?: string;
      accountType?: 'savings' | 'current';
    };
    documents?: Array<{
      _id: mongoose.Types.ObjectId;
      kind: string;
      storageKey: string;
      contentType: string;
      fileName: string;
      size: number;
      uploadedAt: Date;
    }>;
    submittedAt?: Date;
    reviewedAt?: Date;
    reviewedBy?: mongoose.Types.ObjectId;
    rejectReason?: string | null;
  };
  approvedBy?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  /** History of term changes, newest last — who changed what, when. */
  termsHistory: Array<{
    firstPaymentRate: number;
    recurringRate: number;
    holdDays: number;
    recurringMonths?: number | null;
    changedBy: mongoose.Types.ObjectId;
    changedAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

const GrowthPartnerSchema = new Schema<IGrowthPartner>(
  {
    applicationId: { type: Schema.Types.ObjectId, ref: 'PartnerApplication' },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    partnerCode: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true },
    companyName: { type: String, required: true, trim: true },
    website: { type: String, default: null },
    city: { type: String, required: true },
    state: { type: String, required: true },
    applicantType: {
      type: String,
      enum: ['agency', 'freelancer', 'individual', 'other'],
      required: true,
    },
    status: {
      type: String,
      enum: ['invited', 'active', 'suspended'],
      default: 'invited',
      index: true,
    },
    firstPaymentRate: { type: Number, required: true, min: 0, max: 100 },
    recurringRate: { type: Number, required: true, min: 0, max: 100 },
    holdDays: { type: Number, required: true, min: 0, max: 365 },
    recurringMonths: { type: Number, default: null },
    tdsPercent: { type: Number, default: null },
    referralClicks: { type: Number, default: 0 },
    kycStatus: {
      type: String,
      enum: ['not_submitted', 'submitted', 'verified', 'rejected'],
      default: 'not_submitted',
    },
    kyc: {
      entityType: { type: String, enum: ['company', 'individual'] },
      legalName: String,
      companyType: { type: String, default: null },
      gstin: { type: String, default: null },
      registrationNumber: { type: String, default: null },
      address: String,
      pincode: String,
      panEncrypted: String,
      panLast4: String,
      aadhaarLast4: { type: String, default: null },
      bank: {
        accountHolderName: String,
        accountNumberEncrypted: String,
        accountLast4: String,
        ifsc: String,
        bankName: String,
        accountType: { type: String, enum: ['savings', 'current'] },
      },
      documents: [
        {
          kind: { type: String, required: true },
          storageKey: { type: String, required: true },
          contentType: { type: String, required: true },
          fileName: { type: String, default: '' },
          size: { type: Number, default: 0 },
          uploadedAt: { type: Date, default: Date.now },
        },
      ],
      submittedAt: Date,
      reviewedAt: Date,
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      rejectReason: { type: String, default: null },
    },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    termsHistory: [
      {
        _id: false,
        firstPaymentRate: Number,
        recurringRate: Number,
        holdDays: Number,
        recurringMonths: { type: Number, default: null },
        changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        changedAt: Date,
      },
    ],
  },
  { timestamps: true }
);

GrowthPartnerSchema.index({ kycStatus: 1 });

export default (mongoose.models.GrowthPartner as mongoose.Model<IGrowthPartner>) ||
  mongoose.model<IGrowthPartner>('GrowthPartner', GrowthPartnerSchema);
