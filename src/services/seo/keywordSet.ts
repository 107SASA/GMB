/**
 * Assembles SeoPlan.keywordSet from the research stages
 * (docs/KEYWORD_SYSTEM_PLAN.md §5). Pure.
 *
 *   planRankChecks   S4 — which candidates to search on Google Maps, and at
 *                    how many points, within the per-audit cap
 *   buildKeywordSet  S3 + S6 — score every candidate with its measured
 *                    volume / rank / competitors, then select targets
 *   competitorGaps   keywords competitors rank for and we don't
 *   legacyKeywordLists  primary/secondary lists derived from the set, for
 *                    readers not yet moved to keywordSet
 */
import { scoreKeyword } from './keywordScore.ts';
import { selectTargets } from './keywordSelect.ts';
import {
  KEYWORD_LIMITS,
  type CompetitorAbove,
  type CompetitorGap,
  type KeywordCandidate,
  type KeywordRank,
  type KeywordSetChange,
  type KeywordVolume,
  type PlanKeyword,
  type ScoredKeyword,
} from './keywordTypes.ts';

export const NOT_MEASURED_VOLUME: KeywordVolume = { country: null, city: null, area: null, status: 'not_measured', measuredAt: null };
export const NOT_MEASURED_RANK: KeywordRank = { avg: null, best: null, foundPct: 0, points: 0, status: 'not_measured' };

export interface RankCheck {
  id: string;
  keyword: string;
  points: number;
  set: 'core' | 'rotating' | 'owner' | 'explore';
}

/**
 * S4 — the rank-check list. Last plan's core / rotating keywords keep their
 * point counts so month-to-month comparison stays like-for-like; on a first
 * plan the best pre-rank scores take those slots. Every owner keyword is
 * checked. The rest of the cap explores the next best candidates at one
 * point each to find quick wins.
 */
export function planRankChecks(input: {
  candidates: KeywordCandidate[];
  /** Candidates scored with volume only (rank not measured yet). */
  preScored: ScoredKeyword[];
  previous: PlanKeyword[];
  limits?: Partial<{ core: number; rotating: number; maxRankChecked: number; explore: number; points: { core: number; rotating: number; owner: number; explore: number } }>;
}): RankCheck[] {
  const L = { ...KEYWORD_LIMITS, ...(input.limits || {}) };
  const P = { ...KEYWORD_LIMITS.points, ...(input.limits?.points || {}) };
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  const out: RankCheck[] = [];
  const taken = new Set<string>();
  const push = (id: string, set: RankCheck['set'], points: number) => {
    const c = byId.get(id);
    if (!c || taken.has(id) || out.length >= L.maxRankChecked) return false;
    taken.add(id);
    out.push({ id, keyword: c.keyword, points, set });
    return true;
  };
  const ranked = [...input.preScored]
    .filter((k) => k.verdict !== 'not_relevant' && k.verdict !== 'low_demand' && k.verdict !== 'claim_word')
    .sort((a, b) => b.score - a.score);

  const prevCore = input.previous.filter((p) => p.role === 'core' || p.pinned).map((p) => p.id).filter((id) => byId.has(id));
  const prevRot = input.previous.filter((p) => p.role === 'rotating').map((p) => p.id).filter((id) => byId.has(id));

  let core = 0;
  for (const id of prevCore) if (core < L.core && push(id, 'core', P.core)) core++;
  for (const k of ranked) if (core < L.core && push(k.id, 'core', P.core)) core++;

  let rot = 0;
  for (const id of prevRot) if (rot < L.rotating && push(id, 'rotating', P.rotating)) rot++;
  for (const k of ranked) if (rot < L.rotating && push(k.id, 'rotating', P.rotating)) rot++;

  // Owner keywords are never skipped for exploration: reserve their room first.
  for (const c of input.candidates) if (c.owner) push(c.id, 'owner', P.owner);

  let explored = 0;
  for (const k of ranked) if (explored < L.explore && push(k.id, 'explore', P.explore)) explored++;
  return out;
}

/**
 * Cost guard for S4: the rank checks that fit `budgetUsd`, in priority order
 * — core and owner keywords first, then rotating, then exploration. A check
 * that still does not fit is left out (its keyword shows "not measured").
 */
export function fitChecksToBudget(checks: RankCheck[], budgetUsd: number, usdPerSearch: number): RankCheck[] {
  const order: Record<RankCheck['set'], number> = { core: 0, owner: 1, rotating: 2, explore: 3 };
  const kept: RankCheck[] = [];
  let left = budgetUsd;
  for (const c of [...checks].sort((a, b) => order[a.set] - order[b.set])) {
    const cost = c.points * usdPerSearch;
    if (cost <= left + 1e-9) { kept.push(c); left -= cost; }
  }
  return checks.filter((c) => kept.includes(c));
}

export interface BuildInput {
  candidates: KeywordCandidate[];
  volumes: Map<string, KeywordVolume>;
  ranks: Map<string, KeywordRank>;
  competitors: Map<string, CompetitorAbove[]>;
  ourReviews: number | null;
  previous: PlanKeyword[];
  now: Date;
}

/** Score every candidate with what was measured for it (volume-only when no rank). */
export function scoreCandidates(input: Omit<BuildInput, 'previous' | 'now'>): ScoredKeyword[] {
  return input.candidates.map((candidate) =>
    scoreKeyword({
      candidate,
      volume: input.volumes.get(candidate.id) ?? NOT_MEASURED_VOLUME,
      rank: input.ranks.get(candidate.id) ?? NOT_MEASURED_RANK,
      competitorsAbove: input.competitors.get(candidate.id) ?? [],
      ourReviews: input.ourReviews,
    }),
  );
}

export function buildKeywordSet(input: BuildInput): { keywordSet: PlanKeyword[]; changes: KeywordSetChange[]; gaps: CompetitorGap[] } {
  const scored = scoreCandidates(input);
  const { keywords, changes } = selectTargets({ scored, previous: input.previous, now: input.now });
  return { keywordSet: keywords, changes, gaps: competitorGaps(scored) };
}

/** Keywords a competitor is top 3 for while we are not in the top 20 (or not measured), most searched first. */
export function competitorGaps(scored: ScoredKeyword[], max = 15): CompetitorGap[] {
  const gaps: CompetitorGap[] = [];
  for (const k of scored) {
    if (k.verdict === 'not_relevant') continue;
    const weAreOut = k.rank.status !== 'measured' || k.rank.avg == null;
    if (!weAreOut) continue;
    const top = k.competitorsAbove.find((c) => c.rank <= 3);
    const volume = k.volume.city ?? k.volume.country ?? k.ideaVolume ?? null;
    if (top) gaps.push({ keyword: k.keyword, volume, competitor: top.name, competitorRank: top.rank });
    else if (k.sources.includes('competitor') && k.competitor && k.rank.status === 'measured') {
      // Competitor's website ranks for it and we are not in the top 20 on Maps.
      gaps.push({ keyword: k.keyword, volume, competitor: k.competitor, competitorRank: null });
    }
  }
  return gaps.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1)).slice(0, max);
}

/** primaryKeywords = core, secondaryKeywords = rotating then the owner's other keywords. */
export function legacyKeywordLists(set: PlanKeyword[]): { primaryKeywords: string[]; secondaryKeywords: string[] } {
  return {
    primaryKeywords: set.filter((k) => k.role === 'core').map((k) => k.keyword),
    secondaryKeywords: set.filter((k) => k.role === 'rotating' || k.role === 'owner').map((k) => k.keyword).slice(0, 25),
  };
}

/** The month's targets in priority order (core, then rotating). */
export function targetKeywords(set: PlanKeyword[] | null | undefined): PlanKeyword[] {
  const rows = Array.isArray(set) ? set : [];
  return [...rows.filter((k) => k.role === 'core'), ...rows.filter((k) => k.role === 'rotating')];
}

/**
 * The targets as measured-keyword rows for content prioritisation
 * (content/keywordPriority.ts MeasuredKeywordRow): posts then target only the
 * month's core + rotating keywords, ranked by their real rank and volume.
 * Empty when the plan has no researched targets yet.
 */
export function contentRows(set: PlanKeyword[] | null | undefined): Array<{
  keyword: string; rank: number | null; found: boolean | null; rankStatus: 'ok' | 'unavailable';
  searchVolume: number | null; demandStatus: 'measured' | 'unavailable';
}> {
  return targetKeywords(set).map((k) => {
    const volume = [k.volume?.city, k.volume?.country].find((v): v is number => typeof v === 'number' && v > 0) ?? null;
    const measured = k.rank?.status === 'measured';
    return {
      keyword: k.keyword,
      rank: measured ? k.rank.avg : null,
      // Not rank-checked yet → unknown, never "not found".
      found: measured ? k.rank.avg != null : null,
      rankStatus: measured ? 'ok' : 'unavailable',
      searchVolume: volume,
      demandStatus: volume != null ? 'measured' : 'unavailable',
    };
  });
}
