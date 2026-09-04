import dbConnect from '@/lib/mongodb';
import GBPToken from '@/models/GBPToken';
import GBPInsights from '@/models/GBPInsights';
import Business from '@/models/Business';
import { encrypt, decrypt } from '@/lib/crypto';
import { gbpWritesEnabled } from '@/lib/gbpSafety';
import { describeGoogleApiError } from '@/lib/googleApiError';

const BIZINFO_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';
// Local posts, media and review replies still live only on the legacy My
// Business API v4 (there is no v1 replacement yet). v4 resource names need the
// FULL "accounts/{a}/locations/{l}" path — v1 APIs above use just "locations/{l}".
const MYBUSINESS_V4_BASE = 'https://mybusiness.googleapis.com/v4';

export class GBPAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GBPAuthError';
  }
}

// Returns a valid (non-expired) access token, refreshing if needed.
export async function getValidToken(businessId: string): Promise<string> {
  await dbConnect();
  const tokenDoc = await GBPToken.findOne({ businessId });
  if (!tokenDoc) throw new GBPAuthError('No GBP token found for this business');

  const fiveMinutes = 5 * 60 * 1000;
  const isExpired = tokenDoc.expiresAt.getTime() < Date.now() + fiveMinutes;

  if (!isExpired) {
    return decrypt(tokenDoc.accessToken);
  }

  // Refresh the token
  const refreshToken = decrypt(tokenDoc.refreshToken);
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    // Token revoked — mark business as disconnected
    await Business.findByIdAndUpdate(businessId, { googleConnected: false });
    throw new GBPAuthError('Google token refresh failed — user must reconnect');
  }

  const data = await res.json();
  const newAccessToken = data.access_token;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  await GBPToken.findOneAndUpdate(
    { businessId },
    { $set: { accessToken: encrypt(newAccessToken), expiresAt } }
  );

  return newAccessToken;
}

interface DailyMetricPoint {
  date: string; // "YYYY-MM-DD"
  views: number;
  viewsMaps: number;
  viewsSearch: number;
  callClicks: number;
  websiteClicks: number;
  directionRequests: number;
  conversations: number;
}

// GBP API returns time series per metric; we pivot into per-day rows.
export async function fetchDailyMetrics(
  businessId: string,
  startDate: Date,
  endDate: Date
): Promise<DailyMetricPoint[]> {
  const accessToken = await getValidToken(businessId);
  await dbConnect();
  const tokenDoc = await GBPToken.findOne({ businessId });
  if (!tokenDoc?.locationId) throw new Error('No GBP location linked to this business');

  const toDateObj = (d: Date) => ({
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  });

  // fetchMultiDailyMetricsTimeSeries is a GET with query params — NOT a POST
  // with a JSON body. A POST to this path returns an HTML 404.
  const metrics = [
    'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
    'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
    'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
    'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
    'CALL_CLICKS',
    'WEBSITE_CLICKS',
    'BUSINESS_DIRECTION_REQUESTS',
    'BUSINESS_CONVERSATIONS',
  ];

  const params = new URLSearchParams();
  for (const metric of metrics) params.append('dailyMetrics', metric);
  const start = toDateObj(startDate);
  const end = toDateObj(endDate);
  params.set('dailyRange.start_date.year', String(start.year));
  params.set('dailyRange.start_date.month', String(start.month));
  params.set('dailyRange.start_date.day', String(start.day));
  params.set('dailyRange.end_date.year', String(end.year));
  params.set('dailyRange.end_date.month', String(end.month));
  params.set('dailyRange.end_date.day', String(end.day));

  const url =
    `https://businessprofileperformance.googleapis.com/v1/${tokenDoc.locationId}` +
    `:fetchMultiDailyMetricsTimeSeries?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw describeGoogleApiError('fetchDailyMetrics', res.status, err);
  }

  const data = await res.json();
  // data.multiDailyMetricTimeSeries[].dailyMetricTimeSeries[].timeSeries.datedValues[]
  const byDate: Record<string, DailyMetricPoint> = {};

  const series: any[] = data.multiDailyMetricTimeSeries ?? [];
  for (const multiSeries of series) {
    for (const metricSeries of multiSeries.dailyMetricTimeSeries ?? []) {
      const metric: string = metricSeries.dailyMetric;
      for (const dv of metricSeries.timeSeries?.datedValues ?? []) {
        const { year, month, day } = dv.date;
        const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (!byDate[dateKey]) {
          byDate[dateKey] = {
            date: dateKey,
            views: 0,
            viewsMaps: 0,
            viewsSearch: 0,
            callClicks: 0,
            websiteClicks: 0,
            directionRequests: 0,
            conversations: 0,
          };
        }
        const value = Number(dv.value ?? 0);
        const row = byDate[dateKey];
        switch (metric) {
          case 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH':
          case 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH':
            row.viewsSearch += value;
            row.views += value;
            break;
          case 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS':
          case 'BUSINESS_IMPRESSIONS_MOBILE_MAPS':
            row.viewsMaps += value;
            row.views += value;
            break;
          case 'CALL_CLICKS':
            row.callClicks += value;
            break;
          case 'WEBSITE_CLICKS':
            row.websiteClicks += value;
            break;
          case 'BUSINESS_DIRECTION_REQUESTS':
            row.directionRequests += value;
            break;
          case 'BUSINESS_CONVERSATIONS':
            row.conversations += value;
            break;
        }
      }
    }
  }

  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

interface KeywordPoint {
  keyword: string;
  impressions: number;
  type: 'DIRECT' | 'INDIRECT' | 'CHAIN';
}

export async function fetchSearchKeywords(
  businessId: string,
  year: number,
  month: number
): Promise<KeywordPoint[]> {
  const accessToken = await getValidToken(businessId);
  await dbConnect();
  const tokenDoc = await GBPToken.findOne({ businessId });
  if (!tokenDoc?.locationId) throw new Error('No GBP location linked to this business');

  // Sub-collection path uses a slash ("/searchkeywords/...", not ":") and
  // requires BOTH start and end month — query a single month by setting them equal.
  const url =
    `https://businessprofileperformance.googleapis.com/v1/${tokenDoc.locationId}` +
    `/searchkeywords/impressions/monthly` +
    `?monthlyRange.startMonth.year=${year}` +
    `&monthlyRange.startMonth.month=${month}` +
    `&monthlyRange.endMonth.year=${year}` +
    `&monthlyRange.endMonth.month=${month}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw describeGoogleApiError('fetchSearchKeywords', res.status, err);
  }

  const data = await res.json();
  const keywords: KeywordPoint[] = [];

  for (const item of data.searchKeywordsCounts ?? []) {
    // Low-volume keywords come back as { threshold } instead of { value }:
    // the true count is below that threshold. Use it as an approximation.
    const iv = item.insightsValue ?? {};
    keywords.push({
      keyword: item.searchKeyword,
      impressions: Number(iv.value ?? iv.threshold ?? 0),
      type: (item.type as 'DIRECT' | 'INDIRECT' | 'CHAIN') ?? 'DIRECT',
    });
  }

  return keywords.sort((a, b) => b.impressions - a.impressions);
}

// ─── Business Information: live profile read + gated write ─────────────────────

export interface GbpLocationProfile {
  /** GBP resource name, e.g. "locations/12345". */
  locationName: string;
  title: string;
  description: string;
  primaryPhone: string;
  website: string;
  primaryCategory: string;
  address: string;
}

export interface GbpProfilePatch {
  title?: string;
  description?: string;
  primaryPhone?: string;
  website?: string;
}

/** Reads the live GBP location profile (name, description, phone, website, …). */
export async function fetchLocationProfile(businessId: string): Promise<GbpLocationProfile> {
  const accessToken = await getValidToken(businessId);
  await dbConnect();
  const tokenDoc = await GBPToken.findOne({ businessId });
  if (!tokenDoc?.locationId) throw new Error('No GBP location linked to this business');

  const readMask = 'title,profile.description,phoneNumbers,websiteUri,categories,storefrontAddress';
  const url = `${BIZINFO_BASE}/${tokenDoc.locationId}?readMask=${encodeURIComponent(readMask)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const err = await res.text();
    throw describeGoogleApiError('fetchLocationProfile', res.status, err);
  }

  const d = await res.json();
  const addr = d.storefrontAddress;
  const address = addr
    ? [...(addr.addressLines ?? []), addr.locality, addr.administrativeArea, addr.postalCode]
        .filter(Boolean)
        .join(', ')
    : '';

  return {
    locationName: tokenDoc.locationId,
    title: d.title ?? '',
    description: d.profile?.description ?? '',
    primaryPhone: d.phoneNumbers?.primaryPhone ?? '',
    website: d.websiteUri ?? '',
    primaryCategory: d.categories?.primaryCategory?.displayName ?? '',
    address,
  };
}

/**
 * Applies an edit to the GBP profile. The edit is ALWAYS mirrored into our own
 * Business doc so the data is captured; the live write to Google only happens
 * when GBP_LIVE_WRITES_ENABLED is on (until the app is verified for the
 * business.manage write scope). Returns whether the live write was applied.
 */
export async function updateLocationProfile(
  businessId: string,
  patch: GbpProfilePatch
): Promise<{ liveWriteApplied: boolean }> {
  await dbConnect();

  // Mirror into the local Business record (source of truth for our features).
  const localSet: Record<string, string> = {};
  if (patch.title !== undefined) localSet.name = patch.title;
  if (patch.description !== undefined) localSet.description = patch.description;
  if (patch.primaryPhone !== undefined) localSet.phone = patch.primaryPhone;
  if (patch.website !== undefined) localSet.website = patch.website;
  if (Object.keys(localSet).length) {
    await Business.updateOne({ _id: businessId }, { $set: localSet });
  }

  // Live write to Google is gated OFF by default (see lib/gbpSafety.ts).
  if (!gbpWritesEnabled()) {
    return { liveWriteApplied: false };
  }

  const accessToken = await getValidToken(businessId);
  const tokenDoc = await GBPToken.findOne({ businessId });
  if (!tokenDoc?.locationId) throw new Error('No GBP location linked to this business');

  const body: Record<string, unknown> = {};
  const masks: string[] = [];
  if (patch.title !== undefined) { body.title = patch.title; masks.push('title'); }
  if (patch.description !== undefined) { body.profile = { description: patch.description }; masks.push('profile.description'); }
  if (patch.primaryPhone !== undefined) { body.phoneNumbers = { primaryPhone: patch.primaryPhone }; masks.push('phoneNumbers.primaryPhone'); }
  if (patch.website !== undefined) { body.websiteUri = patch.website; masks.push('websiteUri'); }
  if (masks.length === 0) return { liveWriteApplied: true };

  const url = `${BIZINFO_BASE}/${tokenDoc.locationId}?updateMask=${encodeURIComponent(masks.join(','))}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw describeGoogleApiError('updateLocationProfile', res.status, err);
  }
  return { liveWriteApplied: true };
}

// ─── Local posts / media / review replies (My Business API v4) ─────────────────
//
// These are the "push to the live profile" writes. Every one is gated behind
// GBP_LIVE_WRITES_ENABLED: while OFF they no-op (returning liveWriteApplied:false)
// so callers keep their existing mock/DB-only behaviour; flipping the env var to
// true — after verification on a test account — makes the real Google call fire
// with no other code change. They all require the v4 "Google My Business API" to
// be enabled + allow-listed on the Cloud project, and the business.manage scope.

/** Builds the v4 resource name "accounts/{a}/locations/{l}" from a token doc. */
async function v4LocationName(businessId: string): Promise<{ name: string; accessToken: string }> {
  const accessToken = await getValidToken(businessId);
  const tokenDoc = await GBPToken.findOne({ businessId });
  if (!tokenDoc?.accountId || !tokenDoc?.locationId) {
    throw new Error('No GBP account/location linked to this business — reconnect Google.');
  }
  // locationId is stored as "locations/{l}" (v1 format); v4 needs it under the account.
  const loc = tokenDoc.locationId.includes('/locations/')
    ? tokenDoc.locationId
    : `${tokenDoc.accountId}/${tokenDoc.locationId}`;
  return { name: loc, accessToken };
}

export interface LocalPostInput {
  summary: string;
  /** Optional call-to-action button. */
  cta?: { actionType: 'LEARN_MORE' | 'BOOK' | 'ORDER' | 'SHOP' | 'SIGN_UP' | 'CALL'; url?: string };
  /** Optional photo — MUST be a public http(s) URL (Google fetches it). Data-URLs are skipped. */
  mediaUrl?: string;
}

/**
 * Publishes a local post to the live GBP. Gated — no-ops (returns
 * liveWriteApplied:false) while live writes are disabled.
 */
export async function createLocalPost(
  businessId: string,
  input: LocalPostInput
): Promise<{ liveWriteApplied: boolean; postName?: string }> {
  if (!gbpWritesEnabled()) return { liveWriteApplied: false };
  await dbConnect();

  const { name, accessToken } = await v4LocationName(businessId);

  const body: Record<string, unknown> = {
    languageCode: 'en-US',
    summary: input.summary,
    topicType: 'STANDARD',
  };
  if (input.cta?.actionType) {
    body.callToAction =
      input.cta.actionType === 'CALL'
        ? { actionType: 'CALL' }
        : { actionType: input.cta.actionType, url: input.cta.url };
  }
  // Google fetches media by URL; a base64 data-URL can't be used here.
  if (input.mediaUrl && /^https?:\/\//i.test(input.mediaUrl)) {
    body.media = [{ mediaFormat: 'PHOTO', sourceUrl: input.mediaUrl }];
  }

  const res = await fetch(`${MYBUSINESS_V4_BASE}/${name}/localPosts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw describeGoogleApiError('createLocalPost', res.status, err);
  }
  const data = await res.json();
  return { liveWriteApplied: true, postName: data.name };
}

/**
 * Posts (or updates) the owner's reply to a review on the live GBP. Gated.
 * `reviewName` must be the GBP review resource id — i.e. reviews sourced from the
 * GBP reviews API, NOT a SerpApi id (see the note in the review-reply route).
 */
export async function replyToReview(
  businessId: string,
  reviewName: string,
  comment: string
): Promise<{ liveWriteApplied: boolean }> {
  if (!gbpWritesEnabled()) return { liveWriteApplied: false };
  await dbConnect();

  const { name, accessToken } = await v4LocationName(businessId);
  // reviewName may be a full path or a bare id; normalise to the location's review.
  const reviewPath = reviewName.startsWith('accounts/')
    ? reviewName
    : `${name}/reviews/${reviewName}`;

  const res = await fetch(`${MYBUSINESS_V4_BASE}/${reviewPath}/reply`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw describeGoogleApiError('replyToReview', res.status, err);
  }
  return { liveWriteApplied: true };
}

export type GbpMediaCategory = 'PROFILE' | 'COVER' | 'ADDITIONAL' | 'LOGO';

/**
 * Google's real My Business v4 `LocationAssociation.Category` enum has no
 * "LOGO" value — the business logo/icon is what Google itself calls the
 * "PROFILE" photo (a strict singleton: "There can be only one media item
 * with this category for a location"). This app's own schema invented a
 * separate "LOGO" category (GbpMediaAsset.ts, GbpMediaCategory) for the
 * user-facing "Logo" slot, distinct from the "PROFILE" tag it also exposes
 * as an ordinary multi-item gallery category — so "LOGO" was going out to
 * Google's API as-is, an enum value Google doesn't recognize, and any photo
 * Google itself reports as "PROFILE" was reconciled in under a category our
 * Logo slot never looks for. Net effect: the current logo/cover slots never
 * showed what was actually live on Google (Aug 2026 bug report). These two
 * helpers are the only place that translation needs to happen — every other
 * function in this file already deals in our own GbpMediaCategory.
 */
function toGoogleCategory(category: GbpMediaCategory): string {
  return category === 'LOGO' ? 'PROFILE' : category;
}
function fromGoogleCategory(category: string | undefined): GbpMediaCategory {
  if (category === 'PROFILE') return 'LOGO';
  if (category === 'COVER' || category === 'ADDITIONAL') return category;
  return 'ADDITIONAL';
}

/**
 * Uploads a photo to the live GBP (logo / cover / additional). Gated. `sourceUrl`
 * MUST be a public http(s) URL that Google can fetch (see hosting note in the
 * media route — user-uploaded files need a public URL before this can be used).
 */
export async function uploadLocationPhoto(
  businessId: string,
  category: GbpMediaCategory,
  sourceUrl: string,
  mediaFormat: 'PHOTO' | 'VIDEO' = 'PHOTO'
): Promise<{ liveWriteApplied: boolean; mediaName?: string }> {
  if (!gbpWritesEnabled()) return { liveWriteApplied: false };
  if (!/^https?:\/\//i.test(sourceUrl)) {
    throw new Error('uploadLocationPhoto requires a public http(s) sourceUrl.');
  }
  await dbConnect();

  const { name, accessToken } = await v4LocationName(businessId);
  const res = await fetch(`${MYBUSINESS_V4_BASE}/${name}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mediaFormat,
      locationAssociation: { category: toGoogleCategory(category) },
      sourceUrl,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw describeGoogleApiError('uploadLocationPhoto', res.status, err);
  }
  const data = await res.json();
  return { liveWriteApplied: true, mediaName: data.name };
}

/**
 * Deletes a photo from the live GBP. Gated, same as uploadLocationPhoto.
 * `mediaName` is the full v4 resource name returned by uploadLocationPhoto
 * (e.g. "accounts/123/locations/456/media/789") — already fully-qualified,
 * so this hits it directly rather than re-deriving the location path.
 */
export async function deleteLocationMedia(
  businessId: string,
  mediaName: string
): Promise<{ liveWriteApplied: boolean }> {
  if (!gbpWritesEnabled()) return { liveWriteApplied: false };
  await dbConnect();

  const accessToken = await getValidToken(businessId);
  const res = await fetch(`${MYBUSINESS_V4_BASE}/${mediaName}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const err = await res.text();
    throw describeGoogleApiError('deleteLocationMedia', res.status, err);
  }
  return { liveWriteApplied: true };
}

export interface GbpMediaItem {
  name: string;
  /** Already translated to our own GbpMediaCategory (see fromGoogleCategory) — never a raw Google enum value. */
  category: GbpMediaCategory;
  url: string;
  thumbnailUrl: string;
}

/**
 * Reads the location's existing media (photos/logo/cover) for display.
 * Read-only. Follows Google's nextPageToken until exhausted — a single
 * request only returns the first page (up to pageSize items), so without
 * this loop any profile with more photos than fit on page one silently lost
 * the rest on every sync (Aug 2026 bug: "only 4 photos" showing for
 * businesses with many more live on Google).
 */
export async function listLocationMedia(businessId: string): Promise<GbpMediaItem[]> {
  const { name, accessToken } = await v4LocationName(businessId);
  const items: GbpMediaItem[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${MYBUSINESS_V4_BASE}/${name}/media`);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const err = await res.text();
      throw describeGoogleApiError('listLocationMedia', res.status, err);
    }
    const data = await res.json();
    items.push(
      ...(data.mediaItems ?? []).map((m: any) => ({
        name: m.name ?? '',
        category: fromGoogleCategory(m.locationAssociation?.category),
        url: m.googleUrl ?? m.sourceUrl ?? '',
        thumbnailUrl: m.thumbnailUrl ?? m.googleUrl ?? '',
      }))
    );
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);

  return items;
}
