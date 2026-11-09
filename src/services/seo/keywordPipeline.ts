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
import { buildKeywordSet, fitChecksToBudget, planRankChecks, scoreCandidates } from './keywordSet';
import { UNIT_PRICES } from '@/services/audit/costModel';
import { keywordBudgetRemaining, monthlyKeywordBudgetUsd, recordKeywordSpend } from '@/lib/keywordBudget';
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
  /** Override the remaining monthly budget (tests); defaults to the stored budget. */
  budgetUsd?: number;
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
  /** Estimated list-price spend of this run, recorded against the monthly budget. */
  spentUsd: number;
}

const COMPETITOR_SITES = 3;
const AREA_DEMAND_FOR = 30;
/** List prices (services/audit/costModel.ts UNIT_PRICES; confirmed via DataForSEO user_data, Nov 2026). */
const ADS_TASK_USD = UNIT_PRICES.dataForSeoAdsVolumeLiveTask.usd;
const MAPS_SEARCH_USD = UNIT_PRICES.dataForSeoMapsLiveTask.usd;
/** Kept back for the essential work: country volume + core / owner rank checks (~5x9 + 20x3 searches). */
const ESSENTIAL_RESERVE_USD = ADS_TASK_USD + 105 * MAPS_SEARCH_USD;

export async function runKeywordPipeline(input: KeywordPipelineInput): Promise<KeywordPipelineResult | null> {
  const now = input.now ?? new Date();
  const measuredAt = now.toISOString();
  const businessId = String(input.business?._id ?? '');
  try {
    // ── Budget (docs/KEYWORD_SYSTEM_PLAN.md §7a) ─────────────────────────
    // Essential work first (volume + rank for focus / owner keywords); extras
    // (ideas, competitor sites, city volume, area demand, exploration) only
    // while budget remains. Too little left this month → keep last research.
    let left = input.budgetUsd ?? (businessId ? await keywordBudgetRemaining(businessId, now) : monthlyKeywordBudgetUsd());
    let spent = 0;
    const pay = (usd: number) => { spent += usd; left -= usd; };
    const onTask = () => pay(ADS_TASK_USD);
    const affords = (usd: number) => left - usd >= ESSENTIAL_RESERVE_USD;
    if (left < ESSENTIAL_RESERVE_USD) {
      console.warn(`[keywordPipeline] ${businessId}: monthly keyword budget used (USD ${left.toFixed(2)} left) — previous research kept`);
      return null;
    }

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
    const runIdeas = affords(ADS_TASK_USD);
    if (runIdeas) pay(ADS_TASK_USD);
    const sites: Array<{ name: string; website?: string | null }> = [];
    for (const c of input.competitors.filter((x) => x.website).slice(0, COMPETITOR_SITES)) {
      if (!affords(ADS_TASK_USD)) break;
      pay(ADS_TASK_USD);
      sites.push(c);
    }
    const [ideas, ...siteKeywords] = await Promise.all([
      runIdeas ? fetchKeywordIdeas(seeds, { locationCode: cityCode, countryHint: country }) : Promise.resolve([]),
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
      previousKeywords: Array.isArray(b.legacyKeywords) ? b.legacyKeywords : [],
    });
    if (!candidates.length) {
      if (businessId) await recordKeywordSpend(businessId, spent, now);
      return null;
    }

    // ── S2 volume (country is essential; city + area are extras) ──────────
    const phrases = candidates.map((c) => c.keyword);
    const countryVol = await fetchSearchVolumes(phrases, { countryHint: country, onTask }).catch(() => new Map<string, number | null>());
    const cityVol = cityCode && affords(ADS_TASK_USD)
      ? await fetchSearchVolumes(phrases, { locationCode: cityCode, onTask }).catch(() => new Map<string, number | null>())
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
    if (empty.length && affords(2 * ADS_TASK_USD)) {
      const area = await areaDemandFor(empty.map((k) => k.keyword), input.place, { onTask }).catch(() => new Map());
      if (area.size) {
        volumes = new Map(candidates.map((c) => [c.id, volumeOf(c.keyword, { country: countryVol, city: cityVol, area, ideaVolume: fromIdeas(c) }, measuredAt)]));
      }
    }

    // ── S4 rank checks (reuse what this audit already searched; fit the budget) ─
    const preScored = scoreCandidates({ candidates, volumes, ranks: new Map(), competitors: new Map(), ourReviews: null });
    const planned = planRankChecks({ candidates, preScored, previous: input.previous });
    const existing = groupByKeyword(input.existingObservations);
    const covered = (c: { keyword: string; points: number }) => (existing.get(obsKey(c.keyword))?.length ?? 0) >= c.points;
    const toFetch = fitChecksToBudget(planned.filter((c) => !covered(c)), Math.max(0, left), MAPS_SEARCH_USD);
    const checks = planned.filter((c) => covered(c) || toFetch.includes(c));
    const fetched = await (input.fetchObservations ?? fetchKeywordSetObservations)(input.businessForRankings, toFetch.map((c) => ({ keyword: c.keyword, points: c.points })));
    pay(toFetch.reduce((a, c) => a + c.points, 0) * MAPS_SEARCH_USD);
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
    if (businessId) await recordKeywordSpend(businessId, spent, now);
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
      spentUsd: Math.round(spent * 10_000) / 10_000,
    };
  } catch (err: any) {
    console.warn('[keywordPipeline] skipped:', err?.message);
    return null;
  }
}
