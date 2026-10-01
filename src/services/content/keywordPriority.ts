/**
 * Weekly keyword prioritisation — pure (runs under `node --test`).
 *
 * Decides WHICH keyword each weekly post targets, from data already stored:
 *   - the audit's measured Google Maps ranks (SeoPlan.keywordTable)
 *   - search volume, only where it was actually measured (demandStatus 'measured')
 *   - Google Business Profile search terms with Google-reported impressions
 *   - relevance to verified services / categories, and to the business's area
 *   - what recent posts already targeted
 *
 * Rules: nothing is invented. A rank, a volume or a customer search term is
 * used only when present in that stored data; a keyword that matches no
 * verified service/category, contains the business name, or carries a claim
 * word the post fact-check would reject ("best", "top", …) is never an
 * opportunity. Proposed (unmeasured) keywords are never scored as
 * opportunities — they stay a separate, labelled fallback. The reason stored
 * on each post is built only from the evidence it actually had.
 */

export interface MeasuredKeywordRow {
  keyword: string;
  rank?: number | null;
  mapsRank?: number | null;
  found?: boolean | null;
  rankStatus?: 'ok' | 'unavailable' | string | null;
  searchVolume?: number | null;
  demandStatus?: 'measured' | 'unavailable' | string | null;
}

export interface SearchTermRow { keyword: string; impressions: number; year?: number; month?: number }

export interface KeywordEvidence {
  source: 'measured' | 'gbp_search_terms' | 'proposed';
  /** Observed Google Maps position (1–20) when found and the check succeeded. */
  rank?: number;
  /** The rank check ran and the business was not in the top 20. */
  notFound?: boolean;
  /** Monthly searches — only when measured. */
  searchVolume?: number;
  /** Impressions Google reported for this search term on the profile. */
  impressions?: number;
  /** "2026-09" — the month the search-term data covers. */
  period?: string;
  /** Verified service / category the keyword matches. */
  matchedTerm?: string;
  local: boolean;
}

export interface KeywordPick {
  keyword: string;
  measured: boolean;
  score: number;
  reason: string;
  evidence: KeywordEvidence;
}

export interface PriorityInput {
  businessName: string;
  /** Verified services + category (owner, website, GBP). */
  serviceTerms: string[];
  /** City / area names of this business. */
  places: string[];
  measured: MeasuredKeywordRow[];
  searchTerms: SearchTermRow[];
  proposed: string[];
  /** Keywords targeted by posts in the last few weeks (most recent first). */
  recentlyTargeted: string[];
}

export interface PriorityResult {
  /** Highest-value measured SEO opportunity. */
  seo: KeywordPick | null;
  /** Best customer search term from Google Business Profile data. */
  search: KeywordPick | null;
  /** Best local "service + area" opportunity. */
  local: KeywordPick | null;
  /** Every scored candidate (for tests / debugging), best first. */
  ranked: KeywordPick[];
  /** Candidates rejected and why (never selected). */
  rejected: Array<{ keyword: string; why: string }>;
}

const norm = (s: string) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9ऀ-ॿ\s]/g, ' ').replace(/\s+/g, ' ').trim();
const stem = (w: string) => w.replace(/(ings|ing|ers|er|es|s)$/, '');
const FILLER = new Set(['near', 'me', 'in', 'the', 'and', 'for', 'of', 'a', 'to', 'at', 'my', 'nearby', 'shop', 'store', 'services', 'service', 'company', 'agency', 'center', 'centre']);
/** Claim words the post fact-check rejects — a keyword carrying one can't be used verbatim in a post. */
const CLAIM_WORDS = /\b(best|top|top rated|no 1|number one|cheapest|leading|premier|famous|trusted|award|certified|guaranteed)\b/;

const NAME_GENERIC = new Set([
  'pvt', 'ltd', 'private', 'limited', 'llp', 'inc', 'co', 'and', 'the', 'company', 'enterprises', 'enterprise', 'solutions',
  'services', 'service', 'works', 'traders', 'trading', 'industries', 'group', 'studio', 'hub', 'point', 'centre', 'center',
  'shop', 'store', 'mart', 'agency', 'associates', 'india', 'global', 'international', 'technologies', 'technology', 'tech',
  'top', 'best', 'new', 'shree', 'shri', 'sri',
]);

/**
 * The business's brand words: its full distinctive name phrase plus the first
 * distinctive word ("Sahyadri Tile Works" → ["sahyadri"]). Generic words
 * (works, traders, services, the category's own words) are never brand words,
 * so "tile works nashik" is not mistaken for a brand search.
 */
export function brandWords(businessName: string, serviceTerms: string[]): string[] {
  const generic = new Set(serviceTerms.flatMap((t) => norm(t).split(' ')).map(stem));
  const head = String(businessName || '').split(/\s[-–|]\s|,|\(/)[0];
  const words = norm(head).split(' ').filter((w) => w.length > 2 && !NAME_GENERIC.has(w) && !generic.has(stem(w)));
  return words.length ? [words[0]] : [];
}

function matchService(keyword: string, serviceTerms: string[], places: string[]): string | null {
  const placeWords = new Set(places.flatMap((p) => norm(p).split(' ')));
  const kw = norm(keyword).split(' ').filter((w) => w.length > 2 && !FILLER.has(w) && !placeWords.has(w)).map(stem);
  if (!kw.length) return null;
  for (const term of serviceTerms) {
    const tw = norm(term).split(' ').filter((w) => w.length > 2 && !FILLER.has(w)).map(stem);
    if (tw.some((w) => kw.includes(w))) return term;
  }
  return null;
}

const isLocal = (keyword: string, places: string[]) => {
  const k = ` ${norm(keyword)} `;
  return places.some((p) => p && k.includes(` ${norm(p)} `)) || /\bnear me\b/.test(k);
};

const rankOf = (r: MeasuredKeywordRow): number | null => {
  const v = r.rank ?? r.mapsRank;
  return typeof v === 'number' && v >= 1 && v <= 20 ? Math.round(v * 10) / 10 : null;
};

/** 0–1: positions 4–10 are the biggest win, 11–20 next, not found next, top 3 = maintain. */
function opportunity(e: KeywordEvidence): number {
  if (e.rank != null) return e.rank <= 3 ? 0.2 : e.rank <= 10 ? 1 : 0.8;
  if (e.notFound) return 0.6;
  return 0;
}
const demandScore = (v?: number) => (v && v > 0 ? Math.min(1, Math.log10(v + 1) / 3) : 0);
const impressionScore = (i?: number) => (i && i > 0 ? Math.min(1, Math.log10(i + 1) / 2.5) : 0);

/** The stored reason — built only from the evidence present. */
export function reasonFor(e: KeywordEvidence): string {
  const parts: string[] = [];
  if (e.rank != null) parts.push(`the business was observed at #${e.rank} on Google Maps for this measured keyword`);
  else if (e.notFound) parts.push('the business was not found in the top 20 on Google Maps for this measured keyword');
  if (e.searchVolume != null) parts.push(`the keyword has ${e.searchVolume} measured monthly searches`);
  if (e.impressions != null) parts.push(`Google reported ${e.impressions} impressions for this search on the profile${e.period ? ` (${e.period})` : ''}`);
  if (!parts.length) return e.source === 'proposed' ? 'From the SEO plan’s proposed keywords — not measured.' : '';
  const s = `Selected because ${parts.join(' and ')}`;
  return `${s}${e.matchedTerm ? `; it matches the verified service "${e.matchedTerm}"` : ''}.`;
}

export function prioritizeKeywords(input: PriorityInput): PriorityResult {
  const rejected: PriorityResult['rejected'] = [];
  const brand = brandWords(input.businessName, input.serviceTerms);
  const recent = input.recentlyTargeted.map(norm);
  const seen = new Set<string>();

  const screen = (keyword: string): { ok: true; matched: string } | { ok: false } => {
    const k = norm(keyword);
    if (!k) return { ok: false };
    if (brand.some((b) => k.split(' ').includes(b))) { rejected.push({ keyword, why: 'brand-name keyword' }); return { ok: false }; }
    if (CLAIM_WORDS.test(k)) { rejected.push({ keyword, why: 'contains a claim word the post fact-check rejects' }); return { ok: false }; }
    const matched = matchService(keyword, input.serviceTerms, input.places);
    if (!matched) { rejected.push({ keyword, why: 'matches no verified service or category' }); return { ok: false }; }
    return { ok: true, matched };
  };

  const ranked: KeywordPick[] = [];
  const push = (keyword: string, evidence: KeywordEvidence) => {
    const base = 0.5 * opportunity(evidence) + 0.3 * demandScore(evidence.searchVolume) + 0.2 * impressionScore(evidence.impressions) + (evidence.local ? 0.1 : 0);
    if (base <= 0) { rejected.push({ keyword, why: 'no measured rank, measured demand or Google search data' }); return; }
    const recency = recent.indexOf(norm(keyword));
    const score = Math.round(base * (recency === -1 ? 1 : 0.3) * 1000) / 1000;
    ranked.push({ keyword, measured: evidence.source === 'measured', score, reason: reasonFor(evidence), evidence });
  };

  // Measured keywords (audit rank / measured demand).
  for (const r of input.measured) {
    const k = norm(r.keyword);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const s = screen(r.keyword);
    if (!s.ok) continue;
    const rankOk = (r.rankStatus ?? 'ok') === 'ok';
    const rank = rankOk && r.found !== false ? rankOf(r) : null;
    const ev: KeywordEvidence = {
      source: 'measured',
      ...(rank != null ? { rank } : {}),
      ...(rankOk && r.found === false ? { notFound: true } : {}),
      ...(r.demandStatus === 'measured' && typeof r.searchVolume === 'number' && r.searchVolume >= 0 ? { searchVolume: r.searchVolume } : {}),
      matchedTerm: s.matched,
      local: isLocal(r.keyword, input.places),
    };
    push(r.keyword, ev);
  }
  const measuredRanked = [...ranked];

  // Google Business Profile search terms (only what Google reported).
  const searchRanked: KeywordPick[] = [];
  for (const t of input.searchTerms) {
    const k = norm(t.keyword);
    if (!k || !(t.impressions > 0)) continue;
    const s = screen(t.keyword);
    if (!s.ok) continue;
    const before = ranked.length;
    push(t.keyword, {
      source: 'gbp_search_terms',
      impressions: Math.round(t.impressions),
      ...(t.year && t.month ? { period: `${t.year}-${String(t.month).padStart(2, '0')}` } : {}),
      matchedTerm: s.matched,
      local: isLocal(t.keyword, input.places),
    });
    if (ranked.length > before) searchRanked.push(ranked[ranked.length - 1]);
  }

  ranked.sort((a, b) => b.score - a.score);
  measuredRanked.sort((a, b) => b.score - a.score);
  searchRanked.sort((a, b) => b.score - a.score);

  const seo = measuredRanked.find((p) => p.evidence.rank != null || p.evidence.notFound || p.evidence.searchVolume != null) ?? null;
  const search = searchRanked.find((p) => !seo || norm(p.keyword) !== norm(seo.keyword)) ?? null;
  const taken = new Set([seo, search].filter(Boolean).map((p) => norm(p!.keyword)));
  const local = measuredRanked.find((p) => p.evidence.local && !taken.has(norm(p.keyword)))
    ?? searchRanked.find((p) => p.evidence.local && !taken.has(norm(p.keyword))) ?? null;
  return { seo, search, local, ranked, rejected };
}

/** A proposed keyword as a labelled, never-scored fallback (null when it fails the same screens). */
export function proposedPick(keyword: string, input: Pick<PriorityInput, 'businessName' | 'serviceTerms' | 'places'>): KeywordPick | null {
  const k = norm(keyword);
  if (!k || brandWords(input.businessName, input.serviceTerms).some((b) => k.split(' ').includes(b)) || CLAIM_WORDS.test(k)) return null;
  const matched = matchService(keyword, input.serviceTerms, input.places);
  if (!matched) return null;
  const evidence: KeywordEvidence = { source: 'proposed', matchedTerm: matched, local: isLocal(keyword, input.places) };
  return { keyword, measured: false, score: 0, reason: reasonFor(evidence), evidence };
}
