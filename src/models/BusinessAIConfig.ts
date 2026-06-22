import mongoose, { Schema, Document } from 'mongoose';

export interface IBusinessAIConfig extends Document {
  tenantId: string;
  businessId: mongoose.Types.ObjectId;
  systemPrompt: string;
  aiTone: string;
  aiEnabled: boolean;
  salesRules: string;
  automationRules?: string;
  aiPersonality?: string;
  tone?: string;
  maxResponseLength?: number;
  createdAt: Date;
  updatedAt: Date;
}

const BusinessAIConfigSchema: Schema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    systemPrompt: {
      type: String,
      default:
        'You are an AI WhatsApp sales agent. Your goal is to qualify leads and help book demos. Keep responses under 60 words. Ask one question at a time. After 2 exchanges, attempt demo booking. Never discuss competitor pricing.',
    },
    aiTone: { type: String, default: 'Professional and helpful' },
    aiEnabled: { type: Boolean, default: true },
    salesRules: { type: String, default: 'Never offer discounts. Always collect email before booking.' },
    automationRules: { type: String },
    aiPersonality: {
      type: String,
      enum: ['Professional', 'Friendly', 'Enthusiastic'],
      default: 'Professional',
    },
    tone: {
      type: String,
      enum: ['Formal', 'Conversational', 'Casual'],
      default: 'Formal',
    },
    maxResponseLength: { type: Number, default: 100 },
  },
  { timestamps: true }
);

export default mongoose.models.BusinessAIConfig ||
  mongoose.model<IBusinessAIConfig>('BusinessAIConfig', BusinessAIConfigSchema);
