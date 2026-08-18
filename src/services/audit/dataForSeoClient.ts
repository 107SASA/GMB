import axios from 'axios';

const DATAFORSEO_LOGIN = process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.env.DATAFORSEO_PASSWORD;
const MAPS_LIVE_URL = 'https://api.dataforseo.com/v3/serp/google/maps/live/advanced';
// DataForSEO's own cap on tasks per POST — batches larger than this are chunked.
const MAX_TASKS_PER_REQUEST = 100;

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

function extractResults(taskResult: any): MapsLocalResult[] {
  // Per-task failures (e.g. one bad location) shouldn't blow up the whole
  // batch — just treat that grid point as "no results" like a failed
  // individual call used to.
  if (taskResult?.status_code !== 20000) return [];
  const items: any[] = taskResult.result?.[0]?.items || [];
  return items
    .filter((item: any) => item.type === 'maps_search')
    .map((item: any) => ({
      title: item.title,
      place_id: item.place_id,
      data_id: item.cid,
      rating: item.rating?.value,
      reviews: item.rating?.votes_count,
    }));
}

/**
 * Google Maps local-pack results for many keyword/grid-point combinations in
 * as few HTTP round trips as possible. DataForSEO's Live endpoint accepts an
 * array of tasks in one POST (up to MAX_TASKS_PER_REQUEST) and processes them
 * server-side before responding — so a 45-query geo-grid becomes 1 request
 * instead of 45 individually-throttled ones, which is what made audits slow.
 * Results are returned in the same order as `queries`.
 */
export async function fetchMapsLocalResultsBatch(
  queries: MapsQuery[],
  opts: { timeout?: number } = {},
): Promise<MapsLocalResult[][]> {
  if (!dataForSeoConfigured || queries.length === 0) return queries.map(() => []);

  const chunks: MapsQuery[][] = [];
  for (let i = 0; i < queries.length; i += MAX_TASKS_PER_REQUEST) {
    chunks.push(queries.slice(i, i + MAX_TASKS_PER_REQUEST));
  }

  const chunkResults = await Promise.all(
    chunks.map(async (chunk) => {
      let res;
      try {
        res = await axios.post(MAPS_LIVE_URL, chunk.map(buildTask), {
          auth: { username: DATAFORSEO_LOGIN!, password: DATAFORSEO_PASSWORD! },
          // Live-batch responses only arrive once every task in the chunk has
          // resolved server-side, so this needs real headroom over the
          // single-task timeout, not just chunk-count * 15s.
          timeout: opts.timeout ?? 60000,
        });
      } catch (err: any) {
        // A real non-2xx HTTP response (confirmed live, Aug 2026: an
        // unverified DataForSEO account returns HTTP 403 here, not a 200
        // with a bad status_code — DataForSEO's failure modes aren't
        // consistent about which layer reports the error).
        throw classifyDataForSeoFailure(err);
      }

      // DataForSEO also returns HTTP 200 for some auth/balance/validation
      // failures — the real outcome is in status_code (20000 = ok). Without
      // this check, bad creds would silently look like "business not found"
      // on every grid point instead of erroring loudly.
      if (res.data?.status_code !== 20000) {
        throw classifyDataForSeoStatusCode(res.data?.status_code, res.data?.status_message);
      }

      const tasks: any[] = res.data.tasks || [];
      return chunk.map((_, i) => extractResults(tasks[i]));
    }),
  );

  return chunkResults.flat();
}

/** Single-query convenience wrapper over the batch call, for the rare
 *  one-off lookup (e.g. the no-coordinates fallback path). */
export async function fetchMapsLocalResults(
  keyword: string,
  opts: { point?: { lat: number; lng: number }; business?: any; timeout?: number } = {},
): Promise<MapsLocalResult[]> {
  const [results] = await fetchMapsLocalResultsBatch(
    [{ keyword, point: opts.point, business: opts.business }],
    { timeout: opts.timeout },
  );
  return results;
}
