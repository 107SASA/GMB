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
  viewsSearchMobile: number;
  viewsSearchDesktop: number;
  viewsMapsMobile: number;
  viewsMapsDesktop: number;
  bookings: number;
  foodOrders: number;
  menuClicks: number;
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
  viewsSearchMobile: { type: Number, default: 0 },
  viewsSearchDesktop: { type: Number, default: 0 },
  viewsMapsMobile: { type: Number, default: 0 },
  viewsMapsDesktop: { type: Number, default: 0 },
  bookings: { type: Number, default: 0 },
  foodOrders: { type: Number, default: 0 },
  menuClicks: { type: Number, default: 0 },
  syncedAt: { type: Date, default: Date.now },
});

/** The stored fields of one day, from a fetchDailyMetrics point. One list so
 *  the nightly sync and the history backfill can never store different sets. */
export const INSIGHT_METRIC_FIELDS = [
  'views', 'viewsMaps', 'viewsSearch',
  'viewsSearchMobile', 'viewsSearchDesktop', 'viewsMapsMobile', 'viewsMapsDesktop',
  'callClicks', 'websiteClicks', 'directionRequests', 'conversations',
  'bookings', 'foodOrders', 'menuClicks',
] as const;

export function insightMetricValues(point: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of INSIGHT_METRIC_FIELDS) out[f] = Number(point?.[f]) || 0;
  return out;
}

GBPInsightsSchema.index({ businessId: 1, date: 1 }, { unique: true });

export default mongoose.models.GBPInsights ||
  mongoose.model<IGBPInsights>('GBPInsights', GBPInsightsSchema);
