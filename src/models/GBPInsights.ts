import mongoose, { Schema, Document } from 'mongoose';

export interface IGBPInsights extends Document {
  businessId: mongoose.Types.ObjectId;
  organizationId: mongoose.Types.ObjectId;
  date: Date;
  views: number;
  viewsMaps: number;
  viewsSearch: number;
  callClicks: number;
  websiteClicks: number;
  directionRequests: number;
  conversations: number;
  syncedAt: Date;
}

const GBPInsightsSchema = new Schema<IGBPInsights>({
  businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  date: { type: Date, required: true },
  views: { type: Number, default: 0 },
  viewsMaps: { type: Number, default: 0 },
  viewsSearch: { type: Number, default: 0 },
  callClicks: { type: Number, default: 0 },
  websiteClicks: { type: Number, default: 0 },
  directionRequests: { type: Number, default: 0 },
  conversations: { type: Number, default: 0 },
  syncedAt: { type: Date, default: Date.now },
});

GBPInsightsSchema.index({ businessId: 1, date: 1 }, { unique: true });

export default mongoose.models.GBPInsights ||
  mongoose.model<IGBPInsights>('GBPInsights', GBPInsightsSchema);
