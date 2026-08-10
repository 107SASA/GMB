import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IKeywordRank {
  keyword: string;
  rank: number;
  sourceQuery?: string;
  confidence?: string;
}

export interface IGoogleSearchRank {
  averageRank: number;
  topKeywords: IKeywordRank[];
}

export interface IGeoGridPoint {
  lat: number;
  lng: number;
  rank: number;
}

export interface IGeoGridKeyword {
  keyword: string;
  avgRank: number;
  points: IGeoGridPoint[];
}

export interface ILocalPackCompetitor {
  name: string;
  avgRank: number;
  rating?: number;
  reviewCount?: number;
  placeId?: string;
}

export interface IProfileScore {
  overallScore: number;
  seoScore: number;
  reviewScore: number;
  profileCompletionScore: number;
  ratingScore: number;
  contentScore: number;
}

export interface ISeoScore {
  score: number;
  missingKeywords: string[];
  optimizationOpportunities: string[];
}

export interface IReviewAnalysis {
  reviewCount: number;
  averageRating: number;
  reviewsPerWeek: number;
  industryAverage: number;
  responseRate: string;
  positivePercent: number;
  neutralPercent: number;
  negativePercent: number;
  mostCommonPraises: string[];
  mostCommonComplaints: string[];
  /** True when reviewCount/averageRating came from a Google Places snapshot
   *  rather than synced Review documents (no reviews synced yet, e.g. a
   *  fastMode/free-report audit). See estimatedFields for which specific
   *  sub-fields are the honest zero-defaults this implies, vs the real
   *  reviewCount/averageRating alongside them. */
  estimatedFromPlaces?: boolean;
  estimatedFields?: string[];
}

export interface IChecklistItem {
  field: string;
  status: 'Complete' | 'Partial' | 'Missing' | 'Unknown';
}

export interface IProfileCompletion {
  /** Complete / (Complete + Missing) — Unknown fields are excluded from the
   *  ratio entirely, not scored as partial failures. See seoAnalyzer.ts. */
  completionPercentage: number;
  checklist: IChecklistItem[];
  /** Fields checked and confirmed absent. */
  missingCount?: number;
  /** Fields we structurally couldn't verify (pre-OAuth) — surfaced
   *  separately so the UI can say "N fields need verification" instead of
   *  folding them into the percentage either way. */
  unknownCount?: number;
}

export interface IKeywordGap {
  keyword: string;
  found: boolean;
  missing: boolean;
  priority: 'High' | 'Medium' | 'Low';
}

export interface ICompetitorGap {
  missingAdvantages: string[];
  gapScore: number;
}

export interface ICompetitor {
  name: string;
  category: string;
  rating: number;
  reviewCount: number;
  estimatedRank: number;
  distance: string;
  reason: string;
  website?: string;
  similarityScore?: number;
  strengthScore?: number;
  gapAnalysis?: ICompetitorGap;
}

export interface IPriorityFix {
  title: string;
  reason: string;
  impact: 'High' | 'Medium' | 'Low';
  effort: 'High' | 'Medium' | 'Low';
  expectedScoreGain: string;
  revenuePotential: 'High' | 'Medium' | 'Low'; // legacy compat
}

export interface IStrengthWeakness {
  title: string;
  observation?: string;
  evidence: string;
  impact?: string;
  risk?: string;
}

export interface IThirtyDayPlan {
  week: string;
  tasks: string[];
  expectedOutcome?: string;
}

export interface INinetyDayPlan {
  month: string;
  tasks: string[];
  focusAreas?: string[];
}

export interface IDataQuality {
  profileData: 'Complete' | 'Partial' | 'Unavailable';
  competitorDiscovery: 'Complete' | 'Partial' | 'Unavailable';
  keywordDiscovery: 'Complete' | 'Partial' | 'Unavailable';
  reviewAnalysis: 'Complete' | 'Partial' | 'Unavailable';
  websiteAnalysis: 'Complete' | 'Partial' | 'Unavailable';
}

export interface IAuditConfidence {
  dataQuality: IDataQuality;
  confidenceScore: number; // e.g. 85 for 85%
}

/** Which real source powered the rank / review numbers shown in this
 *  report — lets the frontend (and any future debugging) tell "reduced but
 *  real" apart from "estimated from a Places snapshot" apart from
 *  "genuinely unavailable" without reverse-engineering it from which fields
 *  happen to be zero. See auditService.ts. */
export interface IDataQualitySource {
  /** 'error' = the DataForSEO call itself failed (account/rate-limit/
   *  server) — distinct from 'unavailable' (not configured / genuinely
   *  queried and found nothing). See DataForSeoApiError in
   *  dataForSeoClient.ts and rankData.fetchError in seoAnalyzer.ts. */
  rankSource: 'full-grid' | 'reduced-grid' | 'unavailable' | 'error';
  reviewSource: 'live-sync' | 'places-snapshot' | 'unavailable';
  /** True when this report reused another lead's data for the same
   *  googlePlaceId (see PlaceInsightCache.ts) instead of re-querying
   *  DataForSEO/Places or re-generating the AI narrative. Only ever true
   *  for fastMode audits. */
  rankCacheHit?: boolean;
  narrativeCacheHit?: boolean;
}

export interface IBusinessIntelligence {
  competitivePosition: string;
  marketSaturation: string;
  reviewGap: number;
  /** Renamed from visibilityGap (Aug 2026) — this is a review-count-gap
   *  narrative, not a real search-visibility/rank finding; the old name
   *  read as a ranking claim it wasn't. See calculateBusinessIntelligence
   *  in seoAnalyzer.ts. */
  reviewGapImpact: string;
  growthPotential: string;
}

export interface IAuditData {
  googleSearchRank: IGoogleSearchRank;
  profileScore: IProfileScore;
  competitors: ICompetitor[];
  keywordGapAnalysis: IKeywordGap[];
  seoScore: ISeoScore;
  reviewAnalysis: IReviewAnalysis;
  profileCompletion: IProfileCompletion;
  
  strengths: IStrengthWeakness[];
  weaknesses: IStrengthWeakness[];
  quickWins: string[];
  priorityFixes: IPriorityFix[];
  thirtyDayPlan: IThirtyDayPlan[];
  ninetyDayPlan: INinetyDayPlan[];
  
  businessTier: string;
  evidence?: Record<string, string>;
  
  auditConfidence?: IAuditConfidence;
  businessIntelligence?: IBusinessIntelligence;
  geoGridRank?: {
    keywords: IGeoGridKeyword[];
    overallAvgRank: number;
    gridSpacingKm: number;
    areaSqKm: number;
    /** % of geo-grid keyword×point checks where the business appeared in the local pack */
    visibilityPct?: number;
    /** 'reduced' = fastMode's cheaper check (1 keyword × ≤3 points) — real
     *  data, just a smaller sample; UI should badge this "Quick check"
     *  rather than hide the number. */
    gridResolution?: 'full' | 'reduced';
  };
  localPackCompetitors?: ILocalPackCompetitor[];
  dataQuality?: IDataQualitySource;
}

export interface IAudit extends Document {
  tenantId: string;
  userId: string;
  organizationId: string;
  
  businessId: mongoose.Types.ObjectId;
  businessName: string;
  userDefinedCategory?: string;
  website?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  
  location: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  auditVersion: 'V5' | 'V6' | 'V7';
  overallScore?: number;
  auditData?: IAuditData;
  metadata?: any;

  // Review Analysis Range Selector (Feature 2A) — which review window this
  // audit's review metrics/sentiment/trends/recommendations were computed from.
  reviewPeriodDays?: 7 | 14 | 21;

  // Improvement Plan Duration (Feature 2B) — drives the generated action plan.
  actionPlanDurationDays?: 30 | 45 | 90;

  // ADDITIVE — set only by the lead-gen entry points (/free-report,
  // WhatsApp report-connect), never by the authenticated POST /api/audit
  // route. Skips geo-grid ranking (45 SerpApi calls) and the first-time
  // review sync in processAuditJob so a brand-new visitor's first report
  // generates fast. Paying customers' dashboard audits are unaffected.
  fastMode?: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const AuditSchema = new Schema<IAudit>(
  {
    tenantId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    organizationId: { type: String, required: true },
    
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    businessName: { type: String, required: true },
    userDefinedCategory: { type: String },
    website: { type: String },
    phone: { type: String },
    address: { type: String },
    city: { type: String },
    state: { type: String },
    country: { type: String },
    
    location: { type: String, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED'],
      default: 'PENDING',
    },
    auditVersion: { type: String, enum: ['V5', 'V6', 'V7'], default: 'V7' },
    overallScore: { type: Number },
    auditData: { type: Schema.Types.Mixed }, // Using Mixed for the root data object since it's large and varies heavily
    metadata: { type: Schema.Types.Mixed },

    // Review Analysis Range Selector — defaults to 14 days to match prior
    // (unbounded-but-effectively-recent) behavior for any code path that
    // doesn't pass a value explicitly.
    reviewPeriodDays: { type: Number, enum: [7, 14, 21], default: 14 },

    // Improvement Plan Duration — defaults to 30 days, matching the
    // original hardcoded "30-Day Action Plan" the report always showed.
    actionPlanDurationDays: { type: Number, enum: [30, 45, 90], default: 30 },

    // ADDITIVE — see fastMode in IAudit above.
    fastMode: { type: Boolean, default: false },
  },
  { timestamps: true }
);

AuditSchema.index({ tenantId: 1, businessName: 1 });

const Audit: Model<IAudit> = mongoose.models.Audit || mongoose.model<IAudit>('Audit', AuditSchema);

export default Audit;
