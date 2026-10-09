import Groq from 'groq-sdk';
import { GROQ_MODEL } from '@/lib/aiModel';
import { withGroqRetry } from '@/lib/groqRetry';
import {
  buildCompletionPromptFact,
  qualifyCompletionInProse,
  COMPLETION_PROMPT_RULE,
} from '@/lib/profileCompletion';
import type { ISeoPlanDraft, IKeywordTableRow, ISeoPlanSnapshotTile, ISeoPlanGapItem } from '@/models/Audit';
import type { WebsiteSignals } from '@/services/audit/websiteSignals';
import type { FieldState, RankingSummary, ReviewComparison, SuspensionRisk } from '@/services/audit/facts';
import type { Finding, OpportunityLabel } from '@/services/audit/findings';
import { GROWWMATICS_CAPABILITIES } from '@/services/audit/findings';
import { allowedNumbersFrom, claimsUnsupportedCapability, dropUnsupportedSentences, groundItems, groundText } from '@/services/audit/validateAudit';
import { competitorTierLabel, suspensionDisplay } from '@/services/audit/reportDisplay';
import { claimsUnknownService, inventedClaimChecker, namesUnknownBusiness, repairUnverifiedGbpClaims, type ClaimContext } from '@/services/audit/validateAudit';
import { brandPhrase } from '@/services/audit/facts';
import { buildCompetitorInsights } from '@/services/intel/competitorInsights';
import { isGroundedKeywordProposal, toSearchPhrase } from '@/services/intel/searchTerms';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export type ReportDepth = 'free' | 'full';

export interface SeoPlanInput {
  businessName: string;
  category: string;
  city: string;
  area?: string;
  state?: string;
  country?: string;
  website?: string;
  neighbourhoods: string[];
  primaryKeyword: string;
  keywordTable: IKeywordTableRow[];
  /** Real businesses observed above the target (facts.ts), strongest first. */
  competitors: Array<{
    name: string;
    mapsRank?: number | null;
    rating?: number | null;
    reviewCount?: number | null;
    searchesAhead?: number;
    appearances?: number | null;
    relevance?: string;
    source?: 'dataforseo' | 'google_places';
    top3Count?: number;
    category?: string | null;
    hasWebsite?: boolean;
    hasBookingLink?: boolean;
    additionalCategories?: string[] | null;
    websiteServices?: string[];
  }>;
  /** Valid searches the competitor list was drawn from. */
  searchesChecked: number;
  /** Ranking facts — `overall.averageObservedRank` is over FOUND searches only. */
  ranking: { overall: RankingSummary; primary: RankingSummary; notRunReason?: 'category_unknown' | null };
  reviews: { totalCount: number | null; rating: number | null; sampleSize: string | null };
  reviewComparison: ReviewComparison | null;
  profileCompletion: any;
  fieldStates: Record<string, FieldState>;
  findings: Finding[];
  /** Deterministically selected, evidence-backed keyword opportunities. */
  opportunities: Array<{ keyword: string; potential: OpportunityLabel; searchVolume: number | null; volumeBand: string | null; found: boolean; rank: number | null }>;
  strengths?: any[];
  weaknesses?: any[];

  // ── 'full' depth extras ──────────────────────────────────────────────────
  depth?: ReportDepth;
  /** From the intake form. Owner input is a trusted source. */
  offers?: string;
  usps?: string;
  services?: string;
  /** Services seen on a verified source (live GBP / owner intake / website). */
  verifiedServices: string[];
  /** Light read of the business's own website. */
  websiteSignals?: WebsiteSignals | null;
  /** Live GBP fields, only when the workspace connected Google. */
  gbpLive?: {
    title?: string;
    description?: string;
    primaryCategory?: string;
    additionalCategories?: string[];
  } | null;
  suspensionRisk: SuspensionRisk;

  // ── Evidence layer (Sep 2026) ────────────────────────────────────────────
  /** Services from the owner / live GBP only (not the website). */
  ownerServices?: string[];
  /** Stored website research (WebsiteIntelligence doc) — SOURCE_CLAIMs. */
  websiteIntel?: any;
  /** The target's public Maps listing seen in ranking results. */
  publicProfile?: { observed: boolean; category: string | null; additionalCategories: string[] | null; website: string | null; bookingUrl: string | null; hasHours: boolean | null } | null;
  competitorComparison?: any;
  /** Search term taken from the website when the Google category is generic. */
  websiteSearchTerm?: string | null;
  /** True only when the live GBP was read — otherwise prose may not assert its content. */
  gbpRead?: boolean;
  /** Monthly audits: measured changes since the previous connected audit (the ONLY change facts the AI may state). */
  monthlyContext?: string[];
  /**
   * Verified facts from the GBP Intelligence snapshot (services, hours,
   * attributes, media, posts, health, duplicates, external changes) — short
   * normalized lines from services/gbp/intelligence/auditInput.ts
   * seoBrainGbpLines, never the raw snapshot.
   */
  gbpIntelligenceLines?: string[];
  /**
   * Measured FR-4 gaps only. Unknown and not-measured checks are omitted
   * and must not be turned into recommendations.
   */
  fr4Lines?: string[];
}

/** Prompt wording for a measured rank — "not found in the top 20" is a fact, never a number. */
const fmtRank = (found: boolean, r?: number | null) => (found && r != null ? `#${Math.round(r)}` : 'not found in the top 20');
const demandText = (k: { volumeBand: string | null; searchVolume: number | null }) =>
  k.volumeBand ? `demand ${k.volumeBand}${k.searchVolume != null ? ` (~${k.searchVolume}/mo nationwide — NOT local)` : ''}` : 'demand unavailable (no measured volume)';

/** Headline rank text — measured, never estimated. */
function rankHeadline(input: SeoPlanInput): { value: string; note: string; tone: 'good' | 'warn' | 'bad' } {
  const o = input.ranking.overall;
  if (input.ranking.notRunReason === 'category_unknown') {
    return { value: 'Not measured', note: 'Business category unknown — no search term to measure', tone: 'warn' };
  }
  if (o.status === 'unavailable' || o.status === 'not_run' || o.testedCount === 0) {
    return { value: 'Unavailable', note: 'Ranking check did not complete', tone: 'warn' };
  }
  if (o.averageObservedRank == null) {
    return { value: 'Not found', note: `Not in the top 20 in any of ${o.testedCount} searches`, tone: 'bad' };
  }
  return {
    value: `#${o.averageObservedRank}`,
    note: `Average where found · top 20 in ${o.foundCount} of ${o.testedCount} searches`,
    tone: o.averageObservedRank <= 3 && (o.visibilityRate ?? 0) >= 0.5 ? 'good' : o.averageObservedRank <= 10 ? 'warn' : 'bad',
  };
}

async function jsonCall(prompt: string, temperature = 0.3): Promise<any> {
  const res = await withGroqRetry(() => groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature,
    reasoning_effort: 'low',
  }), { reason: 'consultant_sections' });
  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error('empty Groq response');
  return JSON.parse(content);
}

// ── Deterministic sections (no LLM — built straight from real numbers) ────────

function buildCompetitorLandscape(input: SeoPlanInput): ISeoPlanDraft['competitorLandscape'] {
  return input.competitors.slice(0, 10).map((c) => {
    const bits: string[] = [];
    if (c.searchesAhead != null && input.searchesChecked > 0) {
      bits.push(`shown above you in ${c.searchesAhead} of ${input.searchesChecked} searches`);
    }
    if (c.appearances != null && input.searchesChecked > 0 && c.appearances > (c.searchesAhead ?? 0)) {
      bits.push(`in the top 20 in ${c.appearances}`);
    }
    if (c.rating != null && c.reviewCount != null) bits.push(`${c.rating}★ from ${c.reviewCount} reviews`);
    else if (c.reviewCount != null) bits.push(`${c.reviewCount} reviews`);
    const keyEdge = bits.length ? `${bits.join('; ')}.` : 'Shown above you in the searches we ran.';
    return {
      name: c.name, mapsRank: c.mapsRank ?? undefined, rating: c.rating ?? undefined, reviewCount: c.reviewCount ?? undefined, keyEdge,
      relevance: c.relevance, searchesAhead: c.searchesAhead, appearances: c.appearances ?? null,
      tierLabel: competitorTierLabel(c, input.searchesChecked),
    };
  });
}

function buildCriticalGap(input: SeoPlanInput): ISeoPlanDraft['criticalGap'] {
  const weak = input.keywordTable
    .filter((k) => (k.rankStatus ?? 'ok') === 'ok')
    .filter((k) => !k.found || (k.rank != null && k.rank > 5))
    .slice(0, 5)
    .map((k) => ({ keyword: k.keyword, mapsRank: k.found ? k.rank ?? null : null }));
  return {
    intro: `We searched these phrases around ${input.city || 'your area'}. ${input.businessName} is not in the top 5 for them, so those searchers see other businesses first.`,
    rows: weak,
    closer: `Improve the listing with facts that are true of this business — its real services, area served and reviews. Don't invent anything and don't stuff keywords.`,
  };
}

/**
 * Projected improvement timeline. Only "Today" is a rank — the measured one.
 * Later stages are the work and the re-measurement, never a promised position.
 */
function buildRankTimeline(input: SeoPlanInput): ISeoPlanDraft['rankTimeline'] {
  const today = rankHeadline(input);
  return [
    { label: 'Today', rank: today.value, note: today.note, tone: today.tone },
    { label: 'After 14 days', rank: 'Fixes live', note: 'Verified listing fixes from this report applied', tone: 'warn' },
    { label: 'After 45 days', rank: 'Re-measure', note: 'Reviews, replies and weekly posts running; same searches re-checked', tone: 'warn' },
    { label: 'After 90 days', rank: 'Compare', note: "Re-audit against today's baseline — the change is measured, not predicted", tone: 'good' },
  ];
}

function websiteServicesOf(input: SeoPlanInput): string[] {
  return (input.websiteIntel?.services || []).map((c: any) => String(c.value)).filter(Boolean);
}

function buildInsights(input: SeoPlanInput): NonNullable<ISeoPlanDraft['competitorInsights']> {
  const pub = input.publicProfile;
  return buildCompetitorInsights(input.competitors, {
    name: input.businessName,
    rating: input.reviews.rating,
    reviewCount: input.reviews.totalCount,
    listingObserved: !!pub?.observed,
    hasWebsite: pub?.observed ? !!pub.website : null,
    hasBookingLink: pub?.observed ? !!pub.bookingUrl : null,
    additionalCategories: pub?.additionalCategories ?? null,
    top3Searches: input.ranking.overall.top3Count,
    searches: input.ranking.overall.testedCount,
    services: [...input.verifiedServices, ...websiteServicesOf(input)],
    websiteBookingUrl: input.websiteIntel?.bookingLinks?.[0]?.value ?? null,
  });
}

function buildWhatWeAimFor(input: SeoPlanInput): ISeoPlanDraft['whatWeAimFor'] {
  return {
    todayRank: rankHeadline(input).value,
    milestones: [
      { label: 'After 14 days', text: 'Apply the verified fixes in this report on the live listing.' },
      { label: 'After 30 days', text: 'Keep weekly posts on real services, answer every review, and ask recent customers for reviews.' },
      { label: 'After 90 days', text: 'Re-audit and compare against this baseline — the change is measured, not predicted.' },
    ],
  };
}

/** Core Performance Snapshot tiles — measured values only. */
function buildCoreSnapshot(input: SeoPlanInput): ISeoPlanSnapshotTile[] {
  const pc = input.profileCompletion || {};
  const tiles: ISeoPlanSnapshotTile[] = [];
  const rank = rankHeadline(input);

  tiles.push({ label: 'Google Maps rank', value: rank.value, note: rank.note, tone: rank.tone });
  tiles.push({
    label: 'Website',
    value: input.websiteSignals?.reachable ? 'Live ✓' : input.website ? 'On listing' : 'Not found',
    note: input.website ? String(input.website).replace(/^https?:\/\//, '').replace(/\/$/, '') : 'No website on the listing',
    tone: input.websiteSignals?.reachable ? 'good' : input.website ? 'warn' : 'bad',
  });

  const r = input.reviews;
  const cmp = input.reviewComparison;
  let reviewNote = 'Review total unavailable';
  let reviewTone: 'good' | 'warn' | 'bad' = 'warn';
  if (r.totalCount != null) {
    if (cmp) {
      reviewNote = r.totalCount >= cmp.medianCompetitorReviewCount
        ? `At or above the median (${cmp.medianCompetitorReviewCount}) of businesses above you`
        : `Median of businesses above you: ${cmp.medianCompetitorReviewCount}`;
      reviewTone = r.totalCount >= cmp.medianCompetitorReviewCount ? 'good' : 'warn';
    } else {
      reviewNote = r.sampleSize === 'very_small' || r.sampleSize === 'none' ? 'Small review sample' : 'Lifetime Google reviews';
      reviewTone = r.totalCount === 0 ? 'bad' : 'warn';
    }
  }
  tiles.push({
    label: 'Google reviews',
    value: r.totalCount != null ? `${r.totalCount}${r.rating != null ? ` · ${r.rating}★` : ''}` : 'Unknown',
    note: reviewNote,
    tone: reviewTone,
  });
  tiles.push({
    label: 'Profile completion',
    value: `${Math.round(pc.completionPercentage ?? 0)}%`,
    note: (pc.oauthPendingCount ?? pc.unknownCount ?? 0) > 0 ? `${pc.oauthPendingCount ?? pc.unknownCount} fields need Google` : 'All visible fields filled',
    tone: (pc.completionPercentage ?? 0) >= 90 ? 'good' : 'warn',
  });
  const susp = suspensionDisplay(input.suspensionRisk);
  tiles.push({
    label: 'Suspension risk',
    value: susp.level,
    note: susp.note,
    tone: input.suspensionRisk.level === 'Low' ? 'good' : input.suspensionRisk.level === 'Medium' ? 'warn' : 'bad',
  });
  return tiles;
}

function buildDataRequired(input: SeoPlanInput, depth: ReportDepth): string[] {
  const out: string[] = [];
  if (input.ranking.notRunReason === 'category_unknown') {
    out.push('Your main service (and a specific primary category on Google) — needed before Google Maps ranking can be measured.');
  }
  if (input.websiteSearchTerm) {
    out.push(`Google's Places data gave only a generic category ("${input.category}"), so we measured ranking for "${input.websiteSearchTerm}" — a service your website names. Confirm it is your main service.`);
  }
  const siteServices = websiteServicesOf(input);
  if (siteServices.length && !input.gbpRead) {
    out.push(`Confirm which services your website lists (${siteServices.slice(0, 4).join(', ')}${siteServices.length > 4 ? '…' : ''}) should appear on your Google profile — we could not read its service list.`);
  }
  if (!input.gbpLive) out.push('Connect Google to read the live listing title, description, categories, hours, and attributes.');
  if (input.fieldStates['Business Description'] !== 'verified_present') out.push('Business description (from Google or owner intake).');
  if (input.verifiedServices.length === 0 && siteServices.length === 0) out.push('The services you actually offer — we only list services we can verify.');
  out.push('Which Google attributes apply (e.g. accessibility, appointments) — we never guess these.');
  out.push('Owner USPs / credentials (registration, years, licence numbers).');
  if (input.keywordTable.some((k) => !k.volumeBand)) {
    out.push('Google Ads returned no search volume for some phrases — their demand is shown as unavailable, not estimated.');
  }
  if (depth === 'full') {
    out.push('Current monthly footfall and average sale value — needed before any revenue scenario.');
    out.push('Localities currently served (for geo-specific posts and Q&As).');
  }
  return out;
}

/** GBP gap rows: status comes from verified field states, never the AI. */
const GAP_FIELDS_FREE = ['Business Description', 'Services Listed', 'Social Links', 'Videos', 'Logo / Cover Image', 'Attributes', 'Booking / Appointment Link'];
const GAP_FIELDS_FULL = ['GBP Title', 'Business Description', 'Additional Categories', 'Services Listed', 'Attributes', 'Google Reviews', 'Business Photos'];

function gapStatus(input: SeoPlanInput, field: string): 'ok' | 'missing' | 'unverified' {
  if (field === 'GBP Title') {
    return input.findings.some((f) => f.id.startsWith('profile.title.')) ? 'missing' : input.gbpLive?.title ? 'ok' : 'unverified';
  }
  if (field === 'Google Reviews') {
    if (input.reviews.totalCount == null) return 'unverified';
    return input.findings.some((f) => f.category === 'reviews') ? 'missing' : 'ok';
  }
  const s = input.fieldStates[field];
  return s === 'verified_present' ? 'ok' : s === 'verified_missing' ? 'missing' : 'unverified';
}

/** A suggested title may only REMOVE words from the real name (no stuffing). */
function safeSuggestedTitle(realName: string, suggested: unknown): string | undefined {
  if (typeof suggested !== 'string' || !suggested.trim()) return undefined;
  const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const real = new Set(realName.split(/\s+/).map(norm).filter(Boolean));
  const words = suggested.split(/\s+/).map(norm).filter(Boolean);
  if (!words.length || !words.every((w) => real.has(w))) return undefined;
  return suggested.trim() === realName.trim() ? undefined : suggested.trim();
}

// ── LLM sections ────────────────────────────────────────────────────────────

function factsBlock(input: SeoPlanInput): string {
  const kwLines = input.keywordTable
    .map((k) => `- ${k.keyword} — ${demandText(k)}, Maps rank ${k.rankStatus === 'unavailable' ? 'unavailable' : fmtRank(!!k.found, k.rank)}`)
    .join('\n');
  const compLines = input.competitors
    .slice(0, 8)
    .map((c) => {
      const extra = [
        c.category && `category ${c.category}`,
        c.hasBookingLink && 'booking link on listing',
        c.websiteServices?.length && `its website lists: ${c.websiteServices.slice(0, 5).join(', ')}`,
      ].filter(Boolean).join('; ');
      return `- ${c.name}: shown above the business in ${c.searchesAhead ?? '?'} of ${input.searchesChecked} searches, ${c.rating ?? '?'}★, ${c.reviewCount ?? '?'} reviews${extra ? `; ${extra}` : ''}`;
    })
    .join('\n');
  const wi = input.websiteIntel;
  const siteClaims = wi && wi.status !== 'failed'
    ? `WEBSITE SAYS (source claims from ${wi.origin}, not verified on Google — cite as "your website says"):
- services: ${websiteServicesOf(input).slice(0, 12).join(', ') || '(none stated)'}
- description: ${wi.description?.value ? String(wi.description.value).slice(0, 240) : '(none)'}
- areas served: ${(wi.serviceAreas || []).map((a: any) => a.value).slice(0, 6).join(', ') || '(none stated)'}
- booking link: ${wi.bookingLinks?.[0]?.value || '(none)'}`
    : '';
  const pub = input.publicProfile;
  const listing = pub?.observed
    ? `PUBLIC GOOGLE LISTING (as shown in Maps results): category ${pub.category || '?'}; additional categories ${pub.additionalCategories?.length ? pub.additionalCategories.join(', ') : 'none shown'}; website ${pub.website ? 'shown' : 'not shown'}; booking link ${pub.bookingUrl ? 'shown' : 'not shown'}.`
    : '';
  const gbpIntel = input.gbpIntelligenceLines?.length
    ? `GOOGLE BUSINESS PROFILE (read from the Google Business Profile API — verified facts; state only these about the profile):
${input.gbpIntelligenceLines.map((l) => `- ${l}`).join('\n')}`
    : '';
  const fr4 = input.fr4Lines?.length
    ? `FR-4 MEASURED GAPS (use these; do not recommend a fix for anything that was not measured):
${input.fr4Lines.map((l) => `- ${l}`).join('\n')}`
    : '';
  const gbpNote = input.gbpRead
    ? ''
    : 'GOOGLE PROFILE CONTENT (services, description, attributes, Q&A): NOT READ. Never say the profile has, lacks or is missing something — write "verify whether your Google Business Profile lists …" instead.';
  // "Not checked" and "did not respond" are different facts from "no website".
  const site = input.websiteSignals?.reachable
    ? `WEBSITE: ${input.websiteSignals.structureNote} Service pages: ${input.websiteSignals.servicePages.slice(0, 12).join(', ') || 'none detected'}.`
    : input.websiteSignals && input.website
      ? `WEBSITE: listed (${input.website}) but it did not respond to our check. This does NOT mean the business has no online presence.`
      : input.website
        ? `WEBSITE: listed (${input.website}); not checked in this report.`
        : 'WEBSITE: none listed on the Google profile.';
  const owner = [
    input.usps && `USPs: ${input.usps}`,
    input.offers && `Offers: ${input.offers}`,
    input.services && `Services: ${input.services}`,
  ].filter(Boolean).join(' | ') || '(none provided)';
  const r = input.reviews;
  const o = input.ranking.overall;
  const monthly = input.monthlyContext?.length
    ? `
SINCE THE LAST AUDIT (measured — the only changes you may mention; never add others):
${input.monthlyContext.map((l) => `- ${l}`).join('\n')}
`
    : '';
  return `${monthly}BUSINESS: ${input.businessName}
CATEGORY: ${input.category}
LOCATION: ${[input.area, input.city, input.state].filter(Boolean).join(', ')}
RANKING: ${o.testedCount ? `in the top 20 in ${o.foundCount} of ${o.testedCount} searches${o.averageObservedRank != null ? `; average position where found #${o.averageObservedRank}` : ''}` : 'unavailable'}
REVIEWS (lifetime): ${r.totalCount != null ? `${r.totalCount} at ${r.rating ?? '?'}★ (sample size: ${r.sampleSize})` : 'unknown'}
PROFILE COMPLETION: ${shortCompletionFact(input.profileCompletion)} (never call the profile "complete" or "100% complete")
VERIFIED SERVICES: ${(input.ownerServices ?? input.verifiedServices).join(', ') || '(none verified)'}
OWNER-PROVIDED: ${owner}
${site}
${siteClaims}
${listing}
${gbpIntel}
${fr4}
${gbpNote}

KEYWORDS (measured Maps rank + demand band):
${kwLines || '(none)'}

BUSINESSES SHOWN ABOVE ${input.businessName.toUpperCase()} (real Maps results):
${compLines || '(none)'}`;
}

/** One short line for prompts — the long qualified fact was being pasted
 *  verbatim into Q&As and action items. */
function shortCompletionFact(pc: any): string {
  const cl: any[] = pc?.checklist || [];
  const known = cl.filter((c) => c.status !== 'Unknown').length;
  const unknown = cl.length - known;
  return `${Math.round(pc?.completionPercentage ?? 0)}% of the ${known} fields we could check; ${unknown} fields could not be checked`;
}

const FACT_RULES = `Do not invent competitors, ranks, reviews, services, hours, accessibility, offers, discounts, events, new courses/products, awards, credentials, years in business or numbers. Use only numbers that appear in the facts. Never state that one fact causes another, and never predict a ranking. About competitors you know ONLY the facts listed for them (name, rating, review count, how often they appeared above this business, and — when listed — their category, booking link and the services their website states). Never describe anything else about them or guess their strategy. Label nothing as fact unless it is in the facts; website content is what the website SAYS.`;

async function callNarrative(input: SeoPlanInput): Promise<Partial<ISeoPlanDraft>> {
  const full = input.depth === 'full';
  const opps = input.opportunities.map((o) => `- ${o.keyword} [${o.potential}] ${demandText(o)}, rank ${fmtRank(o.found, o.rank)}`).join('\n');

  const prompt = `You are a senior local-SEO consultant. ${FACT_RULES} Output strict JSON.

${factsBlock(input)}

KEYWORD OPPORTUNITIES (labels already decided from real demand + rank — do not change them):
${opps || '(none)'}

Return JSON:
{
  "keyFinding": "${full ? '4-6' : '3-4'} sentences. Genuine strengths only from OWNER-PROVIDED / website / reviews. Name which businesses were shown above this one. State the strategic gap. A high rating from few reviews is a good current rating with a small sample, not an established reputation.",
  ${full ? '"websiteAssessment": "2-3 sentences assessing the business\'s own website from the WEBSITE facts only.",' : ''}
  "keywordInsights": ["${full ? '3-4' : '2-3'} one-line takeaways naming specific keywords from the list, using only their measured rank and demand"],
  "opportunityRationales": [ { "keyword": "<exactly one of the KEYWORD OPPORTUNITIES>", "rationale": "${full ? '2-3' : '1-2'} sentences grounded in the measured demand and rank" } ],
  "competitorCounterPosition": "2-3 sentences on how ${input.businessName} can differentiate using only its real facts",
  "uspLine": "one sentence, <=160 chars, from OWNER-PROVIDED where possible; if nothing is provided, describe the verified category and area plainly",
  "reviewReplyMustInclude": ["2-4 short phrases every review reply should include (city, a verified service word)"],
  "proposedKeywords": ["up to 6 search phrases a customer would type, each built ONLY from a VERIFIED SERVICE, a service the WEBSITE SAYS, or the category, plus the city or a real nearby area. Never the business name. Not already in KEYWORDS."]
}`;

  const j = await jsonCall(prompt, 0.3);
  const allowed = allowedNumbersFrom([input.monthlyContext, input.ranking, input.reviews, input.reviewComparison, input.keywordTable, input.competitors, input.searchesChecked, input.opportunities, input.profileCompletion?.completionPercentage, input.usps, input.offers, input.services, input.gbpIntelligenceLines, input.fr4Lines]);
  const byKw = new Map(input.opportunities.map((o) => [o.keyword.toLowerCase(), o]));
  const rationales = new Map<string, string>(
    (Array.isArray(j.opportunityRationales) ? j.opportunityRationales : [])
      .filter((x: any) => x?.keyword && byKw.has(String(x.keyword).toLowerCase()))
      .map((x: any) => [String(x.keyword).toLowerCase(), dropUnsupportedSentences(groundText(String(x.rationale || ''), allowed)) || ''] as [string, string]),
  );
  const insights = groundItems(
    (Array.isArray(j.keywordInsights) ? j.keywordInsights : []).map((t: any) => ({ t: String(t) })),
    ['t'],
    allowed,
  ).kept.map((x: any) => x.t);

  // Sentence-level guards: no causal ranking claims; "high demand" only when
  // a keyword actually has measured HIGH demand.
  const hasHighDemand = input.keywordTable.some((k) => k.volumeBand === 'HIGH');
  const unsupported = (sn: string) =>
    (!hasHighDemand && /high[- ]demand|high[- ]volume/i.test(sn)) ||
    /no online presence/i.test(sn) ||
    // We know nothing about competitors' profiles beyond name/rating/reviews/positions.
    /competitors?\b[^.]{0,40}\b(verified|complete|optimi[sz]ed|better|stronger) (listings?|profiles?)/i.test(sn);
  const clean = (t: unknown) => dropUnsupportedSentences(groundText(typeof t === 'string' ? t : undefined, allowed), unsupported);
  return {
    keyFinding: clean(j.keyFinding),
    websiteAssessment: full ? clean(j.websiteAssessment) : undefined,
    keywordInsights: insights.slice(0, 4),
    // Label from code, words from the AI (or a factual default).
    marketOpportunities: input.opportunities.map((o) => ({
      keyword: o.keyword,
      potential: o.potential,
      rationale: rationales.get(o.keyword.toLowerCase()) ||
        `Measured demand ${o.volumeBand}${o.searchVolume != null ? ` (~${o.searchVolume} searches/month nationwide)` : ''}; ${o.found && o.rank != null ? `currently #${o.rank} near you` : 'not found in the top 20 near you today'}.`,
    })),
    competitorCounterPosition: clean(j.competitorCounterPosition),
    uspLine: groundText(j.uspLine, allowed),
    reviewReplyMustInclude: Array.isArray(j.reviewReplyMustInclude) ? j.reviewReplyMustInclude.slice(0, 4).map(String) : [],
    proposedKeywords: groundedProposals(input, j.proposedKeywords),
  };
}

/** Keep only proposals built from a real service/category + a real location. */
function groundedProposals(input: SeoPlanInput, raw: unknown): NonNullable<ISeoPlanDraft['proposedKeywords']> {
  const siteServices = websiteServicesOf(input);
  const owner = input.ownerServices ?? input.verifiedServices;
  const terms = [...owner, ...siteServices, input.category, input.websiteSearchTerm || ''].filter(Boolean);
  const locations = [input.city, input.area || '', ...input.neighbourhoods].filter(Boolean);
  const measured = new Set(input.keywordTable.map((k) => toSearchPhrase(k.keyword)));
  const brand = brandPhrase(input.businessName);
  const out: NonNullable<ISeoPlanDraft['proposedKeywords']> = [];
  for (const k of Array.isArray(raw) ? raw : []) {
    const kw = toSearchPhrase(String(k || ''));
    if (!kw || measured.has(kw) || out.some((o) => o.keyword === kw)) continue;
    if (!isGroundedKeywordProposal(kw, { terms, locations, brandPhrase: brand })) continue;
    const from = owner.some((t) => kw.includes(String(t).toLowerCase().split(' ')[0])) ? 'owner-provided service'
      : siteServices.some((t) => kw.includes(String(t).toLowerCase().split(' ')[0])) ? 'service your website names'
      : 'Google category';
    out.push({ keyword: kw, basis: from });
    if (out.length >= 6) break;
  }
  return out;
}

/** Fixed, factual wording per field — used when the AI drafts are unavailable. */
const GAP_FIXED_TEXT: Record<string, { whyItMatters: string; ok: string; missing: string; unverified: string }> = {
  'GBP Title': { whyItMatters: 'The title must be your real-world business name.', ok: 'No change needed.', missing: 'Use the real business name without promotional words.', unverified: 'Connect Google to check the live title.' },
  'Business Description': { whyItMatters: 'The description tells searchers what you do and where.', ok: 'No change needed.', missing: 'Add a description built only from true facts about your business.', unverified: 'Connect Google to check the live description.' },
  'Additional Categories': { whyItMatters: 'Categories decide which searches the listing can appear for.', ok: 'No change needed.', missing: 'Add categories that truly describe your services (changed by you in Google).', unverified: 'Connect Google to check your categories.' },
  'Services Listed': { whyItMatters: 'Listed services help Google match the listing to searches.', ok: 'No change needed.', missing: 'List the services you actually offer (changed by you in Google).', unverified: 'Connect Google to check your service list.' },
  'Social Links': { whyItMatters: 'Social links let searchers check your work.', ok: 'No change needed.', missing: 'Add the social profiles you actually use.', unverified: 'Connect Google to check your social links.' },
  Videos: { whyItMatters: 'Videos show your real premises and work.', ok: 'No change needed.', missing: 'Add short, real videos of your business.', unverified: 'Connect Google to check your videos.' },
  'Logo / Cover Image': { whyItMatters: 'A logo and cover image make the listing recognisable.', ok: 'No change needed.', missing: 'Upload your real logo and a cover photo.', unverified: 'Connect Google to check your logo and cover.' },
  Attributes: { whyItMatters: 'Attributes are facts customers filter on in Google Maps; they must be true for the business.', ok: 'No change needed.', missing: 'Tell us which attributes genuinely apply — we never guess them.', unverified: 'Tell us which attributes genuinely apply — we never guess them.' },
  'Booking / Appointment Link': { whyItMatters: 'A booking link lets searchers book straight from Google Maps.', ok: 'No change needed.', missing: 'Add your booking link if you take bookings.', unverified: 'Connect Google to check your booking link.' },
  'Google Reviews': { whyItMatters: 'Review volume and replies are visible to every searcher.', ok: 'Keep reviews coming and reply to each one.', missing: 'Ask recent customers for reviews and reply to every one.', unverified: 'Review data was not available for this report.' },
  'Business Photos': { whyItMatters: 'Photos show searchers the real business.', ok: 'Keep adding recent photos.', missing: 'Upload real photos of your business and work.', unverified: 'Connect Google to check your photos.' },
};

function deterministicGbpGaps(input: SeoPlanInput): ISeoPlanGapItem[] {
  const fields = input.depth === 'full' ? GAP_FIELDS_FULL : GAP_FIELDS_FREE;
  return fields.map((field) => {
    const status = gapStatus(input, field);
    const t = GAP_FIXED_TEXT[field] || { whyItMatters: '', ok: 'No change needed.', missing: 'Confirm this field in Google Business Profile.', unverified: 'Confirm this field in Google Business Profile.' };
    return { field, status, whyItMatters: t.whyItMatters, recommendation: status === 'ok' ? t.ok : status === 'missing' ? t.missing : t.unverified };
  });
}

async function callGbpDrafts(input: SeoPlanInput): Promise<Partial<ISeoPlanDraft>> {
  const full = input.depth === 'full';
  const live = input.gbpLive;
  const liveBlock = live
    ? `CURRENT LIVE GBP:
- title: ${live.title || '(empty)'}
- description: ${live.description ? `${live.description.slice(0, 200)}${live.description.length > 200 ? '…' : ''}` : '(empty)'}
- primary category: ${live.primaryCategory || '(unknown)'}
- additional categories: ${(live.additionalCategories || []).join(', ') || '(none)'}`
    : 'CURRENT LIVE GBP: not connected.';
  const gapFields = full ? GAP_FIELDS_FULL : GAP_FIELDS_FREE;
  const titleIssues = input.findings.filter((f) => f.id.startsWith('profile.title.')).map((f) => f.title);

  const prompt = `You are a Google Business Profile expert. Draft listing content for ${input.businessName} ONLY. A draft is a proposal: GrowwMatics does not write it to Google until the owner previews and approves it. Never change the business name, address, or primary category automatically. ${FACT_RULES} Output strict JSON.

${factsBlock(input)}
${liveBlock}
TITLE CHECK FINDINGS: ${titleIssues.join('; ') || 'none'}

Return JSON:
{
  "suggestedTitle": "${titleIssues.length ? 'The real business name with the flagged words removed — only words already in the current name. Never add a category, location or keyword (that breaks Google\'s naming guidelines).' : 'Return an empty string — the title passed the checks.'}",
  "suggestedDescription": "150-750 chars built ONLY from VERIFIED SERVICES, OWNER-PROVIDED facts, category and location. Where a fact is unknown write [confirm: what is needed] instead of inventing it.",
  ${full ? '"platformGaps": [ { "platform": "a directory relevant to this category in this country", "why": "1 sentence on why a listing there can matter for this category — we did NOT check whether the business is listed there, so never say it is or is not listed" } ],' : ''}
  "gbpGaps": [ ${gapFields.map((f) => `{ "field": "${f}", "whyItMatters": "1 sentence", "recommendation": "1-2 sentences, no invented facts" }`).join(', ')} ]
}${full ? ' 2-4 platformGaps.' : ''}`;

  const j = await jsonCall(prompt, 0.3);
  const allowed = allowedNumbersFrom([input.monthlyContext, input.ranking, input.reviews, input.keywordTable, input.usps, input.offers, input.services, input.verifiedServices, input.gbpIntelligenceLines, input.fr4Lines]);
  const aiGaps = new Map<string, any>((Array.isArray(j.gbpGaps) ? j.gbpGaps : []).map((g: any) => [String(g?.field), g]));
  // Attributes (accessibility, amenities, ownership…) are facts only the
  // owner can confirm — fixed wording, never AI examples that read as claims.
  const FIXED_GAP_TEXT: Record<string, { whyItMatters: string; recommendation: string }> = {
    Attributes: {
      whyItMatters: 'Attributes are facts customers filter on in Google Maps; they must be true for the business.',
      recommendation: 'Tell us which attributes genuinely apply — we never guess them — and set them in Google Business Profile.',
    },
  };
  const gbpGaps: ISeoPlanGapItem[] = gapFields.map((field) => {
    if (FIXED_GAP_TEXT[field]) return { field, status: gapStatus(input, field), ...FIXED_GAP_TEXT[field] };
    const g = aiGaps.get(field) || {};
    return {
      field,
      status: gapStatus(input, field),
      whyItMatters: groundText(String(g.whyItMatters || ''), allowed) || '',
      recommendation: (!claimsUnsupportedCapability(String(g.recommendation || '')) && groundText(String(g.recommendation || ''), allowed)) || 'Confirm this field in Google Business Profile.',
    };
  });

  // Description keywords: real phrases with measured (non-estimated) demand.
  const descriptionKeywords = full
    ? input.keywordTable.filter((k) => k.volumeBand === 'HIGH' || k.volumeBand === 'MED').map((k) => k.keyword).slice(0, 12)
    : undefined;

  return {
    suggestedTitle: titleIssues.length ? safeSuggestedTitle(input.businessName, j.suggestedTitle) : undefined,
    suggestedDescription: groundText(j.suggestedDescription, allowed),
    // Services are never generated: only ones seen on a verified source.
    suggestedServices: input.fieldStates['Services Listed'] === 'verified_present' ? [] : input.verifiedServices.slice(0, 16),
    // No AI-suggested categories: nothing can verify them (a live check
    // produced "Business Consulting" from a website button label).
    suggestedCategories: [],
    suggestedAttributes: undefined,
    descriptionKeywords,
    // We never check other directories — drop any claim about the business
    // being (or not being) listed there.
    platformGaps: full && Array.isArray(j.platformGaps)
      ? j.platformGaps
          .map((p: any) => ({ platform: String(p?.platform || ''), why: dropUnsupportedSentences(String(p?.why || ''), (sn) => /\b(not listed|isn'?t listed|absence|absent|missing from|no (presence|listing))\b/i.test(sn)) || '' }))
          .filter((p: any) => p.platform && p.why)
          .slice(0, 4)
      : undefined,
    gbpGaps,
  };
}

async function callActionPlan(input: SeoPlanInput): Promise<Partial<ISeoPlanDraft>> {
  const full = input.depth === 'full';
  const areas = input.neighbourhoods.slice(0, 4);
  const issues = input.findings
    .filter((f) => f.category !== 'data_quality')
    .map((f) => `- ${f.title} (${f.severity}; ${f.growwmaticsCapability ? `GrowwMatics: ${GROWWMATICS_CAPABILITIES[f.growwmaticsCapability].label}` : 'owner action in Google'})`)
    .join('\n');
  const prompt = `You are a local-SEO delivery lead. Build a concrete 30/60/90-day plan for ${input.businessName} (${input.category}, ${input.city}). ${FACT_RULES} Output strict JSON.

${factsBlock(input)}

VERIFIED ISSUES TO ADDRESS (plan items must map to these):
${issues || '(none — plan maintenance: posts on verified services, review replies, monthly re-measure)'}

Return JSON:
{
  "actionPhases": [
    { "label": "EMERGENCY", "window": "Week 1-2", "items": [ { "title": "...", "detail": "${full ? '2-3 sentences' : '1-2 sentences'} naming ${input.businessName}", "priority": "CRITICAL | HIGH | MEDIUM" } ] },
    { "label": "SHORT-TERM", "window": "Day 15-45", "items": [ ... ] },
    { "label": "MEDIUM-TERM", "window": "Day 46-90", "items": [ ... ] }
  ],
  "weeklyPostThemes": [
    { "weekday": "Monday", "theme": "<one-sentence post idea>", "keyword": "<one keyword from the list>", "postType": "UPDATE | OFFER | EVENT" }
  ],
  "suggestedQas": [ { "q": "<question>", "a": "<answer>" } ]
}
Post themes: each about a verified service or a real update of this business; no offers or discounts unless OWNER-PROVIDED lists them.
Q&As: questions a prospective CUSTOMER would ask about the business (services, location, how to book, who it is for). Never about rankings, reviews, ratings, profile completion or this audit. Answer only from the facts; if the answer is not in the facts write [Owner to confirm: what is needed].
${full ? '4-6' : '3-5'} items in EMERGENCY, 3-4 in SHORT-TERM, 3-4 in MEDIUM-TERM. Exactly 4 weeklyPostThemes (Mon/Wed/Fri/Sat)${areas.length ? ` mentioning these real nearby areas where natural: ${areas.join(', ')}` : ''}. ${full ? '8' : '5-6'} suggestedQas. Use postType OFFER only if OWNER-PROVIDED lists an offer.`;

  const j = await jsonCall(prompt, 0.35);
  const allowed = allowedNumbersFrom([input.monthlyContext, input.ranking, input.reviews, input.keywordTable, input.usps, input.offers, input.services, input.verifiedServices, input.findings.map((f) => f.title), input.gbpIntelligenceLines, input.fr4Lines]);
  const hasOffers = !!input.offers;

  const phases = (Array.isArray(j.actionPhases) ? j.actionPhases : []).map((p: any) => ({
    label: String(p?.label || ''),
    window: String(p?.window || ''),
    // Drop items promising GrowwMatics changes it cannot make (categories,
    // services, hours, attributes, Q&A).
    items: groundItems(Array.isArray(p?.items) ? p.items : [], ['title', 'detail'], allowed).kept
      .filter((it: any) => !claimsUnsupportedCapability(`${it.title} ${it.detail}`))
      .filter((it: any) => !/PROFILE COMPLETION is|NOT confirmed present/.test(String(it.detail || '')))
      .map((it: any) => ({ ...it, detail: dropUnsupportedSentences(String(it.detail || '')) || '' })),
  }));
  // Reject echoed prompt text ("post idea about a VERIFIED service…") and
  // audit-internal Q&As (ranks, reviews, profile completion).
  const echoed = /VERIFIED|OWNER-PROVIDED|<[^>]+>|one-sentence post idea/;
  const posts = groundItems(Array.isArray(j.weeklyPostThemes) ? j.weeklyPostThemes : [], ['theme'], allowed).kept
    .filter((p: any) => hasOffers || String(p.postType).toUpperCase() !== 'OFFER')
    .filter((p: any) => !echoed.test(String(p.theme || '')))
    // No invented events, offers or new offerings (a live check produced
    // "upcoming free demo class" and "a new course module").
    .filter((p: any) => hasOffers || !/\b(free|discount\w*|offer\w*|% off|sale|upcoming|announce\w*|launch\w*|new (course|module|service|batch|branch|program\w*)|event|workshop|webinar|demo class)\b/i.test(String(p.theme || '')))
    .slice(0, 4);
  const auditInternal = /\b(rank|ranking|position|reviews?|rating|profile completion|profile (is )?complete|google business profile|audit|search results)\b/i;
  const qas = groundItems(Array.isArray(j.suggestedQas) ? j.suggestedQas : [], ['q', 'a'], allowed).kept
    .filter((qa: any) => !auditInternal.test(`${qa.q} ${qa.a}`) && !echoed.test(`${qa.q} ${qa.a}`))
    .slice(0, full ? 10 : 8);

  return { actionPhases: phases as any, weeklyPostThemes: posts as any, suggestedQas: qas as any };
}

/** 'full' only — the 3-4 offer/USP Performance-Snapshot tiles. Small call. */
async function callSnapshotTiles(input: SeoPlanInput): Promise<ISeoPlanSnapshotTile[]> {
  const owner = [input.usps, input.offers, input.services].filter(Boolean).join(' | ');
  if (!owner) return [];
  const prompt = `From the OWNER-PROVIDED facts for ${input.businessName} (${input.category}, ${input.city}), pick the 3-4 strongest differentiators a searcher would care about and turn each into a snapshot tile. Only use what's stated — do not invent. Output strict JSON.

OWNER-PROVIDED: ${owner}

Return JSON:
{ "tiles": [ { "label": "short label e.g. Free hearing test", "value": "Offered ✓ | 20 yrs ✓ | Home visit ✓", "note": "why it matters, <=6 words", "tone": "good" } ] }`;
  try {
    const j = await jsonCall(prompt, 0.3);
    const allowed = allowedNumbersFrom([owner]);
    return groundItems(Array.isArray(j.tiles) ? j.tiles : [], ['label', 'value', 'note'], allowed).kept
      .slice(0, 4)
      .map((t: any) => ({ label: String(t.label || ''), value: String(t.value || ''), note: t.note ? String(t.note) : undefined, tone: 'good' as const }));
  } catch {
    return [];
  }
}

/**
 * Generate the consultant sections. Each LLM block is independent — a failure
 * in one records its name in `failed` and the rest still render.
 */
export async function generateSeoPlanDraft(input: SeoPlanInput): Promise<ISeoPlanDraft> {
  const depth: ReportDepth = input.depth === 'full' ? 'full' : 'free';
  input.depth = depth;

  const draft: ISeoPlanDraft = {
    depth,
    grounded: 1,
    performanceSnapshot: buildCoreSnapshot(input),
    // Projected improvement timeline: today's measured rank, then work
    // milestones. The old fixed rank bands ("#4–7", "Top 3") are gone.
    rankTimeline: buildRankTimeline(input),
    competitorLandscape: buildCompetitorLandscape(input),
    competitorInsights: buildInsights(input),
    websiteSummary: !input.website
      ? { url: '', status: 'none', services: [] }
      : input.websiteIntel
      ? {
          url: input.websiteIntel.origin,
          status: input.websiteIntel.status,
          services: websiteServicesOf(input).slice(0, 12),
          description: input.websiteIntel.description?.value,
          readAt: input.websiteIntel.fetchedAt ? new Date(input.websiteIntel.fetchedAt).toISOString() : undefined,
        }
      : undefined,
    criticalGap: buildCriticalGap(input),
    whatWeAimFor: buildWhatWeAimFor(input),
    dataRequired: buildDataRequired(input, depth),
    failed: [],
  };

  const hasOwnerData = !!(input.usps || input.offers || input.services);
  const tasks = [callNarrative(input), callGbpDrafts(input), callActionPlan(input)];
  if (hasOwnerData) tasks.push(callSnapshotTiles(input) as any);

  const [narrative, gbp, action, tiles] = await Promise.allSettled(tasks);

  if (narrative.status === 'fulfilled') Object.assign(draft, narrative.value);
  else { draft.failed!.push('narrative'); console.warn('[seoPlanEngine] narrative failed:', (narrative as PromiseRejectedResult).reason?.message); }

  if (gbp.status === 'fulfilled') Object.assign(draft, gbp.value);
  else {
    draft.failed!.push('gbpDrafts');
    console.warn('[seoPlanEngine] gbpDrafts failed:', (gbp as PromiseRejectedResult).reason?.message);
    // The gap STATUS per field is deterministic (verified field states), so
    // it still ships; only the AI-written drafts are missing.
    draft.gbpGaps = deterministicGbpGaps(input);
    draft.suggestedServices = input.fieldStates['Services Listed'] === 'verified_present' ? [] : input.verifiedServices.slice(0, 16);
  }

  if (action.status === 'fulfilled') Object.assign(draft, action.value);
  else { draft.failed!.push('actionPlan'); console.warn('[seoPlanEngine] actionPlan failed:', (action as PromiseRejectedResult).reason?.message); }

  if (tiles && tiles.status === 'fulfilled' && Array.isArray(tiles.value) && tiles.value.length) {
    draft.performanceSnapshot = [...(draft.performanceSnapshot || []), ...tiles.value];
  }

  // Qualify any "100% complete" that slipped into generated prose.
  const fact = buildCompletionPromptFact(input.profileCompletion);
  const pending = Number(input.profileCompletion?.oauthPendingCount ?? input.profileCompletion?.unknownCount ?? 0);
  draft.keyFinding = draft.keyFinding ? qualifyCompletionInProse(draft.keyFinding, fact, pending) : undefined;
  draft.websiteAssessment = draft.websiteAssessment ? qualifyCompletionInProse(draft.websiteAssessment, fact, pending) : undefined;
  draft.competitorCounterPosition = draft.competitorCounterPosition ? qualifyCompletionInProse(draft.competitorCounterPosition, fact, pending) : undefined;
  if (Array.isArray(draft.marketOpportunities)) {
    draft.marketOpportunities = draft.marketOpportunities.map((m) => ({
      ...m,
      rationale: qualifyCompletionInProse(m.rationale, fact, pending),
    }));
  }

  // Without a live GBP read, prose may not assert what the profile contains:
  // "Your GBP is missing X" → "Verify whether your Google Business Profile lists X".
  const gbpRead = !!input.gbpRead;
  const fix = (t?: string) => repairUnverifiedGbpClaims(t, gbpRead);
  draft.keyFinding = fix(draft.keyFinding);
  draft.websiteAssessment = fix(draft.websiteAssessment);
  draft.competitorCounterPosition = fix(draft.competitorCounterPosition);
  draft.keywordInsights = draft.keywordInsights?.map((t) => fix(t) || t);
  draft.marketOpportunities = draft.marketOpportunities?.map((m) => ({ ...m, rationale: fix(m.rationale) || m.rationale }));
  draft.actionPhases = draft.actionPhases?.map((p) => ({
    ...p,
    items: p.items.map((it: any) => ({ ...it, title: fix(it.title) || it.title, detail: fix(it.detail) || it.detail })),
  }));
  draft.gbpGaps = draft.gbpGaps?.map((g) => ({ ...g, whyItMatters: fix(g.whyItMatters) || g.whyItMatters, recommendation: fix(g.recommendation) || g.recommendation }));

  // Invented businesses / services: sentences naming a business that is not
  // in the ranking results, or a service no verified/website source states,
  // are removed (never rewritten into something else).
  const invented = inventedClaimChecker(claimContextOf(input));
  const repairs: string[] = [];
  const why = (sn: string) => {
    const ctx = claimContextOf(input);
    const name = namesUnknownBusiness(sn, ctx);
    return name ? `unknown business "${name}"` : `unverified service "${claimsUnknownService(sn, ctx)}"`;
  };
  const scrub = (t: string | undefined, where: string) => {
    if (!t) return t;
    const removed = (String(t).match(/[^.!?]+[.!?]*/g) || []).filter(invented);
    removed.forEach((sn) => repairs.push(`${where}: removed sentence with ${why(sn)} — "${sn.trim().slice(0, 90)}"`));
    return removed.length ? dropUnsupportedSentences(t, invented) : t;
  };
  const flagged = (t: string, where: string) => {
    const bad = (String(t || '').match(/[^.!?]+[.!?]*/g) || []).find(invented);
    if (bad) repairs.push(`${where}: dropped item with ${why(bad)} — "${String(t).slice(0, 90)}"`);
    return !!bad;
  };
  draft.keyFinding = scrub(draft.keyFinding, 'keyFinding');
  draft.websiteAssessment = scrub(draft.websiteAssessment, 'websiteAssessment');
  draft.competitorCounterPosition = scrub(draft.competitorCounterPosition, 'competitorCounterPosition');
  draft.uspLine = scrub(draft.uspLine, 'uspLine');
  draft.suggestedDescription = scrub(draft.suggestedDescription, 'suggestedDescription');
  draft.keywordInsights = draft.keywordInsights?.filter((t) => !flagged(t, 'keywordInsight'));
  draft.marketOpportunities = draft.marketOpportunities?.map((m) => ({ ...m, rationale: scrub(m.rationale, 'opportunity') || '' }));
  draft.actionPhases = draft.actionPhases?.map((p) => ({
    ...p,
    items: p.items
      .filter((it: any) => !flagged(it.title, 'actionItem'))
      .map((it: any) => ({ ...it, detail: scrub(it.detail, 'actionItem') || '' })),
  }));
  draft.weeklyPostThemes = draft.weeklyPostThemes?.filter((p) => !flagged(p.theme, 'post'));
  draft.suggestedQas = draft.suggestedQas?.filter((q) => !flagged(`${q.q} ${q.a}`, 'qa'));
  draft.gbpGaps = draft.gbpGaps?.map((g) => ({ ...g, recommendation: scrub(g.recommendation, 'gbpGap') || 'Confirm this field in Google Business Profile.' }));
  if (repairs.length) draft.repairs = repairs;

  return draft;
}

/** Everything a sentence may legitimately name: real businesses, places and stated services. */
export function claimContextOf(input: SeoPlanInput): ClaimContext {
  const wi = input.websiteIntel;
  return {
    businessNames: [input.businessName, ...input.competitors.map((c) => c.name)],
    places: [input.city, input.area || '', input.state || '', input.country || '', ...input.neighbourhoods].filter(Boolean),
    serviceTerms: [
      ...input.verifiedServices,
      ...websiteServicesOf(input),
      wi?.description?.value || '',
      ...(wi?.credentials || []).map((c: any) => c.value),
      input.category,
      input.websiteSearchTerm || '',
      input.publicProfile?.category || '',
      ...(input.publicProfile?.additionalCategories || []),
      input.services || '', input.usps || '', input.offers || '',
      ...input.keywordTable.map((k) => k.keyword),
    ].filter(Boolean),
  };
}
