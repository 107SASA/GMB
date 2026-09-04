import mongoose, { Schema, Document } from 'mongoose';

/**
 * AI-generated keyword intelligence for a business's GBP Insights page:
 *  - estimated monthly local search volume for the terms it already ranks for
 *    (Google's API only gives impressions, never volume)
 *  - "growth" keywords the business is NOT yet getting impressions for but
 *    realistically could, with a one-line rationale each.
 *
 * All numbers are LLM ESTIMATES, labelled as such in the UI. Cached per
 * business and regenerated at most once every CACHE_DAYS (or on explicit
 * refresh) since each generation is a paid model call.
 */
export const KEYWORD_INTEL_CACHE_DAYS = 7;

interface EstimatedKeyword {
  keyword: string;
  estMonthlyVolume: number;
  impressions?: number;
  rationale?: string;
}

export interface IGBPKeywordIntel extends Document {
  businessId: mongoose.Types.ObjectId;
  organizationId?: mongoose.Types.ObjectId;
  generatedAt: Date;
  /** Volume estimates for the terms already bringing impressions. */
  currentKeywords: EstimatedKeyword[];
  /** New terms to target, with rationale. */
  growthKeywords: EstimatedKeyword[];
  /** Sum of estMonthlyVolume across currentKeywords — the headline "est. searches". */
  totalEstimatedVolume: number;
}

const EstimatedKeywordSchema = new Schema<EstimatedKeyword>(
  {
    keyword: { type: String, required: true },
    estMonthlyVolume: { type: Number, default: 0 },
    impressions: { type: Number },
    rationale: { type: String },
  },
  { _id: false }
);

const GBPKeywordIntelSchema = new Schema<IGBPKeywordIntel>({
  businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, unique: true },
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization' },
  generatedAt: { type: Date, default: Date.now },
  currentKeywords: { type: [EstimatedKeywordSchema], default: [] },
  growthKeywords: { type: [EstimatedKeywordSchema], default: [] },
  totalEstimatedVolume: { type: Number, default: 0 },
});

export default mongoose.models.GBPKeywordIntel ||
  mongoose.model<IGBPKeywordIntel>('GBPKeywordIntel', GBPKeywordIntelSchema);
