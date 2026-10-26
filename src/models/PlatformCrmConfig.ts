import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Super admin CRM settings (one document, key 'default'): the team's own
 * sub-stages. The main stages are fixed (the AI agents rely on them); a
 * sub-stage is a label under one of them, e.g. "Called twice" under Qualifying.
 */
export interface IPlatformCrmSubStage {
  id: string;
  name: string;
  /** The main CRM stage (Lead.currentStage) it belongs to. */
  stage: string;
  color: string;
}

export interface IPlatformCrmConfig extends Document {
  key: string;
  subStages: IPlatformCrmSubStage[];
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PlatformCrmConfigSchema = new Schema<IPlatformCrmConfig>(
  {
    key: { type: String, default: 'default', unique: true },
    subStages: {
      type: [
        new Schema(
          {
            id: { type: String, required: true },
            name: { type: String, required: true, maxlength: 40 },
            stage: { type: String, required: true },
            color: { type: String, default: 'slate' },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

const PlatformCrmConfig: Model<IPlatformCrmConfig> =
  (mongoose.models.PlatformCrmConfig as Model<IPlatformCrmConfig>) ||
  mongoose.model<IPlatformCrmConfig>('PlatformCrmConfig', PlatformCrmConfigSchema);
export default PlatformCrmConfig;
