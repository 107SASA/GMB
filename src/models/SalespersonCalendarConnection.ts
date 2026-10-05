import mongoose, { Schema, Document } from 'mongoose';

/**
 * One salesperson's Google Calendar authorization.
 * Tokens are AES-256-GCM ciphertext (src/lib/crypto.ts). API responses must
 * use publicCalendarConnection() and never select the token fields.
 * This is unrelated to GBPToken / Business.googleConnected.
 */
export interface ISalespersonCalendarConnection extends Document {
  userId: mongoose.Types.ObjectId;
  googleEmail: string;
  calendarId: string;
  refreshTokenEnc: string;
  accessTokenEnc: string;
  accessTokenExpiresAt?: Date;
  status: 'active' | 'revoked' | 'error';
  lastCheckedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SalespersonCalendarConnectionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    googleEmail: { type: String, default: '' },
    calendarId: { type: String, default: 'primary' },
    refreshTokenEnc: { type: String, default: '' },
    accessTokenEnc: { type: String, default: '' },
    accessTokenExpiresAt: { type: Date },
    status: { type: String, enum: ['active', 'revoked', 'error'], default: 'active' },
    lastCheckedAt: { type: Date },
    lastError: { type: String, default: '' },
  },
  { timestamps: true }
);

export default mongoose.models.SalespersonCalendarConnection ||
  mongoose.model<ISalespersonCalendarConnection>('SalespersonCalendarConnection', SalespersonCalendarConnectionSchema);
