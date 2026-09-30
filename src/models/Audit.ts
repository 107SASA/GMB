import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IKeywordRank {
  keyword: string;
  /** Observed position; null = not found (new audits). Old audits used 21. */
  rank: number | null;
  sourceQuery?: string;
  confidence?: string;
}

export interface IGoogleSearchRank {
  /** Mean over FOUND searches only; null = never found / not measured (new audits). */
  averageRank: number | null;
  topKeywords: IKeywordRank[];
}

export interface IGeoGridPoint {
  lat: number;
  lng: number;
  /** Observed position; null = not found or unavailable (new audits). Old audits used 21. */
  rank: number | null;
  found?: boolean;
  status?: 'ok' | 'unavailable';
}

export interface IGeoGridKeyword {
  keyword: string;
  /** Mean over FOUND points only; null = never found (new audits). */
  avgRank: number | null;
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
  /** null = no checkable item (new audits) — shown as "Not measured". */
  score: number | null;
  /** How many of the weighted items could actually be checked (new audits). */
  checkedItems?: number;
  totalItems?: number;
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
  /** 'places' fields form the pre-OAuth percentage denominator; 'oauth'
   *  fields are only verifiable once the owner connects Google. See
   *  src/lib/profileCompletion.ts. */
  group?: 'places' | 'oauth';
}

export interface IProfileCompletion {
  /** Pre-OAuth: Places-complete / (Places-complete + Places-missing).
   *  Post-OAuth: complete / (complete + missing) across every checkable
   *  field. Unknown fields are always excluded from the ratio. See
   *  src/lib/profileCompletion.ts + seoAnalyzer.ts. */
  completionPercentage: number;
  /** 'places' before a Google connection, 'full' after. */
  completionScope?: 'places' | 'full';
  /** The one qualified sentence every surface prints, e.g. "100% of visible
   *  fields complete — 7 more fields need a Google connection to check." */
  completionLabel?: string;
  /** The exact string fed to Groq wherever completion is referenced — longer
   *  and more explicit so the model can't round it to "100% complete". */
  completionPromptFact?: string;
  checklist: IChecklistItem[];
  placesCompleteCount?: number;
  placesTotalCount?: number;
  /** Fields still Unknown — i.e. "N fields need a Google connection". */
  oauthPendingCount?: number;
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

  /** "Keyword Search Volume Analysis — Google Maps" table. Live demand band
   *  from DataForSEO Google Ads when available, else a labeled city-tier
   *  estimate (estimated:true → rendered with a `*`). See
   *  src/services/audit/keywordTable.ts. */
  keywordTable?: IKeywordTableRow[];

  /** Neighbourhood names the primary keyword was checked in — rendered as
   *  "Areas checked: Bidhannagar, Rajarhat, …". */
  areasChecked?: string[];

  /** Consultant sections (Key Finding, competitor landscape, GBP drafts,
   *  market opportunities, action phases, weekly posts, Q&As). Present only
   *  when the SEO-plan generation succeeded — surfaces hide when absent. See
   *  src/services/ai/seoPlanEngine.ts. */
  seoPlanDraft?: ISeoPlanDraft;
}

export interface IKeywordTableRow {
  keyword: string;
  searchVolume: number | null;
  /** Derived Google-Maps monthly estimate (≈ search × 0.62); null when the
   *  search volume itself is a band estimate. Shown as "~N" and labeled. */
  mapsVolume?: number | null;
  /** Band from MEASURED search volume; null = demand unavailable (new audits). */
  volumeBand: 'HIGH' | 'MED' | 'LOW' | 'NICHE' | null;
  /** 'measured' = live Google Ads volume. Old audits used 'estimated' city-tier guesses. */
  demandStatus?: 'measured' | 'unavailable';
  estimated: boolean;
  /** Observed position; null = not found/unavailable (new audits). Old audits used 21. */
  mapsRank: number | null;
  rank?: number | null;
  found?: boolean;
  rankStatus?: 'ok' | 'unavailable';
  /** Where the searched phrase came from (Sep 2026+). */
  source?: 'category' | 'website_service' | 'owner' | 'ai_proposed' | 'brand';
}

export interface ISeoPlanActionItem {
  title: string;
  detail: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM';
}

export interface ISeoPlanGapItem {
  field: string;
  whyItMatters: string;
  recommendation: string;
  /** 'ok' = present and adequate, 'missing' = confirmed/near-certain gap,
   *  'unverified' = needs a Google connection / owner input to confirm.
   *  Present on the 'full' depth tier. */
  status?: 'ok' | 'missing' | 'unverified';
}

export interface ISeoPlanSnapshotTile {
  label: string;
  value: string;
  note?: string;
  tone?: 'good' | 'warn' | 'bad';
}

export interface ISeoPlanDraft {
  /** Set on drafts built from verified facts (Sep 2026+). Older drafts may
   *  contain AI-invented services/attributes/Q&A answers/labels, which the
   *  report hides for them. */
  grounded?: number;
  /** 'free' = cold-lead teaser (fastMode audit); 'full' = the deep paid
   *  audit (post-Google-connect + monthly re-audit). Drives which blocks the
   *  report renders. */
  depth?: 'free' | 'full';

  keyFinding?: string;
  /** 8-tile "Performance Snapshot" (4 core + 4 offer/USP tiles on 'full'). */
  performanceSnapshot?: ISeoPlanSnapshotTile[];
  criticalGap?: { intro: string; rows: Array<{ keyword: string; mapsRank: number | null }>; closer: string };
  keywordInsights?: string[];
  competitorLandscape?: Array<{
    name: string; mapsRank?: number; rating?: number; reviewCount?: number; keyEdge: string;
    /** Measured: strong / moderate / incidental (facts.competitorRelevance). */
    relevance?: string; searchesAhead?: number; appearances?: number | null;
    /** reportDisplay.competitorTierLabel — shown under the name. */
    tierLabel?: string;
  }>;
  competitorCounterPosition?: string;
  gbpGaps?: ISeoPlanGapItem[];
  suggestedTitle?: string;
  suggestedDescription?: string;
  suggestedServices?: string[];
  suggestedCategories?: string[];
  /** 'full' only — GBP attributes to set (industry-specific, LLM-picked). */
  suggestedAttributes?: string[];
  /** 'full' only — the explicit keyword list the 750-char description must embed. */
  descriptionKeywords?: string[];
  /** 'full' only — off-GBP platforms worth a listing (Practo, Justdial, …). */
  platformGaps?: Array<{ platform: string; why: string }>;
  marketOpportunities?: Array<{ keyword: string; potential: string; rationale: string }>;
  actionPhases?: Array<{ label: string; window: string; items: ISeoPlanActionItem[] }>;
  weeklyPostThemes?: Array<{ weekday: string; theme: string; keyword: string; postType: string }>;
  suggestedQas?: Array<{ q: string; a: string }>;
  uspLine?: string;
  reviewReplyMustInclude?: string[];
  whatWeAimFor?: { todayRank: string; milestones: Array<{ label: string; text: string }> };
  /** Today (measured) → 14d → 45d → 90d work milestones. Since Sep 2026
   *  only "Today" holds a rank; later stages never promise a position. */
  rankTimeline?: Array<{ label: string; rank: string; note: string; tone?: 'bad' | 'warn' | 'good' }>;
  /** Deterministic competitor insights: fact (counted) / meaning / recommendation. */
  competitorInsights?: Array<{ topic: string; fact: string; meaning: string; recommendation: string; basis: string }>;
  /** AI-proposed search phrases built from verified/website services + real
   *  locations. NOT measured — no rank or demand exists for them yet. */
  proposedKeywords?: Array<{ keyword: string; basis: string }>;
  /** What the business's own website states (SOURCE_CLAIM, not verified on Google). */
  websiteSummary?: { url: string; services: string[]; description?: string; readAt?: string; status: string };
  /** 'full' — one-paragraph assessment of the business's own website. */
  websiteAssessment?: string;
  dataRequired?: string[];
  /** Per-subsection generation failures — UI shows a support message for
   *  just that block instead of faking it. */
  failed?: string[];
  /** What the output validator removed (invented businesses/services, GBP claims). */
  repairs?: string[];
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

  /**
   * Lifecycle (Sep 2026): 'free_report' | 'connected_baseline' | 'monthly' |
   * 'dashboard'. With `period` it is the server-side idempotency key —
   * one connected_baseline per business ('baseline') and one monthly per
   * business per calendar month ('YYYY-MM'). A FAILED audit gives its
   * period up (moved to failedPeriod) so the month can be retried.
   */
  auditKind?: 'free_report' | 'connected_baseline' | 'monthly' | 'dashboard';
  period?: string;
  failedPeriod?: string;
  /** The connected baseline this audit is measured against (monthly audits). */
  baselineAuditId?: mongoose.Types.ObjectId;
  /** The previous comparable (baseline or monthly) audit. */
  previousAuditId?: mongoose.Types.ObjectId;

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
    auditKind: { type: String, enum: ['free_report', 'connected_baseline', 'monthly', 'dashboard'] },
    period: { type: String },
    failedPeriod: { type: String },
    baselineAuditId: { type: Schema.Types.ObjectId, ref: 'Audit' },
    previousAuditId: { type: Schema.Types.ObjectId, ref: 'Audit' },
  },
  { timestamps: true }
);

AuditSchema.index({ tenantId: 1, businessName: 1 });
// One connected baseline per business, one monthly report per business per
// calendar month — enforced by the database, so double clicks, Inngest
// retries, cron overlap and concurrent requests cannot create a second paid
// audit. Only audits holding a period take part.
AuditSchema.index(
  { businessId: 1, auditKind: 1, period: 1 },
  { unique: true, partialFilterExpression: { period: { $exists: true } }, name: 'uniq_business_kind_period' },
);

const Audit: Model<IAudit> = mongoose.models.Audit || mongoose.model<IAudit>('Audit', AuditSchema);

export default Audit;
