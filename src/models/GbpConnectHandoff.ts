import mongoose, { Schema, Document } from 'mongoose';

/**
 * Single-use, short-lived handoff that lets the iOS app open the Google
 * Business Profile OAuth flow in an in-app browser, which has no web session
 * (see src/lib/gbpConnectHandoff.ts). Like LoginLink, only the SHA-256 hash
 * of the raw token is stored, and it is consumed atomically.
 *
 * It is pinned to the user, the workspace it was issued for, and the user's
 * sessionEpoch at issue time — signing out everywhere (or deleting the
 * account) invalidates any handoff still outstanding.
 */
export interface IGbpConnectHandoff extends Document {
  tokenHash: string;
  userId: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  sessionEpoch: number;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

const GbpConnectHandoffSchema = new Schema<IGbpConnectHandoff>(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    sessionEpoch: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Nothing reads a handoff after it expires; keep a day for support, then drop it.
GbpConnectHandoffSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export default mongoose.models.GbpConnectHandoff ||
  mongoose.model<IGbpConnectHandoff>('GbpConnectHandoff', GbpConnectHandoffSchema);
