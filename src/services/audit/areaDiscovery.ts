/**
 * WHERE to look for competitors — separate from WHETHER a business found
 * there is one (that is competitorRelevance.ts). Pure: Google lookups and
 * Maps searches are passed in, so tests run without network.
 *
 * Priority:
 *  1. the business's own location (the existing ranking grid — not repeated here);
 *  2. every configured Google Business Profile service area
 *     (GbpLocationSnapshot … serviceArea.places[]), nearest first;
 *  3. rings around the business, progressively wider, only while too few
 *     relevant competitors have been found.
 *
 * Cost: one Maps search per location (the trade phrase, e.g. "Fireworks
 * Store Ojhar"); locations within MIN_SEPARATION_KM of one already searched
 * are skipped (same results); a hard cap on searches per report.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface ServiceAreaPlace {
  placeName: string | null;
  placeId: string | null;
}

export interface AreaSearch {
  /** Where this search ran, as shown in the report ("Ojhar (service area)"). */
  label: string;
  kind: 'service_area' | 'expansion';
  keyword: string;
  point: GeoPoint;
  /** Distance from the business, rounded to 0.1 km. */
  distanceKm: number;
}

export const AREA_DISCOVERY_LIMITS = {
  /** Service areas searched per report, nearest first. */
  maxServiceAreas: 6,
  /** The ranking grid already covers ±1.5 km; anything closer than this to a searched point repeats it. */
  minSeparationKm: 3,
  /** Expansion rings (km from the business), tried in order while results are insufficient. */
  expansionRingsKm: [6, 12],
  /** Points per ring: N, E, S, W. */
  ringDirections: 4,
  /** Fewer relevant competitors than this → expand. */
  minRelevantCompetitors: 3,
  /** Hard cap on searches this module may add to one report. */
  maxSearches: 12,
};

export type AreaDiscoveryLimits = typeof AREA_DISCOVERY_LIMITS;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** "Fireworks Store" + "Ojhar" → "Fireworks Store Ojhar" (no repeat when the term already names it). */
function keywordFor(term: string, place?: string | null): string {
  const t = term.trim();
  if (!place) return t;
  return t.toLowerCase().includes(place.toLowerCase()) ? t : `${t} ${place}`;
}

/**
 * Service areas → searches: nearest first, skipping any too close to the
 * business or to an area already chosen, capped at maxServiceAreas.
 */
export function planServiceAreaSearches(
  pin: GeoPoint,
  searchTerm: string,
  areas: Array<{ name: string; point: GeoPoint }>,
  limits: AreaDiscoveryLimits = AREA_DISCOVERY_LIMITS,
): { searches: AreaSearch[]; skipped: Array<{ label: string; reason: string }> } {
  const searches: AreaSearch[] = [];
  const skipped: Array<{ label: string; reason: string }> = [];
  const taken: GeoPoint[] = [pin];
  const sorted = [...areas].sort((a, b) => haversineKm(pin, a.point) - haversineKm(pin, b.point));
  for (const a of sorted) {
    const label = `${a.name} (service area)`;
    if (searches.length >= limits.maxServiceAreas) { skipped.push({ label, reason: 'service-area limit reached' }); continue; }
    const near = taken.find((p) => haversineKm(p, a.point) < limits.minSeparationKm);
    if (near) {
      skipped.push({ label, reason: near === pin ? 'already covered by the search around the business' : 'already covered by a nearby service area' });
      continue;
    }
    taken.push(a.point);
    searches.push({ label, kind: 'service_area', keyword: keywordFor(searchTerm, a.name), point: a.point, distanceKm: round1(haversineKm(pin, a.point)) });
  }
  return { searches, skipped };
}

const DIRECTIONS: Array<{ name: string; dLat: number; dLng: number }> = [
  { name: 'north', dLat: 1, dLng: 0 },
  { name: 'east', dLat: 0, dLng: 1 },
  { name: 'south', dLat: -1, dLng: 0 },
  { name: 'west', dLat: 0, dLng: -1 },
];

/** Points `radiusKm` from the business, skipping any already covered by a searched point. */
export function planRingSearches(
  pin: GeoPoint,
  searchTerm: string,
  radiusKm: number,
  covered: GeoPoint[],
  limits: AreaDiscoveryLimits = AREA_DISCOVERY_LIMITS,
): AreaSearch[] {
  const latPerKm = 1 / 111;
  const lngPerKm = 1 / (111 * Math.cos((pin.lat * Math.PI) / 180));
  return DIRECTIONS.slice(0, limits.ringDirections)
    .map((d) => ({
      d,
      point: {
        lat: Number((pin.lat + d.dLat * radiusKm * latPerKm).toFixed(6)),
        lng: Number((pin.lng + d.dLng * radiusKm * lngPerKm).toFixed(6)),
      },
    }))
    .filter(({ point }) => !covered.some((c) => haversineKm(c, point) < limits.minSeparationKm))
    .map(({ d, point }) => ({
      label: `~${radiusKm} km ${d.name}`,
      kind: 'expansion' as const,
      keyword: searchTerm.trim(),
      point,
      distanceKm: radiusKm,
    }));
}

export interface AreaDiscoveryDeps<O> {
  /** Service area → coordinates (place id preferred, else name); null when unknown. */
  resolve: (area: ServiceAreaPlace) => Promise<GeoPoint | null>;
  /** Runs Maps searches; one observation per search, labelled with its AreaSearch.label. */
  search: (searches: AreaSearch[]) => Promise<O[]>;
  /** How many relevant competitors these observations yield (with the ranking searches). Infinity = never expand. */
  relevantCount: (observations: O[]) => number;
}

export interface AreaDiscoveryResult<O> {
  observations: O[];
  searched: AreaSearch[];
  skipped: Array<{ label: string; reason: string }>;
  /** Expansion rings actually searched (km). */
  expandedToKm: number[];
}

export async function discoverCompetitorAreas<O>(
  input: { pin: GeoPoint; searchTerm: string; serviceAreas: ServiceAreaPlace[] },
  deps: AreaDiscoveryDeps<O>,
  limits: AreaDiscoveryLimits = AREA_DISCOVERY_LIMITS,
): Promise<AreaDiscoveryResult<O>> {
  const searchTerm = input.searchTerm.trim();
  const out: AreaDiscoveryResult<O> = { observations: [], searched: [], skipped: [], expandedToKm: [] };
  if (!searchTerm) return out;

  // 2. Configured service areas (deduplicated by place id / name before any lookup).
  const seen = new Set<string>();
  const unique = input.serviceAreas.filter((a) => {
    const key = (a.placeId || a.placeName || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const resolved = await Promise.all(unique.map(async (a) => ({ a, point: await deps.resolve(a).catch(() => null) })));
  for (const r of resolved) if (!r.point) out.skipped.push({ label: `${r.a.placeName || r.a.placeId} (service area)`, reason: 'location could not be resolved' });
  const plan = planServiceAreaSearches(
    input.pin,
    searchTerm,
    resolved.filter((r) => r.point).map((r) => ({ name: r.a.placeName || 'Service area', point: r.point! })),
    limits,
  );
  out.skipped.push(...plan.skipped);
  const budget = (n: AreaSearch[]) => n.slice(0, Math.max(0, limits.maxSearches - out.searched.length));
  const run = async (searches: AreaSearch[]) => {
    const batch = budget(searches);
    if (!batch.length) return;
    out.observations.push(...(await deps.search(batch)));
    out.searched.push(...batch);
  };
  await run(plan.searches);

  // 3. Progressive expansion while relevant competitors are insufficient.
  for (const radius of limits.expansionRingsKm) {
    if (out.searched.length >= limits.maxSearches) break;
    if (deps.relevantCount(out.observations) >= limits.minRelevantCompetitors) break;
    const covered = [input.pin, ...out.searched.map((s) => s.point)];
    const ring = planRingSearches(input.pin, searchTerm, radius, covered, limits);
    if (!ring.length) continue;
    out.expandedToKm.push(radius);
    await run(ring);
  }
  return out;
}
