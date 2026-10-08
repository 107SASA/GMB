/**
 * Duplicate listing detection (FR-3.6) — pure scoring (runs under `node --test`).
 *
 * Two signals:
 *   1. Google's own flag: Location.metadata.duplicateLocation (free — comes
 *      with the location read every sync).
 *   2. A Google Places search around the verified pin for the business name,
 *      scored on Name / Address / Phone / distance. The search is cached and
 *      re-run only when the cache is older than PLACES_RECHECK_DAYS or the NAP
 *      itself changed — dashboard loads never call Places.
 * Nothing is ever merged, removed or edited — results are recommendations.
 */
import type { DuplicateCandidate, GbpLocationData } from './types.ts';
import { canonPhone, canonText } from './changes.ts';

export const PLACES_RECHECK_DAYS = 30;
const SEARCH_RADIUS_M = 1000;
export { SEARCH_RADIUS_M };

const STOP = new Set(['the', 'and', '&', 'pvt', 'ltd', 'private', 'limited', 'llp', 'inc', 'co', 'company', 'of', 'in', 'at', 'a']);

export function nameTokens(name: string | null | undefined): string[] {
  return canonText(name)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
}

/** Dice coefficient over word tokens (0..1). */
export function tokenSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (!x.length || !y.length) return 0;
  const ys = new Set(y);
  const common = new Set(x.filter((t) => ys.has(t))).size;
  return (2 * common) / (new Set(x).size + ys.size);
}

export function haversineMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export interface PlaceCandidate {
  placeId: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  location?: { latitude: number; longitude: number } | null;
}

/** Score one Places result against the business's own NAP. */
export function scoreCandidate(own: GbpLocationData, c: PlaceCandidate): DuplicateCandidate | null {
  if (!c.placeId || (own.metadata.placeId && c.placeId === own.metadata.placeId)) return null;
  const signals: string[] = [];
  let score = 0;

  const ownPhone = canonPhone(own.primaryPhone);
  const theirPhone = canonPhone(c.phone);
  const samePhone = ownPhone.length >= 8 && ownPhone === theirPhone;
  if (samePhone) { score += 0.5; signals.push('same phone number'); }

  const nameSim = tokenSimilarity(own.title, c.name);
  if (nameSim >= 0.85) { score += 0.3; signals.push('very similar name'); }
  else if (nameSim >= 0.6) { score += 0.15; signals.push('similar name'); }

  const addrSim = tokenSimilarity(own.address?.formatted, c.address);
  if (addrSim >= 0.75) { score += 0.15; signals.push('very similar address'); }
  else if (addrSim >= 0.5) { score += 0.07; signals.push('similar address'); }

  let distance: number | null = null;
  if (own.latlng && c.location) {
    distance = haversineMeters(own.latlng, c.location);
    if (distance <= 100) { score += 0.15; signals.push('within 100 m'); }
    else if (distance <= 500) { score += 0.05; signals.push('within 500 m'); }
  }

  // Never call something a duplicate on proximity alone (shared buildings).
  if (!samePhone && nameSim < 0.6) return null;
  score = Math.min(1, Math.round(score * 100) / 100);
  const confidence: DuplicateCandidate['confidence'] =
    (samePhone && (nameSim >= 0.6 || (distance != null && distance <= 500))) || (nameSim >= 0.85 && addrSim >= 0.75 && distance != null && distance <= 200)
      ? 'high'
      : score >= 0.45 ? 'medium' : 'low';
  if (confidence === 'low') return null;
  return {
    placeId: c.placeId,
    name: c.name,
    address: c.address ?? null,
    phone: c.phone ?? null,
    distanceMeters: distance,
    signals,
    confidence,
    score,
  };
}

export function rankCandidates(own: GbpLocationData, places: PlaceCandidate[]): DuplicateCandidate[] {
  return places
    .map((p) => scoreCandidate(own, p))
    .filter((x): x is DuplicateCandidate => !!x)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/** Stable fingerprint of the NAP the Places search ran for. */
export function napFingerprint(own: GbpLocationData): string {
  return [canonText(own.title), canonText(own.address?.formatted), canonPhone(own.primaryPhone),
    own.latlng ? `${own.latlng.latitude.toFixed(3)},${own.latlng.longitude.toFixed(3)}` : ''].join('|');
}

/** Places is called only when there is something to search and the cache is stale or the NAP changed. */
export function needsPlacesSearch(
  own: GbpLocationData,
  cached: { placesCheckedAt: string | null; napFingerprint: string | null } | null | undefined,
  now: Date,
  force = false,
): boolean {
  if (!own.title || !own.latlng) return false;
  if (force || !cached?.placesCheckedAt) return true;
  if (cached.napFingerprint !== napFingerprint(own)) return true;
  return now.getTime() - new Date(cached.placesCheckedAt).getTime() > PLACES_RECHECK_DAYS * 86_400_000;
}
