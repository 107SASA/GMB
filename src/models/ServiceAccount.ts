import mongoose, { Schema, Document } from 'mongoose';

/**
 * One row per third-party service the platform depends on (DigitalOcean,
 * Twilio, Apple Developer, …) — keyed by the registry key in
 * lib/serviceMonitor/registry.ts.
 *
 * Holds what no provider API can tell us (the plan we are on, what it costs,
 * when it renews, the limits to warn at) plus the last automatic check, so the
 * sidebar badge and the alert cron can read state without calling providers.
 */
export type ServiceStatus = 'ok' | 'warning' | 'critical' | 'unconfigured' | 'error' | 'info';

export interface IServiceMetric {
  label: string;
  used?: number;
  limit?: number;
  unit?: string;
  /** Free-text value when the metric is not a used/limit pair (e.g. "$42.10"). */
  value?: string;
  status?: ServiceStatus;
  /** Where the number comes from: the provider's API, our own logs, or typed in. */
  source: 'live' | 'logs' | 'manual' | 'estimate';
}

export interface IServiceAccount extends Document {
  key: string;
  planName?: string;
  /** Recurring cost of the plan (not usage), in `costCurrency`. */
  costAmount?: number;
  costCurrency?: 'USD' | 'INR';
  billingCycle?: 'free' | 'monthly' | 'yearly' | 'prepaid' | 'one_time' | 'usage';
  renewalDate?: Date;
  /** Overrides for the registry's default limits, by limit key. */
  limits?: Record<string, number>;
  notes?: string;
  alertsMuted?: boolean;

  lastStatus?: ServiceStatus;
  lastSummary?: string;
  lastMetrics?: IServiceMetric[];
  lastCheckedAt?: Date;
  /** Status the last alert email was sent for, so we only email on change. */
  lastAlertedStatus?: ServiceStatus;
  lastAlertedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ServiceAccountSchema = new Schema<IServiceAccount>(
  {
    key: { type: String, required: true, unique: true },
    planName: { type: String, default: '' },
    costAmount: { type: Number },
    costCurrency: { type: String, enum: ['USD', 'INR'], default: 'USD' },
    billingCycle: { type: String, enum: ['free', 'monthly', 'yearly', 'prepaid', 'one_time', 'usage'] },
    renewalDate: { type: Date },
    limits: { type: Schema.Types.Mixed, default: {} },
    notes: { type: String, default: '' },
    alertsMuted: { type: Boolean, default: false },
    lastStatus: { type: String },
    lastSummary: { type: String },
    lastMetrics: { type: Schema.Types.Mixed },
    lastCheckedAt: { type: Date },
    lastAlertedStatus: { type: String },
    lastAlertedAt: { type: Date },
  },
  { timestamps: true }
);

export default (mongoose.models.ServiceAccount as mongoose.Model<IServiceAccount>) ||
  mongoose.model<IServiceAccount>('ServiceAccount', ServiceAccountSchema);
