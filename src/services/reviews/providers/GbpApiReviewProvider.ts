import { getValidToken } from '@/lib/gbpClient';
import dbConnect from '@/lib/mongodb';
import GBPToken from '@/models/GBPToken';
import type { ProviderReview, FetchReviewsOptions, ProviderReviewTotals, ProviderRunInfo } from './MockGoogleProvider';
import { collectGbpReviews } from './gbpReviewPaging';
import { describeGoogleApiError } from '@/lib/googleApiError';

/**
 * Reviews sourced from the OFFICIAL Google Business Profile API (My Business v4
 * `accounts/{a}/locations/{l}/reviews`).
 *
 * Advantages over the SerpApi scrape:
 *  - Real Google review IDs → owner replies can be posted back (replyToReview).
 *  - The COMPLETE review set (paginated), not a bounded scrape → nothing missing.
 *  - The existing owner reply comes back with each review → replies stay in sync.
 *
 * Requires the business to have a connected GBPToken and the v4 Google My
 * Business API enabled/allow-listed on the Cloud project.
 */
const MYBUSINESS_V4_BASE = 'https://mybusiness.googleapis.com/v4';
// The import cap is separate from MAX_REVIEWS_PER_AUDIT (which only limits
// how many stored reviews one audit reads): FR-3.2 needs the full review
// history, so the import pages up to GBP_REVIEW_IMPORT_MAX (default 1000).
const DEFAULT_IMPORT_MAX = 1000;
const PAGE_SIZE = 50;

function importMax(): number {
  const n = parseInt(process.env.GBP_REVIEW_IMPORT_MAX || '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_IMPORT_MAX;
}

export class GbpApiReviewProvider {
  /** Lifetime totals from the last fetchReviews() call (see syncReviews.ts). */
  lastTotals: ProviderReviewTotals | null = null;
  /** What the last fetchReviews() call covered (mode, pages, cap). */
  lastRun: ProviderRunInfo | null = null;

  async fetchReviews(businessId: string, options?: FetchReviewsOptions): Promise<ProviderReview[]> {
    await dbConnect();
    const tokenDoc = await GBPToken.findOne({ businessId });
    if (!tokenDoc?.accountId || !tokenDoc?.locationId) {
      throw new Error('No GBP account/location linked to this business — reconnect Google.');
    }
    const accessToken = await getValidToken(businessId);
    const name = tokenDoc.locationId.includes('/locations/')
      ? tokenDoc.locationId
      : `${tokenDoc.accountId}/${tokenDoc.locationId}`;

    // Explicit mode from syncReviews.ts; otherwise the original behaviour
    // (stop at the first already-known id when any are known).
    const mode = options?.mode
      ?? (options?.knownReviewIds && options.knownReviewIds.size > 0 ? 'known_ids' : 'full');

    this.lastTotals = null;
    this.lastRun = null;
    const { reviews, totals, run } = await collectGbpReviews(
      async (pageToken) => {
        const params = new URLSearchParams({ pageSize: String(PAGE_SIZE), orderBy: 'updateTime desc' });
        if (pageToken) params.set('pageToken', pageToken);
        const res = await fetch(`${MYBUSINESS_V4_BASE}/${name}/reviews?${params.toString()}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          const err = await res.text();
          throw describeGoogleApiError('reviews.list', res.status, err);
        }
        return res.json();
      },
      {
        mode,
        maxReviews: options?.maxReviews ?? importMax(),
        sinceUpdateTime: options?.sinceUpdateTime ?? null,
        knownReviewIds: options?.knownReviewIds,
      },
    );
    this.lastTotals = totals;
    this.lastRun = run;

    console.log(
      `[GbpApiReviewProvider] Fetched ${reviews.length} reviews (${run.mode}, ${run.pages} page(s)${run.hitCap ? ', import cap reached' : ''}) for businessId=${businessId}`
    );
    return reviews;
  }
}
