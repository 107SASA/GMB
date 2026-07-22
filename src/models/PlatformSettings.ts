import mongoose, { Schema, Document } from 'mongoose';

export interface IPlatformSettings extends Document {
  platformName: string;
  supportEmail: string;
  maxAuditsPerBusiness: number;
  maxPostsPerMonth: number;
  maxWhatsAppMessagesPerDay: number;
  maintenanceMode: boolean;
  defaultTrialDays: number;
  reviewRequestCooldownDays: number;
  createdAt: Date;
  updatedAt: Date;
}

const PlatformSettingsSchema: Schema = new Schema(
  {
    platformName:               { type: String, default: 'Growwmatic AI' },
    supportEmail:               { type: String, default: '' },
    maxAuditsPerBusiness:       { type: Number, default: 10 },
    maxPostsPerMonth:           { type: Number, default: 50 },
    maxWhatsAppMessagesPerDay:  { type: Number, default: 100 },
    maintenanceMode:            { type: Boolean, default: false },
    defaultTrialDays:           { type: Number, default: 14 },
    reviewRequestCooldownDays:  { type: Number, default: 30 },
  },
  { timestamps: true }
);

export default mongoose.models.PlatformSettings ||
  mongoose.model<IPlatformSettings>('PlatformSettings', PlatformSettingsSchema);
