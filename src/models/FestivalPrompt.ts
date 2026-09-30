import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * "Diwali is coming up — any offer or special message?" — sent at most once
 * per business per festival (unique), so reruns never duplicate the in-app
 * or WhatsApp notification.
 */
export interface IFestivalPrompt extends Document {
  businessId: mongoose.Types.ObjectId;
  festivalKey: string;
  festivalName: string;
  festivalDate: string;
  inApp: boolean;
  whatsapp: 'sent_if_opted_in' | 'no_phone' | 'not_sent';
  createdAt: Date;
}

const FestivalPromptSchema = new Schema<IFestivalPrompt>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    festivalKey: { type: String, required: true },
    festivalName: { type: String, required: true },
    festivalDate: { type: String, required: true },
    inApp: { type: Boolean, default: false },
    whatsapp: { type: String, enum: ['sent_if_opted_in', 'no_phone', 'not_sent'], default: 'not_sent' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

FestivalPromptSchema.index({ businessId: 1, festivalKey: 1 }, { unique: true });
FestivalPromptSchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 });

const FestivalPrompt: Model<IFestivalPrompt> =
  mongoose.models.FestivalPrompt || mongoose.model<IFestivalPrompt>('FestivalPrompt', FestivalPromptSchema);

export default FestivalPrompt;
