import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Stores per-user usage limit overrides set by super admins.
 * A null field means "use the plan/global default" for that metric.
 * One document per user — upserted via PATCH /api/admin/customers/[userId]/usage-limits.
 */
export interface IUserLimitOverride extends Document {
  userId:                    mongoose.Types.ObjectId;
  maxAuditsPerBusiness:      number | null;
  maxPostsPerMonth:          number | null;
  maxWhatsAppMessagesPerDay: number | null;
  reviewRequestCooldownDays: number | null;
  maxAIGenerations:          number | null;
  adminNotes:                string;
  updatedBy:                 string;
  createdAt:                 Date;
  updatedAt:                 Date;
}

const UserLimitOverrideSchema = new Schema<IUserLimitOverride>(
  {
    userId:                    { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    maxAuditsPerBusiness:      { type: Number, default: null },
    maxPostsPerMonth:          { type: Number, default: null },
    maxWhatsAppMessagesPerDay: { type: Number, default: null },
    reviewRequestCooldownDays: { type: Number, default: null },
    maxAIGenerations:          { type: Number, default: null },
    adminNotes:                { type: String, default: '' },
    updatedBy:                 { type: String, default: '' },
  },
  { timestamps: true }
);

const UserLimitOverride: Model<IUserLimitOverride> =
  mongoose.models.UserLimitOverride ||
  mongoose.model<IUserLimitOverride>('UserLimitOverride', UserLimitOverrideSchema);

export default UserLimitOverride;
