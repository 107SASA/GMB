import mongoose, { Schema, Document } from 'mongoose';

export interface ISEOContent extends Document {
  tenantId: string;
  businessId?: string;
  description: string;
  seoScore?: number;
  keywords?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const SEOContentSchema: Schema = new Schema(
  {
    tenantId: { type: String, required: true, index: true },
    businessId: { type: String },
    description: { type: String, required: true },
    seoScore: { type: Number },
    keywords: [{ type: String }],
  },
  { timestamps: true }
);

export default mongoose.models.SEOContent || mongoose.model<ISEOContent>('SEOContent', SEOContentSchema);
