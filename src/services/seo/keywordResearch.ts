/**
 * S1 — research candidates (docs/KEYWORD_SYSTEM_PLAN.md §5). Pure.
 *
 * Builds the pool of keywords worth measuring for one business, from (in
 * priority order): the owner's own keywords, verified services × city and
 * service areas, Google Business Profile search terms, Google Ads keyword
 * ideas, competitors' website keywords, and "<service> near me".
 *
 * Every candidate except an owner keyword must match a verified service or
 * the category — a keyword we can't tie to what the business sells is never
 * researched. Brand names, competitor names, claim words ("best", "top"),
 * and keywords the owner removed are dropped. Owner keywords are always kept
 * (they are measured and shown with an honest verdict, even when weak).
 */
import { keywordId, serviceId, stem, words } from './ids.ts';
import { serviceForKeyword, type VerifiedService } from './trackedKeywords.ts';
import { KEYWORD_LIMITS, type KeywordCandidate, type KeywordSourceTag, type RelevanceSource } from './keywordTypes.ts';

/** Self-praise Google and our post fact-check reject; never a target. */
const CLAIM = /\b(best|top|cheapest|no\.? ?1|number one|leading|famous)\b/i;

/** Tidy a phrase; null when it can't be a search keyword. */
export function cleanKeyword(raw: unknown): string | null {
  const v = String(raw ?? '')
    .replace(/[^\p{L}\p{N}\s'&-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!v || !/[a-z]/i.test(v)) return null;
  if (v.length > 80 || v.split(' ').length > 10) return null;
  return v.toLowerCase();
}

/**
 * The owner's keyword list as stored: cleaned, deduped, capped at
 * KEYWORD_LIMITS.maxOwnerKeywords. Used by every API that saves owner
 * keywords, so the cap holds no matter what the client sends.
 */
export function cleanOwnerKeywords(list: unknown, max: number = KEYWORD_LIMITS.maxOwnerKeywords): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(list) ? list : []) {
    const original = String(raw ?? '').replace(/\s+/g, ' ').trim();
    const clean = cleanKeyword(original);
    if (!clean) continue;
    const id = keywordId(clean);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(original);
    if (out.length >= max) break;
  }
  return out;
}

export interface ResearchInput {
  businessName: string;
  category: string | null;
  city: string;
  /** Nearest service areas first (names only). */
  serviceAreas: string[];
  ownerKeywords: string[];
  services: VerifiedService[];
  /** GBP Performance API search terms (recent months). */
  gbpSearchTerms: Array<{ keyword: string; impressions: number }>;
  /** Google Ads keyword ideas, with the volume the ideas call returned. */
  googleIdeas: Array<{ keyword: string; volume: number | null }>;
  /** Keywords competitors' websites rank for. */
  competitorKeywords: Array<{ keyword: string; competitor: string; volume?: number | null }>;
  /** Competitor business names (Maps results + owner-entered). Never a keyword. */
  competitorNames: string[];
  /** Keywords the owner removed — never researched again. */
  ownerRemoved: string[];
  limits?: { maxCandidates?: number; maxOwnerKeywords?: number };
}

const RELEVANCE_OF: Record<VerifiedService['source'], RelevanceSource> = {
  gbp: 'gbp',
  category: 'category',
  owner: 'owner',
  website: 'website',
};

const withPlace = (phrase: string, place: string) =>
  place && !` ${phrase.toLowerCase()} `.includes(` ${place.toLowerCase()} `) ? `${phrase} ${place}` : phrase;

/** First meaningful word of each name, for brand / competitor-name checks. */
function nameTokens(names: string[], generic: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const n of names) {
    const head = String(n || '').split(/\s[-–|]\s|,|\(/)[0];
    const w = words(head).map(stem).filter((x) => !generic.has(x));
    if (w[0] && w[0].length >= 4) out.add(w[0]);
  }
  return out;
}

export function buildCandidates(input: ResearchInput): KeywordCandidate[] {
  const maxCandidates = input.limits?.maxCandidates ?? KEYWORD_LIMITS.maxCandidates;
  const maxOwner = input.limits?.maxOwnerKeywords ?? KEYWORD_LIMITS.maxOwnerKeywords;
  const city = String(input.city || '').trim();
  const services = input.services.length
    ? input.services
    : input.category
      ? [{ id: serviceId(input.category), name: input.category, source: 'category' as const, state: 'VERIFIED' as const }]
      : [];

  // Service / category / place words are generic: "Kolkata Dental Care" must
  // not make "dental" a brand word.
  const generic = new Set(
    [...services.map((s) => s.name), input.category || '', city, ...input.serviceAreas]
      .flatMap((x) => words(x)).map(stem),
  );
  const brand = nameTokens([input.businessName], generic);
  const rivals = nameTokens(input.competitorNames, generic);
  const removed = new Set(input.ownerRemoved.map((k) => keywordId(cleanKeyword(k) || k)));

  const byId = new Map<string, KeywordCandidate>();
  const order: string[] = [];

  const add = (
    raw: string,
    source: KeywordSourceTag,
    extra: { owner?: boolean; ideaVolume?: number | null; gbpImpressions?: number | null; competitor?: string | null } = {},
  ) => {
    const keyword = cleanKeyword(raw);
    if (!keyword) return;
    const id = keywordId(keyword);
    const existing = byId.get(id);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      if (extra.owner) existing.owner = true;
      if (existing.ideaVolume == null && extra.ideaVolume != null) existing.ideaVolume = extra.ideaVolume;
      if (extra.gbpImpressions != null) existing.gbpImpressions = Math.max(existing.gbpImpressions ?? 0, extra.gbpImpressions);
      if (!existing.competitor && extra.competitor) existing.competitor = extra.competitor;
      return;
    }
    if (removed.has(id)) return;
    const owner = !!extra.owner;
    const kwStems = words(keyword).map(stem);
    if (!owner) {
      if (CLAIM.test(keyword)) return;
      if (kwStems.some((w) => brand.has(w) || rivals.has(w))) return;
    }
    const svc = serviceForKeyword(keyword, services);
    if (!svc && !owner) return; // not tied to anything the business sells
    if (byId.size >= maxCandidates) return;
    byId.set(id, {
      id,
      keyword,
      sources: [source],
      owner,
      serviceId: svc?.id ?? null,
      service: svc?.name ?? null,
      relevance: svc ? RELEVANCE_OF[svc.source] : 'none',
      ideaVolume: extra.ideaVolume ?? null,
      gbpImpressions: extra.gbpImpressions ?? null,
      competitor: extra.competitor ?? null,
    });
    order.push(id);
  };

  // 1. Owner keywords — always kept.
  let ownerCount = 0;
  for (const k of input.ownerKeywords) {
    if (ownerCount >= maxOwner) break;
    const before = byId.size;
    add(k, 'owner', { owner: true });
    if (byId.size > before) ownerCount++;
  }

  // 2. Services × city, then × the 3 nearest service areas.
  for (const s of services) add(withPlace(s.name, city), s.source === 'category' ? 'category' : 'service');
  for (const area of input.serviceAreas.slice(0, 3)) {
    for (const s of services.slice(0, 3)) add(withPlace(s.name, area), 'service_area');
  }

  // 3. Real customer searches (GBP), most impressions first.
  for (const t of [...input.gbpSearchTerms].sort((a, b) => b.impressions - a.impressions)) {
    if (t.impressions > 0) add(t.keyword, 'gbp_search_term', { gbpImpressions: t.impressions });
  }

  // 4. Google Ads keyword ideas, highest volume first.
  for (const i of [...input.googleIdeas].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1))) {
    add(i.keyword, 'google_ideas', { ideaVolume: i.volume });
  }

  // 5. Competitors' website keywords.
  for (const c of [...input.competitorKeywords].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1))) {
    add(c.keyword, 'competitor', { ideaVolume: c.volume ?? null, competitor: c.competitor });
  }

  // 6. "<service> near me" for the first two services.
  for (const s of services.slice(0, 2)) add(`${s.name} near me`, s.source === 'category' ? 'category' : 'service');

  return order.map((id) => byId.get(id)!);
}
