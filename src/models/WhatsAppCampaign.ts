import mongoose, { Schema, Document } from 'mongoose';

/**
 * One "Send WhatsApp" from Leads & Pipeline: an approved template, the message
 * typed for {{2}}, and who it went to (WhatsAppCampaignRecipient rows).
 */
export interface IWhatsAppCampaign extends Document {
  name: string;
  templateId: mongoose.Types.ObjectId;
  contentSid: string;
  templateLabel: string;
  /** The text sent as {{2}} (one line). */
  message: string;
  status: 'sending' | 'done';
  counts: { total: number; sent: number; failed: number; skipped: number };
  createdBy?: mongoose.Types.ObjectId;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WhatsAppCampaignSchema: Schema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    templateId: { type: Schema.Types.ObjectId, ref: 'WhatsAppTemplate', required: true },
    contentSid: { type: String, required: true },
    templateLabel: { type: String, default: '' },
    message: { type: String, default: '' },
    status: { type: String, enum: ['sending', 'done'], default: 'sending' },
    counts: {
      total: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    finishedAt: { type: Date },
  },
  { timestamps: true }
);

WhatsAppCampaignSchema.index({ createdAt: -1 });

export default mongoose.models.WhatsAppCampaign || mongoose.model<IWhatsAppCampaign>('WhatsAppCampaign', WhatsAppCampaignSchema);
