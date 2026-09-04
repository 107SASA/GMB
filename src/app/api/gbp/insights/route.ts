import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import GBPToken from '@/models/GBPToken';
import GBPInsights from '@/models/GBPInsights';
import GBPKeyword from '@/models/GBPKeyword';

const VALID_RANGES = [7, 14, 28, 90] as const;

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export async function GET(request: NextRequest) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const gate = await requireModule(ctx.userId, 'google_ranking_agent');
  if (!gate.ok) return gate.response;

  await dbConnect();

  // "Connected" must mean a real OAuth grant exists (a GBPToken), NOT just that
  // onboarding set Business.googleConnected from a pasted Maps URL. Without a
  // token, /api/gbp/sync can't fetch anything and returns 400 — so the UI has
  // to show "Connect Account", not a "Sync Now" button that always fails.
  const tokenDoc = await GBPToken.findOne({ businessId: ctx.businessId }).lean() as any;
  if (!tokenDoc) {
    return NextResponse.json({ connected: false });
  }

  const { searchParams } = new URL(request.url);
  const rangeParam = parseInt(searchParams.get('range') ?? '28', 10);
  const range = (VALID_RANGES.includes(rangeParam as any) ? rangeParam : 28) as number;

  const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
  const needsSync =
    !tokenDoc?.lastSyncAt || new Date(tokenDoc.lastSyncAt) < twentyFiveHoursAgo;

  // --- Date range for current period ---
  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() - 1);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (range - 1));

  // --- Date range for previous period (same length, immediately before) ---
  const prevEndDate = new Date(startDate);
  prevEndDate.setDate(prevEndDate.getDate() - 1);
  const prevStartDate = new Date(prevEndDate);
  prevStartDate.setDate(prevStartDate.getDate() - (range - 1));

  const [currentRows, prevRows] = await Promise.all([
    GBPInsights.find({
      businessId: ctx.businessId,
      date: { $gte: startDate, $lte: endDate },
    })
      .sort({ date: 1 })
      .lean(),
    GBPInsights.find({
      businessId: ctx.businessId,
      date: { $gte: prevStartDate, $lte: prevEndDate },
    }).lean(),
  ]);

  // --- Totals for current period ---
  const sumField = (rows: any[], field: string) =>
    rows.reduce((acc, r) => acc + (r[field] ?? 0), 0);

  const summary = {
    totalViews: sumField(currentRows, 'views'),
    totalSearchViews: sumField(currentRows, 'viewsSearch'),
    totalMapsViews: sumField(currentRows, 'viewsMaps'),
    totalCallClicks: sumField(currentRows, 'callClicks'),
    totalWebsiteClicks: sumField(currentRows, 'websiteClicks'),
    totalDirectionRequests: sumField(currentRows, 'directionRequests'),
    totalConversations: sumField(currentRows, 'conversations'),
  };

  const prevSummary = {
    views: sumField(prevRows, 'views'),
    searchViews: sumField(prevRows, 'viewsSearch'),
    mapsViews: sumField(prevRows, 'viewsMaps'),
    callClicks: sumField(prevRows, 'callClicks'),
    websiteClicks: sumField(prevRows, 'websiteClicks'),
    directionRequests: sumField(prevRows, 'directionRequests'),
    conversations: sumField(prevRows, 'conversations'),
  };

  const changes = {
    views: pctChange(summary.totalViews, prevSummary.views),
    searchViews: pctChange(summary.totalSearchViews, prevSummary.searchViews),
    mapsViews: pctChange(summary.totalMapsViews, prevSummary.mapsViews),
    callClicks: pctChange(summary.totalCallClicks, prevSummary.callClicks),
    websiteClicks: pctChange(summary.totalWebsiteClicks, prevSummary.websiteClicks),
    directionRequests: pctChange(
      summary.totalDirectionRequests,
      prevSummary.directionRequests
    ),
    conversations: pctChange(summary.totalConversations, prevSummary.conversations),
  };

  // --- Time series for chart ---
  const timeSeries = currentRows.map((r: any) => ({
    date: r.date.toISOString().slice(0, 10),
    views: r.views ?? 0,
    callClicks: r.callClicks ?? 0,
    websiteClicks: r.websiteClicks ?? 0,
    directionRequests: r.directionRequests ?? 0,
  }));

  // --- Last 6 months, monthly totals — the Performance tab's trend chart.
  // Independent of the `range` selector above (that's 7/14/28/90 days for
  // the summary cards; this is always "however many of the last 6 calendar
  // months have data"), so it's computed unconditionally rather than only
  // when range=180 was requested.
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const monthRows = await GBPInsights.find({
    businessId: ctx.businessId,
    date: { $gte: sixMonthsAgo },
  }).lean();
  const monthBuckets = new Map<string, { views: number; callClicks: number; directionRequests: number }>();
  for (const r of monthRows as any[]) {
    const key = r.date.toISOString().slice(0, 7); // "2026-07"
    const bucket = monthBuckets.get(key) ?? { views: 0, callClicks: 0, directionRequests: 0 };
    bucket.views += r.views ?? 0;
    bucket.callClicks += r.callClicks ?? 0;
    bucket.directionRequests += r.directionRequests ?? 0;
    monthBuckets.set(key, bucket);
  }
  const monthlyTrend = [...monthBuckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, totals]) => ({
      month: new Date(`${key}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short' }),
      ...totals,
    }));

  // --- Before/After impact (split on the real GBP-connect date, not a
  // fixed lookback window) — home-screen "Impact" card. Each side is
  // averaged per-day-present, not summed, since the two periods are almost
  // never the same length, then scaled to a monthly figure for a stable,
  // comparable unit. Either side is null (not 0) when there's no data yet
  // for it — a business connected 3 days ago genuinely has no "before"
  // history, and that's a different fact than 0 average views.
  const [beforeRows, afterRows] = await Promise.all([
    GBPInsights.find({ businessId: ctx.businessId, date: { $lt: tokenDoc.connectedAt } }).lean(),
    GBPInsights.find({ businessId: ctx.businessId, date: { $gte: tokenDoc.connectedAt } }).lean(),
  ]);
  const avgPerMonth = (rows: any[], field: string): number | null => {
    if (rows.length === 0) return null;
    return Math.round((sumField(rows, field) / rows.length) * 30);
  };
  const impact = {
    connectedAt: tokenDoc.connectedAt,
    before: {
      views: avgPerMonth(beforeRows, 'views'),
      callClicks: avgPerMonth(beforeRows, 'callClicks'),
      directionRequests: avgPerMonth(beforeRows, 'directionRequests'),
      days: beforeRows.length,
    },
    after: {
      views: avgPerMonth(afterRows, 'views'),
      callClicks: avgPerMonth(afterRows, 'callClicks'),
      directionRequests: avgPerMonth(afterRows, 'directionRequests'),
      days: afterRows.length,
    },
  };

  // --- This calendar month vs last calendar month ---
  // Deliberately separate from `changes` above (which compares two rolling
  // windows of the selected range). This is the plain "how am I doing this
  // month vs last month" view the Insights page surfaces as its own section.
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const [thisMonthRows, lastMonthRows] = await Promise.all([
    GBPInsights.find({ businessId: ctx.businessId, date: { $gte: startOfThisMonth } }).lean(),
    GBPInsights.find({
      businessId: ctx.businessId,
      date: { $gte: startOfLastMonth, $lte: endOfLastMonth },
    }).lean(),
  ]);
  const MONTH_METRICS: [string, string][] = [
    ['views', 'Total Views'],
    ['viewsSearch', 'Search Views'],
    ['viewsMaps', 'Maps Views'],
    ['callClicks', 'Call Clicks'],
    ['websiteClicks', 'Website Clicks'],
    ['directionRequests', 'Directions'],
    ['conversations', 'Conversations'],
  ];
  const monthComparison = {
    thisMonthLabel: startOfThisMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    lastMonthLabel: startOfLastMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    thisMonthDaysCounted: thisMonthRows.length,
    lastMonthDaysCounted: lastMonthRows.length,
    metrics: MONTH_METRICS.map(([field, label]) => {
      const current = sumField(thisMonthRows, field);
      const previous = sumField(lastMonthRows, field);
      return { key: field, label, current, previous, change: pctChange(current, previous) };
    }),
  };

  // --- Keywords (MONTHLY only) ---
  // Google's searchkeywords endpoint has no daily granularity, so this section
  // is inherently month-based and does NOT follow the 7/14/28/90-day range.
  // Use the most recent month that actually has data: the current month is
  // usually empty for the first days until Google finalizes it.
  const latestKw = await GBPKeyword.findOne({ businessId: ctx.businessId })
    .sort({ year: -1, month: -1 })
    .lean() as any;

  let monthKeywords: any[] = [];
  let keywordMonth: string | null = null;
  if (latestKw) {
    monthKeywords = (await GBPKeyword.find({
      businessId: ctx.businessId,
      year: latestKw.year,
      month: latestKw.month,
    })
      .sort({ impressions: -1 })
      .lean()) as any[];
    keywordMonth = new Date(latestKw.year, latestKw.month - 1, 1).toLocaleString(
      'en-US',
      { month: 'short', year: 'numeric' }
    );
  }

  // The API does NOT return a direct-vs-discovery classification (that old split
  // is deprecated), so we only report what is real: total impressions, the number
  // of unique search terms, and the top terms themselves.
  const totalSearchImpressions = monthKeywords.reduce(
    (acc: number, k: any) => acc + (k.impressions ?? 0),
    0
  );
  const topKeywords = monthKeywords.slice(0, 10).map((k: any) => ({
    keyword: k.keyword,
    impressions: k.impressions ?? 0,
  }));

  return NextResponse.json({
    connected: true,
    needsSync,
    lastSyncAt: tokenDoc?.lastSyncAt ?? null,
    googleEmail: tokenDoc?.googleEmail ?? null,
    summary,
    changes,
    impact,
    monthComparison,
    monthlyTrend,
    timeSeries,
    searchData: {
      totalSearchImpressions,
      uniqueKeywords: monthKeywords.length,
      keywordMonth,
      topKeywords,
    },
  });
}
