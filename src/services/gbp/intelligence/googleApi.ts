/**
 * Google HTTP calls used by the GBP Intelligence sync. No database access and
 * no `@/` imports, so request construction is testable under `node --test`
 * with an injected fetch. Every call is read-only.
 *
 * Endpoints (all under the existing `business.manage` scope, except Places
 * which uses the existing GOOGLE_MAPS_API_KEY):
 *   - Business Information v1  GET locations/{id}?readMask=…           (profile, hours, categories, services, metadata)
 *   - Business Information v1  GET locations/{id}/attributes
 *   - Business Information v1  GET locations/{id}:getGoogleUpdated      (only when metadata.hasGoogleUpdated)
 *   - My Business Verifications v1 GET locations/{id}/VoiceOfMerchantState
 *   - My Business v4           GET accounts/{a}/locations/{l}/localPosts (paginated)
 *   - Places API (New)         POST places:searchText                    (duplicate check, cached 30 days)
 */
import { classifyGoogleError, GoogleApiRequestError, sanitizeErrorMessage } from './errors.ts';
import { GOOGLE_UPDATED_READ_MASK, LOCATION_READ_MASK } from './normalize.ts';
import type { PlaceCandidate } from './duplicates.ts';

export const BIZINFO_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';
export const VERIFICATIONS_BASE = 'https://mybusinessverifications.googleapis.com/v1';
export const MYBUSINESS_V4_BASE = 'https://mybusiness.googleapis.com/v4';
export const PLACES_SEARCH_TEXT_URL = 'https://places.googleapis.com/v1/places:searchText';

export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

export const MAX_POST_PAGES = 5; // 100 per page → up to 500 posts per sync

async function getJson(fetchFn: FetchFn, url: string, accessToken: string, label: string): Promise<any> {
  let res;
  try {
    res = await fetchFn(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (err: any) {
    throw new GoogleApiRequestError('TEMPORARY', null, `${label}: network error — ${sanitizeErrorMessage(String(err?.message || err))}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GoogleApiRequestError(classifyGoogleError(res.status, body), res.status, `${label} ${res.status}: ${sanitizeErrorMessage(body)}`);
  }
  return res.json();
}

/** "locations/123" (v1 resource) — GBPToken.locationId may also be "accounts/a/locations/l". */
export function v1LocationName(locationId: string): string {
  const i = locationId.indexOf('locations/');
  return i >= 0 ? locationId.slice(i) : locationId;
}

/** "accounts/a/locations/l" (v4 resource). */
export function v4LocationName(accountId: string | null | undefined, locationId: string): string {
  if (locationId.includes('/locations/')) return locationId;
  return `${accountId}/${v1LocationName(locationId)}`;
}

export interface GbpReadApi {
  getLocation(accessToken: string, locationId: string): Promise<any>;
  getAttributes(accessToken: string, locationId: string): Promise<any>;
  getVoiceOfMerchantState(accessToken: string, locationId: string): Promise<any>;
  getGoogleUpdated(accessToken: string, locationId: string): Promise<any>;
  listLocalPosts(accessToken: string, accountId: string | null, locationId: string): Promise<{ posts: any[]; truncated: boolean }>;
}

export function createGbpReadApi(fetchFn: FetchFn): GbpReadApi {
  return {
    getLocation: (token, locationId) =>
      getJson(fetchFn, `${BIZINFO_BASE}/${v1LocationName(locationId)}?readMask=${encodeURIComponent(LOCATION_READ_MASK)}`, token, 'locations.get'),
    getAttributes: (token, locationId) =>
      getJson(fetchFn, `${BIZINFO_BASE}/${v1LocationName(locationId)}/attributes`, token, 'locations.getAttributes'),
    getVoiceOfMerchantState: (token, locationId) =>
      getJson(fetchFn, `${VERIFICATIONS_BASE}/${v1LocationName(locationId)}/VoiceOfMerchantState`, token, 'locations.getVoiceOfMerchantState'),
    getGoogleUpdated: (token, locationId) =>
      getJson(fetchFn, `${BIZINFO_BASE}/${v1LocationName(locationId)}:getGoogleUpdated?readMask=${encodeURIComponent(GOOGLE_UPDATED_READ_MASK)}`, token, 'locations.getGoogleUpdated'),
    async listLocalPosts(token, accountId, locationId) {
      const name = v4LocationName(accountId, locationId);
      const posts: any[] = [];
      let pageToken: string | undefined;
      let pages = 0;
      do {
        const params = new URLSearchParams({ pageSize: '100' });
        if (pageToken) params.set('pageToken', pageToken);
        const data = await getJson(fetchFn, `${MYBUSINESS_V4_BASE}/${name}/localPosts?${params.toString()}`, token, 'localPosts.list');
        posts.push(...(Array.isArray(data?.localPosts) ? data.localPosts : []));
        pageToken = data?.nextPageToken || undefined;
        pages++;
      } while (pageToken && pages < MAX_POST_PAGES);
      return { posts, truncated: !!pageToken };
    },
  };
}

/**
 * Places API (New) Text Search around the verified pin. One request; the
 * field mask asks only for what duplicate scoring needs.
 */
export async function searchPlacesNear(
  fetchFn: FetchFn,
  apiKey: string,
  query: string,
  center: { latitude: number; longitude: number },
  radiusMeters: number,
): Promise<PlaceCandidate[]> {
  let res;
  try {
    res = await fetchFn(PLACES_SEARCH_TEXT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.location',
      },
      body: JSON.stringify({
        textQuery: query,
        pageSize: 10,
        locationBias: { circle: { center, radius: radiusMeters } },
      }),
    });
  } catch (err: any) {
    throw new GoogleApiRequestError('TEMPORARY', null, `places.searchText: network error — ${sanitizeErrorMessage(String(err?.message || err))}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GoogleApiRequestError(classifyGoogleError(res.status, body), res.status, `places.searchText ${res.status}: ${sanitizeErrorMessage(body)}`);
  }
  const data = await res.json();
  return (Array.isArray(data?.places) ? data.places : []).map((p: any) => ({
    placeId: String(p?.id || ''),
    name: String(p?.displayName?.text || ''),
    address: p?.formattedAddress ? String(p.formattedAddress) : null,
    phone: p?.internationalPhoneNumber || p?.nationalPhoneNumber || null,
    location: Number.isFinite(p?.location?.latitude) && Number.isFinite(p?.location?.longitude)
      ? { latitude: Number(p.location.latitude), longitude: Number(p.location.longitude) }
      : null,
  }));
}
