import mongoose, { Schema, Document } from 'mongoose';
import type { ReportAgentConfigShape } from '@/lib/reportAgentDefaults';

export interface IReportAgentConfig extends ReportAgentConfigShape, Document {
  key: string; // singleton key: 'default'
  createdAt: Date;
  updatedAt: Date;
}

const ReportAgentConfigSchema: Schema = new Schema(
  {
    key: { type: String, default: 'default', unique: true },
    enabled: { type: Boolean, default: false },
    agentSystemPrompt: { type: String, default: '' },
    reportIntroTemplate: { type: String, default: '' },
    reportSummaryTemplate: { type: String, default: '' },
  },
  { timestamps: true }
);

export default mongoose.models.ReportAgentConfig ||
  mongoose.model<IReportAgentConfig>('ReportAgentConfig', ReportAgentConfigSchema);
