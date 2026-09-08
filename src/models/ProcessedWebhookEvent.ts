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

// TTL — a provider only retries a delivery for minutes/hours, and no
// provider replays an event id after 30 days. The row exists purely to make
// re-delivery within that window a safe no-op; past it, deleting the whole
// document is harmless (a 30-day-late "replay" would just be processed once,
// which for our handlers is idempotent anyway). This is the single
// fastest-growing collection (one row per inbound WhatsApp message).
ProcessedWebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export default mongoose.models.ProcessedWebhookEvent ||
  mongoose.model<IProcessedWebhookEvent>('ProcessedWebhookEvent', ProcessedWebhookEventSchema);
