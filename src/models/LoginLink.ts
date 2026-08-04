import mongoose, { Schema, Document } from 'mongoose';

/**
 * Single-use, short-lived login links (e.g. the WhatsApp "save to dashboard"
 * link sent after a report — see src/services/inngest/functions.ts and
 * src/app/api/auth/session-link/[token]/route.ts).
 *
 * Deliberately NOT a JWT: a stateless token can't be revoked or marked
 * "already used," which is exactly the property this needs — WhatsApp links
 * get forwarded, screenshotted, and cached by link-preview crawlers, so a
 * reusable 30-day bearer token embedded in a URL is a real account-takeover
 * risk. Only the SHA-256 hash of the raw token is stored, mirroring the OTP
 * hashing pattern in src/services/auth/otp.ts.
 */
export interface ILoginLink extends Document {
  tokenHash: string;
  userId: mongoose.Types.ObjectId;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

const LoginLinkSchema = new Schema<ILoginLink>(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default mongoose.models.LoginLink || mongoose.model<ILoginLink>('LoginLink', LoginLinkSchema);
