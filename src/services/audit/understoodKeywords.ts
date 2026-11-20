/**
 * S2 + S3 of the free report (docs/FREE_REPORT_REBUILD_PLAN.md): keywords
 * built from what the business really offers (businessUnderstanding.ts), then
 * the ones Google reports real searches for are rank-checked.
 *
 * Replaces, when the business is understood, the old "category × 7 nearby
 * areas" list: on 22 real reports (Nov 2026) 114 of 222 keywords were such
 * area phrases and 109 of them had no search volume at all
 * ("Banking and Finance Vannerpet Officers Colony").
 *
 * Pure: the caller fetches the volumes and runs the searches.
 */
import type { Understanding } from './businessUnderstanding';

export interface KeywordCandidate {
  keyword: string;
  /** The search term it was built from ("psychologist"). */
  term: string;
  shape: 'city' | 'near_me' | 'area' | 'shop' | 'maker';
}

export interface PickedKeyword extends KeywordCandidate {
  volume: number | null;
}

export const MAX_RANK_CHECKS = 6;
const MAX_TERMS = 6;
const MAX_AREAS = 2;
const MAKER_WORD = /\b(manufacturer|manufacturers|supplier|suppliers|wholesaler|wholesalers|exporter|exporters|processing|factory)\b/;
const SHOP_WORD = /\b(shop|store|showroom|mart|dealer|dealers)\b/;

const tidy = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const JUNK_AREA = /^(p\.?\s*o\.?|p\.?\s*s\.?|g\.?p\.?o\.?|post\s*office|ward\s*\d+|zone\s*\d+|sector\s*\d+|phase\s*\d+\s*\w?|block\s*\w+|[a-z]\s*block|\d+(st|nd|rd|th)?\s*(stage|phase|block|cross|main))$/i;

/** Nearby locality names fit for a search phrase: no city repeat, no post-office / ward / "2nd Stage" noise. */
export function cleanAreas(neighbourhoods: string[], city: string, max = MAX_AREAS): string[] {
  const c = tidy(city || '');
  const out: string[] = [];
  for (const raw of neighbourhoods || []) {
    const a = tidy(String(raw).split(',')[0]).replace(/\s*[,(]?\s*(p\.?\s*o\.?|post\s*office)\s*[)]?$/i, '');
    if (!a || a.length < 3 || a === c || JUNK_AREA.test(a) || out.includes(a)) continue;
    out.push(a);
    if (out.length >= max) break;
  }
  return out;
}

/** Every keyword worth one volume lookup, built from the understood terms. */
export function candidatesFromUnderstanding(u: Pick<Understanding, 'searchTerms' | 'offered'>, place: { city: string; areas: string[] }): KeywordCandidate[] {
  const city = tidy(place.city || '');
  const out: KeywordCandidate[] = [];
  const seen = new Set<string>();
  const push = (keyword: string, term: string, shape: KeywordCandidate['shape']) => {
    const k = tidy(keyword);
    if (!k || k.split(' ').length > 8 || seen.has(k)) return;
    seen.add(k);
    out.push({ keyword: k, term, shape });
  };
  const terms = (u.searchTerms || []).map(tidy).filter(Boolean).slice(0, MAX_TERMS);
  terms.forEach((term, idx) => {
    if (city) push(term.includes(city) ? term : `${term} ${city}`, term, 'city');
    push(`${term} near me`, term, 'near_me');
    if (idx < 2) {
      if ((u.offered === 'made_to_order') && !MAKER_WORD.test(term) && city) {
        push(`${term} manufacturer ${city}`, term, 'maker');
        push(`${term} wholesaler ${city}`, term, 'maker');
      }
      if ((u.offered === 'products' || u.offered === 'both') && !SHOP_WORD.test(term) && city) {
        push(`${term} shop ${city}`, term, 'shop');
      }
    }
    if (idx < 3) for (const a of (place.areas || []).slice(0, MAX_AREAS)) push(`${term} ${tidy(a)}`, term, 'area');
  });
  return out;
}

/**
 * The phrases to rank-check: those with real searches, the most-searched
 * first, one per term before any term gets a second. An area phrase is used
 * only when Google reports searches for it. When fewer than 3 phrases have
 * volume, "<term> <city>" fills up to 3 (shown as "too few searches").
 */
export function pickRankChecks(
  candidates: KeywordCandidate[],
  volumes: Map<string, number | null>,
  max = MAX_RANK_CHECKS,
): { picked: PickedKeyword[]; mainTerm: string | null } {
  const vol = (k: string) => volumes.get(k.toLowerCase()) ?? null;
  const withVolume = candidates
    .map((c) => ({ ...c, volume: vol(c.keyword) }))
    .filter((c) => (c.volume ?? 0) > 0)
    .sort((a, b) => (b.volume! - a.volume!) || candidates.indexOf(a) - candidates.indexOf(b));
  const picked: PickedKeyword[] = [];
  const usedTerm = new Set<string>();
  for (const c of withVolume) {
    if (picked.length >= max) break;
    if (usedTerm.has(c.term)) continue;
    usedTerm.add(c.term);
    picked.push(c);
  }
  for (const c of withVolume) {
    if (picked.length >= max) break;
    if (!picked.includes(c)) picked.push(c);
  }
  if (picked.length < 3) {
    for (const c of candidates) {
      if (picked.length >= 3) break;
      if (c.shape === 'city' && !picked.some((p) => p.keyword === c.keyword)) picked.push({ ...c, volume: vol(c.keyword) });
    }
  }
  // The main ranking phrase: of the business's 3 MAIN terms (the AI lists the
  // most important first), the one with the most searches — so a side service
  // with big volume ("digital marketing agency" for a software company) never
  // becomes the headline.
  const termOrder = Array.from(new Set(candidates.map((c) => c.term)));
  const best = new Map<string, number>();
  for (const c of candidates) best.set(c.term, Math.max(best.get(c.term) ?? 0, vol(c.keyword) ?? 0));
  const main3 = termOrder.slice(0, 3);
  const mainTerm = main3.length
    ? main3.reduce((a, b) => ((best.get(b) ?? 0) > (best.get(a) ?? 0) ? b : a))
    : (picked[0]?.term ?? null);
  return { picked, mainTerm };
}
