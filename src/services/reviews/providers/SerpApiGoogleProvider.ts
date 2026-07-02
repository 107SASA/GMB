import axios from 'axios';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { ProviderReview } from './MockGoogleProvider';

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const BASE_URL = 'https://serpapi.com/search.json';

// SerpApi's google_maps_reviews engine needs a data_id in hex format (0x...:0x...)
// which is DIFFERENT from Google's own place_id (ChIJ...).
// We resolve it once via the google_maps engine and cache it on the Business document.
const MAX_REVIEWS = parseInt(process.env.MAX_REVIEWS_PER_AUDIT || '100', 10);

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

    const response = await axios.get(BASE_URL, { params });
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

  async fetchReviews(businessId: string): Promise<ProviderReview[]> {
    if (!SERPAPI_KEY) {
      throw new Error('[SerpApiGoogleProvider] SERPAPI_KEY is not set');
    }

    let dataId: string;
    try {
      dataId = await this.resolveDataId(businessId);
    } catch (err: any) {
      console.error(`[SerpApiGoogleProvider] data_id resolution failed for ${businessId}:`, err.message);
      return [];
    }

    const reviews: ProviderReview[] = [];
    let nextPageToken: string | undefined;

    do {
      try {
        const params: Record<string, string> = {
          engine: 'google_maps_reviews',
          data_id: dataId,
          api_key: SERPAPI_KEY,
        };
        if (nextPageToken) params.next_page_token = nextPageToken;

        const response = await axios.get(BASE_URL, { params });
        const page: any[] = response.data.reviews ?? [];

        for (const r of page) {
          if (reviews.length >= MAX_REVIEWS) break;

          // Stable unique ID: prefer review_id, fall back to a composite
          const providerReviewId: string =
            r.review_id ??
            r.id ??
            `serp-${dataId}-${r.iso_date ?? r.date ?? reviews.length}`;

          reviews.push({
            providerReviewId,
            reviewerName: r.user?.name ?? 'Anonymous',
            rating: typeof r.rating === 'number' ? r.rating : parseInt(r.rating, 10) || 0,
            text: r.snippet ?? r.text ?? '',
            postedAt: r.iso_date ?? new Date().toISOString(),
          });
        }

        nextPageToken =
          reviews.length < MAX_REVIEWS
            ? (response.data.serpapi_pagination?.next_page_token ?? undefined)
            : undefined;

      } catch (err: any) {
        // Rate limit or transient error — stop pagination, return what we have
        console.error(`[SerpApiGoogleProvider] Error fetching reviews page for data_id=${dataId}:`, err.message);
        break;
      }
    } while (nextPageToken);

    console.log(`[SerpApiGoogleProvider] Fetched ${reviews.length} reviews for businessId=${businessId}`);
    return reviews;
  }
}
