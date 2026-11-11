import mongoose, { Schema, Document } from 'mongoose';

/**
 * Second step of super admin sign-in (POST /api/admin/auth → /verify).
 *
 * After the password is correct the browser gets an opaque challenge token and
 * proves it with an authenticator code, an emailed code, or a recovery code.
 * Only SHA-256 hashes of the token and email code are stored. A challenge
 * expires in 10 minutes, allows 5 wrong tries in total, and is single use. MongoDB
 * deletes the row after expiry (TTL).
 */
export interface IAdminLoginChallenge extends Document {
  userId: mongoose.Types.ObjectId;
  challengeHash: string;
  /** Hash of the emailed code; absent until an email code is sent. */
  codeHash?: string;
  expiresAt: Date;
  attempts: number;
  resends: number;
  lastSentAt?: Date;
  usedAt?: Date;
  ip?: string;
  createdAt: Date;
}

const AdminLoginChallengeSchema = new Schema<IAdminLoginChallenge>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    challengeHash: { type: String, required: true, unique: true },
    codeHash: { type: String },
    expiresAt: { type: Date, required: true, expires: 0 },
    attempts: { type: Number, default: 0 },
    resends: { type: Number, default: 0 },
    lastSentAt: { type: Date },
    usedAt: { type: Date },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default (mongoose.models.AdminLoginChallenge as mongoose.Model<IAdminLoginChallenge>) ||
  mongoose.model<IAdminLoginChallenge>('AdminLoginChallenge', AdminLoginChallengeSchema);
