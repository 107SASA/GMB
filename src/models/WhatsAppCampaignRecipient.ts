import mongoose, { Schema, Document } from 'mongoose';

/**
 * One lead in one WhatsApp send. Unique per (campaign, lead), so a lead gets a
 * send at most once however often it is retried. `sending` is claimed before
 * the WhatsApp call: a crash after it is never re-sent automatically.
 */
export interface IWhatsAppCampaignRecipient extends Document {
  campaignId: mongoose.Types.ObjectId;
  leadId: mongoose.Types.ObjectId;
  phone: string;
  name: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped';
  /** Why it was skipped or failed. */
  reason?: string;
  sid?: string;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WhatsAppCampaignRecipientSchema: Schema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'WhatsAppCampaign', required: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    phone: { type: String, default: '' },
    name: { type: String, default: '' },
    status: { type: String, enum: ['queued', 'sending', 'sent', 'failed', 'skipped'], default: 'queued' },
    reason: { type: String },
    sid: { type: String },
    sentAt: { type: Date },
  },
  { timestamps: true }
);

WhatsAppCampaignRecipientSchema.index({ campaignId: 1, leadId: 1 }, { unique: true });
WhatsAppCampaignRecipientSchema.index({ campaignId: 1, status: 1 });
WhatsAppCampaignRecipientSchema.index({ leadId: 1, sentAt: -1 });

export default mongoose.models.WhatsAppCampaignRecipient || mongoose.model<IWhatsAppCampaignRecipient>('WhatsAppCampaignRecipient', WhatsAppCampaignRecipientSchema);
