/**
 * S6 — pick the month's targets (docs/KEYWORD_SYSTEM_PLAN.md §5). Pure.
 *
 * Core (5): the focus keywords. Once chosen, a core keyword stays at least
 *   90 days. After that it is swapped only when it has stalled (not top 3
 *   and gained < 3 positions since it became core), lost its demand, or no
 *   longer matches a listed service — at most 2 swaps per run, and only when
 *   a better-scoring keyword is available. Pinned keywords are never swapped.
 *   The owner's keywords get up to 2 core slots when they score at least as
 *   well as the 10th best candidate.
 * Rotating (5): re-picked every run — quick wins first, then real customer
 *   searches (GBP), then competitor keywords, by score; one per service.
 * Owner: every owner keyword not selected above stays on the list (measured
 *   and shown with its verdict).
 * Watch: the best of the rest, for next month.
 *
 * Every change carries a reason built from the numbers.
 */
import {
  KEYWORD_LIMITS,
  type KeywordSetChange,
  type PlanKeyword,
  type ScoredKeyword,
} from './keywordTypes.ts';

type Limits = {
  core: number;
  rotating: number;
  maxWatch: number;
  coreLockDays: number;
  maxCoreSwapsPerRun: number;
  coreMinGain: number;
  ownerCoreMin: number;
  ownerCoreScoreRank: number;
};

export interface SelectInput {
  scored: ScoredKeyword[];
  /** The previous plan's keywordSet (empty on the first plan). */
  previous: PlanKeyword[];
  now: Date;
  limits?: Partial<Limits>;
}

export interface SelectResult {
  keywords: PlanKeyword[];
  changes: KeywordSetChange[];
}

const DAY_MS = 86_400_000;
const NOT_IN_TOP_20 = 21;

/** Comparable rank: measured position, 21 when not in the top 20, null when not measured. */
export function rankNumber(k: Pick<ScoredKeyword, 'rank'>): number | null {
  if (k.rank.status !== 'measured') return null;
  return k.rank.avg ?? NOT_IN_TOP_20;
}

const eligible = (k: ScoredKeyword) => k.verdict !== 'not_relevant' && k.verdict !== 'low_demand';
const byScore = (a: ScoredKeyword, b: ScoredKeyword) =>
  b.score - a.score || Number(b.owner) - Number(a.owner) || a.keyword.localeCompare(b.keyword);
const round1 = (n: number) => Math.round(n * 10) / 10;

export function selectTargets(input: SelectInput): SelectResult {
  const L: Limits = { ...KEYWORD_LIMITS, ...(input.limits || {}) };
  const nowIso = input.now.toISOString();
  const scoredById = new Map(input.scored.map((k) => [k.id, k]));
  const prevById = new Map(input.previous.map((k) => [k.id, k]));
  const sorted = [...input.scored].sort(byScore);
  const pool = sorted.filter(eligible);
  const changes: KeywordSetChange[] = [];

  const core: PlanKeyword[] = [];
  const inCore = new Set<string>();
  const toPlan = (k: ScoredKeyword, role: PlanKeyword['role'], extra: Partial<PlanKeyword> = {}): PlanKeyword => {
    const prev = prevById.get(k.id);
    const was = prev ? rankNumber(prev) : null;
    const cur = rankNumber(k);
    return {
      ...k,
      role,
      rankTrend: was != null && cur != null ? round1(was - cur) : null,
      ...(prev?.pinned ? { pinned: true } : {}),
      ...extra,
    };
  };
  const addCore = (k: ScoredKeyword, extra: Partial<PlanKeyword>) => {
    core.push(toPlan(k, 'core', extra));
    inCore.add(k.id);
  };
  /** A better keyword exists to take a failing core keyword's place. */
  const betterAvailable = (score: number) => pool.some((k) => !inCore.has(k.id) && k.score > score);

  // 1. Pinned keywords first, then last plan's core keywords.
  const prevCore = input.previous
    .filter((p) => p.role === 'core' || p.pinned)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  let swaps = 0;
  for (const p of prevCore) {
    if (core.length >= L.core) break;
    const cur = scoredById.get(p.id);
    if (!cur) {
      if (p.role === 'core') changes.push({ id: p.id, keyword: p.keyword, change: 'core_removed', reason: 'No longer researched — the keyword or its service was removed.' });
      continue;
    }
    const startRank = p.coreStartRank ?? rankNumber(cur) ?? undefined;
    const keep = { coreSince: p.coreSince ?? nowIso, ...(startRank != null ? { coreStartRank: startRank } : {}) };
    if (p.pinned) { addCore(cur, { ...keep, pinned: true }); continue; }

    if (cur.verdict === 'not_relevant') {
      changes.push({ id: p.id, keyword: p.keyword, change: 'core_removed', reason: 'It no longer matches a service listed for the business.' });
      continue;
    }
    const ageDays = (input.now.getTime() - new Date(keep.coreSince).getTime()) / DAY_MS;
    if (ageDays < L.coreLockDays) { addCore(cur, keep); continue; }

    const now = rankNumber(cur);
    const gain = now != null && startRank != null ? startRank - now : null;
    const stalled = now != null && now > 3 && (gain ?? 0) < L.coreMinGain;
    const failing = cur.verdict === 'low_demand' || stalled;
    if (failing && swaps < L.maxCoreSwapsPerRun && betterAvailable(cur.score)) {
      swaps++;
      changes.push({
        id: p.id, keyword: p.keyword, change: 'core_removed',
        reason: cur.verdict === 'low_demand'
          ? `After ${Math.floor(ageDays)} days Google reports too few searches for it — replaced by a keyword with more demand.`
          : `After ${Math.floor(ageDays)} days it moved ${gain != null && gain > 0 ? `only ${round1(gain)} position${gain === 1 ? '' : 's'}` : 'no positions'} (now ${now! >= NOT_IN_TOP_20 ? 'not in the top 20' : `#${Math.round(now!)}`}) — replaced by a keyword with a better chance.`,
      });
      continue;
    }
    addCore(cur, keep);
    changes.push({
      id: p.id, keyword: p.keyword, change: 'core_kept',
      reason: !failing
        ? 'Moving up or already in the top 3 — kept as a focus keyword.'
        : swaps >= L.maxCoreSwapsPerRun
          ? 'Not moving yet — kept because this month’s swap limit was reached.'
          : 'Not moving yet — kept because no better keyword is available.',
    });
  }

  // 2. Fill core: owner keywords that score well enough first, then by score.
  const threshold = pool[L.ownerCoreScoreRank - 1]?.score ?? 0;
  const ownerCandidates = pool.filter((k) => k.owner && k.score >= threshold);
  const ownerWanted = Math.min(L.ownerCoreMin, ownerCandidates.length);
  const fresh = (k: ScoredKeyword) => {
    const r = rankNumber(k);
    addCore(k, { coreSince: nowIso, ...(r != null ? { coreStartRank: r } : {}) });
    changes.push({ id: k.id, keyword: k.keyword, change: 'core_added', reason: k.reason });
  };
  for (const k of ownerCandidates) {
    if (core.length >= L.core || core.filter((c) => c.owner).length >= ownerWanted) break;
    if (!inCore.has(k.id)) fresh(k);
  }
  for (const k of pool) {
    if (core.length >= L.core) break;
    if (!inCore.has(k.id)) fresh(k);
  }

  // 3. Rotating: quick wins, then customer searches, then competitor keywords; one per service.
  const priority = (k: ScoredKeyword) =>
    k.verdict === 'quick_win' ? 0 : k.sources.includes('gbp_search_term') ? 1 : k.sources.includes('competitor') ? 2 : 3;
  const coreServices = new Set(core.map((k) => k.serviceId).filter(Boolean));
  const usedServices = new Set<string>();
  const rotating: PlanKeyword[] = [];
  for (const k of pool.filter((x) => !inCore.has(x.id)).sort((a, b) => priority(a) - priority(b) || byScore(a, b))) {
    if (rotating.length >= L.rotating) break;
    const svcKey = k.serviceId ?? k.id;
    if (usedServices.has(svcKey)) continue;
    usedServices.add(svcKey);
    rotating.push(toPlan(k, 'rotating'));
  }
  // Not enough distinct services: allow repeats, but never a core service twice over.
  if (rotating.length < L.rotating) {
    const taken = new Set(rotating.map((k) => k.id));
    for (const k of pool) {
      if (rotating.length >= L.rotating) break;
      if (inCore.has(k.id) || taken.has(k.id)) continue;
      if (k.serviceId && coreServices.has(k.serviceId) && rotating.some((r) => r.serviceId === k.serviceId)) continue;
      rotating.push(toPlan(k, 'rotating'));
      taken.add(k.id);
    }
  }
  const rotatingIds = new Set(rotating.map((k) => k.id));
  for (const k of rotating) {
    if (prevById.get(k.id)?.role !== 'rotating') changes.push({ id: k.id, keyword: k.keyword, change: 'rotating_added', reason: k.reason });
  }
  for (const p of input.previous) {
    if (p.role === 'rotating' && !rotatingIds.has(p.id) && !inCore.has(p.id)) {
      changes.push({ id: p.id, keyword: p.keyword, change: 'rotating_removed', reason: 'Replaced by a stronger keyword this month.' });
    }
  }

  // 4. Owner keywords not selected, 5. watch list.
  const chosen = new Set([...inCore, ...rotatingIds]);
  const owner = sorted.filter((k) => k.owner && !chosen.has(k.id)).map((k) => toPlan(k, 'owner'));
  const watch = sorted
    .filter((k) => !k.owner && !chosen.has(k.id) && k.verdict !== 'not_relevant')
    .slice(0, L.maxWatch)
    .map((k) => toPlan(k, 'watch'));

  return { keywords: [...core, ...rotating, ...owner, ...watch], changes };
}
