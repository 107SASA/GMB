import mongoose, { Schema, Document } from 'mongoose';

export interface IGBPKeyword extends Document {
  businessId: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  keyword: string;
  impressions: number;
  month: number;
  year: number;
  type: 'DIRECT' | 'INDIRECT' | 'CHAIN';
  syncedAt: Date;
}

const GBPKeywordSchema = new Schema<IGBPKeyword>({
  businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  keyword: { type: String, required: true },
  impressions: { type: Number, default: 0 },
  month: { type: Number, required: true },
  year: { type: Number, required: true },
  type: { type: String, enum: ['DIRECT', 'INDIRECT', 'CHAIN'], default: 'DIRECT' },
  syncedAt: { type: Date, default: Date.now },
});

GBPKeywordSchema.index({ businessId: 1, keyword: 1, month: 1, year: 1 }, { unique: true });

export default mongoose.models.GBPKeyword ||
  mongoose.model<IGBPKeyword>('GBPKeyword', GBPKeywordSchema);
