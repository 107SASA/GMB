import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import GBPToken from '@/models/GBPToken';
import GBPInsights from '@/models/GBPInsights';
import GBPKeyword from '@/models/GBPKeyword';
import Business from '@/models/Business';

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

  const business = await Business.findById(ctx.businessId).lean() as any;
  if (!business?.googleConnected) {
    return NextResponse.json({ connected: false });
  }

  const { searchParams } = new URL(request.url);
  const rangeParam = parseInt(searchParams.get('range') ?? '28', 10);
  const range = (VALID_RANGES.includes(rangeParam as any) ? rangeParam : 28) as number;

  const tokenDoc = await GBPToken.findOne({ businessId: ctx.businessId }).lean() as any;
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
    totalCallClicks: sumField(currentRows, 'callClicks'),
    totalWebsiteClicks: sumField(currentRows, 'websiteClicks'),
    totalDirectionRequests: sumField(currentRows, 'directionRequests'),
    totalConversations: sumField(currentRows, 'conversations'),
  };

  const prevSummary = {
    views: sumField(prevRows, 'views'),
    callClicks: sumField(prevRows, 'callClicks'),
    websiteClicks: sumField(prevRows, 'websiteClicks'),
    directionRequests: sumField(prevRows, 'directionRequests'),
    conversations: sumField(prevRows, 'conversations'),
  };

  const changes = {
    views: pctChange(summary.totalViews, prevSummary.views),
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

  // --- Keywords ---
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const keywordDocs = await GBPKeyword.find({
    businessId: ctx.businessId,
    month: currentMonth,
    year: currentYear,
  })
    .sort({ impressions: -1 })
    .limit(10)
    .lean() as any[];

  const directSearches = keywordDocs
    .filter((k: any) => k.type === 'DIRECT')
    .reduce((acc: number, k: any) => acc + (k.impressions ?? 0), 0);

  const discoverySearches = keywordDocs
    .filter((k: any) => k.type === 'INDIRECT' || k.type === 'CHAIN')
    .reduce((acc: number, k: any) => acc + (k.impressions ?? 0), 0);

  const topKeywords = keywordDocs.map((k: any) => ({
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
      directSearches,
      discoverySearches,
      topKeywords,
    },
  });
}
