import dbConnect from '@/lib/mongodb';
import GBPToken from '@/models/GBPToken';
import GBPInsights from '@/models/GBPInsights';
import Business from '@/models/Business';
import { encrypt, decrypt } from '@/lib/crypto';

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
    throw new Error(`GBP fetchDailyMetrics failed: ${res.status} ${err}`);
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
    throw new Error(`GBP fetchSearchKeywords failed: ${res.status} ${err}`);
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
