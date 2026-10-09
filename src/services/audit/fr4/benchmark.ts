/**
 * FR-4.2 competitor benchmark. Built from the existing local-pack
 * observations. Does not fetch competitors again.
 *
 * Review velocity is the change between two measured counts. One count, or
 * no earlier audit, is not_measured — never zero.
 * Competitor photo count is used only when the pack result included it.
 * Competitor posting frequency is always not_measured: the pack has no
 * Google Posts, and GrowwMatics drafts are not Google posts.
 */

import type { SearchObservation } from '../facts.ts';

export interface BenchmarkCompetitor {
  position: number;
  name: string;
  placeId: string | null;
  reviewCount: number | null;
  reviewVelocityPerMonth: number | null;
  reviewVelocityStatus: 'measured' | 'not_measured';
  photoCount: number | null;
  photoCountStatus: 'measured' | 'not_measured';
  postsLast30Days: null;
  postingFrequencyPerMonth: null;
  postingFrequencyStatus: 'not_measured';
  primaryCategory: string | null;
  additionalCategories: string[];
  categories: string[];
}

export interface KeywordBenchmark {
  keyword: string;
  /** 1-based position of the business itself, or null when it was outside the window. */
  ownPosition: number | null;
  competitors: BenchmarkCompetitor[];
}

export interface CompetitorBenchmark {
  version: 'fr4-v1';
  /** How many pack results are kept per keyword. */
  limit: 5;
  keywords: KeywordBenchmark[];
  subject: {
    reviewVelocityPerMonth: number | null;
    reviewVelocityStatus: 'measured' | 'not_measured';
    postsLast30Days: number | null;
    postingFrequencyPerMonth: number | null;
    postingFrequencyStatus: 'measured' | 'not_measured';
    photoCount: number | null;
    photoCountStatus: 'measured' | 'not_measured';
  };
}

export interface ReviewHistoryPoint {
  at: string;
  placeId: string | null;
  name: string;
  reviewCount: number | null;
}

const DAY = 86_400_000;

function velocity(previous: number | null, current: number | null, previousAt: string | null, now: string): { value: number | null; status: 'measured' | 'not_measured' } {
  if (previous == null || current == null || !previousAt) return { value: null, status: 'not_measured' };
  const days = (new Date(now).getTime() - new Date(previousAt).getTime()) / DAY;
  if (!Number.isFinite(days) || days < 1) return { value: null, status: 'not_measured' };
  return { value: Math.round(((current - previous) / days) * 30 * 10) / 10, status: 'measured' };
}

function ownExcluded(item: { placeId?: string | null; name?: string }, target: { placeId?: string | null; name?: string } | undefined): boolean {
  if (!target) return false;
  if (target.placeId && item.placeId && target.placeId === item.placeId) return true;
  if (target.name && item.name && target.name.trim().toLowerCase() === item.name.trim().toLowerCase()) return true;
  return false;
}

export function buildCompetitorBenchmark(input: {
  observations: SearchObservation[];
  history: ReviewHistoryPoint[] | null;
  historyAt: string | null;
  now: string;
  subjectReviewCount: number | null;
  subjectPhotoCount: number | null;
  subjectPostsLast30Days: number | null;
}): CompetitorBenchmark {
  const history = input.history;
  const keywords: KeywordBenchmark[] = [];
  for (const obs of input.observations) {
    if (obs.kind === 'brand' || obs.status !== 'ok') continue;
    const ahead = obs.ahead || [];
    const others = obs.others || [];
    const seen = new Set<string>();
    const competitors: BenchmarkCompetitor[] = [];
    const consider = [
      ...ahead.map((item) => ({ item, rich: true })),
      ...others.map((item) => ({ item, rich: false })),
    ].sort((a, b) => a.item.position - b.item.position);
    for (const { item, rich } of consider) {
      if (ownExcluded(item, obs.target)) continue;
      const key = item.placeId || item.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const full = rich ? item as SearchObservation['ahead'][number] : null;
      const previous = history?.find((h) => (item.placeId && h.placeId === item.placeId) || h.name.toLowerCase() === item.name.toLowerCase());
      const currentCount = full && typeof full.reviewCount === 'number' ? full.reviewCount : null;
      const vel = velocity(previous?.reviewCount ?? null, currentCount, input.historyAt, input.now);
      const photos = full && typeof full.totalPhotos === 'number' ? full.totalPhotos : null;
      const primary = full?.category ?? null;
      const additional = full?.additionalCategories?.filter(Boolean) ?? [];
      competitors.push({
        position: item.position,
        name: item.name,
        placeId: item.placeId ?? null,
        reviewCount: currentCount,
        reviewVelocityPerMonth: vel.value,
        reviewVelocityStatus: vel.status,
        photoCount: photos,
        photoCountStatus: photos == null ? 'not_measured' : 'measured',
        postsLast30Days: null,
        postingFrequencyPerMonth: null,
        postingFrequencyStatus: 'not_measured',
        primaryCategory: primary,
        additionalCategories: additional,
        categories: [primary, ...additional].filter((c): c is string => !!c),
      });
      if (competitors.length >= 5) break;
    }
    keywords.push({ keyword: obs.keyword, ownPosition: obs.found ? obs.rank : null, competitors });
  }

  const subjectVel = velocity(
    history?.find((h) => h.placeId === '__subject__')?.reviewCount ?? null,
    input.subjectReviewCount,
    input.historyAt,
    input.now,
  );
  const postsMeasured = input.subjectPostsLast30Days != null;
  return {
    version: 'fr4-v1',
    limit: 5,
    keywords,
    subject: {
      reviewVelocityPerMonth: subjectVel.value,
      reviewVelocityStatus: subjectVel.status,
      postsLast30Days: postsMeasured ? input.subjectPostsLast30Days : null,
      postingFrequencyPerMonth: postsMeasured ? input.subjectPostsLast30Days : null,
      postingFrequencyStatus: postsMeasured ? 'measured' : 'not_measured',
      photoCount: input.subjectPhotoCount,
      photoCountStatus: input.subjectPhotoCount == null ? 'not_measured' : 'measured',
    },
  };
}

/** Count Google posts whose createTime falls in the last 30 days.
 *  Returns null when the list is truncated inside that window, so the count
 *  would be a lower bound rather than a measurement. */
export function postsInLast30Days(
  posts: Array<{ createTime: string | null }> | null,
  truncated: boolean,
  now: Date,
): number | null {
  if (!posts) return null;
  const cutoff = now.getTime() - 30 * DAY;
  const dated = posts.filter((p) => p.createTime && !Number.isNaN(new Date(p.createTime).getTime()));
  if (dated.length !== posts.length && posts.length > 0) return null;
  const oldest = dated.reduce<number | null>((min, p) => {
    const t = new Date(p.createTime as string).getTime();
    return min == null || t < min ? t : min;
  }, null);
  if (truncated && (oldest == null || oldest >= cutoff)) return null;
  return dated.filter((p) => new Date(p.createTime as string).getTime() >= cutoff).length;
}
