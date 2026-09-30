import axios from 'axios';
import { meter } from '@/lib/providerMeter';

const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;
const MAPS_LIVE_URL = 'https://api.dataforseo.com/v3/serp/google/maps/live/advanced';

export const dataForSeoConfigured = !!(DATAFORSEO_LOGIN && DATAFORSEO_PASSWORD);

/**
 * Thrown instead of a plain Error so callers can tell "the API call itself
 * failed" apart from "the API call succeeded and genuinely found nothing" —
 * without this, both looked identical (empty results, rank stuck at the
 * NOT_FOUND sentinel), which is exactly what happened Aug 2026: an
 * unverified DataForSEO account (HTTP 403, status_code 40104) was
 * indistinguishable from "not ranking nearby" until someone reproduced the
 * raw request by hand. `category` lets a caller decide whether this is
 * worth surfacing differently (an account/config problem is actionable and
 * ongoing; a rate limit is transient; "not found" isn't an error at all).
 */
export class DataForSeoApiError extends Error {
  category: 'account' | 'rate_limit' | 'server' | 'unknown';
  constructor(message: string, category: 'account' | 'rate_limit' | 'server' | 'unknown') {
    super(message);
    this.name = 'DataForSeoApiError';
    this.category = category;
  }
}

function classifyDataForSeoFailure(err: any): DataForSeoApiError {
  const httpStatus = err?.response?.status;
  const body = err?.response?.data;
  const statusMessage = body?.status_message || err?.message || 'DataForSEO request failed';

  if (httpStatus === 401 || httpStatus === 403) {
    return new DataForSeoApiError(statusMessage, 'account');
  }
  if (httpStatus === 429) {
    return new DataForSeoApiError(statusMessage, 'rate_limit');
  }
  if (httpStatus != null && httpStatus >= 500) {
    return new DataForSeoApiError(statusMessage, 'server');
  }
  return new DataForSeoApiError(statusMessage, 'unknown');
}

/** For the "HTTP 200 but body status_code != 20000" case (see comment at
 *  the call site) — DataForSEO's 4xxxx range covers auth/account/
 *  validation/client errors; 40104 (unverified account) is the one we've
 *  confirmed live (Aug 2026), so the whole range defaults to 'account'
 *  rather than guessing at sub-range boundaries we haven't verified. */
function classifyDataForSeoStatusCode(statusCode: number | undefined, statusMessage: string | undefined): DataForSeoApiError {
  const message = statusMessage || `DataForSEO status_code ${statusCode}`;
  if (statusCode != null && statusCode >= 40000 && statusCode < 50000) {
    return new DataForSeoApiError(message, 'account');
  }
  if (statusCode != null && statusCode >= 50000) {
    return new DataForSeoApiError(message, 'server');
  }
  return new DataForSeoApiError(message, 'unknown');
}

/** Local-pack result item, normalized to the shape the rest of seoAnalyzer.ts
 *  already expects (findTargetRank / competitor harvesting read these fields). */
export interface MapsLocalResult {
  title: string;
  place_id?: string;
  data_id?: string;
  rating?: number;
  reviews?: number;
  /** The listing's own Google category, from the same response (no extra cost). */
  category?: string;
  address?: string;
  /** Public listing fields Google shows on Maps — same response, no extra cost. */
  website?: string;
  phone?: string;
  additionalCategories?: string[];
  hasHours?: boolean;
  bookingUrl?: string;
  isClaimed?: boolean;
  totalPhotos?: number;
}

export interface MapsQuery {
  keyword: string;
  point?: { lat: number; lng: number };
  business?: any;
}

function buildTask(q: MapsQuery): Record<string, any> {
  const task: Record<string, any> = { keyword: q.keyword, language_code: 'en' };
  if (q.point) {
    task.location_coordinate = `${q.point.lat},${q.point.lng},14z`;
  } else {
    const business = q.business || {};
    task.location_name =
      [business.city, business.state, business.country].filter(Boolean).join(',') ||
      business.country ||
      'India';
  }
  return task;
}

function extractResults(taskResult: any): MapsLocalResult[] | null {
  // Per-task failures (e.g. one bad location) shouldn't blow up the whole
  // batch — but they must stay distinguishable from "searched, not found":
  // null = this search is unavailable (a data-quality state), [] = a real
  // search that returned no listings.
  if (taskResult?.status_code !== 20000) return null;
  const items: any[] = taskResult.result?.[0]?.items || [];
  return items
    .filter((item: any) => item.type === 'maps_search')
    .map((item: any) => ({
      title: item.title,
      place_id: item.place_id,
      data_id: item.cid,
      rating: item.rating?.value,
      reviews: item.rating?.votes_count,
      category: item.category || undefined,
      address: item.address || undefined,
      website: item.url || undefined,
      phone: item.phone || undefined,
      additionalCategories: Array.isArray(item.additional_categories) ? item.additional_categories : undefined,
      hasHours: typeof item.work_hours === 'object' || item.work_hours === true ? true : undefined,
      bookingUrl: item.book_online_url || undefined,
      isClaimed: typeof item.is_claimed === 'boolean' ? item.is_claimed : undefined,
      totalPhotos: typeof item.total_photos === 'number' ? item.total_photos : undefined,
    }));
}

/**
 * Google Maps local-pack results for many keyword/grid-point combinations.
 *
 * ONE TASK PER REQUEST (fixed Sep 2026). DataForSEO's Maps *Live* endpoint
 * rejects every task after the first in a multi-task POST with status 40000
 * "You can set only one task at a time" — confirmed live. The previous
 * batching (up to 100 tasks per POST) meant only the first search of every
 * batch ever ran: a 45-point grid returned 1 real result and 44 failures,
 * which the old engine then reported as "not found / 20+". Requests now go
 * out individually with bounded concurrency.
 *
 * Results are returned in the same order as `queries`; a null entry means
 * that search failed (unavailable), distinct from an empty result. An
 * account/auth failure aborts the whole call (thrown) — it is never turned
 * into per-search "not found".
 */
const MAPS_CONCURRENCY = 20; // well under DataForSEO's 2,000 calls/min limit
const MAPS_TASK_RETRIES = 2;

async function fetchOneMapsTask(q: MapsQuery, timeout: number): Promise<MapsLocalResult[] | null> {
  for (let attempt = 0; attempt <= MAPS_TASK_RETRIES; attempt++) {
    let res;
    try {
      res = await axios.post(MAPS_LIVE_URL, [buildTask(q)], {
        auth: { username: DATAFORSEO_LOGIN!, password: DATAFORSEO_PASSWORD! },
        timeout,
      });
      meter('dataForSeoMapsLiveTask', 1, q.point ? 'rank_search_grid_point' : 'rank_search_city');
    } catch (err: any) {
      const e = classifyDataForSeoFailure(err);
      if (e.category === 'account') throw e;
      if (attempt < MAPS_TASK_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      console.warn(`[dataForSeo] Maps task "${q.keyword}" failed (${e.category}): ${e.message}`);
      return null;
    }
    // HTTP 200 with a failed envelope = auth/balance/validation problem for
    // the whole account → abort (never "business not found").
    if (res.data?.status_code !== 20000) {
      const e = classifyDataForSeoStatusCode(res.data?.status_code, res.data?.status_message);
      if (e.category === 'account') throw e;
      if (attempt < MAPS_TASK_RETRIES) continue;
      return null;
    }
    const task = res.data.tasks?.[0];
    // 40102 "No Search Results": the search ran and Google showed no local
    // results — a real, empty result list (target not found), not a failure.
    if (task?.status_code === 40102) return [];
    if (task?.status_code !== 20000) {
      // Server-side hiccups (5xxxx) are retried; anything else is logged once.
      if (String(task?.status_code ?? '').startsWith('5') && attempt < MAPS_TASK_RETRIES) continue;
      console.warn(`[dataForSeo] Maps task "${q.keyword}" failed: ${task?.status_code} ${task?.status_message}`);
      return null;
    }
    return extractResults(task);
  }
  return null;
}

export async function fetchMapsLocalResultsBatch(
  queries: MapsQuery[],
  opts: { timeout?: number } = {},
): Promise<Array<MapsLocalResult[] | null>> {
  // Not configured → every search is unavailable (null), never "not found".
  if (!dataForSeoConfigured || queries.length === 0) return queries.map(() => null);

  const timeout = opts.timeout ?? 45000;
  const out: Array<MapsLocalResult[] | null> = new Array(queries.length).fill(null);
  let next = 0;
  let abort: unknown = null;
  const worker = async () => {
    while (next < queries.length && !abort) {
      const i = next++;
      try {
        out[i] = await fetchOneMapsTask(queries[i], timeout);
      } catch (err) {
        abort = err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAPS_CONCURRENCY, queries.length) }, worker));
  if (abort) throw abort;
  const failed = out.filter((r) => r === null).length;
  if (failed) console.warn(`[dataForSeo] ${failed}/${queries.length} Maps searches unavailable`);
  return out;
}

/** Single-query convenience wrapper over the batch call, for the rare
 *  one-off lookup (e.g. the no-coordinates fallback path). */
export async function fetchMapsLocalResults(
  keyword: string,
  opts: { point?: { lat: number; lng: number }; business?: any; timeout?: number } = {},
): Promise<MapsLocalResult[] | null> {
  const [results] = await fetchMapsLocalResultsBatch(
    [{ keyword, point: opts.point, business: opts.business }],
    { timeout: opts.timeout },
  );
  return results;
}
