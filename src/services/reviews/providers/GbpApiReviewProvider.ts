import { getValidToken } from '@/lib/gbpClient';
import dbConnect from '@/lib/mongodb';
import GBPToken from '@/models/GBPToken';
import { ProviderReview, FetchReviewsOptions } from './MockGoogleProvider';

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
const MAX_REVIEWS = parseInt(process.env.MAX_REVIEWS_PER_AUDIT || '200', 10);
const PAGE_SIZE = 50;

// Google returns star ratings as an enum, not a number.
const STAR_MAP: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export class GbpApiReviewProvider {
  async fetchReviews(businessId: string, options?: FetchReviewsOptions): Promise<ProviderReview[]> {
    await dbConnect();
    const tokenDoc = await GBPToken.findOne({ businessId });
    if (!tokenDoc?.accountId || !tokenDoc?.locationId) {
      throw new Error('No GBP account/location linked to this business — reconnect Google.');
    }
    const accessToken = await getValidToken(businessId);

    // v4 needs the full "accounts/{a}/locations/{l}" resource name.
    const name = tokenDoc.locationId.includes('/locations/')
      ? tokenDoc.locationId
      : `${tokenDoc.accountId}/${tokenDoc.locationId}`;

    const knownReviewIds = options?.knownReviewIds;
    const incremental = !!(knownReviewIds && knownReviewIds.size > 0);

    const reviews: ProviderReview[] = [];
    let pageToken: string | undefined;
    let reachedKnown = false;

    do {
      const params = new URLSearchParams({
        pageSize: String(PAGE_SIZE),
        orderBy: 'updateTime desc',
      });
      if (pageToken) params.set('pageToken', pageToken);

      const res = await fetch(`${MYBUSINESS_V4_BASE}/${name}/reviews?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`GBP reviews.list failed: ${res.status} ${err}`);
      }
      const data = await res.json();
      const page: any[] = data.reviews ?? [];

      for (const r of page) {
        if (reviews.length >= MAX_REVIEWS) break;
        const providerReviewId: string = r.reviewId ?? (r.name ? String(r.name).split('/').pop() : '');
        if (!providerReviewId) continue;

        // Early-stop on nightly re-syncs once we hit an already-stored review.
        if (incremental && knownReviewIds!.has(providerReviewId)) {
          reachedKnown = true;
          break;
        }

        reviews.push({
          providerReviewId,
          reviewerName: r.reviewer?.displayName ?? 'Anonymous',
          rating: STAR_MAP[r.starRating] ?? 0,
          text: r.comment ?? '',
          postedAt: r.createTime ?? new Date().toISOString(),
          ownerReply: r.reviewReply?.comment ?? undefined,
        });
      }

      pageToken =
        !reachedKnown && reviews.length < MAX_REVIEWS ? (data.nextPageToken ?? undefined) : undefined;
    } while (pageToken);

    console.log(
      `[GbpApiReviewProvider] Fetched ${reviews.length} ${incremental ? 'new ' : ''}reviews for businessId=${businessId}` +
        `${incremental && reachedKnown ? ' (stopped at first already-synced review)' : ''}`
    );
    return reviews;
  }
}
