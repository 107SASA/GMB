import mongoose, { Schema, Document, Model } from 'mongoose';
import type { PlanLimits } from '@/lib/planDefaults';

export interface IPlanConfig extends Document, PlanLimits {
  plan: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const PlanConfigSchema = new Schema<IPlanConfig>(
  {
    plan:                      { type: String, required: true, unique: true, index: true },
    maxAuditsPerBusiness:      { type: Number, required: true },
    maxPostsPerMonth:          { type: Number, required: true },
    maxWhatsAppMessagesPerDay: { type: Number, required: true },
    reviewRequestCooldownDays: { type: Number, required: true },
    maxAIGenerations:          { type: Number, required: true },
    updatedBy:                 { type: String, default: '' },
  },
  { timestamps: true }
);

const PlanConfig: Model<IPlanConfig> =
  mongoose.models.PlanConfig ||
  mongoose.model<IPlanConfig>('PlanConfig', PlanConfigSchema);

export default PlanConfig;
