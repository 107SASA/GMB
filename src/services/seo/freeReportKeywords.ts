/**
 * Free-report keywords from the business's OWN services — the dashboard
 * keyword system's research + scoring (keywordResearch / keywordSet), sized
 * for a free report. Pure: the caller fetches volumes and runs the searches.
 *
 *   1. services   what the website states (+ the Google category, unless it
 *                 is a vague one like "Shop" / "Service" / "Store")
 *   2. candidates each service × city, × the nearest areas, "<service> near me"
 *   3. volume     one search-volume lookup for every candidate (caller)
 *   4. pick       highest demand × relevance first → the phrases to rank-check
 *
 * Nothing is per-business or per-trade: every phrase is built from the
 * business's own services and places. A vague Google category never becomes a
 * keyword when the website names real services (Nov 2026: a software company
 * listed as "Service" was searched as "shop nashik" / "Shop near me").
 */
import { keywordId, serviceId } from './ids.ts';
import { buildCandidates, isGenericCategory } from './keywordResearch.ts';
import { scoreCandidates } from './keywordSet.ts';
import { volumeOf } from './keywordMeasure.ts';
import type { VerifiedService } from './trackedKeywords.ts';
import type { KeywordCandidate, KeywordVolume, ScoredKeyword } from './keywordTypes.ts';

/** Website services that read like something a customer searches for. */
const MAX_SERVICES = 6;
/** Rank checks a free report pays for (1 Maps search each). */
export const FREE_REPORT_RANK_CHECKS = 10;

/** "AI & Automation" → "ai and automation"; null when it can't be a search phrase. */
function servicePhrase(s: string): string | null {
  const p = String(s || '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (p.length < 3 || !/\p{L}/u.test(p) || p.split(' ').length > 5) return null;
  return p;
}

export interface FreeReportServicesInput {
  websiteServices: string[];
  /** The searchable Google category (already resolved), or null. */
  category: string | null;
}

/** The services keywords are built from: website services first, then a specific Google category. */
export function freeReportServices(input: FreeReportServicesInput): VerifiedService[] {
  const out: VerifiedService[] = [];
  const seen = new Set<string>();
  const push = (name: string | null, source: VerifiedService['source'], state: VerifiedService['state']) => {
    if (!name) return;
    const id = serviceId(name);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ id, name, source, state });
  };
  for (const s of input.websiteServices) {
    if (out.length >= MAX_SERVICES) break;
    push(servicePhrase(s), 'website', 'SOURCE_CLAIM');
  }
  const cat = input.category ? servicePhrase(input.category) : null;
  // A vague category only counts when the website gave nothing better.
  if (cat && (!isGenericCategory(cat) || out.length === 0)) push(cat, 'category', 'VERIFIED');
  return out;
}

export interface FreeReportCandidateInput extends FreeReportServicesInput {
  businessName: string;
  city: string;
  /** Nearby locality names, nearest first (already cleaned). */
  areas: string[];
  /** Businesses seen on Maps — their names are never keywords. */
  competitorNames?: string[];
}

/** Every phrase worth a volume lookup. Empty when the business names no service and has no usable category. */
export function freeReportCandidates(input: FreeReportCandidateInput): KeywordCandidate[] {
  const services = freeReportServices(input);
  if (!services.length) return [];
  // The category is already in `services` (or deliberately left out) —
  // buildCandidates must not add a vague one back.
  const built = buildCandidates({
    businessName: input.businessName,
    category: null,
    city: input.city,
    serviceAreas: input.areas,
    ownerKeywords: [],
    services,
    gbpSearchTerms: [],
    googleIdeas: [],
    competitorKeywords: [],
    competitorNames: input.competitorNames ?? [],
    ownerRemoved: [],
  });
  // buildCandidates adds "near me" for the first two services only; the free
  // report measures it for every service (volume decides which one is checked).
  const have = new Set(built.map((c) => c.id));
  for (const s of services) {
    const keyword = `${s.name} near me`;
    const id = keywordId(keyword);
    if (have.has(id)) continue;
    have.add(id);
    built.push({
      id, keyword, sources: [s.source === 'category' ? 'category' : 'service'], owner: false,
      serviceId: s.id, service: s.name,
      relevance: s.source === 'category' ? (isGenericCategory(s.name) ? 'generic' : 'category') : 'website',
      ideaVolume: null, gbpImpressions: null, competitor: null,
    });
  }
  return built;
}

/** Volumes for the candidates from one country (and optional city) lookup, keyed by candidate id. */
export function candidateVolumes(
  candidates: KeywordCandidate[],
  maps: { country: Map<string, number | null>; city?: Map<string, number | null> },
  measuredAt: string,
): Map<string, KeywordVolume> {
  return new Map(candidates.map((c) => [c.id, volumeOf(c.keyword, maps, measuredAt)]));
}

/**
 * The phrases to rank-check: highest score (demand × relevance) first, with
 * every service represented before any service gets a second phrase, so one
 * high-volume service can't crowd out the rest.
 */
export function pickFreeReportChecks(
  candidates: KeywordCandidate[],
  volumes: Map<string, KeywordVolume>,
  max: number = FREE_REPORT_RANK_CHECKS,
): ScoredKeyword[] {
  const scored = scoreCandidates({ candidates, volumes, ranks: new Map(), competitors: new Map(), ourReviews: null });
  const order = new Map(candidates.map((c, i) => [c.id, i]));
  const ranked = [...scored].sort((a, z) => z.score - a.score || order.get(a.id)! - order.get(z.id)!);
  const picked: ScoredKeyword[] = [];
  const usedService = new Set<string>();
  for (const k of ranked) {
    if (picked.length >= max) break;
    const svc = k.serviceId ?? k.id;
    if (usedService.has(svc)) continue;
    usedService.add(svc);
    picked.push(k);
  }
  for (const k of ranked) {
    if (picked.length >= max) break;
    if (!picked.includes(k)) picked.push(k);
  }
  return picked;
}
