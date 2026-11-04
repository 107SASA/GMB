/**
 * Visibility and competitors per GBP service area — built once per audit from
 * data the audit already collected (area searches, the same-trade competitor
 * list, cached keyword volumes) and stored in facts.areaVisibility. Every
 * report variant and the PDF read that one stored object; monthly audits
 * compare it with the previous audit's. Pure: no I/O.
 *
 * Ranking per area comes from the area searches themselves: each one ran AT
 * the area's coordinates ("<trade> <area>" and "<trade> near me") and found
 * the business's own listing the same way the main grid does (place id, then
 * name, then GPS). Discovery-only expansion rings are not service areas and
 * never appear here. The business's own location is a separate row.
 */
import { competitorKey, type CompetitorFact, type SearchObservation } from './facts.ts';

export const AREA_VISIBILITY_VERSION = 1;

export interface AreaSearchRow {
  keyword: string;
  status: 'ok' | 'unavailable';
  found: boolean;
  /** The business's own position there; null when not in the top 20. */
  rank: number | null;
  /** Monthly searches (Google Ads); null = not enough data. */
  searchVolume: number | null;
}

export interface AreaCompetitor {
  key: string;
  name: string;
  /** Same-trade check result; 'unclassified' when the business's trade is unknown. */
  level: 'confirmed' | 'probable' | 'unclassified';
  /** Best position seen in this area's searches. */
  bestRankHere: number | null;
  /** Every location it was found in across the report. */
  foundIn: string[];
}

export type AreaStatus = 'measured' | 'covered_by_address' | 'not_located' | 'not_searched';

export interface AreaVisibility {
  area: string;
  placeId: string | null;
  status: AreaStatus;
  /** Why an area was not searched separately. */
  note: string | null;
  distanceKm: number | null;
  searches: AreaSearchRow[];
  /** Best position across this area's searches; null = not in the top 20 in any. */
  bestRank: number | null;
  searchesOk: number;
  rankedIn: number;
  competitors: AreaCompetitor[];
}

export interface AreaVisibilityFacts {
  version: number;
  /** Service areas configured on Google (before any were skipped). */
  configured: number;
  /** The business's own location — measured by the main ranking grid, kept separate. */
  primary: { label: string; searches: AreaSearchRow[]; bestRank: number | null; searchesOk: number; rankedIn: number };
  areas: AreaVisibility[];
}

const minRank = (ranks: Array<number | null>): number | null => {
  const r = ranks.filter((x): x is number => typeof x === 'number');
  return r.length ? Math.min(...r) : null;
};

/** One row per phrase (a phrase searched at several points keeps its best position). */
function searchRows(obs: SearchObservation[], volumes: Map<string, number | null>): AreaSearchRow[] {
  const byKw = new Map<string, SearchObservation[]>();
  for (const o of obs) {
    const k = o.keyword.toLowerCase();
    byKw.set(k, [...(byKw.get(k) || []), o]);
  }
  return Array.from(byKw.values()).map((group) => {
    const ok = group.filter((o) => o.status === 'ok');
    const rank = minRank(ok.map((o) => (o.found ? o.rank : null)));
    return {
      keyword: group[0].keyword,
      status: ok.length ? 'ok' : 'unavailable',
      found: rank != null,
      rank,
      searchVolume: volumes.get(group[0].keyword.toLowerCase()) ?? null,
    };
  });
}

function summary(rows: AreaSearchRow[]) {
  const ok = rows.filter((r) => r.status === 'ok');
  return { bestRank: minRank(ok.map((r) => r.rank)), searchesOk: ok.length, rankedIn: ok.filter((r) => r.found).length };
}

/** Same-trade competitors seen (above or below the business) in these searches. */
function competitorsIn(obs: SearchObservation[], counted: CompetitorFact[]): AreaCompetitor[] {
  const byKey = new Map(counted.map((c) => [c.key, c]));
  const best = new Map<string, number>();
  for (const o of obs) {
    if (o.status !== 'ok') continue;
    const seen = [
      ...o.ahead.map((r) => ({ key: competitorKey(r), position: r.position })),
      ...(o.others || []).map((r) => ({ key: competitorKey(r as any), position: r.position })),
    ];
    for (const s of seen) {
      if (!byKey.has(s.key)) continue;
      const prev = best.get(s.key);
      if (prev == null || s.position < prev) best.set(s.key, s.position);
    }
  }
  return Array.from(best.entries())
    .map(([key, bestRankHere]) => {
      const c = byKey.get(key)!;
      const level: AreaCompetitor['level'] = !c.tradeMatch ? 'unclassified' : c.tradeMatch.level === 'confirmed' ? 'confirmed' : 'probable';
      return { key, name: c.name, level, bestRankHere, foundIn: c.foundIn || [] };
    })
    .sort((a, b) => (a.bestRankHere ?? 99) - (b.bestRankHere ?? 99));
}

export function buildAreaVisibility(input: {
  /** Service areas configured on Google (GbpLocationSnapshot … serviceArea.places). */
  serviceAreas: Array<{ placeName: string | null; placeId: string | null }>;
  /** What areaDiscovery searched / skipped (stored as facts.areaDiscovery). */
  discovery: { searched: Array<{ label: string; kind: string; areaName?: string; placeId?: string | null; distanceKm?: number }>; skipped: Array<{ label: string; reason: string }> } | null;
  /** Area-search observations (labelled with `area`). */
  areaObservations: SearchObservation[];
  /** Ranking searches around the business's own address. */
  primaryObservations: SearchObservation[];
  /** Counted (same-trade) competitors, with foundIn. */
  competitors: CompetitorFact[];
  volumes: Map<string, number | null>;
  primaryLabel: string;
}): AreaVisibilityFacts {
  const primarySearches = searchRows(input.primaryObservations, input.volumes);
  const primary = { label: input.primaryLabel, searches: primarySearches, ...summary(primarySearches) };
  const primaryCompetitors = competitorsIn(input.primaryObservations, input.competitors);

  const seen = new Set<string>();
  const areas: AreaVisibility[] = [];
  for (const sa of input.serviceAreas) {
    const name = (sa.placeName || '').trim() || sa.placeId || 'Service area';
    const dedupe = (sa.placeId || name).toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const label = `${name} (service area)`;
    const searched = input.discovery?.searched.filter((s) => s.label === label) || [];
    if (searched.length) {
      const obs = input.areaObservations.filter((o) => o.area === label);
      const rows = searchRows(obs, input.volumes);
      areas.push({
        area: name, placeId: sa.placeId, status: 'measured', note: null,
        distanceKm: searched[0].distanceKm ?? null, searches: rows, ...summary(rows),
        competitors: competitorsIn(obs, input.competitors),
      });
      continue;
    }
    const reason = input.discovery?.skipped.find((s) => s.label === label)?.reason || null;
    const covered = !!reason && /around the business/.test(reason);
    areas.push({
      area: name, placeId: sa.placeId,
      status: covered ? 'covered_by_address' : reason && /could not be resolved/.test(reason) ? 'not_located' : 'not_searched',
      note: covered ? `Within 3 km of your address — measured by the searches around your address` : reason,
      distanceKm: null,
      // A nearby area is what the address searches measured — shown as such, not re-searched.
      searches: covered ? primarySearches : [],
      ...(covered ? summary(primarySearches) : { bestRank: null, searchesOk: 0, rankedIn: 0 }),
      competitors: covered ? primaryCompetitors : [],
    });
  }
  return { version: AREA_VISIBILITY_VERSION, configured: input.serviceAreas.length, primary, areas };
}

// ── Monthly comparison ───────────────────────────────────────────────────────

export interface AreaComparison {
  improving: string[];
  declining: string[];
  notRanking: string[];
  newCompetitors: string[];
  competitorsGaining: string[];
  opportunities: string[];
}

const rankText = (r: number | null) => (r == null ? 'not in top 20' : `#${r}`);
const areaKey = (a: AreaVisibility) => (a.placeId || a.area).toLowerCase();

/** Like-for-like per area: only areas measured in BOTH audits are compared. */
export function compareAreaVisibility(prev: AreaVisibilityFacts | null | undefined, cur: AreaVisibilityFacts | null | undefined): AreaComparison {
  const out: AreaComparison = { improving: [], declining: [], notRanking: [], newCompetitors: [], competitorsGaining: [], opportunities: [] };
  if (!cur) return out;
  const before = new Map((prev?.areas || []).filter((a) => a.status === 'measured').map((a) => [areaKey(a), a]));
  for (const a of cur.areas.filter((x) => x.status === 'measured')) {
    if (a.searchesOk > 0 && a.bestRank == null) out.notRanking.push(`${a.area}: not in the top 20 in ${a.searchesOk} search${a.searchesOk > 1 ? 'es' : ''}`);
    for (const s of a.searches) {
      if (s.status !== 'ok' || (s.rank != null && s.rank <= 3)) continue;
      out.opportunities.push(
        `${a.area}: "${s.keyword}" — you are ${rankText(s.rank)}; ${s.searchVolume != null && s.searchVolume > 0 ? `${s.searchVolume} searches/month` : 'monthly searches: not enough data'}`,
      );
    }
    const p = before.get(areaKey(a));
    if (!p || p.searchesOk === 0 || a.searchesOk === 0) continue;
    const was = p.bestRank;
    const now = a.bestRank;
    if (was !== now) {
      const better = now != null && (was == null || now < was);
      (better ? out.improving : out.declining).push(`${a.area}: ${rankText(was)} → ${rankText(now)}`);
    }
    const prevComp = new Map(p.competitors.map((c) => [c.key, c]));
    for (const c of a.competitors) {
      const old = prevComp.get(c.key);
      if (!old) out.newCompetitors.push(`${a.area}: ${c.name} (${rankText(c.bestRankHere)})`);
      else if (c.bestRankHere != null && (old.bestRankHere == null || c.bestRankHere < old.bestRankHere)) {
        out.competitorsGaining.push(`${a.area}: ${c.name} ${rankText(old.bestRankHere)} → ${rankText(c.bestRankHere)}`);
      }
    }
  }
  // Searches with real demand first.
  out.opportunities.sort((x, y) => Number(/searches\/month$/.test(y) && !/not enough/.test(y)) - Number(/searches\/month$/.test(x) && !/not enough/.test(x)));
  return out;
}

/** Measured lines for the SEO Brain / AI (every number in them is from stored data). */
export function areaStrategyLines(cur: AreaVisibilityFacts | null | undefined, cmp?: AreaComparison | null): string[] {
  if (!cur?.areas.length) return [];
  const lines = cur.areas
    .filter((a) => a.status === 'measured')
    .map((a) => {
      const best = a.bestRank == null ? 'not in the top 20' : `best position #${a.bestRank}`;
      const comps = a.competitors.slice(0, 3).map((c) => c.name);
      return `Service area ${a.area}: ${best} in ${a.searchesOk} search${a.searchesOk === 1 ? '' : 'es'}${comps.length ? `; same-trade competitors there: ${comps.join(', ')}` : ''}`;
    });
  if (cmp) {
    for (const l of cmp.improving) lines.push(`Service-area visibility improved — ${l}`);
    for (const l of cmp.declining) lines.push(`Service-area visibility declined — ${l}`);
    for (const l of cmp.newCompetitors.slice(0, 3)) lines.push(`New competitor in a service area — ${l}`);
    for (const l of cmp.competitorsGaining.slice(0, 3)) lines.push(`Competitor gaining in a service area — ${l}`);
  }
  return lines.slice(0, 12);
}

// ── Display (shared by every report variant and the PDF) ─────────────────────

export interface AreaPhraseView { keyword: string; position: string; demand: string }
export interface AreaCompetitorView { name: string; relevance: string; position: string; foundIn: string }
export interface AreaRowView {
  area: string;
  /** Empty when measured; otherwise why the area has no separate searches. */
  status: string;
  distance: string | null;
  position: string;
  phrases: AreaPhraseView[];
  competitors: AreaCompetitorView[];
}

const RELEVANCE_TEXT: Record<AreaCompetitor['level'], string> = {
  confirmed: 'Same trade — confirmed',
  probable: 'Same trade — probable',
  unclassified: 'Not classified',
};

const positionText = (r: AreaSearchRow) => (r.status !== 'ok' ? 'Unavailable' : r.rank != null ? `#${r.rank}` : 'Not in top 20');
const demandText = (v: number | null) => (v != null && v > 0 ? `${v.toLocaleString('en-IN')}/month` : 'Not enough data');

function rowView(area: string, status: string, distanceKm: number | null, searches: AreaSearchRow[], bestRank: number | null, searchesOk: number, competitors: AreaCompetitor[]): AreaRowView {
  return {
    area,
    status,
    distance: distanceKm != null ? `${distanceKm} km away` : null,
    position: searchesOk === 0 ? 'Not measured' : bestRank != null ? `Best #${bestRank}` : 'Not in top 20',
    phrases: searches.map((s) => ({ keyword: s.keyword, position: positionText(s), demand: demandText(s.searchVolume) })),
    competitors: competitors.slice(0, 8).map((c) => ({
      name: c.name,
      relevance: RELEVANCE_TEXT[c.level],
      position: c.bestRankHere != null ? `#${c.bestRankHere}` : '—',
      foundIn: c.foundIn.join(', '),
    })),
  };
}

const STATUS_TEXT: Record<AreaStatus, (note: string | null) => string> = {
  measured: () => '',
  covered_by_address: () => 'Within 3 km of your address — measured by the searches around your address',
  not_located: () => 'Google could not locate this area, so it was not searched',
  not_searched: (note) => `Not searched separately (${note || 'skipped'})`,
};

/** Display rows for every report variant and the PDF; null when the audit has no area data. */
export function areaVisibilityView(av: AreaVisibilityFacts | null | undefined): { primary: AreaRowView; areas: AreaRowView[] } | null {
  if (!av || !Array.isArray(av.areas) || av.areas.length === 0) return null;
  const p = av.primary;
  return {
    primary: rowView(p.label, '', null, p.searches, p.bestRank, p.searchesOk, []),
    areas: av.areas.map((a) => rowView(a.area, STATUS_TEXT[a.status](a.note), a.distanceKm, a.searches, a.bestRank, a.searchesOk, a.competitors)),
  };
}
