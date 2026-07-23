import mongoose, { Schema, Document } from 'mongoose';
import type { SalesAgentConfigShape } from '@/lib/salesAgentDefaults';

export interface ISalesAgentConfig extends SalesAgentConfigShape, Document {
  key: string; // singleton key: 'default'
  createdAt: Date;
  updatedAt: Date;
}

const FollowUpSchema = new Schema(
  {
    delayHours: { type: Number, default: 24 },
    mode: { type: String, enum: ['ai', 'template'], default: 'template' },
    template: { type: String, default: '' },
    aiSystemPrompt: { type: String, default: '' },
    onlyIfNoReply: { type: Boolean, default: true },
  },
  { _id: false }
);

const SalesAgentConfigSchema: Schema = new Schema(
  {
    key: { type: String, default: 'default', unique: true },
    enabled: { type: Boolean, default: false },
    firstMessage: {
      mode: { type: String, enum: ['ai', 'template'], default: 'ai' },
      delayMinutes: { type: Number, default: 2 },
      template: { type: String, default: '' },
      aiSystemPrompt: { type: String, default: '' },
    },
    followUps: { type: [FollowUpSchema], default: [] },
    agentSystemPrompt: { type: String, default: '' },
    subscribeUrl: { type: String, default: '' },
    shopUrl: { type: String, default: '' },
  },
  { timestamps: true }
);

export default mongoose.models.SalesAgentConfig ||
  mongoose.model<ISalesAgentConfig>('SalesAgentConfig', SalesAgentConfigSchema);
