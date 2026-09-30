/**
 * Customer-visible field registry (pure — runs under `node --test`).
 *
 * Every number or factual claim a customer can see, with where it comes
 * from, its evidence state, how it is displayed, and — most importantly —
 * what is shown when the data is missing. tests/integration/field-registry
 * checks every `whenMissing` text against the real display helpers, so this
 * table cannot drift from what the report actually renders.
 *
 * Rule for every row: missing data is shown as a status, never as a number.
 */

export type RegistryEvidenceState = 'VERIFIED' | 'MEASURED' | 'SOURCE_CLAIM' | 'INFERRED' | 'RECOMMENDATION';
export type Surface = 'free' | 'dashboard' | 'connected' | 'pdf' | 'whatsapp' | 'consultant' | 'plan' | 'onboarding';

export interface FieldRule {
  field: string;
  surfaces: Surface[];
  source: string;
  collection: string;
  /** auditData path(s) every surface must read it from. */
  reads: string;
  evidenceState: RegistryEvidenceState;
  display: string;
  /** Exact status text (or pattern) shown when the value is unknown / unavailable / not measured. */
  whenMissing: string;
  /** What is never allowed to replace a missing value. */
  forbiddenFallback: string;
}

export const FIELD_REGISTRY: FieldRule[] = [
  {
    field: 'Average rank where found',
    surfaces: ['free', 'dashboard', 'connected', 'pdf', 'whatsapp', 'consultant'],
    source: 'DataForSEO Google Maps Live (per search)',
    collection: 'one task per keyword × location; target position read from the results',
    reads: 'facts.ranking.overall.averageObservedRank',
    evidenceState: 'MEASURED',
    display: 'mean of FOUND positions only, 1 dp, with "found in X of Y searches"',
    whenMissing: 'Unavailable',
    forbiddenFallback: 'rank 20 / 21 / 0 / 100, "20+", averaging not-found as 21',
  },
  {
    field: 'Rank for one search',
    surfaces: ['free', 'dashboard', 'connected', 'pdf', 'consultant'],
    source: 'DataForSEO Google Maps Live',
    collection: 'position of the target in the top-20 results',
    reads: 'facts.observations[].{status,found,rank} / keywordTable[].{rankStatus,found,rank}',
    evidenceState: 'MEASURED',
    display: '#N',
    whenMissing: 'Not found (searched, not in the results window) | Unavailable (provider failed)',
    forbiddenFallback: 'a number for not-found or failed searches',
  },
  {
    field: 'Visibility / Top 3 / Top 5 / Top 10',
    surfaces: ['free', 'dashboard', 'connected', 'pdf'],
    source: 'DataForSEO Google Maps Live',
    collection: 'counts over VALID searches only',
    reads: 'facts.ranking.overall.{visibilityRate,top3Rate,top5Rate,top10Rate}',
    evidenceState: 'MEASURED',
    display: 'percentage of valid searches',
    whenMissing: 'Not measured',
    forbiddenFallback: '0% when nothing was measured',
  },
  {
    field: 'Businesses above you',
    surfaces: ['free', 'dashboard', 'connected', 'pdf', 'consultant'],
    source: 'DataForSEO Google Maps Live results (place_id deduped)',
    collection: 'unique businesses shown above the target in ≥ 1 valid search; town/place pins excluded',
    reads: 'facts.competitorsAhead.count, competitors[]',
    evidenceState: 'MEASURED',
    display: 'count + names; tier label per competitor',
    whenMissing: 'Competitors come from the Google Maps searches, which could not be completed for this report.',
    forbiddenFallback: 'avgRank − 1, invented names, similarity scores, copied categories',
  },
  {
    field: 'Lifetime Google reviews + rating',
    surfaces: ['free', 'dashboard', 'connected', 'pdf', 'whatsapp'],
    source: 'Google Places (intake) → SerpApi / GBP API totals after a sync',
    collection: 'lifetime totals from Google, never the synced window',
    reads: 'facts.reviews.lifetime.{totalCount,rating}',
    evidenceState: 'VERIFIED',
    display: 'N reviews · R★',
    whenMissing: 'Unknown',
    forbiddenFallback: '0 reviews, the 14-day window count, an industry average',
  },
  {
    field: 'Recent reviews / reviews per week',
    surfaces: ['dashboard', 'connected', 'pdf'],
    source: 'Review sync (GBP API or SerpApi) with real posted dates',
    collection: 'reviews posted in the selected window',
    reads: 'facts.reviews.recent.{newReviewCount,reviewsPerWeek}',
    evidenceState: 'MEASURED',
    display: 'N new reviews in the last D days · X/week',
    whenMissing: 'Not measured | Unknown',
    forbiddenFallback: '0/week, 0.5/week for a single review, the 4.2/week "industry average"',
  },
  {
    field: 'Review response rate',
    surfaces: ['dashboard', 'connected', 'pdf'],
    source: 'Review sync (owner-reply state read per review)',
    collection: 'replied ÷ reviews in window, only when every review’s reply state was read',
    reads: 'facts.reviews.recent.{responseRate,replyUnknownCount}',
    evidenceState: 'MEASURED',
    display: 'X%',
    whenMissing: 'Unknown — reply status not yet re-synced | No reviews in period | Unknown',
    forbiddenFallback: '0% when replies were not captured',
  },
  {
    field: 'Review themes (praise / complaints)',
    surfaces: ['free', 'dashboard', 'connected', 'pdf'],
    source: 'AI over REAL review text only',
    collection: 'only when synced reviews carry text',
    reads: 'reviewAnalysis.{reviewThemes,mostCommonPraises,mostCommonComplaints}',
    evidenceState: 'INFERRED',
    display: 'Praised: … · Complaints: …',
    whenMissing: 'Review themes unavailable because review text was not available.',
    forbiddenFallback: 'themes generated without review text',
  },
  {
    field: 'Profile completion %',
    surfaces: ['free', 'dashboard', 'connected', 'pdf', 'whatsapp'],
    source: 'Google Places snapshot / public Maps listing / live GBP read',
    collection: 'Complete ÷ (Complete + Missing); Unknown excluded and counted separately',
    reads: 'profileCompletion.{completionPercentage,checklist}',
    evidenceState: 'VERIFIED',
    display: 'C of K checked fields complete (P%) · M missing · U could not be checked',
    whenMissing: 'Profile completion could not be measured — none of the fields could be checked.',
    forbiddenFallback: 'Unknown counted as Missing; "100% complete" when fields were unknown',
  },
  {
    field: 'Search demand (monthly volume)',
    surfaces: ['free', 'dashboard', 'connected', 'pdf', 'consultant'],
    source: 'DataForSEO Google Ads Search Volume (nationwide)',
    collection: 'one task per audit; per-keyword 45-day cache incl. empty results',
    reads: 'keywordTable[].{searchVolume,volumeBand,demandStatus}',
    evidenceState: 'MEASURED',
    display: 'N / month nationwide + band',
    whenMissing: 'Not available',
    forbiddenFallback: 'city-tier estimates, Maps-volume multipliers, AI-guessed volume',
  },
  {
    field: 'Proposed keywords',
    surfaces: ['free', 'dashboard', 'connected', 'pdf', 'consultant'],
    source: 'AI, built only from verified/website services + real locations',
    collection: 'isGroundedKeywordProposal filter',
    reads: 'seoPlanDraft.proposedKeywords',
    evidenceState: 'RECOMMENDATION',
    display: 'chips under "proposed, not measured"',
    whenMissing: '(section hidden when there are none)',
    forbiddenFallback: 'a rank or volume next to a proposed keyword',
  },
  {
    field: 'Website services / description / booking / offers',
    surfaces: ['free', 'dashboard', 'connected', 'pdf', 'consultant', 'onboarding'],
    source: 'Business website crawl (≤ 6 pages, SSRF-guarded, 30-day cache)',
    collection: 'schema.org first, then services pages; every value keeps its page URL',
    reads: 'facts.website.*, seoPlanDraft.websiteSummary',
    evidenceState: 'SOURCE_CLAIM',
    display: '"What your website says" / "From your website — review"',
    whenMissing: 'No website was available for analysis. | did not respond when we checked, so nothing from it is used in this report.',
    forbiddenFallback: 'website content presented as a Google Business Profile fact',
  },
  {
    field: 'GBP services / categories / attributes / description',
    surfaces: ['free', 'dashboard', 'connected', 'pdf', 'consultant'],
    source: 'Live GBP read (connected audits only)',
    collection: 'Business Information API',
    reads: 'profileCompletion.checklist, seoPlanDraft.gbpGaps[].status',
    evidenceState: 'VERIFIED',
    display: 'present / missing (connected) ',
    whenMissing: 'Connect Google to check … | ? (unverified)',
    forbiddenFallback: '"Your GBP is missing X" without a GBP read',
  },
  {
    field: 'Suspension risk',
    surfaces: ['free', 'dashboard', 'connected', 'pdf', 'consultant'],
    source: 'Naming-guideline check on the real business name',
    collection: 'promotional term present → Medium; nothing found → Low',
    reads: 'facts.suspensionRisk',
    evidenceState: 'INFERRED',
    display: 'Low / Medium with the reason',
    whenMissing: 'Not assessed',
    forbiddenFallback: 'a percentage; word-count "keyword stuffing"',
  },
  {
    field: 'Customer actions (calls, website clicks, directions)',
    surfaces: ['dashboard', 'connected'],
    source: 'GBP Performance API (connected audits)',
    collection: 'last 28 complete days',
    reads: 'performanceBaseline',
    evidenceState: 'VERIFIED',
    display: 'totals for the period; before → after only when both measured',
    whenMissing: 'Baseline not available yet.',
    forbiddenFallback: 'extra calls / customers / revenue / guaranteed ROI',
  },
  {
    field: 'Findings / priority actions / plan items',
    surfaces: ['free', 'dashboard', 'connected', 'pdf', 'whatsapp', 'plan'],
    source: 'Deterministic rules over the facts above',
    collection: 'each with evidence, owner action, GrowwMatics action (or none), GBP requirement, measurement',
    reads: 'findings[], priorityFixes[], optimizationPlan[]',
    evidenceState: 'RECOMMENDATION',
    display: 'Fact / What it means / Recommended',
    whenMissing: '(no finding is created from an UNKNOWN field — verification steps go to the plan only)',
    forbiddenFallback: 'an issue built from data we could not check',
  },
  {
    field: 'AI narrative (key finding, strengths, plan wording)',
    surfaces: ['free', 'dashboard', 'connected', 'pdf', 'consultant'],
    source: 'Groq over the facts JSON',
    collection: 'validated: numbers, businesses, services, GBP claims, causation, outcomes',
    reads: 'seoPlanDraft.*, strengths, weaknesses',
    evidenceState: 'INFERRED',
    display: 'prose',
    whenMissing: 'Additional AI analysis is temporarily unavailable.',
    forbiddenFallback: 'template or fabricated fallback text',
  },
];
