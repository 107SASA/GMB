import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import GBPToken from '@/models/GBPToken';
import GBPInsights from '@/models/GBPInsights';
import GBPKeyword from '@/models/GBPKeyword';
import { fetchDailyMetrics, fetchSearchKeywords } from '@/lib/gbpClient';

export async function POST() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  await dbConnect();
  const tokenDoc = await GBPToken.findOne({ businessId: ctx.businessId });
  if (!tokenDoc) {
    return NextResponse.json(
      { success: false, error: 'Google Business Profile not connected' },
      { status: 400 }
    );
  }

  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() - 1); // GBP data lags by 1 day
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 27); // 28 days total

  // --- Sync daily metrics ---
  const dailyData = await fetchDailyMetrics(ctx.businessId, startDate, endDate);

  await Promise.all(
    dailyData.map((d) =>
      GBPInsights.findOneAndUpdate(
        { businessId: ctx.businessId, date: new Date(d.date) },
        {
          $set: {
            businessId: ctx.businessId,
            organizationId: ctx.organizationId,
            date: new Date(d.date),
            views: d.views,
            viewsMaps: d.viewsMaps,
            viewsSearch: d.viewsSearch,
            callClicks: d.callClicks,
            websiteClicks: d.websiteClicks,
            directionRequests: d.directionRequests,
            conversations: d.conversations,
            syncedAt: now,
          },
        },
        { upsert: true }
      )
    )
  );

  // --- Sync keywords: current month + previous month ---
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

  const [currentKeywords, prevKeywords] = await Promise.all([
    fetchSearchKeywords(ctx.businessId, currentYear, currentMonth).catch(() => []),
    fetchSearchKeywords(ctx.businessId, prevYear, prevMonth).catch(() => []),
  ]);

  const allKeywords = [
    ...currentKeywords.map((k) => ({ ...k, year: currentYear, month: currentMonth })),
    ...prevKeywords.map((k) => ({ ...k, year: prevYear, month: prevMonth })),
  ];

  await Promise.all(
    allKeywords.map((k) =>
      GBPKeyword.findOneAndUpdate(
        {
          businessId: ctx.businessId,
          keyword: k.keyword,
          month: k.month,
          year: k.year,
        },
        {
          $set: {
            businessId: ctx.businessId,
            organizationId: ctx.organizationId,
            keyword: k.keyword,
            impressions: k.impressions,
            month: k.month,
            year: k.year,
            type: k.type,
            syncedAt: now,
          },
        },
        { upsert: true }
      )
    )
  );

  await GBPToken.findOneAndUpdate(
    { businessId: ctx.businessId },
    { $set: { lastSyncAt: now } }
  );

  return NextResponse.json({
    success: true,
    synced: true,
    daysProcessed: dailyData.length,
    keywordsProcessed: allKeywords.length,
  });
}
