import mongoose, { Schema, Document } from 'mongoose';

/**
 * Dedupe log for incoming provider webhooks (Razorpay retries deliveries).
 * A unique (provider, eventId) insert acts as the idempotency lock: the
 * second delivery hits the duplicate-key error and is skipped.
 */
export interface IProcessedWebhookEvent extends Document {
  provider: string;
  eventId: string;
  eventType?: string;
  createdAt: Date;
}

const ProcessedWebhookEventSchema: Schema = new Schema(
  {
    provider: { type: String, required: true },
    eventId: { type: String, required: true },
    eventType: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ProcessedWebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

export default mongoose.models.ProcessedWebhookEvent ||
  mongoose.model<IProcessedWebhookEvent>('ProcessedWebhookEvent', ProcessedWebhookEventSchema);
