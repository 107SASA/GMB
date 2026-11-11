import mongoose, { Schema, Document } from 'mongoose';

/**
 * The one-time "create your Growth Partner account" link emailed on approval.
 *
 * Same security model as AdminInvite: only the SHA-256 hash of the token is
 * stored; the raw token exists only in the email (and once in the approve
 * response, so the admin can copy it). The account is created with this
 * invite's email — the one the partner applied and was approved with — so a
 * leaked link can't be used to register a different address.
 */
export interface IPartnerInvite extends Document {
  email: string;
  tokenHash: string;
  growthPartnerId: mongoose.Types.ObjectId;
  invitedBy: mongoose.Types.ObjectId;
  status: 'pending' | 'accepted' | 'expired';
  expiresAt: Date;
  acceptedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PartnerInviteSchema = new Schema<IPartnerInvite>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    tokenHash: { type: String, required: true, unique: true },
    growthPartnerId: { type: Schema.Types.ObjectId, ref: 'GrowthPartner', required: true, index: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'expired'], default: 'pending' },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date },
  },
  { timestamps: true }
);

// Keep the row ~30 days past expiry for the audit trail, then let Mongo drop it.
PartnerInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default (mongoose.models.PartnerInvite as mongoose.Model<IPartnerInvite>) ||
  mongoose.model<IPartnerInvite>('PartnerInvite', PartnerInviteSchema);
