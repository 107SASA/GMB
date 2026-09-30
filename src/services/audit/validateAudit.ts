/**
 * Pre-COMPLETED validation for the audit report, plus the guard that keeps
 * AI-written prose from introducing numbers the facts don't contain.
 *
 * validateAudit() checks every rule that can be checked mechanically (the
 * "validation before completed" list of the Sep 2026 correctness pass).
 * Problems are auto-repaired where that is safe (unsupported items removed)
 * and always recorded on auditData.validation so they are visible to
 * support — a narrative problem never blocks the customer's report.
 *
 * Pure: no I/O, no `@/` imports (runs under `node --test`).
 */

import { competitorKey, LOCAL_PACK_WINDOW, normalizeName } from './facts.ts';
import type { CompetitorFact, SearchObservation, ReviewFacts, SuspensionRisk } from './facts.ts';
import { GROWWMATICS_CAPABILITIES, opportunityLabel } from './findings.ts';
import type { Evidence, Finding, KeywordRow } from './findings.ts';

const ACTIONABILITY = new Set(['directly_fixable', 'indirectly_influenceable', 'monitor_only', 'not_actionable', 'unknown']);

export interface ValidatableAudit {
  targetName: string;
  targetPlaceId?: string | null;
  observations: SearchObservation[];
  competitors: CompetitorFact[];
  competitorsAheadCount: number;
  averageObservedRank: number | null;
  reviews: ReviewFacts;
  displayedReviewCount?: number | null;
  evidence: Evidence[];
  findings: Finding[];
  reviewThemes?: { praises?: string[]; complaints?: string[] } | 'unknown' | null;
  suspensionRisk: SuspensionRisk & { pct?: unknown };
  marketOpportunities?: Array<{ keyword: string; potential: string }>;
  keywordRows: KeywordRow[];
  /** Profile checklist + the percentage shown (single formula check). */
  checklist?: Array<{ field: string; status: string }>;
  completionPercentage?: number;
  /** Review values shown in the report (null = unknown). */
  displayedReviewsPerWeek?: number | null;
}

export interface ValidationResult {
  /** false = unrepairable problems remain; the audit must not reach the customer. */
  ok: boolean;
  errors: string[];
  /** What was removed/repaired so the report stays supportable. */
  repairs: string[];
}

const CHECKLIST_STATUSES = new Set(['Complete', 'Partial', 'Missing', 'Unknown']);

export function validateAudit(a: ValidatableAudit): ValidationResult {
  const errors: string[] = [];
  const repairs: string[] = [];

  // Ranking: no sentinel ranks, failures are not "not found", average over found only.
  for (const o of a.observations) {
    if (o.rank != null && (o.rank > LOCAL_PACK_WINDOW || o.rank < 1)) errors.push(`rank ${o.rank} outside 1..${LOCAL_PACK_WINDOW} for "${o.keyword}"`);
    if (!o.found && o.rank != null) errors.push(`not-found search "${o.keyword}" carries a rank`);
    if (o.status === 'unavailable' && (o.found || o.ahead.length > 0)) errors.push(`failed search "${o.keyword}" has results`);
  }
  const foundRanks = a.observations.filter((o) => o.status === 'ok' && o.found && o.rank != null).map((o) => o.rank as number);
  const expectedAvg = foundRanks.length ? Math.round((foundRanks.reduce((x, y) => x + y, 0) / foundRanks.length) * 10) / 10 : null;
  if (expectedAvg !== a.averageObservedRank) errors.push(`averageObservedRank ${a.averageObservedRank} != ${expectedAvg} (found searches only)`);

  // Competitors: real, deduped, target excluded — repaired in place (the
  // count is re-derived from the repaired list).
  const keys = new Set<string>();
  const target = normalizeName(a.targetName);
  const keptCompetitors: CompetitorFact[] = [];
  for (const c of a.competitors) {
    if (!c.name) { repairs.push('removed competitor without a name'); continue; }
    if (c.source !== 'dataforseo' && c.source !== 'google_places') { repairs.push(`removed competitor "${c.name}" without a real source`); continue; }
    const k = competitorKey(c);
    if (keys.has(k)) { repairs.push(`removed duplicate competitor "${c.name}"`); continue; }
    if ((a.targetPlaceId && c.placeId === a.targetPlaceId) || (target && normalizeName(c.name) === target)) {
      repairs.push(`removed the business itself from its competitor list ("${c.name}")`);
      continue;
    }
    if (c.similarityScore !== null) {
      repairs.push(`cleared fabricated similarityScore on "${c.name}"`);
      (c as any).similarityScore = null;
    }
    keys.add(k);
    keptCompetitors.push(c);
  }
  a.competitors = keptCompetitors;
  if (a.competitorsAheadCount !== keptCompetitors.length) {
    repairs.push(`competitorsAhead ${a.competitorsAheadCount} → ${keptCompetitors.length} (re-derived from real businesses)`);
    a.competitorsAheadCount = keptCompetitors.length;
  }

  // Profile: valid states and the single completion formula.
  if (a.checklist) {
    for (const c of a.checklist) {
      if (!CHECKLIST_STATUSES.has(c.status)) errors.push(`invalid profile state "${c.status}" for ${c.field}`);
    }
    if (a.completionPercentage != null) {
      const complete = a.checklist.filter((c) => c.status === 'Complete' || c.status === 'Partial').length;
      const missing = a.checklist.filter((c) => c.status === 'Missing').length;
      const expected = complete + missing > 0 ? Math.round((complete / (complete + missing)) * 100) : 0;
      if (expected !== a.completionPercentage) errors.push(`completion ${a.completionPercentage}% != ${expected}% (Complete ÷ checked)`);
    }
  }

  // Reviews: lifetime is what is displayed as the total.
  if (
    a.reviews.lifetime.status === 'verified' &&
    a.displayedReviewCount != null &&
    a.displayedReviewCount !== a.reviews.lifetime.totalCount
  ) {
    errors.push(`displayed review count ${a.displayedReviewCount} != lifetime ${a.reviews.lifetime.totalCount}`);
  }

  // Reviews per week only from a synced window — never a placeholder.
  if (a.reviews.recent.status !== 'verified' && a.displayedReviewsPerWeek != null) {
    errors.push(`reviews/week ${a.displayedReviewsPerWeek} shown without a synced review window`);
  }
  if (a.reviews.lifetime.status !== 'verified' && a.displayedReviewCount != null) {
    errors.push(`review total ${a.displayedReviewCount} shown but the lifetime count is unknown`);
  }

  // Review themes need review text.
  if (a.reviewThemes && a.reviewThemes !== 'unknown' && a.reviews.recent.textSampleCount === 0) {
    const t = a.reviewThemes;
    if ((t.praises?.length || 0) + (t.complaints?.length || 0) > 0) {
      repairs.push('removed review themes generated without review text');
    }
    a.reviewThemes = 'unknown';
  }

  // Findings: evidence exists, actionability + capability are valid.
  const evidenceIds = new Set(a.evidence.map((e) => e.id));
  const keptFindings: Finding[] = [];
  for (const f of a.findings) {
    const missingEv = f.evidenceIds.filter((id) => !evidenceIds.has(id));
    if (!f.evidenceIds.length || missingEv.length) {
      repairs.push(`removed finding "${f.id}" without evidence`);
      continue;
    }
    if (!ACTIONABILITY.has(f.actionability)) {
      repairs.push(`removed finding "${f.id}" with invalid actionability`);
      continue;
    }
    if (f.growwmaticsCapability && !(f.growwmaticsCapability in GROWWMATICS_CAPABILITIES)) {
      repairs.push(`cleared unverified capability on "${f.id}"`);
      f.growwmaticsCapability = null;
    }
    keptFindings.push(f);
  }
  a.findings = keptFindings;

  // Suspension risk is a category, never a percentage.
  if ('pct' in a.suspensionRisk && a.suspensionRisk.pct != null) {
    repairs.push('removed suspension-risk percentage');
    delete a.suspensionRisk.pct;
  }

  // Opportunity labels must be derivable from real demand + rank.
  if (a.marketOpportunities?.length) {
    const byKw = new Map(a.keywordRows.map((r) => [r.keyword.toLowerCase(), r]));
    const kept = a.marketOpportunities.filter((m) => {
      const row = byKw.get(String(m.keyword || '').toLowerCase());
      const ok = !!row && opportunityLabel(row) === m.potential;
      if (!ok) repairs.push(`removed unsupported opportunity label "${m.potential}" on "${m.keyword}"`);
      return ok;
    });
    a.marketOpportunities = kept;
  }

  return { ok: errors.length === 0, errors, repairs };
}

// ── AI grounding ───────────────────────────────────────────────────────────

/** Numbers that are structural in prose, not claims ("top 3", "30 days"). */
const STRUCTURAL_NUMBERS = ['1', '2', '3', '4', '5', '7', '10', '14', '15', '20', '21', '30', '45', '60', '90', '100', '150', '750'];

export function numbersIn(text: string): string[] {
  return (String(text || '').match(/\d+(?:\.\d+)?/g) || []).map((n) => String(Number(n)));
}

/** Every number a narrative may legitimately cite, from the facts object. */
export function allowedNumbersFrom(values: unknown): Set<string> {
  const out = new Set<string>(STRUCTURAL_NUMBERS);
  const walk = (v: unknown) => {
    if (v == null) return;
    if (typeof v === 'number' && Number.isFinite(v)) {
      out.add(String(v));
      out.add(String(Math.round(v)));
      out.add(String(Math.round(v * 10) / 10));
      if (v > 0 && v <= 1) out.add(String(Math.round(v * 100))); // rates shown as %
      return;
    }
    if (typeof v === 'string') {
      numbersIn(v).forEach((n) => out.add(n));
      return;
    }
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(values);
  return out;
}

/**
 * Keeps an AI-written item only if every number in its text appears in the
 * facts. Returns the kept items and what was dropped (for the repair log).
 */
export function groundItems<T extends Record<string, unknown>>(
  items: T[] | undefined,
  textKeys: string[],
  allowed: Set<string>,
): { kept: T[]; dropped: string[] } {
  const kept: T[] = [];
  const dropped: string[] = [];
  for (const item of items || []) {
    if (!item || typeof item !== 'object') continue;
    const text = textKeys.map((k) => String(item[k] ?? '')).join(' ');
    const unknown = numbersIn(text).filter((n) => !allowed.has(n));
    if (unknown.length) dropped.push(`${String(item.title ?? text.slice(0, 40))} (unsupported numbers: ${unknown.join(', ')})`);
    else kept.push(item);
  }
  return { kept, dropped };
}

/** Same guard for a single prose string: returns null when unsupported. */
export function groundText(text: string | undefined, allowed: Set<string>): string | undefined {
  if (!text) return text;
  return numbersIn(text).every((n) => allowed.has(n)) ? text : undefined;
}

// ── Capability claims ──────────────────────────────────────────────────────

/**
 * True when AI prose promises that GrowwMatics / "we" will change a Google
 * field the product cannot write (categories, services, hours, attributes,
 * Q&A). Such items are dropped rather than shown.
 */
export function claimsUnsupportedCapability(text: string): boolean {
  const t = String(text || '').toLowerCase();
  if (!/\b(we|we'll|growwmatics|our team|our platform)\b/.test(t)) return false;
  return /\b(we|we'll|growwmatics|our team|our platform)\b[^.]{0,60}\b(will|can|'ll)?\s*(add|update|change|set|edit|post|publish|write)\b[^.]{0,60}\b(categor(y|ies)|services?\b|hours|opening hours|attributes?|q&as?|questions? and answers?)/.test(t);
}

// ── Causation / unsupported-claim sentence filter ─────────────────────────

/** A sentence asserting that something causes / limits ranking or visibility. */
export function claimsCausation(text: string): boolean {
  const t = String(text || '').toLowerCase();
  return (
    /\b(contribut\w*|lead(s|ing)? to|result\w* in|caus\w*|because|due to|hurt\w*|drag\w*|limit\w*|threaten\w*|hold\w* back|keep\w* (you|it|the business) from)\b[^.]{0,80}\b(rank\w*|visibility|position|search results)\b/.test(t) ||
    /\b(rank\w*|visibility|position)\b[^.]{0,50}\b(because|due to|caused by|as a result of)\b/.test(t) ||
    /\bwhy\b[^.]{0,40}\b(is ?n[o']t|not|isn't) (ranking|visible)\b/.test(t)
  );
}

/**
 * Predicted business outcomes we have no data for: "30 more calls",
 * "2x more leads", "₹50,000 extra revenue", "you will rank #1". Structural
 * numbers (30-day plans) pass the number check, so outcomes need their own.
 */
export function claimsFabricatedOutcome(sentence: string): boolean {
  const s = String(sentence || '');
  return (
    /\b\d[\d,.]*\s*(?:%|x|×|times)?\s*(?:more|extra|additional|new)\s+(?:calls?|customers?|leads?|enquir\w*|inquir\w*|visits?|visitors?|bookings?|sales|clients?|revenue|footfall|walk-ins?)\b/i.test(s) ||
    /(?:₹|rs\.?|inr|\$)\s*\d[\d,.]*\s*(?:k|lakh|crore)?\s*(?:more|extra|additional|in)?\s*(?:revenue|sales|income|profit)/i.test(s) ||
    /\b(?:increase|boost|grow|double|triple)\w*\s+(?:your\s+)?(?:calls|customers|leads|revenue|sales|bookings)\s+by\s+\d/i.test(s) ||
    /\byou will (?:rank|reach|get|receive|appear)\b[^.]*(?:#\d|top\s*\d|\d+\s+(?:more|extra))/i.test(s)
  );
}

/**
 * Removes individual sentences that fail a check (causal claims, or
 * `extraBad`), keeping the rest of an AI paragraph. Returns undefined when
 * nothing supportable is left.
 */
export function dropUnsupportedSentences(text: string | undefined, extraBad?: (sentence: string) => boolean): string | undefined {
  if (!text) return text;
  const sentences = String(text).match(/[^.!?]+[.!?]*/g) || [String(text)];
  const kept = sentences.filter((sn) => !claimsCausation(sn) && !claimsFabricatedOutcome(sn) && !(extraBad && extraBad(sn)));
  const out = kept.join('').replace(/\s+/g, ' ').trim();
  return out.length ? out : undefined;
}

// ── Unverified GBP claims ──────────────────────────────────────────────────

/**
 * When the Google Business Profile was NOT read, AI prose must not assert
 * what it contains ("Your GBP is missing CCTV installation"). Such sentences
 * are repaired into a verification step instead of being deleted, so the
 * recommendation survives: "Verify whether your Google Business Profile
 * lists CCTV installation."
 */
export function repairUnverifiedGbpClaims(text: string | undefined, gbpRead: boolean): string | undefined {
  if (!text || gbpRead) return text;
  const subject = String.raw`(?:your |the )?(?:google business profile|gbp|google profile|business profile|google listing|listing)`;
  const missing = new RegExp(String.raw`\b${subject}\s+(?:is missing|lacks|does not (?:list|include|have|show)|doesn't (?:list|include|have|show)|has no|is not showing|isn't showing)\s+([^.!?]+)`, 'gi');
  let out = text.replace(missing, (_m, what) => `verify whether your Google Business Profile lists ${String(what).trim()}`);
  const noX = new RegExp(String.raw`\b(?:there (?:is|are) )?no\s+([^.!?]{3,60}?)\s+(?:on|in)\s+${subject}\b`, 'gi');
  out = out.replace(noX, (_m, what) => `verify whether your Google Business Profile lists ${String(what).trim()}`);
  // Capitalise a repaired sentence start.
  return out.replace(/(^|[.!?]\s+)verify whether/g, (_m, p) => `${p}Verify whether`);
}

/**
 * True when text asserts what the Google Business Profile does or does not
 * contain ("Services Not Reflected on GBP", "GBP lacks attributes"). Only
 * allowed when the GBP was read or the claim rests on a verified-missing field.
 */
export function assertsGbpContent(text: string): boolean {
  const t = String(text || '');
  const gbp = /\b(gbp|google business profile|google profile)\b/i;
  const absent = /\b(missing|not (reflected|listed|shown|included|present|added)|lacks?|absent|does ?n[o']t (list|include|have|show)|has no|without)\b/i;
  return gbp.test(t) && absent.test(t);
}

// ── Invented businesses / services ─────────────────────────────────────────

export interface ClaimContext {
  /** The target and every real competitor name from the ranking results. */
  businessNames: string[];
  /** City, area, state, neighbourhoods — real places only. */
  places: string[];
  /** Verified / owner / website-stated services, category, measured keywords. */
  serviceTerms: string[];
}

/** Capitalised words that start sentences or name our own products — never a business. */
const NAME_STARTERS = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'for', 'by', 'with', 'and', 'or', 'but', 'your', 'you', 'their', 'its', 'our',
  'businesses', 'competitors', 'competitor', 'searchers', 'customers', 'google', 'maps', 'business', 'profile', 'search',
  'growwmatics', 'whatsapp', 'ads', 'this', 'these', 'those', 'while', 'although', 'both', 'several', 'many', 'top',
  'focus', 'add', 'ask', 'use', 'keep', 'reply', 'publish', 'post', 'update', 'verify', 'check', 'highlight', 'mention',
]);
const COMPETITOR_CONTEXT = /\b(competitors?|rivals?|above you|ahead of|outrank\w*|shown above|appear\w* above|businesses (?:like|such as)|such as|including|compared (?:to|with)|than)\b/i;
const OWN_WORDS = /^(Google|Business|Profile|Maps|Search|Ads|GrowwMatics|WhatsApp|Q&A|GBP|SEO|AI|IT|ERP|SaaS|MVP|USP|CTA|FAQ|Week|Day|Month|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/;

function mentionsKnown(candidate: string, known: string[]): boolean {
  const c = normalizeName(candidate);
  if (!c) return true;
  return known.some((k) => {
    const n = normalizeName(k);
    return !!n && (n.includes(c) || c.includes(n));
  });
}

/** A Title-Case multi-word name in a competitor context that is not a real business or place. */
export function namesUnknownBusiness(sentence: string, ctx: ClaimContext): string | null {
  if (!COMPETITOR_CONTEXT.test(sentence)) return null;
  // A Title Case heading ("Fewer Reviews Than Competitors") is not a name:
  // skip text where most words are capitalised.
  const words = sentence.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length && words.filter((w) => /^[A-Z]/.test(w)).length / words.length > 0.6) return null;
  const seqs = sentence.match(/(?:[A-Z][\w'’&.-]*(?:\s+|$)){2,}/g) || [];
  for (const raw of seqs) {
    let words = raw.trim().split(/\s+/);
    while (words.length && (NAME_STARTERS.has(words[0].toLowerCase()) || OWN_WORDS.test(words[0]))) words = words.slice(1);
    words = words.filter((w) => !OWN_WORDS.test(w));
    if (words.length < 2) continue;
    const cand = words.join(' ');
    if (mentionsKnown(cand, [...ctx.businessNames, ...ctx.places, ...ctx.serviceTerms])) continue;
    return cand;
  }
  return null;
}

const SERVICE_STOP = new Set([
  'services', 'service', 'solutions', 'quality', 'high', 'local', 'customers', 'customer', 'business', 'businesses',
  'professional', 'reliable', 'range', 'various', 'clients', 'client', 'best', 'expert', 'experts', 'expertise',
  'complete', 'full', 'wide', 'including', 'such', 'like', 'other', 'more', 'their', 'your', 'with', 'from', 'that',
  'offers', 'offer', 'provides', 'provide', 'support', 'help', 'end-to-end', 'team', 'experience', 'area', 'city',
  // Listing / website features, not services ("provides an online booking link").
  'online', 'booking', 'book', 'link', 'links', 'website', 'contact', 'appointment', 'appointments', 'consultation',
  'quote', 'quotes', 'free', 'details', 'information', 'hours', 'photos', 'reviews', 'phone', 'number',
]);
const serviceWords = (s: string) =>
  String(s || '').toLowerCase().replace(/&/g, ' ').split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !SERVICE_STOP.has(w));

/**
 * "X offers/provides/specialises in A, B and C" where an item shares no
 * meaningful word with any verified, owner or website-stated term.
 */
/** An item names a SERVICE (not a feature, adjective or trailing clause) only with one of these nouns. */
const SERVICE_NOUN_RE = /\b(services?|installation|repairs?|development|design|marketing|consult\w*|training|courses?|classes|coaching|cleaning|treatments?|therapy|clinic|catering|photography|printing|plumbing|electrical|construction|renovation|maintenance|management|accounting|legal|tuition|lessons?|software|apps?|seo|automation|delivery|rentals?|hosting|testing|audits?|care|surgery|dental|salon|spa|tours?|insurance|loans?)\b/i;

export function claimsUnknownService(sentence: string, ctx: ClaimContext): string | null {
  const m = sentence.match(/\b(?:offers?|offering|provides?|providing|specializ\w* in|specialis\w* in|known for|services? (?:include|such as|like))\s+([^.;:!?]+)/i);
  if (!m) return null;
  const known = new Set(ctx.serviceTerms.flatMap(serviceWords));
  if (!known.size) return null; // nothing verified to compare against — the prompt rules apply
  // Stop at the end of the list: ", showing …", ", which …", " — …" are commentary, not services.
  const list = m[1].split(/,\s*(?:showing|which|while|making|helping|giving|so that|to help|so)\b|\s[—–-]\s|—/i)[0];
  const items = list.split(/,|\band\b|\bor\b/i).map((x) => x.trim()).filter(Boolean);
  for (const item of items) {
    if (!SERVICE_NOUN_RE.test(item)) continue;
    const w = serviceWords(item);
    if (w.length && !w.some((x) => known.has(x) || [...known].some((k) => k.startsWith(x.slice(0, 5)) && x.length >= 5))) return item;
  }
  return null;
}

/** Sentence predicate for dropUnsupportedSentences: invented business or service. */
export function inventedClaimChecker(ctx: ClaimContext): (sentence: string) => boolean {
  return (sn) => !!namesUnknownBusiness(sn, ctx) || !!claimsUnknownService(sn, ctx);
}
