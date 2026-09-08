import axios from 'axios';
import { generateGeoGrid, GRID_SPACING_KM } from './geoGrid';

/**
 * Named neighbourhoods around a business, used to seed hyper-local keywords
 * ("IT Training Institute Bidhannagar") and to render the report's
 * "Areas checked: Bidhannagar, Rajarhat, Newtown, …" line.
 *
 * Reverse-geocodes a ring of points around the pin with the Google Geocoding
 * API and keeps the sublocality / neighbourhood component. ~8 cheap calls
 * per audit; the whole ranking block is cached downstream so this doesn't
 * re-run for a repeat lookup of the same listing.
 */

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

// Names a searcher would never type: "Ward Number 58", "Zone 4", bare
// abbreviations ("P.O.", "PS", "GPO"), pure numbers, "Post Office" tails.
const JUNK_LOCALITY = /^(ward\s*(number|no\.?)?\s*\d+|zone\s*\d+|p\.?\s*o\.?|p\.?\s*s\.?|g\.?\s*p\.?\s*o\.?|post\s*office|police\s*station|pin\s*\d+)$/i;

function cleanLocality(name: string): string | null {
  let n = (name || '').trim().replace(/\s+/g, ' ');
  // strip a trailing " P.O." / " Post Office" / " (Kolkata)" etc.
  n = n.replace(/\s*[,(]?\s*(p\.?\s*o\.?|post\s*office|g\.?p\.?o\.?)\s*[)]?$/i, '').trim();
  if (!n || n.length < 3 || n.length > 40) return null;
  if (JUNK_LOCALITY.test(n)) return null;
  if (/^\d+$/.test(n)) return null;
  // Drop things that are just a single letter + "Block" ("A Block") — too
  // ambiguous to search; keep two-letter block codes ("BP Block", "AE Block")
  // which are real, well-known Kolkata locality names.
  if (/^[a-z]\s*block$/i.test(n)) return null;
  return n;
}

async function reverseGeocodeLocality(
  lat: number,
  lng: number,
  apiKey: string,
): Promise<{ locality: string | null; city: string | null }> {
  try {
    const { data } = await axios.get(GEOCODE_URL, {
      params: { latlng: `${lat},${lng}`, key: apiKey },
      timeout: 8000,
    });
    if (data.status !== 'OK' || !Array.isArray(data.results)) return { locality: null, city: null };

    // Prefer the more recognisable "neighbourhood" / broader sublocality over
    // a granular block code where both exist ("Bidhannagar" over "BP Block").
    const byTier: Record<number, string | null> = {};
    let city: string | null = null;
    for (const result of data.results) {
      for (const comp of result.address_components || []) {
        const types: string[] = comp.types || [];
        const name = cleanLocality(comp.long_name);
        if (!name) continue;
        if (types.includes('neighborhood')) byTier[0] = byTier[0] || name;
        else if (types.includes('sublocality') && !types.includes('sublocality_level_1')) byTier[1] = byTier[1] || name;
        else if (types.includes('sublocality_level_1')) byTier[2] = byTier[2] || name;
        else if (types.includes('sublocality_level_2')) byTier[3] = byTier[3] || name;
        if (!city && types.includes('locality')) city = cleanLocality(comp.long_name);
      }
    }
    const locality = byTier[0] || byTier[1] || byTier[2] || byTier[3] || null;
    return { locality, city };
  } catch {
    return { locality: null, city: null };
  }
}

export interface NearbyLocalities {
  /** Ordered, de-duplicated neighbourhood names (nearest-ish first). */
  neighbourhoods: string[];
  /** Locality/city name Google returns for the pin, if any. */
  resolvedCity: string | null;
}

/**
 * Resolve up to `limit` distinct neighbourhood names around a coordinate.
 * Returns an empty list (never throws) when the key is missing or geocoding
 * fails — callers fall back to city-level keywords only.
 */
export async function fetchNearbyLocalities(
  center: { lat: number; lng: number } | undefined | null,
  opts: { limit?: number; spacingKm?: number } = {},
): Promise<NearbyLocalities> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
  const limit = opts.limit ?? 8;
  if (!apiKey || !center?.lat || !center?.lng) {
    return { neighbourhoods: [], resolvedCity: null };
  }

  // Centre + the 8 outer points of a 3×3 grid — a ring roughly 1.5 km out.
  const grid = generateGeoGrid(center.lat, center.lng, opts.spacingKm ?? GRID_SPACING_KM);
  const points = [
    grid.find((p) => p.row === 0 && p.col === 0)!,
    ...grid.filter((p) => !(p.row === 0 && p.col === 0)),
  ].filter(Boolean);

  const seen = new Set<string>();
  const neighbourhoods: string[] = [];
  let resolvedCity: string | null = null;

  // Small concurrency — 8 quick calls, no need to hammer.
  const CHUNK = 4;
  for (let i = 0; i < points.length && neighbourhoods.length < limit; i += CHUNK) {
    const batch = points.slice(i, i + CHUNK);
    const results = await Promise.all(
      batch.map((p) => reverseGeocodeLocality(p.lat, p.lng, apiKey)),
    );
    for (const r of results) {
      if (!resolvedCity && r.city) resolvedCity = r.city;
      if (r.locality) {
        const key = r.locality.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          neighbourhoods.push(r.locality);
        }
      }
    }
  }

  return { neighbourhoods: neighbourhoods.slice(0, limit), resolvedCity };
}
