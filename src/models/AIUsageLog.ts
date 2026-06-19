import mongoose, { Schema, Document } from 'mongoose';

export type AIRequestStatus = 'success' | 'failed' | 'partial';
export type AIModel = 'gpt-4o' | 'gpt-4o-mini' | 'gpt-3.5-turbo' | 'claude-3-5-sonnet' | 'gemini-pro' | 'other';

export interface IAIUsageLog extends Document {
  userId: mongoose.Types.ObjectId;
  businessId?: mongoose.Types.ObjectId;
  promptType: string;       // e.g. "content_generation", "review_reply", "lead_response"
  aiModel: AIModel | string;
  tokensUsed: number;
  promptTokens?: number;
  completionTokens?: number;
  estimatedCost: number;    // in USD
  status: AIRequestStatus;
  errorMessage?: string;
  durationMs?: number;
  createdAt: Date;
  updatedAt: Date;
}

const AIUsageLogSchema: Schema = new Schema(
  {
    userId:            { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    businessId:        { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    promptType:        { type: String, required: true, index: true },
    aiModel:           { type: String, required: true, default: 'gpt-4o-mini' },
    tokensUsed:        { type: Number, required: true, default: 0 },
    promptTokens:      { type: Number, default: 0 },
    completionTokens:  { type: Number, default: 0 },
    estimatedCost:     { type: Number, required: true, default: 0 },
    status:            { type: String, enum: ['success', 'failed', 'partial'], default: 'success' },
    errorMessage:      { type: String },
    durationMs:        { type: Number },
  },
  { timestamps: true }
);

// Compound indexes for admin analytics queries
AIUsageLogSchema.index({ createdAt: -1 });
AIUsageLogSchema.index({ userId: 1, createdAt: -1 });
AIUsageLogSchema.index({ status: 1, createdAt: -1 });
AIUsageLogSchema.index({ promptType: 1, createdAt: -1 });

export default mongoose.models.AIUsageLog ||
  mongoose.model<IAIUsageLog>('AIUsageLog', AIUsageLogSchema);
