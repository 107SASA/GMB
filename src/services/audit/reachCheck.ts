/**
 * Reach check (docs/FREE_REPORT_REBUILD_PLAN.md Part D step 5): the free
 * report's main keyword, searched farther from the business, so a strong
 * listing that is #1 next to its own door also sees where it stops showing
 * up (Nov 2026: Modern Jewellery tools, #1 everywhere around the shop).
 *
 * Where it searches depends only on answer 2 / 3 of §3.2 (served how,
 * offered) — the same for every category. Pure: no I/O.
 */
import { haversineKm, type GeoPoint } from './areaDiscovery.ts';
import type { SearchObservation } from './facts.ts';

export const REACH_LIMITS = {
  /** Never two searches closer than this (the ±1.5 km grid already covers the address). */
  minSeparationKm: 2.5,
  /** Searches added per report. */
  maxPoints: 6,
};

type Dir = 'north' | 'east' | 'south' | 'west';
const VEC: Record<Dir, { dLat: number; dLng: number }> = {
  north: { dLat: 1, dLng: 0 }, east: { dLat: 0, dLng: 1 }, south: { dLat: -1, dLng: 0 }, west: { dLat: 0, dLng: -1 },
};

/** Distances × directions by how the business serves and what it offers. */
export function reachRings(servedHow: string | null | undefined, offered: string | null | undefined): Array<{ km: number; dir: Dir }> {
  if (servedHow === 'online') return [{ km: 15, dir: 'east' }, { km: 30, dir: 'west' }];
  // Makers / wholesalers / traders sell across the city and beyond.
  if (offered === 'made_to_order') return [{ km: 6, dir: 'east' }, { km: 10, dir: 'west' }, { km: 25, dir: 'north' }, { km: 25, dir: 'south' }];
  // Service-area / hybrid: the areas served are searched separately; add two farther points.
  if (servedHow === 'service_area' || servedHow === 'hybrid') return [{ km: 6, dir: 'east' }, { km: 10, dir: 'west' }];
  // A shop / office customers visit: how far around it the business still shows.
  return [{ km: 3, dir: 'north' }, { km: 6, dir: 'east' }, { km: 6, dir: 'west' }, { km: 10, dir: 'south' }];
}

export interface ReachPlace {
  label: string;
  kind: 'ring' | 'city_centre';
  keyword: string;
  point: GeoPoint;
  distanceKm: number;
}

function offset(pin: GeoPoint, km: number, dir: Dir): GeoPoint {
  const latPerKm = 1 / 111;
  const lngPerKm = 1 / (111 * Math.cos((pin.lat * Math.PI) / 180));
  return {
    lat: Number((pin.lat + VEC[dir].dLat * km * latPerKm).toFixed(6)),
    lng: Number((pin.lng + VEC[dir].dLng * km * lngPerKm).toFixed(6)),
  };
}

/**
 * The extra places the main keyword is searched from. The city centre comes
 * first for businesses that sell city-wide (makers / online / service-area);
 * no place repeats one already searched (grid, areas served).
 */
export function planReachSearches(input: {
  pin: GeoPoint;
  keyword: string;
  servedHow?: string | null;
  offered?: string | null;
  city?: string | null;
  cityCentre?: GeoPoint | null;
  /** Points already searched this report (grid, areas served). */
  covered: GeoPoint[];
  limits?: Partial<typeof REACH_LIMITS>;
}): ReachPlace[] {
  const L = { ...REACH_LIMITS, ...(input.limits || {}) };
  const keyword = String(input.keyword || '').trim();
  if (!keyword) return [];
  const taken: GeoPoint[] = [input.pin, ...input.covered];
  const out: ReachPlace[] = [];
  const add = (p: ReachPlace) => {
    if (out.length >= L.maxPoints) return;
    if (taken.some((t) => haversineKm(t, p.point) < L.minSeparationKm)) return;
    taken.push(p.point);
    out.push(p);
  };
  const cityWide = input.servedHow === 'online' || input.servedHow === 'service_area' || input.servedHow === 'hybrid' || input.offered === 'made_to_order';
  if (cityWide && input.cityCentre) {
    const km = Math.round(haversineKm(input.pin, input.cityCentre) * 10) / 10;
    add({ label: `${input.city || 'City'} centre`, kind: 'city_centre', keyword, point: input.cityCentre, distanceKm: km });
  }
  for (const r of reachRings(input.servedHow, input.offered)) {
    add({ label: `~${r.km} km ${r.dir}`, kind: 'ring', keyword, point: offset(input.pin, r.km, r.dir), distanceKm: r.km });
  }
  return out;
}

export interface ReachPoint {
  label: string;
  kind: ReachPlace['kind'];
  distanceKm: number;
  status: 'ok' | 'unavailable';
  /** 1-based position, null = not in the top 20. */
  rank: number | null;
  /** The first business Google showed there (a same-trade one when known). */
  shownFirst: string | null;
}

export interface ReachFacts {
  keyword: string;
  points: ReachPoint[];
  /** Farthest distance up to which every measured place shows the business in the top 3 (null = not even the nearest). */
  top3WithinKm: number | null;
  /** Measured places where the business is not in the top 10. */
  weakIn: string[];
}

/** Observations of the reach searches → what the report shows. Unmeasured searches are never "not found". */
export function buildReachFacts(
  keyword: string,
  places: ReachPlace[],
  observations: SearchObservation[],
  opts: { sameTrade?: (name: string) => boolean } = {},
): ReachFacts | null {
  if (!places.length) return null;
  const byLabel = new Map(observations.map((o) => [o.area || '', o]));
  const points: ReachPoint[] = places.map((p) => {
    const o = byLabel.get(p.label);
    const ok = !!o && o.status === 'ok';
    const ahead = ok ? o!.ahead || [] : [];
    const first = ahead.find((a) => opts.sameTrade?.(a.name)) || ahead[0];
    return {
      label: p.label,
      kind: p.kind,
      distanceKm: p.distanceKm,
      status: ok ? ('ok' as const) : ('unavailable' as const),
      rank: ok && o!.found ? o!.rank : null,
      shownFirst: ok ? (o!.rank === 1 ? null : first?.name ?? null) : null,
    };
  }).sort((a, b) => a.distanceKm - b.distanceKm);
  const measured = points.filter((p) => p.status === 'ok');
  if (!measured.length) return { keyword, points, top3WithinKm: null, weakIn: [] };
  let top3WithinKm: number | null = null;
  for (const p of measured) {
    if (p.rank != null && p.rank <= 3) top3WithinKm = p.distanceKm;
    else break;
  }
  return {
    keyword,
    points,
    top3WithinKm,
    weakIn: measured.filter((p) => p.rank == null || p.rank > 10).map((p) => p.label),
  };
}
