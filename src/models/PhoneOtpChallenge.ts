import mongoose, { Schema, Model } from 'mongoose';

/**
 * A one-time WhatsApp code sent to a phone number that may not have an
 * account yet (the public /free-report form). Kept apart from User's
 * phoneOtpHash, which needs an existing user: the whole point here is to
 * prove the number BEFORE a shadow account and a paid report are created.
 *
 * One live challenge per phone + purpose (a new code replaces the old one).
 * Only the SHA-256 hash is stored — same as services/auth/otp.ts.
 */
export interface IPhoneOtpChallenge {
  phone: string;
  purpose: 'free_report';
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
}

const PhoneOtpChallengeSchema = new Schema<IPhoneOtpChallenge>(
  {
    phone: { type: String, required: true },
    purpose: { type: String, required: true, enum: ['free_report'] },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    // MongoDB's TTL monitor removes the document once the code has expired.
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

PhoneOtpChallengeSchema.index({ phone: 1, purpose: 1 }, { unique: true });

const PhoneOtpChallenge: Model<IPhoneOtpChallenge> =
  mongoose.models.PhoneOtpChallenge ||
  mongoose.model<IPhoneOtpChallenge>('PhoneOtpChallenge', PhoneOtpChallengeSchema);

export default PhoneOtpChallenge;
