/**
 * FR-4.1 audit score. Pure. Does not replace profile completion or
 * Audit.overallScore — those stay the existing completion percentage.
 *
 * A dimension is included in `overall` only when it was actually measured.
 * `not_measured` and `unavailable` contribute nothing and are never stored as 0.
 */

import { tokenSimilarity } from '../../gbp/intelligence/duplicates.ts';

export const FR4_SCORE_VERSION = 'fr4-v1';

export type MeasureStatus = 'measured' | 'not_measured' | 'unavailable';

export interface DimensionScore {
  id:
    | 'completeness'
    | 'categoryFit'
    | 'services'
    | 'attributes'
    | 'photos'
    | 'posts'
    | 'reviews'
    | 'napConsistency'
    | 'website'
    | 'schema';
  score: number | null;
  status: MeasureStatus;
  evidenceIds: string[];
  note: string;
}

export interface AuditScore {
  version: typeof FR4_SCORE_VERSION;
  /** Mean of measured dimension scores. Null when nothing was measured. */
  overall: number | null;
  measuredDimensions: number;
  dimensions: DimensionScore[];
}

type FieldState = 'verified_present' | 'verified_missing' | 'unknown' | 'not_applicable';

const GENERIC = new Set([
  'services', 'service', 'local business', 'business', 'establishment',
  'point of interest', 'general', 'company', 'other', 'point_of_interest',
]);

function dim(
  id: DimensionScore['id'],
  status: MeasureStatus,
  score: number | null,
  evidenceIds: string[],
  note: string,
): DimensionScore {
  return {
    id,
    status,
    score: status === 'measured' && score != null ? Math.max(0, Math.min(100, Math.round(score))) : null,
    evidenceIds,
    note,
  };
}

function fieldScore(state: FieldState | undefined, id: DimensionScore['id'], evidenceId: string, label: string): DimensionScore {
  if (state === 'verified_present') return dim(id, 'measured', 100, [evidenceId], `${label} is present on the listing.`);
  if (state === 'verified_missing') return dim(id, 'measured', 0, [evidenceId], `${label} is absent on the listing.`);
  if (state === 'not_applicable') return dim(id, 'unavailable', null, [evidenceId], `${label} cannot be set for this listing.`);
  return dim(id, 'not_measured', null, [evidenceId], `${label} was not read. It is not treated as missing.`);
}

export interface Fr4ScoreInput {
  completionPercentage: number | null;
  primaryCategoryState: FieldState | undefined;
  primaryCategory: string | null;
  serviceNames: string[];
  servicesState: FieldState | undefined;
  attributesState: FieldState | undefined;
  photos: { status: MeasureStatus; count: number | null; scope: string | null };
  posts: { status: MeasureStatus; total: number | null; newestAgeDays: number | null };
  reviews: { status: MeasureStatus; count: number | null; medianCompetitorCount: number | null };
  nap: 'matched' | 'mismatch' | 'unknown';
  website: { status: MeasureStatus; score: number | null; note: string };
  schema: { status: MeasureStatus; score: number | null; note: string };
}

/** Photo bands apply only when a count was actually returned. */
function photoScore(count: number): number {
  if (count <= 0) return 0;
  if (count < 3) return 40;
  if (count < 10) return 70;
  return 100;
}

/** Age of the newest Google post, in days. No post date → caller marks not measured. */
function postScore(total: number, newestAgeDays: number | null): number | null {
  if (total <= 0) return 0;
  if (newestAgeDays == null) return null;
  if (newestAgeDays <= 14) return 100;
  if (newestAgeDays <= 30) return 70;
  if (newestAgeDays <= 60) return 40;
  return 20;
}

export function buildAuditScore(input: Fr4ScoreInput): AuditScore {
  const completeness = input.completionPercentage == null
    ? dim('completeness', 'not_measured', null, ['profile.completion'], 'Profile completion had no verified fields, so it is not scored as zero.')
    : dim('completeness', 'measured', input.completionPercentage, ['profile.completion'], 'Existing profile completion. Unknown fields are already excluded and are not counted as missing.');

  let categoryFit: DimensionScore;
  const cat = (input.primaryCategory || '').trim();
  if (input.primaryCategoryState === 'verified_missing') {
    categoryFit = dim('categoryFit', 'measured', 0, ['profile.primary_category'], 'No primary category is set.');
  } else if (input.primaryCategoryState !== 'verified_present' || !cat) {
    categoryFit = dim('categoryFit', 'not_measured', null, ['profile.primary_category'], 'Primary category was not read, so fit is not scored.');
  } else if (GENERIC.has(cat.toLowerCase())) {
    categoryFit = dim('categoryFit', 'measured', 30, ['profile.primary_category'], `Primary category "${cat}" is a generic placeholder.`);
  } else if (input.servicesState === 'verified_present' && input.serviceNames.some((s) => tokenSimilarity(cat, s) > 0)) {
    categoryFit = dim('categoryFit', 'measured', 100, ['profile.primary_category', 'profile.services'], 'A listed service shares a word with the primary category.');
  } else {
    categoryFit = dim('categoryFit', 'not_measured', null, ['profile.primary_category'], 'Category is set. Fit against services was not established, so it is not scored as a mismatch.');
  }

  const services = fieldScore(input.servicesState, 'services', 'profile.services', 'Services');
  const attributes = fieldScore(input.attributesState, 'attributes', 'profile.attributes', 'Attributes');

  let photos: DimensionScore;
  if (input.photos.status !== 'measured' || input.photos.count == null) {
    photos = dim('photos', input.photos.status === 'unavailable' ? 'unavailable' : 'not_measured', null, ['profile.photos'], 'Photo count was not read. It is not treated as zero.');
  } else {
    photos = dim('photos', 'measured', photoScore(input.photos.count), ['profile.photos'], `${input.photos.count} photos (${input.photos.scope || 'counted'}). 0 → 0, 1–2 → 40, 3–9 → 70, 10+ → 100.`);
  }

  let posts: DimensionScore;
  const posted = input.posts.status === 'measured' && input.posts.total != null
    ? postScore(input.posts.total, input.posts.newestAgeDays)
    : null;
  if (input.posts.status !== 'measured' || posted == null) {
    posts = dim('posts', input.posts.status === 'unavailable' ? 'unavailable' : 'not_measured', null, ['gbp.posts'], 'Google post dates were not available, so posting is not scored as zero.');
  } else {
    posts = dim('posts', 'measured', posted, ['gbp.posts'], input.posts.total === 0
      ? 'Google returned no posts.'
      : `Newest Google post is ${input.posts.newestAgeDays} days old. Within 14 days → 100, 30 → 70, 60 → 40, older → 20.`);
  }

  let reviews: DimensionScore;
  if (input.reviews.status !== 'measured' || input.reviews.count == null) {
    reviews = dim('reviews', input.reviews.status === 'unavailable' ? 'unavailable' : 'not_measured', null, ['reviews.lifetime'], 'Review count was not verified, so reviews are not scored as zero.');
  } else if (input.reviews.count === 0) {
    reviews = dim('reviews', 'measured', 0, ['reviews.lifetime'], 'Google reports 0 reviews.');
  } else if (input.reviews.medianCompetitorCount == null || input.reviews.medianCompetitorCount <= 0) {
    reviews = dim('reviews', 'not_measured', null, ['reviews.lifetime'], `Google reports ${input.reviews.count} reviews. No competitor median was measured, so the gap is not scored as zero.`);
  } else {
    const ratio = Math.min(100, Math.round((input.reviews.count / input.reviews.medianCompetitorCount) * 100));
    reviews = dim('reviews', 'measured', ratio, ['reviews.lifetime', 'reviews.comparison'], `${input.reviews.count} reviews versus a competitor median of ${input.reviews.medianCompetitorCount}. Score is that ratio, capped at 100.`);
  }

  const nap = input.nap === 'matched'
    ? dim('napConsistency', 'measured', 100, ['website.nap'], 'Website name, phone, or address matches the verified Google listing after normalisation.')
    : input.nap === 'mismatch'
      ? dim('napConsistency', 'measured', 0, ['website.nap'], 'Website name, phone, or address disagrees with the verified Google listing after normalisation.')
      : dim('napConsistency', 'not_measured', null, ['website.nap'], 'NAP could not be compared. A missing website value is not treated as a mismatch.');

  const website = dim('website', input.website.status, input.website.score, ['website.audit'], input.website.note);
  const schema = dim('schema', input.schema.status, input.schema.score, ['website.schema'], input.schema.note);

  const dimensions = [completeness, categoryFit, services, attributes, photos, posts, reviews, nap, website, schema];
  const measured = dimensions.filter((d) => d.status === 'measured' && d.score != null);
  const overall = measured.length
    ? Math.round(measured.reduce((s, d) => s + (d.score as number), 0) / measured.length)
    : null;
  return { version: FR4_SCORE_VERSION, overall, measuredDimensions: measured.length, dimensions };
}
