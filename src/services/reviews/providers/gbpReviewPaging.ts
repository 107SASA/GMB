/**
 * Paging rules for the official GBP reviews list (v4 accounts/{a}/locations/{l}/reviews,
 * ordered `updateTime desc`). Pure — runs under `node --test` with mocked pages.
 *
 *   full         page through everything up to maxReviews (initial import,
 *                and a periodic backfill when fewer reviews are stored than
 *                Google reports)
 *   incremental  stop at the first review whose updateTime is at or before the
 *                watermark (sinceUpdateTime). Because the list is ordered by
 *                updateTime, an owner reply or edit made directly on Google
 *                to an OLD review moves it to the top and is re-imported.
 *   known_ids    original behaviour (no watermark yet): stop at the first
 *                already-stored review id.
 */
import type { ProviderReview, ProviderReviewTotals, ProviderRunInfo } from './MockGoogleProvider.ts';

export const STAR_MAP: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export interface GbpReviewPage {
  reviews?: any[];
  nextPageToken?: string;
  totalReviewCount?: number;
  averageRating?: number;
}

export interface CollectOptions {
  mode: 'full' | 'incremental' | 'known_ids';
  maxReviews: number;
  sinceUpdateTime?: string | null;
  knownReviewIds?: Set<string>;
}

export async function collectGbpReviews(
  fetchPage: (pageToken: string | undefined) => Promise<GbpReviewPage>,
  opts: CollectOptions,
): Promise<{ reviews: ProviderReview[]; totals: ProviderReviewTotals | null; run: ProviderRunInfo }> {
  const reviews: ProviderReview[] = [];
  let totals: ProviderReviewTotals | null = null;
  let pageToken: string | undefined;
  let pages = 0;
  let stop = false;
  let hitCap = false;
  let maxUpdateTime: string | null = null;

  do {
    const data = await fetchPage(pageToken);
    pages++;
    if (!totals && typeof data.totalReviewCount === 'number') {
      totals = {
        count: data.totalReviewCount,
        rating: typeof data.averageRating === 'number' ? Math.round(data.averageRating * 10) / 10 : null,
      };
    }
    for (const r of data.reviews ?? []) {
      if (reviews.length >= opts.maxReviews) { hitCap = true; stop = true; break; }
      const providerReviewId: string = r.reviewId ?? (r.name ? String(r.name).split('/').pop() : '');
      if (!providerReviewId) continue;
      const updateTime: string | undefined = r.updateTime ?? r.createTime ?? undefined;
      if (opts.mode === 'incremental' && opts.sinceUpdateTime && updateTime && updateTime <= opts.sinceUpdateTime) { stop = true; break; }
      if (opts.mode === 'known_ids' && opts.knownReviewIds?.has(providerReviewId)) { stop = true; break; }
      if (updateTime && (!maxUpdateTime || updateTime > maxUpdateTime)) maxUpdateTime = updateTime;
      reviews.push({
        providerReviewId,
        reviewerName: r.reviewer?.displayName ?? 'Anonymous',
        rating: STAR_MAP[r.starRating] ?? 0,
        text: r.comment ?? '',
        postedAt: r.createTime ?? new Date().toISOString(),
        ownerReply: r.reviewReply?.comment ?? undefined,
        reviewerPhotoUrl: r.reviewer?.profilePhotoUrl ?? undefined,
        updateTime,
      });
    }
    if (!stop && reviews.length >= opts.maxReviews && data.nextPageToken) { hitCap = true; stop = true; }
    pageToken = stop ? undefined : data.nextPageToken || undefined;
  } while (pageToken);

  return { reviews, totals, run: { mode: opts.mode, pages, fetched: reviews.length, hitCap, maxUpdateTime } };
}

/**
 * Decide the mode for one sync. A full pass runs on the first sync, when the
 * stored count is below Google's total (backfill), at most once per
 * FULL_BACKFILL_MIN_HOURS so a business with more reviews than the cap does
 * not page through everything on every run.
 */
export const FULL_BACKFILL_MIN_HOURS = 24;

export function chooseReviewSyncMode(input: {
  storedCount: number;
  googleTotal: number | null | undefined;
  watermark: string | null | undefined;
  lastFullSyncAt: Date | string | null | undefined;
  now: Date;
}): 'full' | 'incremental' | 'known_ids' {
  const lastFull = input.lastFullSyncAt ? new Date(input.lastFullSyncAt).getTime() : 0;
  const fullDue = !lastFull || input.now.getTime() - lastFull >= FULL_BACKFILL_MIN_HOURS * 3_600_000;
  if (!lastFull) return 'full';
  if (fullDue && typeof input.googleTotal === 'number' && input.storedCount < input.googleTotal) return 'full';
  if (input.watermark) return 'incremental';
  return 'known_ids';
}

/**
 * Conflicts to store after a sync. An identity-index skip (E11000) is never
 * reported as 0. A later pass that fetches nothing must not wipe a previous
 * skip while this workspace still holds fewer reviews than Google reports.
 */
export function reportedReviewConflicts(input: {
  upsertConflicts: number;
  previousConflicts: number;
  storedCount: number;
  googleTotal: number | null | undefined;
}): number {
  if (input.upsertConflicts > 0) return input.upsertConflicts;
  const previous = Number(input.previousConflicts) || 0;
  if (
    previous > 0 &&
    typeof input.googleTotal === 'number' &&
    input.storedCount < input.googleTotal
  ) {
    return previous;
  }
  return 0;
}
