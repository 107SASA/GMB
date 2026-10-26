import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Security log — every sign-in, failed attempt, OTP / password-reset step,
 * admin privilege action, data export and rejected webhook signature, with
 * who, from where (IP + browser) and the outcome. Read on Super Admin →
 * Security Log. Written by services/security/securityLog.ts (never throws).
 * No passwords, codes or tokens are ever stored here.
 */
export type SecurityOutcome = 'success' | 'failure' | 'blocked' | 'info';
export type SecuritySeverity = 'info' | 'warning' | 'critical';

export interface ISecurityEvent extends Document {
  type: string;
  outcome: SecurityOutcome;
  severity: SecuritySeverity;
  /** The account involved, when known. */
  userId?: mongoose.Types.ObjectId;
  role?: string;
  /** Email, or a masked phone (+91******3210) — what was typed / used. */
  subject?: string;
  ip?: string;
  userAgent?: string;
  path?: string;
  status?: number;
  detail?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const SecurityEventSchema = new Schema<ISecurityEvent>(
  {
    type: { type: String, required: true, index: true },
    outcome: { type: String, enum: ['success', 'failure', 'blocked', 'info'], required: true, index: true },
    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    role: { type: String },
    subject: { type: String, index: true },
    ip: { type: String, index: true },
    userAgent: { type: String, maxlength: 300 },
    path: { type: String },
    status: { type: Number },
    detail: { type: String, maxlength: 500 },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

SecurityEventSchema.index({ createdAt: -1 });
SecurityEventSchema.index({ type: 1, outcome: 1, createdAt: -1 });
// Retention: 12 months.
SecurityEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60, name: 'createdAt_ttl' });

const SecurityEvent: Model<ISecurityEvent> =
  (mongoose.models.SecurityEvent as Model<ISecurityEvent>) ||
  mongoose.model<ISecurityEvent>('SecurityEvent', SecurityEventSchema);
export default SecurityEvent;
