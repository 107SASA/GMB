import mongoose, { Schema, Document } from 'mongoose';

export interface IPost extends Document {
  tenantId?: string;
  organizationId?: string;
  title?: string;
  businessId: mongoose.Types.ObjectId;
  userId?: mongoose.Types.ObjectId;
  content: string;
  media: string[];
  imageUrl?: string;
  platform: string;
  status: string;
  aiGenerated: boolean;
  generationPrompt?: string;
  keywords?: string[];
  location?: string;
  tone?: string;
  contentType?: string;
  hashtags?: string[];
  cta?: string;
  seoScore?: number;
  scheduledDate?: Date;
  publishedAt?: Date;
  failureReason?: string;
  retryCount: number;
  aiMetadata?: any;
  automationMetadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

const PostSchema: Schema = new Schema(
  {
    tenantId: { type: String, index: true },
    organizationId: { type: String, index: true },
    title: { type: String },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    content: { type: String, required: true },
    media: [{ type: String }],
    imageUrl: { type: String },
    platform: { type: String, default: 'gmb' },
    status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'rejected', 'scheduled', 'published', 'failed', 'archived'], default: 'draft', index: true },
    aiGenerated: { type: Boolean, default: false },
    generationPrompt: { type: String },
    keywords: [{ type: String }],
    location: { type: String },
    tone: { type: String },
    contentType: { type: String },
    hashtags: [{ type: String }],
    cta: { type: String },
    seoScore: { type: Number },
    scheduledDate: { type: Date },
    publishedAt: { type: Date },
    failureReason: { type: String },
    retryCount: { type: Number, default: 0 },
    aiMetadata: { type: Schema.Types.Mixed },
    automationMetadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

export default mongoose.models.Post || mongoose.model<IPost>('Post', PostSchema);
