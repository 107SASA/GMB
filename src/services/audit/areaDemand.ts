/**
 * Local demand Google actually reports.
 *
 * Google Ads has no volume for most hyper-local phrases ("website development
 * ojhar", "best electronics store labpur" — Nov 2026: 399 of 446 cached
 * phrases came back empty): too few people search that exact wording. It does
 * report the broad service term in a real Google Ads location — the
 * customer's city, or else their state. So for every keyword we also ask:
 *
 *   "website development ojhar"  →  "website development" in Nashik (city)
 *                                    or in Maharashtra (state)
 *
 * The location list comes from DataForSEO's free Google Ads locations
 * endpoint, stored for 30 days. The volumes use the same 45-day cache as
 * every other volume. Never throws.
 */
import axios from 'axios';
import { fetchSearchVolumes } from './keywordVolumeClient';

export interface AreaDemand {
  /** The broad phrase measured ("website development"). */
  term: string;
  /** Where it was measured ("Nashik" / "Maharashtra"). */
  area: string;
  level: 'city' | 'state';
  /** Google Ads monthly searches there; null = Google has no data. */
  searchVolume: number | null;
}

interface AdsLocation { code: number; name: string; type: string }

const LOCATIONS_TTL_MS = 30 * 24 * 3_600_000;
const COUNTRY_ISO: Record<string, string> = {
  india: 'in', 'united states': 'us', usa: 'us', us: 'us', 'united kingdom': 'gb', uk: 'gb',
  canada: 'ca', australia: 'au', 'united arab emirates': 'ae', uae: 'ae', singapore: 'sg',
};

const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function countryIsoOf(hint?: string | null): string {
  const raw = norm(hint);
  if (COUNTRY_ISO[raw]) return COUNTRY_ISO[raw];
  const last = String(hint || '').split(',').map(norm).filter(Boolean).pop();
  return (last && COUNTRY_ISO[last]) || 'in';
}

/** Google Ads locations for one country, from the 30-day store (or DataForSEO). */
async function adsLocations(countryIso: string): Promise<AdsLocation[]> {
  let coll: any = null;
  try {
    await (await import('@/lib/mongodb')).default();
    coll = (await import('mongoose')).default.connection.db!.collection('googleadslocations');
    const doc: any = await coll.findOne({ countryIso });
    if (doc && Date.now() - new Date(doc.fetchedAt).getTime() < LOCATIONS_TTL_MS && Array.isArray(doc.rows)) return doc.rows;
  } catch (err: any) {
    console.warn('[areaDemand] location store read skipped:', err?.message);
  }
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return [];
  try {
    const res = await axios.get(`https://api.dataforseo.com/v3/keywords_data/google_ads/locations/${countryIso}`, {
      auth: { username: login, password },
      timeout: 30000,
    });
    const result: any[] = res.data?.tasks?.[0]?.result || [];
    const rows: AdsLocation[] = result
      .filter((r) => r && typeof r.location_code === 'number' && r.location_name && (r.location_type === 'City' || r.location_type === 'State' || r.location_type === 'Region' || r.location_type === 'District' || r.location_type === 'Union Territory'))
      .map((r) => ({ code: r.location_code, name: String(r.location_name), type: String(r.location_type) }));
    if (rows.length && coll) {
      await coll.updateOne({ countryIso }, { $set: { countryIso, fetchedAt: new Date(), rows } }, { upsert: true }).catch(() => {});
    }
    console.log(`[areaDemand] ${rows.length} Google Ads locations for ${countryIso}`);
    return rows;
  } catch (err: any) {
    console.warn(`[areaDemand] location list failed (HTTP ${err?.response?.status ?? '?'}):`, err?.message);
    return [];
  }
}

/**
 * The customer's place as Google Ads locations, narrowest first: their city
 * (or the area, when it is itself a city), then their state. Pure — exported
 * for tests. Names read "City,State,Country" or "City,District,State,Country"
 * ("Kolkata,Kolkata,West Bengal,India"), so the state is the part before the
 * country.
 */
export function pickAdsLocations(rows: AdsLocation[], place: { city?: string | null; area?: string | null; state?: string | null }):
  Array<{ code: number; area: string; level: 'city' | 'state' }> {
  const state = norm(place.state);
  const parts = (r: AdsLocation) => r.name.split(',');
  const first = (r: AdsLocation) => norm(parts(r)[0]);
  const stateOf = (r: AdsLocation) => { const p = parts(r); return norm(p.length >= 3 ? p[p.length - 2] : p[1]); };
  const out: Array<{ code: number; area: string; level: 'city' | 'state' }> = [];
  for (const want of [place.city, place.area].map((x) => norm(String(x || '').split(',')[0])).filter(Boolean)) {
    const cities = rows.filter((r) => (r.type === 'City' || r.type === 'District') && first(r) === want);
    const hit = cities.find((r) => !state || stateOf(r) === state) || (state ? null : cities[0]);
    if (hit && !out.some((o) => o.code === hit.code)) out.push({ code: hit.code, area: parts(hit)[0], level: 'city' });
  }
  if (state) {
    const region = rows.find((r) => (r.type === 'State' || r.type === 'Union Territory') && first(r) === state)
      || rows.find((r) => r.type === 'Region' && first(r) === state);
    if (region) out.push({ code: region.code, area: parts(region)[0], level: 'state' });
  }
  return out;
}

const FILLER = new Set(['best', 'top', 'near', 'me', 'in', 'at', 'nearby', 'around', 'cheap', 'good', 'no', '1']);

/**
 * "best website development ojhar" → "website development": the keyword
 * without its place names and "best / top / near me". null when nothing
 * meaningful is left. Pure — exported for tests.
 */
export function headTerm(keyword: string, placeNames: string[]): string | null {
  const places = new Set(placeNames.flatMap((p) => String(p || '').split(',')).map(norm).filter(Boolean).flatMap((p) => [p, ...p.split(' ')]));
  const words = norm(keyword).split(' ').filter((w) => w && !FILLER.has(w) && !places.has(w));
  // Multi-word place names ("new delhi") are removed as a phrase too.
  let term = words.join(' ');
  for (const p of places) if (p.includes(' ')) term = term.replace(new RegExp(`\\b${p}\\b`, 'g'), ' ');
  term = term.replace(/\s+/g, ' ').trim();
  return term && /[a-z]/.test(term) ? term : null;
}

/**
 * For each keyword, the broad term's monthly searches in the customer's city
 * (or state). Map keyed by the lowercased keyword. One volume call at most.
 */
export async function areaDemandFor(
  keywords: string[],
  place: { city?: string | null; area?: string | null; state?: string | null; country?: string | null },
): Promise<Map<string, AreaDemand>> {
  const out = new Map<string, AreaDemand>();
  try {
    const placeNames = [place.city, place.area, place.state, place.country].filter(Boolean) as string[];
    const termOf = new Map<string, string>();
    for (const k of keywords) {
      const t = headTerm(k, placeNames);
      if (t) termOf.set(String(k).trim().toLowerCase(), t);
    }
    if (!termOf.size) return out;
    const locs = pickAdsLocations(await adsLocations(countryIsoOf(place.country)), place);
    // Narrowest place first; a term Google can't count there is asked one level up.
    let pending = [...new Set(termOf.values())];
    const found = new Map<string, AreaDemand>();
    for (const loc of locs) {
      if (!pending.length) break;
      const volumes = await fetchSearchVolumes(pending, { locationCode: loc.code });
      for (const term of pending) {
        if (!volumes.has(term)) continue; // not measured here
        const v = volumes.get(term) ?? null;
        if (v != null || !found.has(term)) found.set(term, { term, area: loc.area, level: loc.level, searchVolume: v });
      }
      pending = pending.filter((t) => found.get(t)?.searchVolume == null);
    }
    for (const [kw, term] of termOf) {
      const hit = found.get(term);
      if (hit) out.set(kw, hit);
    }
  } catch (err: any) {
    console.warn('[areaDemand] skipped:', err?.message);
  }
  return out;
}
