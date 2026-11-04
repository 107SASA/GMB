/**
 * Raw Google Maps searches → one measurement row per (keyword, location),
 * keyed by stable ids so monthly audits compare like-for-like. Pure.
 *
 * A row is comparable with last month's only when the same keyword was
 * searched at the same location, from the same grid points (centre, spacing
 * and count — `grid`), with every search succeeding both times — anything
 * else is "not comparable", never a change.
 * A failed search is UNAVAILABLE, never "not found"; a keyword with no search
 * is simply absent (NOT_MEASURED), never zero.
 */
import { ADDRESS_AREA_ID, keywordId } from './ids.ts';
import { monthKey } from '../lifecycle/period.ts';
import type { SearchObservation } from '../audit/facts.ts';

export type MeasurementScope = 'address_grid' | 'address_tracked' | 'service_area';

export interface KeywordMeasurement {
  id: string;
  keyword: string;
  serviceId: string | null;
  service: string | null;
  areaId: string;
  area: string;
  scope: MeasurementScope;
  /** Searches run for this keyword at this location. */
  points: number;
  /** Searches that returned results. */
  okCount: number;
  /** Searches where the business was in the top 20. */
  foundCount: number;
  bestRank: number | null;
  /** Mean position over the searches where it was found. */
  avgRank: number | null;
  status: 'measured' | 'unavailable';
  /** Google Ads monthly searches (country level); null = not enough data. */
  searchVolume: number | null;
  /**
   * The grid the searches ran from: every point rounded to ~11 m, sorted —
   * so a different centre (a corrected map pin), spacing or point count gives
   * a different key. "city" = searched without coordinates. Absent on
   * measurements stored before Nov 2026 (their grid was not recorded).
   */
  grid?: string;
}

/** Grid fingerprint of a keyword's searches (see KeywordMeasurement.grid). */
export function gridKey(points: Array<{ lat: number; lng: number } | null | undefined>): string {
  const keys = Array.from(new Set(points.map((p) => (p ? `${p.lat.toFixed(4)},${p.lng.toFixed(4)}` : 'city')))).sort();
  return keys.join(';');
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function measurementRows(
  obs: SearchObservation[],
  opts: {
    scope: MeasurementScope;
    areaOf: (o: SearchObservation) => { id: string; name: string };
    serviceOf: (keyword: string) => { id: string; name: string } | null;
    volumes?: Map<string, number | null>;
  },
): KeywordMeasurement[] {
  const groups = new Map<string, { o: SearchObservation[]; area: { id: string; name: string } }>();
  for (const o of obs) {
    const area = opts.areaOf(o);
    const k = `${keywordId(o.keyword)}@${area.id}`;
    const g = groups.get(k) || { o: [], area };
    g.o.push(o);
    groups.set(k, g);
  }
  return Array.from(groups.values()).map(({ o, area }) => {
    const ok = o.filter((x) => x.status === 'ok');
    const ranks = ok.filter((x) => x.found && x.rank != null).map((x) => x.rank as number);
    const svc = opts.serviceOf(o[0].keyword);
    return {
      id: keywordId(o[0].keyword),
      keyword: o[0].keyword,
      serviceId: svc?.id ?? null,
      service: svc?.name ?? null,
      areaId: area.id,
      area: area.name,
      scope: opts.scope,
      points: o.length,
      okCount: ok.length,
      foundCount: ranks.length,
      bestRank: ranks.length ? Math.min(...ranks) : null,
      avgRank: ranks.length ? round1(ranks.reduce((a, b) => a + b, 0) / ranks.length) : null,
      status: ok.length ? 'measured' : 'unavailable',
      searchVolume: opts.volumes?.get(o[0].keyword.toLowerCase()) ?? null,
      grid: gridKey(o.map((x) => x.point)),
    };
  });
}

export const addressArea = (label: string) => ({ id: ADDRESS_AREA_ID, name: label });

export type ChangeKind = 'improved' | 'declined' | 'stable' | 'new' | 'not_comparable';

export interface MeasurementChange {
  id: string;
  keyword: string;
  serviceId: string | null;
  service: string | null;
  areaId: string;
  area: string;
  change: ChangeKind;
  before: string;
  after: string;
  /** Average position last month / now; null = not in the top 20, unavailable or not measured. */
  beforeRank?: number | null;
  afterRank?: number | null;
  /** Places moved up (+) or down (−) — only when comparable and in the top 20 both months. */
  positionsGained?: number | null;
  note?: string;
}

/** "#4 (avg, 3 of 3 searches)" / "not in top 20 (3 searches)" / "unavailable". */
export function positionText(m: KeywordMeasurement | null | undefined): string {
  if (!m) return 'not measured';
  if (m.status !== 'measured') return 'unavailable';
  if (m.avgRank == null) return `not in top 20 (${m.okCount} search${m.okCount === 1 ? '' : 'es'})`;
  return m.okCount > 1 ? `#${m.avgRank} avg, top 20 in ${m.foundCount} of ${m.okCount}` : `#${m.avgRank}`;
}

const rowKey = (m: { id: string; areaId: string }) => `${m.id}@${m.areaId}`;

/**
 * Like-for-like change per (keyword, location). "Improved" = now in the top
 * 20 when it was not, or average position better by at least one place
 * (lower number); "declined" the reverse; otherwise "stable".
 */
export function compareMeasurements(prev: KeywordMeasurement[] | null | undefined, cur: KeywordMeasurement[]): MeasurementChange[] {
  const before = new Map((prev || []).map((m) => [rowKey(m), m]));
  return cur.map((c) => {
    const p = before.get(rowKey(c));
    const base = {
      id: c.id, keyword: c.keyword, serviceId: c.serviceId, service: c.service, areaId: c.areaId, area: c.area,
      before: positionText(p), after: positionText(c),
      beforeRank: p && p.status === 'measured' ? p.avgRank : null,
      afterRank: c.status === 'measured' ? c.avgRank : null,
      positionsGained: null as number | null,
    };
    if (!p) return { ...base, change: 'new' as const, note: 'First measured this month' };
    const why = notComparableReason(p, c);
    if (why) return { ...base, change: 'not_comparable' as const, note: why };
    const wasFound = p.avgRank != null;
    const isFound = c.avgRank != null;
    if (!wasFound && !isFound) return { ...base, change: 'stable' as const };
    if (!wasFound && isFound) return { ...base, change: 'improved' as const, note: 'Now in the top 20' };
    if (wasFound && !isFound) return { ...base, change: 'declined' as const, note: 'No longer in the top 20' };
    const d = round1((p.avgRank as number) - (c.avgRank as number));
    return { ...base, positionsGained: d, change: d >= 1 ? 'improved' as const : d <= -1 ? 'declined' as const : 'stable' as const };
  });
}

/**
 * Why two measurements of the same keyword at the same location cannot be
 * compared, or null when they can. Missing grid data is never assumed equal.
 */
export function notComparableReason(p: KeywordMeasurement, c: KeywordMeasurement): string | null {
  if (p.status !== 'measured' || c.status !== 'measured') return 'One of the two measurements was unavailable';
  if (p.points !== c.points || p.okCount !== c.okCount) return 'Measured at a different number of points';
  if (!p.grid || !c.grid) return 'The earlier search location was not recorded';
  if (p.grid !== c.grid) return 'Searched from a different location or grid';
  return null;
}

// ── Month-on-month movement and history ─────────────────────────────────────

/** Earlier months in a keyword's history (with this month: up to 6 months). */
export const RANK_HISTORY_AUDITS = 5;
/** Earlier connected audits read to fill those months — several can share a month. */
export const RANK_HISTORY_FETCH = 24;
/** Audit kinds whose measurements make up the monthly history (no manual or free audits). */
export const RANK_HISTORY_KINDS = ['connected_baseline', 'monthly'] as const;

/**
 * One history point per calendar month (IST, lifecycle/period.ts monthKey):
 * the LATEST eligible audit of each earlier month, newest month first —
 * never the current audit's own month (the current audit is that month's
 * point). The latest is kept even when its measurement was unavailable or
 * not comparable: an earlier same-month audit is never picked to fill in.
 * Audit records themselves are untouched; this only chooses which to read.
 */
export function monthlyHistoryAudits<T extends { at: string }>(earlier: T[], currentAt: string, months = RANK_HISTORY_AUDITS): T[] {
  const newestFirst = [...earlier].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const seen = new Set([monthKey(new Date(currentAt))]);
  const out: T[] = [];
  for (const a of newestFirst) {
    const key = monthKey(new Date(a.at));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= months) break;
  }
  return out;
}

export interface RankPoint {
  /** When that audit measured it (ISO). */
  at: string;
  /** Average position; null = searched, not in the top 20. */
  rank: number | null;
}

export interface KeywordMovement extends MeasurementChange {
  scope: MeasurementScope;
  /**
   * Comparable measurements, oldest → newest, ending with this month: the
   * unbroken run in which every month was measured under the same
   * conditions as the next. A gap (not measured, unavailable, different
   * grid or points) ends it — nothing is filled in.
   */
  history: RankPoint[];
}

/**
 * Every keyword × location measured this month, with its change against the
 * previous month and its comparable history. `previous` = earlier months'
 * stored measurements, newest first, one per month (monthlyHistoryAudits);
 * previous[0] is the month compared with.
 */
export function buildKeywordMovement(
  current: { at: string; measurements: KeywordMeasurement[] },
  previous: Array<{ at: string; measurements: KeywordMeasurement[] }>,
): KeywordMovement[] {
  const changes = compareMeasurements(previous[0]?.measurements ?? null, current.measurements);
  const lookup = previous.map((a) => new Map(a.measurements.map((m) => [rowKey(m), m])));
  return current.measurements.map((c, i) => {
    const history: RankPoint[] = [];
    if (c.status === 'measured') {
      history.push({ at: current.at, rank: c.avgRank });
      let newer = c;
      for (let j = 0; j < previous.length; j++) {
        const older = lookup[j].get(rowKey(c));
        if (!older || notComparableReason(older, newer)) break;
        history.unshift({ at: previous[j].at, rank: older.avgRank });
        newer = older;
      }
    }
    return { ...changes[i], scope: c.scope, history };
  });
}

/** "▲ 4 up · ▼ 1 down · = 3 unchanged" counts (new and not-comparable are listed separately). */
export function movementCounts(rows: Array<{ change: ChangeKind }>): Record<ChangeKind, number> {
  const out: Record<ChangeKind, number> = { improved: 0, declined: 0, stable: 0, new: 0, not_comparable: 0 };
  for (const r of rows) out[r.change]++;
  return out;
}
