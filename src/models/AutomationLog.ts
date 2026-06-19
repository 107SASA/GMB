import mongoose, { Schema, Document } from 'mongoose';

export interface IAutomationLog extends Document {
  tenantId?: string;
  organizationId?: string;
  businessId?: string;
  workflow?: string;
  event?: string;
  action?: string;
  status?: string;
  message?: string;
  prompt?: string;
  response?: string;
  aiModel?: string;
  tokens?: number;
  duration?: number;
  error?: string;
  type: 'scheduler' | 'ai_generation' | 'inngest_job' | 'other';
  createdAt: Date;
  updatedAt: Date;
}

const AutomationLogSchema: Schema = new Schema(
  {
    tenantId: { type: String, index: true },
    organizationId: { type: String, index: true },
    businessId: { type: String, index: true },
    workflow: { type: String },
    event: { type: String },
    action: { type: String },
    status: { type: String },
    message: { type: String },
    prompt: { type: String },
    response: { type: String },
    aiModel: { type: String },
    tokens: { type: Number },
    duration: { type: Number },
    error: { type: String },
    type: { type: String, enum: ['scheduler', 'ai_generation', 'inngest_job', 'other'], required: true, default: 'other' },
  },
  { timestamps: true }
);

export default mongoose.models.AutomationLog || mongoose.model<IAutomationLog>('AutomationLog', AutomationLogSchema);
