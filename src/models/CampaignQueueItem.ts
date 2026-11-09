import mongoose, { Schema, Document } from 'mongoose';

/**
 * One customer waiting in a review campaign. Launching a campaign queues
 * every eligible customer here; the daily dispatcher
 * (services/reviews/campaignQueue.ts) starts as many as the workspace's daily
 * WhatsApp limit allows after reserving room for reminders due that day.
 *
 *   queued     → waiting for a day with budget
 *   dispatched → its review-request run started (dispatchedAt)
 *   sent       → the first WhatsApp was delivered to the provider (sentAt)
 *   failed / skipped / cancelled → will not be sent (reason)
 */
export interface ICampaignQueueItem extends Document {
  campaignId: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  status: 'queued' | 'dispatched' | 'sent' | 'failed' | 'skipped' | 'cancelled';
  /** Order inside the campaign (upload order). */
  position: number;
  queuedAt: Date;
  dispatchedAt?: Date | null;
  sentAt?: Date | null;
  reason?: string | null;
}

const CampaignQueueItemSchema = new Schema<ICampaignQueueItem>(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    status: { type: String, enum: ['queued', 'dispatched', 'sent', 'failed', 'skipped', 'cancelled'], default: 'queued', required: true },
    position: { type: Number, default: 0 },
    queuedAt: { type: Date, default: Date.now },
    dispatchedAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    reason: { type: String, default: null },
  },
  { timestamps: true },
);

// One entry per customer per campaign (a relaunch never queues them twice).
CampaignQueueItemSchema.index({ campaignId: 1, customerId: 1 }, { unique: true });
CampaignQueueItemSchema.index({ businessId: 1, status: 1, position: 1 });
CampaignQueueItemSchema.index({ campaignId: 1, status: 1 });

export default (mongoose.models.CampaignQueueItem as mongoose.Model<ICampaignQueueItem>) ||
  mongoose.model<ICampaignQueueItem>('CampaignQueueItem', CampaignQueueItemSchema);
