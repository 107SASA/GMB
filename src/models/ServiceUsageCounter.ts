import mongoose, { Schema, Document } from 'mongoose';

/**
 * Daily call counters for providers that expose no usage API (Resend emails,
 * NanoBanana images). One document per service per UTC day, bumped with $inc
 * by lib/serviceUsage.ts. Read by the Services & Costs monitor.
 */
export interface IServiceUsageCounter extends Document {
  service: string;
  /** UTC day, YYYY-MM-DD. */
  day: string;
  count: number;
  expiresAt?: Date;
}

const ServiceUsageCounterSchema = new Schema<IServiceUsageCounter>({
  service: { type: String, required: true },
  day: { type: String, required: true },
  count: { type: Number, default: 0 },
  // Kept ~13 months; only the current day and month are ever read.
  expiresAt: { type: Date, expires: 0 },
});

ServiceUsageCounterSchema.index({ service: 1, day: 1 }, { unique: true });

export default (mongoose.models.ServiceUsageCounter as mongoose.Model<IServiceUsageCounter>) ||
  mongoose.model<IServiceUsageCounter>('ServiceUsageCounter', ServiceUsageCounterSchema);
