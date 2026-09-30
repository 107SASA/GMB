import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * One weekly monitoring run per business per ISO week (unique) — so a cron
 * overlap or retry can never double-notify. Stores what was checked, what
 * was sent, and that no paid provider call was made.
 */
export interface IWeeklyMonitor extends Document {
  businessId: mongoose.Types.ObjectId;
  weekKey: string;
  status: 'running' | 'done' | 'skipped';
  skipReason?: string;
  lines: string[];
  meaningful: boolean;
  notificationsCreated: number;
  whatsappSent: boolean;
  whatsappSkipReason?: string;
  inputs?: Record<string, unknown>;
  providerUsage?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const WeeklyMonitorSchema = new Schema<IWeeklyMonitor>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    weekKey: { type: String, required: true },
    status: { type: String, enum: ['running', 'done', 'skipped'], default: 'running' },
    skipReason: { type: String },
    lines: [{ type: String }],
    meaningful: { type: Boolean, default: false },
    notificationsCreated: { type: Number, default: 0 },
    whatsappSent: { type: Boolean, default: false },
    whatsappSkipReason: { type: String },
    inputs: { type: Schema.Types.Mixed },
    providerUsage: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

WeeklyMonitorSchema.index({ businessId: 1, weekKey: 1 }, { unique: true });
// Retention: 400 days — a year of weekly history.
WeeklyMonitorSchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 });

const WeeklyMonitor: Model<IWeeklyMonitor> =
  mongoose.models.WeeklyMonitor || mongoose.model<IWeeklyMonitor>('WeeklyMonitor', WeeklyMonitorSchema);

export default WeeklyMonitor;
