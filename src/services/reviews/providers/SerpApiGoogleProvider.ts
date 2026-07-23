import axios from 'axios';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { ProviderReview, FetchReviewsOptions } from './MockGoogleProvider';

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const BASE_URL = 'https://serpapi.com/search.json';

/**
 * Turns a SerpApi/axios failure into a human-readable message. SerpApi reports
 * problems in two ways: an HTTP error (e.g. 429 when the account is out of
 * searches) with `{ error }` in the body, OR a 200 response that still carries
 * an `error` field. Both must surface to the user instead of silently
 * returning zero reviews.
 */
function serpApiErrorMessage(err: any): string {
  const apiError = err?.response?.data?.error;
  if (apiError) return apiError;
  if (err?.response?.status === 429) return 'Review provider quota exhausted (SerpApi account is out of searches).';
  return err?.message || 'Unknown review provider error';
}

// SerpApi's google_maps_reviews engine needs a data_id in hex format (0x...:0x...)
// which is DIFFERENT from Google's own place_id (ChIJ...).
// We resolve it once via the google_maps engine and cache it on the Business document.
const MAX_REVIEWS = parseInt(process.env.MAX_REVIEWS_PER_AUDIT || '50', 10);

export class SerpApiGoogleProvider {
  private async resolveDataId(businessId: string): Promise<string> {
    await dbConnect();
    const business = await Business.findById(businessId);
    if (!business) throw new Error(`Business not found: ${businessId}`);

    if (business.serpApiDataId) {
      console.log(`[SerpApiGoogleProvider] Using cached data_id for ${business.name}`);
      return business.serpApiDataId;
    }

    console.log(`[SerpApiGoogleProvider] Resolving data_id for ${business.name} (placeId: ${business.placeId})`);

    // Use place_id lookup first (most accurate), fall back to name+city query
    const params: Record<string, string> = {
      engine: 'google_maps',
      api_key: SERPAPI_KEY!,
    };

    if (business.placeId) {
      params.place_id = business.placeId;
      params.type = 'place';
    } else {
      params.q = [business.name, business.city, business.address].filter(Boolean).join(', ');
    }

    let response;
    try {
      response = await axios.get(BASE_URL, { params });
    } catch (err: any) {
      throw new Error(`SerpApi lookup failed for ${business.name}: ${serpApiErrorMessage(err)}`);
    }
    // SerpApi can return HTTP 200 with an error field (e.g. quota exhausted).
    if (response.data?.error) {
      throw new Error(`SerpApi lookup failed for ${business.name}: ${response.data.error}`);
    }
    const result = response.data.place_results ?? response.data.local_results?.[0];

    if (!result) {
      throw new Error(`SerpApi returned no place result for business: ${business.name}`);
    }

    // SerpApi returns data_id (hex) separately from place_id (Google's ChIJ format)
    const dataId: string | undefined = result.data_id;
    if (!dataId) {
      throw new Error(
        `SerpApi did not return a data_id for ${business.name}. ` +
        `Response fields: ${Object.keys(result).join(', ')}`
      );
    }

    // Cache data_id + harvest photo count and hours presence from the same response
    // so profile-completion scoring has real data without extra API calls.
    const updatePayload: Record<string, any> = { serpApiDataId: dataId };
    if (typeof result.photos === 'number') updatePayload.photoCount = result.photos;
    else if (Array.isArray(result.photos)) updatePayload.photoCount = result.photos.length;
    if (result.hours || result.operating_hours) updatePayload.hasHours = true;
    await Business.findByIdAndUpdate(businessId, updatePayload);
    console.log(`[SerpApiGoogleProvider] Resolved and cached data_id=${dataId} for ${business.name}`);
    return dataId;
  }

  async fetchReviews(businessId: string, options?: FetchReviewsOptions): Promise<ProviderReview[]> {
    if (!SERPAPI_KEY) {
      throw new Error('[SerpApiGoogleProvider] SERPAPI_KEY is not set');
    }

    // Resolution failures (quota exhausted, no place found, etc.) must PROPAGATE
    // so the caller can show the real reason instead of a silent "0 reviews".
    const dataId: string = await this.resolveDataId(businessId);

    // Incremental "fetch only new" mode: when we already have reviews stored,
    // pull newest-first and stop as soon as we reach one we've seen — a nightly
    // re-sync then costs ~1 API call instead of ~10. First-ever sync (no known
    // ids) still back-fills up to MAX_REVIEWS.
    const knownReviewIds = options?.knownReviewIds;
    const incremental = !!(knownReviewIds && knownReviewIds.size > 0);

    const reviews: ProviderReview[] = [];
    let nextPageToken: string | undefined;
    let firstPage = true;
    let reachedKnown = false;

    do {
      try {
        const params: Record<string, string> = {
          engine: 'google_maps_reviews',
          data_id: dataId,
          api_key: SERPAPI_KEY,
          // Newest-first so the early-stop below is correct: once we hit a known
          // review, everything after it is older and already stored.
          sort_by: 'newestFirst',
        };
        if (nextPageToken) params.next_page_token = nextPageToken;

        const response = await axios.get(BASE_URL, { params });
        // Surface a hard error on the first page (e.g. quota exhausted); on
        // later pages we keep whatever we already collected.
        if (response.data?.error && firstPage) {
          throw new Error(`SerpApi reviews fetch failed: ${response.data.error}`);
        }
        const page: any[] = response.data.reviews ?? [];

        for (const r of page) {
          if (reviews.length >= MAX_REVIEWS) break;

          // Stable unique ID: prefer review_id, fall back to a composite
          const providerReviewId: string =
            r.review_id ??
            r.id ??
            `serp-${dataId}-${r.iso_date ?? r.date ?? reviews.length}`;

          // Reached already-synced territory — stop; nothing after is new.
          if (incremental && knownReviewIds!.has(providerReviewId)) {
            reachedKnown = true;
            break;
          }

          reviews.push({
            providerReviewId,
            reviewerName: r.user?.name ?? 'Anonymous',
            rating: typeof r.rating === 'number' ? r.rating : parseInt(r.rating, 10) || 0,
            text: r.snippet ?? r.text ?? '',
            postedAt: r.iso_date ?? new Date().toISOString(),
          });
        }

        firstPage = false;
        nextPageToken =
          !reachedKnown && reviews.length < MAX_REVIEWS
            ? (response.data.serpapi_pagination?.next_page_token ?? undefined)
            : undefined;

      } catch (err: any) {
        // First page failing is a hard error (quota/auth) — propagate so the
        // caller can explain it. Later pages failing is transient — keep what
        // we already have.
        if (firstPage) {
          throw new Error(`SerpApi reviews fetch failed: ${serpApiErrorMessage(err)}`);
        }
        console.error(`[SerpApiGoogleProvider] Error fetching reviews page for data_id=${dataId}:`, err.message);
        break;
      }
    } while (nextPageToken);

    console.log(
      `[SerpApiGoogleProvider] Fetched ${reviews.length} ${incremental ? 'new ' : ''}reviews for businessId=${businessId}` +
      `${incremental && reachedKnown ? ' (stopped at first already-synced review)' : ''}`
    );
    return reviews;
  }
}
