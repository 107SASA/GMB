/**
 * The keyword system's audit stage (docs/KEYWORD_SYSTEM_PLAN.md §5, S1–S6),
 * run by full (connected) audits only. I/O lives here; every rule lives in
 * the pure modules it calls.
 *
 *   S1 research    owner keywords, services × city / areas, GBP search
 *                  terms, Google Ads ideas, competitor-site keywords
 *   S2 volume      one Google Ads task for the country (≤ 700 per task),
 *                  one for the city, area demand for what's still empty
 *   S3/S4 ranks    plan the checks (cap 50), reuse searches this audit
 *                  already ran, search the rest on Google Maps
 *   S5 competitors from the same Maps results
 *   S6 select      5 core + 5 rotating + owner verdicts
 *
 * Never throws; returns null when research could not run.
 */
import { fetchSearchVolumes } from '@/services/audit/keywordVolumeClient';
import { areaDemandFor, cityAdsLocationCode } from '@/services/audit/areaDemand';
import { fetchKeywordIdeas, fetchSiteKeywords } from '@/services/audit/keywordIdeasClient';
import { fetchKeywordSetObservations } from '@/services/audit/seoAnalyzer';
import type { SearchObservation } from '@/services/audit/facts';
import type { VerifiedService } from './trackedKeywords';
import { buildCandidates } from './keywordResearch';
import { buildKeywordSet, planRankChecks, scoreCandidates } from './keywordSet';
import { competitorsAboveFrom, groupByKeyword, obsKey, rankFromObservations, volumeOf } from './keywordMeasure';
import { KEYWORD_LIMITS, type CompetitorAbove, type CompetitorGap, type KeywordRank, type KeywordSetChange, type KeywordVolume, type PlanKeyword } from './keywordTypes';

export interface KeywordPipelineInput {
  business: any;
  /** The business object the ranking searches use (coordinates, place id). */
  businessForRankings: any;
  services: VerifiedService[];
  category: string | null;
  city: string;
  place: { city?: string | null; area?: string | null; state?: string | null; country?: string | null };
  /** Service-area names, nearest first. */
  serviceAreas: string[];
  gbpSearchTerms: Array<{ keyword: string; impressions: number }>;
  /** Searches this audit already ran (grid, tracked) — reused, never paid twice. */
  existingObservations: SearchObservation[];
  /** Same-trade businesses seen on Maps, best first (name + website). */
  competitors: Array<{ name: string; website?: string | null }>;
  previous: PlanKeyword[];
  ownerRemoved: string[];
  now?: Date;
  /** Maps search runner (tests stub it); defaults to the DataForSEO batch. */
  fetchObservations?: (business: any, checks: Array<{ keyword: string; points: number }>) => Promise<SearchObservation[]>;
}

export interface KeywordPipelineResult {
  keywordSet: PlanKeyword[];
  changes: KeywordSetChange[];
  gaps: CompetitorGap[];
  research: { candidates: number; withVolume: number; rankChecked: number };
  /** Maps searches this stage ran (for measurement history). */
  observations: SearchObservation[];
}

const COMPETITOR_SITES = 3;
const AREA_DEMAND_FOR = 30;

export async function runKeywordPipeline(input: KeywordPipelineInput): Promise<KeywordPipelineResult | null> {
  const now = input.now ?? new Date();
  const measuredAt = now.toISOString();
  try {
    const b = input.business;
    const ownerKeywords: string[] = b.intakeCompleted && Array.isArray(b.keywords) ? b.keywords.slice(0, KEYWORD_LIMITS.maxOwnerKeywords) : [];
    const ownerCompetitors: string[] = Array.isArray(b.intake?.competitorNames) ? b.intake.competitorNames : [];
    const cityCode = await cityAdsLocationCode(input.place);
    const country = input.place.country || '';

    // ── S1 research ───────────────────────────────────────────────────────
    const seeds = [
      ...ownerKeywords,
      ...input.services.map((s) => s.name),
      ...(input.category ? [input.category] : []),
    ];
    const sites = input.competitors.filter((c) => c.website).slice(0, COMPETITOR_SITES);
    const [ideas, ...siteKeywords] = await Promise.all([
      fetchKeywordIdeas(seeds, { locationCode: cityCode, countryHint: country }),
      ...sites.map((c) => fetchSiteKeywords(c.website!, { locationCode: cityCode, countryHint: country })),
    ]);
    const candidates = buildCandidates({
      businessName: b.name || '',
      category: input.category,
      city: input.city,
      serviceAreas: input.serviceAreas,
      ownerKeywords,
      services: input.services,
      gbpSearchTerms: input.gbpSearchTerms,
      googleIdeas: ideas,
      competitorKeywords: siteKeywords.flatMap((list, i) => list.map((k) => ({ keyword: k.keyword, competitor: sites[i].name, volume: k.volume }))),
      competitorNames: [...input.competitors.map((c) => c.name), ...ownerCompetitors],
      ownerRemoved: input.ownerRemoved,
    });
    if (!candidates.length) return null;

    // ── S2 volume ─────────────────────────────────────────────────────────
    const phrases = candidates.map((c) => c.keyword);
    const countryVol = await fetchSearchVolumes(phrases, { countryHint: country }).catch(() => new Map<string, number | null>());
    const cityVol = cityCode
      ? await fetchSearchVolumes(phrases, { locationCode: cityCode }).catch(() => new Map<string, number | null>())
      : new Map<string, number | null>();
    const fromIdeas = (c: (typeof candidates)[number]) =>
      c.sources.includes('google_ideas') || c.sources.includes('competitor') ? c.ideaVolume : undefined;
    let volumes = new Map<string, KeywordVolume>(
      candidates.map((c) => [c.id, volumeOf(c.keyword, { country: countryVol, city: cityVol, ideaVolume: fromIdeas(c) }, measuredAt)]),
    );
    // Area demand for the owner's keywords and the best of the rest still without a number.
    const empty = scoreCandidates({ candidates, volumes, ranks: new Map(), competitors: new Map(), ourReviews: null })
      .filter((k) => k.volume.status !== 'measured')
      .sort((a, z) => Number(z.owner) - Number(a.owner) || z.score - a.score)
      .slice(0, AREA_DEMAND_FOR);
    if (empty.length) {
      const area = await areaDemandFor(empty.map((k) => k.keyword), input.place).catch(() => new Map());
      if (area.size) {
        volumes = new Map(candidates.map((c) => [c.id, volumeOf(c.keyword, { country: countryVol, city: cityVol, area, ideaVolume: fromIdeas(c) }, measuredAt)]));
      }
    }

    // ── S4 rank checks (reuse what this audit already searched) ───────────
    const preScored = scoreCandidates({ candidates, volumes, ranks: new Map(), competitors: new Map(), ourReviews: null });
    const checks = planRankChecks({ candidates, preScored, previous: input.previous });
    const existing = groupByKeyword(input.existingObservations);
    const toFetch = checks.filter((c) => (existing.get(obsKey(c.keyword))?.length ?? 0) < c.points);
    const fetched = await (input.fetchObservations ?? fetchKeywordSetObservations)(input.businessForRankings, toFetch.map((c) => ({ keyword: c.keyword, points: c.points })));
    const fetchedBy = groupByKeyword(fetched);

    const ranks = new Map<string, KeywordRank>();
    const competitors = new Map<string, CompetitorAbove[]>();
    for (const c of checks) {
      const k = obsKey(c.keyword);
      const obs = fetchedBy.get(k) ?? existing.get(k) ?? [];
      ranks.set(c.id, rankFromObservations(obs));
      competitors.set(c.id, competitorsAboveFrom(obs));
    }
    const ourReviews = [...input.existingObservations, ...fetched]
      .map((o) => o.target?.reviewCount)
      .find((n): n is number => typeof n === 'number') ?? null;

    // ── S6 select ─────────────────────────────────────────────────────────
    const built = buildKeywordSet({ candidates, volumes, ranks, competitors, ourReviews, previous: input.previous, now });
    return {
      keywordSet: built.keywordSet,
      changes: built.changes,
      gaps: built.gaps,
      research: {
        candidates: candidates.length,
        withVolume: Array.from(volumes.values()).filter((v) => v.status === 'measured').length,
        rankChecked: checks.length,
      },
      observations: fetched,
    };
  } catch (err: any) {
    console.warn('[keywordPipeline] skipped:', err?.message);
    return null;
  }
}
