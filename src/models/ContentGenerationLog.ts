import mongoose, { Schema, Document } from 'mongoose';

export interface IContentGenerationLog extends Document {
  businessId: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  requestType: string;
  prompt: string;
  output: string;
  tokensUsed?: number;
  createdAt: Date;
  updatedAt: Date;
}

const ContentGenerationLogSchema: Schema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    requestType: { type: String, required: true },
    prompt: { type: String, required: true },
    output: { type: String, required: true },
    tokensUsed: { type: Number },
  },
  { timestamps: true }
);

// Retention: 180 days (approved policy). Debug/audit trail for AI content
// generation — the generated Posts themselves are stored separately and kept.
ContentGenerationLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

export default mongoose.models.ContentGenerationLog || mongoose.model<IContentGenerationLog>('ContentGenerationLog', ContentGenerationLogSchema);
