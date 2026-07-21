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
    timeSeries,
    searchData: {
      totalSearchImpressions,
      uniqueKeywords: monthKeywords.length,
      keywordMonth,
      topKeywords,
    },
  });
}
