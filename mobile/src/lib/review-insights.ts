import type { Review } from '@/api/endpoints/reviews';

/**
 * Client-side aggregations over the raw /api/reviews list — powers the Home
 * "This Week's Reviews" goal card and the GBP "Review Trends" chart.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Weekly review goal shown on the Home card (product default). */
export const WEEKLY_REVIEW_GOAL = 3;

export interface ReviewInsights {
  total: number;
  avgRating: number;
  /** Reviews received in the current (rolling last-7-days) week. */
  thisWeek: number;
  /** Whole days since the newest review; null when there are none. */
  daysSinceLast: number | null;
  /** Oldest → newest. 7 full weeks + the current partial week. */
  weekly: { label: string; value: number }[];
  /** Average reviews/week across the 8-week window, 1 decimal. */
  avgPerWeek: number;
  /** % change of the last 8 weeks vs the 8 weeks before (null = no baseline). */
  eightWeekChangePct: number | null;
}

export function computeReviewInsights(reviews: Review[]): ReviewInsights {
  const now = Date.now();
  const dated = reviews
    .map((r) => {
      // postedAt = Google's real review date; createdAt is just the sync
      // time (bulk syncs cluster it), only used for pre-postedAt docs.
      const iso = r.postedAt ?? r.createdAt;
      return { rating: r.rating, at: iso ? new Date(iso).getTime() : NaN };
    })
    .filter((r) => !Number.isNaN(r.at));

  const weekly = Array.from({ length: 8 }, (_, i) => ({
    label: i === 7 ? 'This Week' : `W${i + 1}`,
    value: 0,
  }));
  let previousWindow = 0;

  for (const r of dated) {
    const weeksAgo = Math.floor((now - r.at) / WEEK_MS); // 0 = current week
    if (weeksAgo >= 0 && weeksAgo < 8) weekly[7 - weeksAgo].value += 1;
    else if (weeksAgo >= 8 && weeksAgo < 16) previousWindow += 1;
  }

  const currentWindow = weekly.reduce((acc, w) => acc + w.value, 0);
  const newest = dated.reduce((acc, r) => Math.max(acc, r.at), 0);
  const totalRating = reviews.reduce((acc, r) => acc + (r.rating || 0), 0);

  return {
    total: reviews.length,
    avgRating: reviews.length ? Math.round((totalRating / reviews.length) * 10) / 10 : 0,
    thisWeek: weekly[7].value,
    daysSinceLast: newest ? Math.floor((now - newest) / (24 * 60 * 60 * 1000)) : null,
    weekly,
    avgPerWeek: Math.round((currentWindow / 8) * 10) / 10,
    eightWeekChangePct:
      previousWindow > 0
        ? Math.round(((currentWindow - previousWindow) / previousWindow) * 100)
        : null,
  };
}
