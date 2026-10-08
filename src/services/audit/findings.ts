/**
 * Evidence + structured findings for the audit report.
 *
 * Every customer-facing problem is a Finding that points at Evidence items
 * built from real provider data (facts.ts). Code decides WHAT is verifiably
 * true; the AI (auditEngine.ts) may only decide which findings matter most
 * for this business and explain them — it cannot add new ones.
 *
 * `actionability` is from the business owner's point of view.
 * `growwmaticsCapability` is set ONLY when the product has a working feature
 * for it (see GROWWMATICS_CAPABILITIES) — otherwise the report must not
 * present it as something GrowwMatics fixes.
 *
 * Pure: no I/O, no `@/` imports (runs under `node --test`).
 */

import type {
  CompetitorFact,
  CompetitorsAhead,
  FieldState,
  KeywordRankingSummary,
  RankingSummary,
  ReviewComparison,
  ReviewFacts,
  SuspensionRisk,
} from './facts.ts';

// ── Capability map (verified against the codebase, Sep 2026) ──────────────

export type Capability =
  | 'update_title'
  | 'update_description'
  | 'update_phone'
  | 'update_website'
  | 'google_posts'
  | 'review_replies'
  | 'review_requests'
  | 'photo_uploads'
  | 'rank_tracking';

export const GROWWMATICS_CAPABILITIES: Record<Capability, { label: string; verifiedIn: string }> = {
  update_title: { label: 'Update the business title on Google', verifiedIn: 'lib/gbpClient.ts updateLocationProfile' },
  update_description: { label: 'Update the business description on Google', verifiedIn: 'lib/gbpClient.ts updateLocationProfile' },
  update_phone: { label: 'Update the phone number on Google', verifiedIn: 'lib/gbpClient.ts updateLocationProfile' },
  update_website: { label: 'Update the website link on Google', verifiedIn: 'lib/gbpClient.ts updateLocationProfile' },
  google_posts: { label: 'Write and publish Google posts', verifiedIn: 'lib/gbpClient.ts createLocalPost' },
  review_replies: { label: 'Reply to Google reviews', verifiedIn: 'lib/gbpClient.ts replyToReview' },
  review_requests: { label: 'Send WhatsApp review-request campaigns', verifiedIn: 'app/api/campaigns' },
  photo_uploads: { label: 'Upload photos to the Google profile', verifiedIn: 'lib/gbpClient.ts uploadLocationPhoto' },
  rank_tracking: { label: 'Re-measure rankings every month', verifiedIn: 'lib/auditAutopilot.ts' },
};

// ── Evidence ───────────────────────────────────────────────────────────────

export type EvidenceSource = 'google_places' | 'dataforseo' | 'gbp_api' | 'serpapi' | 'website' | 'owner' | 'calculated';

/**
 * Unified evidence state (Sep 2026):
 *   VERIFIED       — read from an authoritative source (Google data, GBP API, owner confirmation)
 *   SOURCE_CLAIM   — what a source SAYS, not independently verified (e.g. the business's website)
 *   INFERRED       — derived by code or AI from other evidence
 *   UNKNOWN        — could not be checked
 *   NOT_MEASURED   — deliberately not measured in this audit
 *   UNAVAILABLE    — the provider failed
 *   RECOMMENDATION — a proposed action; never stored as a business fact
 */
export type EvidenceState = 'VERIFIED' | 'SOURCE_CLAIM' | 'INFERRED' | 'UNKNOWN' | 'NOT_MEASURED' | 'UNAVAILABLE' | 'RECOMMENDATION';

export interface Evidence {
  id: string;
  metric: string;
  value: unknown;
  status: 'verified' | 'verified_missing' | 'unknown' | 'unavailable';
  source: EvidenceSource;
  sourceId?: string;
  keyword?: string;
  found?: boolean;
  confidence: 'high' | 'medium' | 'low';
  /** Unified state; derived from `status`/`source` when not set explicitly. */
  state?: EvidenceState;
  /** Page / provider reference the value came from (e.g. the website page). */
  sourceUrl?: string;
  collectedAt?: string;
  businessId?: string;
  auditId?: string;
}

/** The unified state for an evidence item (explicit state wins). */
export function evidenceState(e: Pick<Evidence, 'state' | 'status' | 'source'>): EvidenceState {
  if (e.state) return e.state;
  if (e.status === 'unavailable') return 'UNAVAILABLE';
  if (e.status === 'unknown') return 'UNKNOWN';
  if (e.source === 'website') return 'SOURCE_CLAIM';
  if (e.source === 'calculated') return 'INFERRED';
  return 'VERIFIED';
}

// ── Findings ───────────────────────────────────────────────────────────────

export type FindingCategory = 'profile' | 'ranking' | 'reviews' | 'keywords' | 'competitors' | 'website' | 'data_quality';
export type Actionability = 'directly_fixable' | 'indirectly_influenceable' | 'monitor_only' | 'not_actionable' | 'unknown';
export type Severity = 'high' | 'medium' | 'low';

export interface Finding {
  id: string;
  category: FindingCategory;
  title: string;
  /** Human-readable evidence built from Evidence values — never AI-written. */
  evidence: string;
  evidenceIds: string[];
  source: EvidenceSource;
  severity: Severity;
  confidence: 'high' | 'medium' | 'low';
  businessImpact: string;
  actionability: Actionability;
  growwmaticsCapability: Capability | null;
  recommendedAction: string;
  /**
   * A check the owner should make, built from something we could NOT verify
   * (e.g. the GBP service list was not readable). Never counted or listed as
   * a verified issue; it appears only in the optimization plan.
   */
  verificationOnly?: boolean;
}

/** A proven problem (not data coverage, not a verification step). */
export function isVerifiedIssue(f: Pick<Finding, 'category'> & { verificationOnly?: boolean }): boolean {
  return f.category !== 'data_quality' && !f.verificationOnly;
}

// ── Execution: who does what, and how we will know it worked ─────────────

export interface FindingExecution {
  evidenceState: EvidenceState;
  /** What the business owner must do or approve. */
  ownerAction: string;
  /** What GrowwMatics itself executes — null when it cannot (never implied). */
  growwmaticsAction: string | null;
  /** GrowwMatics can only execute it through a connected Google profile. */
  requiresGbpConnection: boolean;
  /** What the next audit re-measures. */
  measurement: string;
}

const OWNER_ACTION: Record<Capability, string> = {
  update_title: 'Approve the corrected name — it must match your real-world signage.',
  update_description: 'Confirm every fact in the draft description before it is published.',
  update_phone: 'Provide the phone number customers should call.',
  update_website: 'Provide the website address to show on Google.',
  google_posts: 'Approve post topics built from your real services and updates.',
  review_replies: 'Approve the reply tone; flag any review that needs a personal answer.',
  review_requests: 'Provide or approve the list of recent customers and the request message.',
  photo_uploads: 'Provide real photos of your business, team and work.',
  rank_tracking: 'Nothing — measurement only.',
};
const NEEDS_GBP: Record<Capability, boolean> = {
  update_title: true, update_description: true, update_phone: true, update_website: true,
  google_posts: true, review_replies: true, photo_uploads: true,
  review_requests: false, rank_tracking: false,
};
export const MEASUREMENT_BY_CATEGORY: Record<string, string> = {
  ranking: 'The same Google Maps searches, re-run in the next audit',
  reviews: 'Lifetime review count, rating and reply rate in the next audit',
  profile: 'Field status in the next connected audit',
  keywords: 'Rank for the same phrases in the next audit',
  competitors: 'Businesses shown above you in the same searches',
  website: 'Website re-read (cached 30 days) and Google profile field status',
  data_quality: 'Data coverage in the next audit',
};

export function findingExecution(f: Pick<Finding, 'source' | 'category' | 'growwmaticsCapability' | 'recommendedAction'>): FindingExecution {
  const cap = f.growwmaticsCapability;
  return {
    evidenceState: f.source === 'website' ? 'SOURCE_CLAIM' : f.source === 'calculated' ? 'INFERRED' : 'VERIFIED',
    ownerAction: cap ? OWNER_ACTION[cap] : f.recommendedAction,
    growwmaticsAction: cap ? GROWWMATICS_CAPABILITIES[cap].label : null,
    requiresGbpConnection: cap ? NEEDS_GBP[cap] : false,
    measurement: MEASUREMENT_BY_CATEGORY[f.category] || 'Re-checked in the next audit',
  };
}

/** Findings that describe the business (not our data coverage). */
export function isCustomerIssue(f: Finding): boolean {
  return f.category !== 'data_quality';
}

export interface KeywordRow {
  keyword: string;
  /** null = demand unavailable (no measured volume). */
  volumeBand: 'HIGH' | 'MED' | 'LOW' | 'NICHE' | null;
  estimated: boolean;
  searchVolume: number | null;
  status: 'ok' | 'unavailable';
  found: boolean;
  rank: number | null;
}

export interface FindingsInput {
  fields: Record<string, FieldState>;
  /** Description length when readable (GBP-connected or owner-provided). */
  descriptionLength?: number | null;
  title: { name: string; selfPraiseTerm?: string | null; wordCount: number };
  primaryKeyword?: string | null;
  primaryRanking: RankingSummary;
  nearbyRanking: RankingSummary;
  nearbyByKeyword: KeywordRankingSummary[];
  competitors: CompetitorFact[];
  competitorsAhead: CompetitorsAhead;
  reviews: ReviewFacts;
  reviewComparison: ReviewComparison | null;
  keywordRows: KeywordRow[];
  website?: { onListing: boolean; reachable: boolean | null } | null;
  suspensionRisk: SuspensionRisk;
  /** Where each profile field's value was read (default 'google_places'). A
   *  field read from the Google Business Profile API is 'gbp_api'. */
  fieldSources?: Record<string, EvidenceSource>;
}

const pct = (r: number | null) => (r == null ? '—' : `${Math.round(r * 100)}%`);

/** Builds evidence + candidate findings. Deterministic; same input → same output. */
export function buildEvidenceAndFindings(input: FindingsInput): { evidence: Evidence[]; findings: Finding[] } {
  const evidence: Evidence[] = [];
  const findings: Finding[] = [];
  const ev = (e: Evidence) => {
    evidence.push(e);
    return e.id;
  };

  // ── Profile fields ───────────────────────────────────────────────────────
  for (const [field, state] of Object.entries(input.fields)) {
    ev({
      id: `profile.${slug(field)}`,
      metric: `profile_field:${field}`,
      value: state,
      status: state === 'verified_present' ? 'verified' : state === 'verified_missing' ? 'verified_missing' : 'unknown',
      source: input.fieldSources?.[field] ?? 'google_places',
      confidence: state === 'unknown' ? 'low' : 'high',
    });
  }

  const missing = (field: string) => input.fields[field] === 'verified_missing';
  const profileFinding = (
    field: string,
    f: Omit<Finding, 'id' | 'category' | 'evidence' | 'evidenceIds' | 'source' | 'confidence'>,
  ) => {
    findings.push({
      id: `profile.${slug(field)}.missing`,
      category: 'profile',
      evidence: `${field}: not found on the Google listing`,
      evidenceIds: [`profile.${slug(field)}`],
      source: input.fieldSources?.[field] ?? 'google_places',
      confidence: 'high',
      ...f,
    });
  };

  if (missing('Phone')) {
    profileFinding('Phone', {
      title: 'No phone number on the Google listing',
      severity: 'high',
      businessImpact: 'Searchers cannot call directly from Google Maps.',
      actionability: 'directly_fixable',
      growwmaticsCapability: 'update_phone',
      recommendedAction: 'Add the business phone number to the Google profile.',
    });
  }
  if (missing('Website')) {
    profileFinding('Website', {
      title: 'No website linked on the Google listing',
      severity: 'medium',
      businessImpact: 'Searchers who want more detail have nowhere to go from the listing.',
      actionability: 'directly_fixable',
      growwmaticsCapability: 'update_website',
      recommendedAction: 'Link the business website (or a single landing page) on the Google profile.',
    });
  }
  if (missing('Business Hours')) {
    profileFinding('Business Hours', {
      title: 'Opening hours are not set on the Google listing',
      severity: 'medium',
      businessImpact: 'Google may show the business without hours, and searchers cannot tell when it is open.',
      actionability: 'directly_fixable',
      growwmaticsCapability: null,
      recommendedAction: 'Set opening hours in Google Business Profile.',
    });
  }
  if (missing('Business Photos')) {
    profileFinding('Business Photos', {
      title: 'No photos on the Google listing',
      severity: 'medium',
      businessImpact: 'Listings without photos give searchers less reason to choose them.',
      actionability: 'directly_fixable',
      growwmaticsCapability: 'photo_uploads',
      recommendedAction: 'Upload real photos of the premises, team and work.',
    });
  }
  if (missing('Primary Category')) {
    profileFinding('Primary Category', {
      title: 'No primary category on the Google listing',
      severity: 'high',
      businessImpact: 'The category is how Google decides which searches the listing is relevant for.',
      actionability: 'directly_fixable',
      growwmaticsCapability: null,
      recommendedAction: 'Choose the most specific primary category in Google Business Profile.',
    });
  }
  if (missing('Business Description')) {
    const len = input.descriptionLength;
    profileFinding('Business Description', {
      title: len && len > 0 ? `Business description is short (${len} characters)` : 'No business description on the Google listing',
      severity: 'medium',
      businessImpact: 'The description is where the listing explains what the business does and for whom.',
      actionability: 'directly_fixable',
      growwmaticsCapability: 'update_description',
      recommendedAction: 'Write a factual description of at least 100 characters covering services and area served.',
    });
  }
  if (missing('Services Listed')) {
    profileFinding('Services Listed', {
      title: 'No services listed on the Google profile',
      severity: 'low',
      businessImpact: 'Listed services help Google match the listing to specific searches.',
      actionability: 'directly_fixable',
      growwmaticsCapability: null,
      recommendedAction: 'Add the services the business actually offers in Google Business Profile.',
    });
  }

  // ── Title (Google naming guidelines) ─────────────────────────────────────
  const titleEv = ev({
    id: 'title.name',
    metric: 'business_title',
    value: input.title.name,
    status: 'verified',
    source: 'google_places',
    confidence: 'high',
  });
  if (input.title.selfPraiseTerm) {
    findings.push({
      id: 'profile.title.self_praise',
      category: 'profile',
      title: `Business title contains the promotional word "${input.title.selfPraiseTerm}"`,
      evidence: `Title: "${input.title.name}"`,
      evidenceIds: [titleEv],
      source: 'google_places',
      severity: 'high',
      confidence: 'high',
      businessImpact: "Google's naming guidelines don't allow promotional terms in the title; listings can be suspended for it.",
      actionability: 'directly_fixable',
      growwmaticsCapability: 'update_title',
      recommendedAction: 'Use the real-world business name exactly as it appears on signage, without promotional words.',
    });
  }
  // No "title is long" finding: word count alone is not evidence of a
  // naming-guideline violation (a live 9-word real name was flagged).

  // ── Ranking ──────────────────────────────────────────────────────────────
  const p = input.primaryRanking;
  const rankEv = ev({
    id: 'ranking.primary',
    metric: 'primary_keyword_ranking',
    value: p,
    keyword: input.primaryKeyword || undefined,
    status: p.status === 'unavailable' ? 'unavailable' : p.status === 'not_run' ? 'unknown' : 'verified',
    source: 'dataforseo',
    confidence: p.testedCount >= 3 ? 'high' : 'medium',
  });
  if (p.status === 'unavailable') {
    findings.push({
      id: 'data_quality.ranking_unavailable',
      category: 'data_quality',
      title: 'Ranking check could not be completed',
      evidence: 'The ranking provider did not return results for this report.',
      evidenceIds: [rankEv],
      source: 'dataforseo',
      severity: 'low',
      confidence: 'high',
      businessImpact: 'Ranking position is unknown for this report — not a problem with the business.',
      actionability: 'unknown',
      growwmaticsCapability: 'rank_tracking',
      recommendedAction: 'Re-run the report to measure ranking.',
    });
  } else if (p.testedCount > 0 && p.foundCount === 0) {
    findings.push({
      id: 'ranking.primary.not_found',
      category: 'ranking',
      title: `Not in the top 20 on Google Maps for "${input.primaryKeyword}"`,
      evidence: `Not found in the top 20 at any of ${p.testedCount} location${p.testedCount > 1 ? 's' : ''} checked`,
      evidenceIds: [rankEv],
      source: 'dataforseo',
      severity: 'high',
      confidence: p.testedCount >= 3 ? 'high' : 'medium',
      businessImpact: 'People searching this phrase nearby are shown other businesses.',
      actionability: 'indirectly_influenceable',
      growwmaticsCapability: null,
      recommendedAction: 'Work on the profile, review and posting findings in this report, then re-measure.',
    });
  } else if (p.testedCount > 0 && p.visibilityRate != null && p.visibilityRate < 0.5) {
    findings.push({
      id: 'ranking.primary.low_visibility',
      category: 'ranking',
      title: `Visible in only ${p.foundCount} of ${p.testedCount} searches for "${input.primaryKeyword}"`,
      evidence: `Top-20 visibility ${pct(p.visibilityRate)}; average position where found #${p.averageObservedRank}`,
      evidenceIds: [rankEv],
      source: 'dataforseo',
      severity: 'medium',
      confidence: 'medium',
      businessImpact: 'The listing appears for some nearby searchers but not others.',
      actionability: 'indirectly_influenceable',
      growwmaticsCapability: null,
      recommendedAction: 'Work on the profile, review and posting findings in this report, then re-measure.',
    });
  }

  const nearbyMissed = input.nearbyByKeyword.filter((k) => k.status !== 'unavailable' && k.testedCount > 0 && k.foundCount === 0);
  if (input.nearbyRanking.testedCount > 0) {
    const nearbyEv = ev({
      id: 'ranking.nearby',
      metric: 'nearby_area_rankings',
      value: input.nearbyRanking,
      status: 'verified',
      source: 'dataforseo',
      confidence: 'high',
    });
    if (nearbyMissed.length > 0) {
      const tested = input.nearbyByKeyword.filter((k) => k.testedCount > 0).length;
      findings.push({
        id: 'ranking.nearby.not_found',
        category: 'ranking',
        title: `Not in the top 20 for ${nearbyMissed.length} of ${tested} nearby-area searches`,
        evidence: `Examples: ${nearbyMissed.slice(0, 3).map((k) => `"${k.keyword}"`).join(', ')}`,
        evidenceIds: [nearbyEv],
        source: 'dataforseo',
        severity: nearbyMissed.length / Math.max(1, tested) >= 0.5 ? 'medium' : 'low',
        confidence: 'high',
        businessImpact: 'Searchers in these nearby areas are shown other businesses first.',
        actionability: 'indirectly_influenceable',
        growwmaticsCapability: 'google_posts',
        recommendedAction: 'Mention the areas actually served in posts and the description, then re-measure.',
      });
    }
  }

  // ── Competitors (facts only — no causation) ──────────────────────────────
  if (input.competitorsAhead.count > 0) {
    const compEv = ev({
      id: 'competitors.ahead',
      metric: 'competitors_ahead',
      value: { count: input.competitorsAhead.count, names: input.competitorsAhead.names.slice(0, 10) },
      status: 'verified',
      source: 'dataforseo',
      confidence: 'high',
    });
    findings.push({
      id: 'competitors.ahead',
      category: 'competitors',
      title: `${input.competitorsAhead.count} ${input.competitorsAhead.count === 1 ? 'business appeared' : 'businesses appeared'} above you in the searches we ran`,
      evidence: `Including ${input.competitorsAhead.names.slice(0, 3).join(', ')} (across ${input.competitorsAhead.searchesChecked} searches)`,
      evidenceIds: [compEv],
      source: 'dataforseo',
      severity: 'low',
      confidence: 'high',
      businessImpact: 'These are the listings searchers see before yours.',
      actionability: 'monitor_only',
      growwmaticsCapability: 'rank_tracking',
      recommendedAction: 'Compare your profile with theirs using the other findings in this report.',
    });
  }

  // ── Reviews ──────────────────────────────────────────────────────────────
  const lt = input.reviews.lifetime;
  const ltEv = ev({
    id: 'reviews.lifetime',
    metric: 'lifetime_reviews',
    value: { totalCount: lt.totalCount, rating: lt.rating },
    status: lt.status === 'verified' ? 'verified' : 'unknown',
    source: lt.source === 'gbp_api' ? 'gbp_api' : lt.source === 'serpapi' ? 'serpapi' : 'google_places',
    confidence: lt.status === 'verified' ? 'high' : 'low',
  });
  if (lt.status === 'verified' && lt.totalCount === 0) {
    findings.push({
      id: 'reviews.none',
      category: 'reviews',
      title: 'No Google reviews yet',
      evidence: '0 reviews on the Google listing',
      evidenceIds: [ltEv],
      source: 'google_places',
      severity: 'high',
      confidence: 'high',
      businessImpact: 'Searchers have no reviews to judge the business by.',
      actionability: 'indirectly_influenceable',
      growwmaticsCapability: 'review_requests',
      recommendedAction: 'Ask recent real customers for a review.',
    });
  }
  const cmp = input.reviewComparison;
  if (cmp && lt.totalCount != null && lt.totalCount > 0 && cmp.targetCount < cmp.medianCompetitorReviewCount) {
    const cmpEv = ev({
      id: 'reviews.vs_competitors',
      metric: 'review_count_vs_competitors_ahead',
      value: cmp,
      status: 'verified',
      source: 'dataforseo',
      confidence: cmp.competitorsCompared >= 5 ? 'high' : 'medium',
    });
    const ratingNote = lt.rating != null ? `${lt.rating}★ from ${lt.totalCount} review${lt.totalCount === 1 ? '' : 's'}` : `${lt.totalCount} reviews`;
    findings.push({
      id: 'reviews.volume_gap',
      category: 'reviews',
      title: 'Fewer reviews than the businesses shown above you',
      evidence: `You: ${ratingNote}. Median of ${cmp.competitorsCompared} businesses above you: ${cmp.medianCompetitorReviewCount} reviews${cmp.medianCompetitorRating != null ? ` at ${cmp.medianCompetitorRating}★` : ''}`,
      evidenceIds: [ltEv, cmpEv],
      source: 'dataforseo',
      severity: cmp.targetCount < cmp.medianCompetitorReviewCount / 4 ? 'high' : 'medium',
      confidence: cmp.competitorsCompared >= 5 ? 'high' : 'medium',
      businessImpact: 'Searchers comparing listings see far more customer feedback on the others.',
      actionability: 'indirectly_influenceable',
      growwmaticsCapability: 'review_requests',
      recommendedAction: 'Ask recent real customers for reviews on a steady schedule.',
    });
  }
  const rc = input.reviews.recent;
  if (rc.status === 'verified' && rc.responseRate != null && (rc.newReviewCount ?? 0) >= 3 && rc.responseRate < 0.5) {
    const respEv = ev({
      id: 'reviews.response_rate',
      metric: 'recent_response_rate',
      value: { responseRate: rc.responseRate, newReviewCount: rc.newReviewCount, periodDays: rc.periodDays },
      status: 'verified',
      source: 'serpapi',
      confidence: 'medium',
    });
    findings.push({
      id: 'reviews.unanswered',
      category: 'reviews',
      title: rc.responseRate === 0
        ? `None of the ${rc.newReviewCount} recent reviews has a reply`
        : `Only ${pct(rc.responseRate)} of recent reviews have a reply`,
      evidence: `${rc.newReviewCount} reviews in the last ${rc.periodDays} days`,
      evidenceIds: [respEv],
      source: 'serpapi',
      severity: 'medium',
      confidence: 'medium',
      businessImpact: 'Unanswered reviews look unattended to people reading them.',
      actionability: 'directly_fixable',
      growwmaticsCapability: 'review_replies',
      recommendedAction: 'Reply to every review, positive and negative.',
    });
  }

  // ── Keywords (ranking evidence + real demand only) ───────────────────────
  const gaps = input.keywordRows.filter(
    (k) => k.status === 'ok' && !k.estimated && (k.volumeBand === 'HIGH' || k.volumeBand === 'MED') && !k.found,
  );
  if (gaps.length > 0) {
    const kwEv = ev({
      id: 'keywords.demand_not_ranking',
      metric: 'keywords_with_demand_not_in_top20',
      value: gaps.map((g) => ({ keyword: g.keyword, searchVolume: g.searchVolume, band: g.volumeBand })),
      status: 'verified',
      source: 'dataforseo',
      confidence: 'high',
    });
    findings.push({
      id: 'keywords.demand_gap',
      category: 'keywords',
      title: `Not in the top 20 for ${gaps.length} searched phrase${gaps.length > 1 ? 's' : ''} with real demand`,
      evidence: gaps
        .slice(0, 3)
        .map((g) => `"${g.keyword}"${g.searchVolume != null ? ` (~${g.searchVolume}/mo)` : ''}`)
        .join(', '),
      evidenceIds: [kwEv],
      source: 'dataforseo',
      severity: 'medium',
      confidence: 'high',
      businessImpact: 'People do search these phrases; the listing is not shown for them.',
      actionability: 'indirectly_influenceable',
      growwmaticsCapability: 'google_posts',
      recommendedAction: 'Use these phrases naturally in posts and the description where they truly describe the business.',
    });
  }

  // ── Website ──────────────────────────────────────────────────────────────
  if (input.website?.onListing && input.website.reachable === false) {
    const wEv = ev({
      id: 'website.unreachable',
      metric: 'website_reachable',
      value: false,
      status: 'verified',
      source: 'website',
      confidence: 'medium',
    });
    // One failed fetch from our server is not proof the site is down (a live
    // site was once "unreachable" because of our DNS; bot-blocking and TLS
    // quirks do the same) — so this is a check for the owner, not an issue.
    findings.push({
      id: 'website.unreachable',
      verificationOnly: true,
      category: 'website',
      title: 'We could not load the website on your listing — please check it opens',
      evidence: 'Our request to the listed website failed or timed out',
      evidenceIds: [wEv],
      source: 'website',
      severity: 'medium',
      confidence: 'medium',
      businessImpact: 'Searchers who click through may reach a broken page.',
      actionability: 'directly_fixable',
      growwmaticsCapability: null,
      recommendedAction: 'Check the website is online and the link on the listing is correct.',
    });
  }

  // Suspension risk evidence (the tile reads reasons from here).
  ev({
    id: 'risk.suspension',
    metric: 'suspension_risk_heuristic',
    value: input.suspensionRisk,
    status: 'verified',
    source: 'calculated',
    confidence: 'low',
  });

  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => Number(!isCustomerIssue(a)) - Number(!isCustomerIssue(b)) || order[a.severity] - order[b.severity]);
  return { evidence, findings };
}

/**
 * One-line, human-readable rendering of an evidence item — the only text
 * that appears as "evidence" next to an AI-written strength/weakness, so the
 * AI never writes the evidence itself.
 */
export function describeEvidence(e: Evidence): string {
  const v: any = e.value;
  if (e.status === 'unavailable') return `${e.metric.replace(/_/g, ' ')}: unavailable`;
  switch (e.metric) {
    case 'business_title':
      return `Title: "${v}"`;
    case 'primary_keyword_ranking': {
      if (!v || !v.testedCount) return 'Ranking: not measured';
      const avg = v.averageObservedRank != null ? `; average position where found #${v.averageObservedRank}` : '';
      return `"${e.keyword}": in the top 20 in ${v.foundCount} of ${v.testedCount} searches${avg}`;
    }
    case 'nearby_area_rankings':
      return `Nearby-area searches: in the top 20 in ${v.foundCount} of ${v.testedCount}`;
    case 'competitors_ahead':
      return `${v.count} businesses shown above you (e.g. ${(v.names || []).slice(0, 3).join(', ')})`;
    case 'lifetime_reviews':
      return v.totalCount == null
        ? 'Lifetime reviews: unknown'
        : `${v.rating != null ? `${v.rating}★ from ` : ''}${v.totalCount} Google review${v.totalCount === 1 ? '' : 's'}`;
    case 'review_count_vs_competitors_ahead':
      return `Median ${v.medianCompetitorReviewCount} reviews among ${v.competitorsCompared} businesses above you (you: ${v.targetCount})`;
    case 'recent_response_rate':
      return `${Math.round((v.responseRate ?? 0) * 100)}% of ${v.newReviewCount} reviews in the last ${v.periodDays} days have a reply`;
    case 'keywords_with_demand_not_in_top20':
      return `Not in the top 20 for: ${(v || []).slice(0, 3).map((k: any) => `"${k.keyword}"`).join(', ')}`;
    case 'website_reachable':
      return 'Website on the listing did not respond';
    case 'website_services':
      return `Your website lists: ${(v || []).slice(0, 6).join(', ')}`;
    case 'website_description':
      return `Your website describes the business as: "${String(v).slice(0, 160)}"`;
    case 'website_booking_link':
      return `Your website has a booking page: ${v}`;
    case 'website_service_areas':
      return `Your website mentions areas served: ${(v || []).slice(0, 5).join(', ')}`;
    case 'website_credentials':
      return `Your website states: ${(v || []).slice(0, 3).join('; ')}`;
    case 'suspension_risk_heuristic':
      return `Suspension-risk check: ${v.level}${v.reasons?.length ? ` — ${v.reasons[0]}` : ''}`;
    default:
      if (e.metric.startsWith('gbp:')) {
        const label = `Google Business Profile ${e.metric.slice('gbp:'.length).replace(/_/g, ' ')}`;
        if (v == null) return `${label}: ${e.state === 'NOT_MEASURED' ? 'not available from Google' : 'not read'}`;
        return `${label}: ${String(v)}`;
      }
      if (e.metric.startsWith('profile_field:')) {
        const field = e.metric.slice('profile_field:'.length);
        return `${field}: ${e.status === 'verified' ? 'present' : e.status === 'verified_missing' ? 'missing' : 'could not be checked'}`;
      }
      return `${e.metric.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`;
  }
}

// ── Market opportunity labels (evidence-backed) ────────────────────────────

export type OpportunityLabel = 'HIGHEST POTENTIAL' | 'IMMEDIATE WIN' | 'HIGH POTENTIAL';

/**
 * Only live (non-estimated) demand plus a measured rank can earn a label.
 * Returns null when the evidence is insufficient — the label is then not shown.
 */
export function opportunityLabel(row: KeywordRow): OpportunityLabel | null {
  if (row.status !== 'ok' || row.estimated) return null;
  const strongDemand = row.volumeBand === 'HIGH' || row.volumeBand === 'MED';
  if (!strongDemand) return null;
  if (row.found && row.rank != null && row.rank >= 4 && row.rank <= 10) return 'IMMEDIATE WIN';
  if (!row.found && row.volumeBand === 'HIGH') return 'HIGHEST POTENTIAL';
  if (!row.found || (row.rank != null && row.rank > 10)) return 'HIGH POTENTIAL';
  return null;
}

/** Up to `limit` labelled keyword opportunities, strongest evidence first. */
export function selectOpportunities(rows: KeywordRow[], limit = 3): Array<KeywordRow & { potential: OpportunityLabel }> {
  const rankOf: Record<OpportunityLabel, number> = { 'HIGHEST POTENTIAL': 0, 'IMMEDIATE WIN': 1, 'HIGH POTENTIAL': 2 };
  return rows
    .map((r) => ({ ...r, potential: opportunityLabel(r) }))
    .filter((r): r is KeywordRow & { potential: OpportunityLabel } => r.potential != null)
    .sort((a, b) => rankOf[a.potential] - rankOf[b.potential] || (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, limit);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
