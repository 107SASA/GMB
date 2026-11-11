import mongoose, { Schema, Document } from 'mongoose';

/**
 * Growth Partner application — what a digital marketing agency, freelancer
 * or individual submits from the public /growth-partner/apply form.
 *
 * Lands on Admin → Growth Partners → Applications as `pending`. Approval
 * (POST /api/admin/growth-partners/applications/[id]/approve) creates the
 * GrowthPartner with its commission terms and emails a PartnerInvite link;
 * rejection records the reason and emails the applicant.
 */
export interface IPartnerApplication extends Document {
  fullName: string;
  email: string;
  phone: string;
  companyName: string;
  website?: string | null;
  city: string;
  state: string;
  applicantType: 'agency' | 'freelancer' | 'individual' | 'other';
  message?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  rejectReason?: string | null;
  growthPartnerId?: mongoose.Types.ObjectId;
  ip?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PartnerApplicationSchema = new Schema<IPartnerApplication>(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    phone: { type: String, required: true, index: true },
    companyName: { type: String, required: true, trim: true },
    website: { type: String, default: null },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    applicantType: {
      type: String,
      enum: ['agency', 'freelancer', 'individual', 'other'],
      required: true,
    },
    message: { type: String, default: null },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    rejectReason: { type: String, default: null },
    growthPartnerId: { type: Schema.Types.ObjectId, ref: 'GrowthPartner' },
    ip: { type: String },
  },
  { timestamps: true }
);

PartnerApplicationSchema.index({ status: 1, createdAt: -1 });

export default (mongoose.models.PartnerApplication as mongoose.Model<IPartnerApplication>) ||
  mongoose.model<IPartnerApplication>('PartnerApplication', PartnerApplicationSchema);
