/**
 * Existing customers (docs/KEYWORD_SYSTEM_PLAN.md §11). Pure.
 *
 *   splitOwnerKeywords  owner list over the 20 cap → first 20 stay, the rest
 *                       move to legacyKeywords (still researched, never deleted)
 *   seedKeywordSet      a first keywordSet from what the last report already
 *                       measured (keyword table rank + Google Ads volume), so
 *                       the Keywords page has targets before the next report.
 *                       No provider call; unmeasured keywords stay unmeasured.
 */
import { buildCandidates, cleanOwnerKeywords } from './keywordResearch.ts';
import { buildKeywordSet } from './keywordSet.ts';
import type { VerifiedService } from './trackedKeywords.ts';
import { KEYWORD_LIMITS, type KeywordRank, type KeywordSetChange, type KeywordVolume, type PlanKeyword } from './keywordTypes.ts';

const key = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function splitOwnerKeywords(keywords: unknown, legacy: unknown = []): { keywords: string[]; legacyKeywords: string[]; moved: string[] } {
  const all = Array.isArray(keywords) ? keywords.map((k) => String(k ?? '').trim()).filter(Boolean) : [];
  const kept = cleanOwnerKeywords(all, KEYWORD_LIMITS.maxOwnerKeywords);
  const keptKeys = new Set(kept.map(key));
  // Junk ("." / numbers) is dropped, not moved.
  const moved = Array.from(new Map(all.filter((k) => !keptKeys.has(key(k)) && /[a-z]/i.test(k)).map((k) => [key(k), k])).values());
  const before = Array.isArray(legacy) ? legacy.map(String) : [];
  const legacyKeys = new Set(before.map(key));
  return { keywords: kept, legacyKeywords: [...before, ...moved.filter((k) => !legacyKeys.has(key(k)))], moved };
}

interface TableRow {
  keyword: string;
  rank?: number | null;
  mapsRank?: number | null;
  found?: boolean | null;
  rankStatus?: string | null;
  searchVolume?: number | null;
  demandStatus?: string | null;
}

export function seedKeywordSet(input: {
  businessName: string;
  category: string | null;
  city: string;
  services: VerifiedService[];
  ownerKeywords: string[];
  legacyKeywords?: string[];
  keywordTable: TableRow[];
  trackedKeywords?: Array<{ keyword: string }>;
  ownerRemoved: string[];
  measuredAt: string;
  now: Date;
}): { keywordSet: PlanKeyword[]; changes: KeywordSetChange[] } {
  const table = new Map<string, TableRow>();
  for (const r of input.keywordTable || []) if (r?.keyword && !table.has(key(r.keyword))) table.set(key(r.keyword), r);

  const candidates = buildCandidates({
    businessName: input.businessName,
    category: input.category,
    city: input.city,
    serviceAreas: [],
    ownerKeywords: input.ownerKeywords,
    services: input.services,
    gbpSearchTerms: [],
    googleIdeas: [],
    competitorKeywords: [],
    competitorNames: [],
    ownerRemoved: input.ownerRemoved,
    previousKeywords: [
      ...Array.from(table.values()).map((r) => r.keyword),
      ...(input.trackedKeywords || []).map((t) => t.keyword),
      ...(input.legacyKeywords || []),
    ],
  });

  const volumes = new Map<string, KeywordVolume>();
  const ranks = new Map<string, KeywordRank>();
  for (const c of candidates) {
    const r = table.get(key(c.keyword));
    if (!r) continue;
    const vol = r.demandStatus === 'measured' && typeof r.searchVolume === 'number' && r.searchVolume > 0 ? r.searchVolume : null;
    volumes.set(c.id, { country: vol, city: null, area: null, status: vol != null ? 'measured' : 'too_few_searches', measuredAt: input.measuredAt });
    if ((r.rankStatus ?? 'ok') === 'ok') {
      const pos = r.found === false ? null : (r.rank ?? r.mapsRank ?? null);
      const avg = typeof pos === 'number' && pos >= 1 && pos <= 20 ? pos : null;
      ranks.set(c.id, { avg, best: avg, foundPct: avg != null ? 1 : 0, points: 1, status: 'measured' });
    }
  }

  const { keywordSet, changes } = buildKeywordSet({
    candidates, volumes, ranks, competitors: new Map(), ourReviews: null, previous: [], now: input.now,
  });
  return { keywordSet, changes };
}
