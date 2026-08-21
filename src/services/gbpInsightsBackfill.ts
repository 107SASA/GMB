import dbConnect from '@/lib/mongodb';
import GBPToken from '@/models/GBPToken';
import GBPInsights from '@/models/GBPInsights';
import { fetchDailyMetrics } from '@/lib/gbpClient';

// Matches the Performance tab's "Last 6 Months Trends" chart — no point
// pulling further back than what the UI actually displays.
const BACKFILL_MONTHS = 6;

// Chunked into ~80-day windows rather than one ~180-day call — defensive
// against an undocumented (or lower-than-expected) per-request day cap on
// Google's fetchMultiDailyMetricsTimeSeries. A single wide call getting
// rejected would otherwise silently fail the WHOLE backfill; a rejected
// chunk here only loses that one slice, and each chunk is independent so a
// retry of the whole function (next sync) just re-fetches everything again
// since historyBackfilledAt is only set after every chunk succeeds.
const CHUNK_DAYS = 80;

/**
 * One-time backfill of ~6 months of GBPInsights history for a business,
 * run from inside the regular sync (gbpSyncWorker / api/gbp/sync) rather
 * than as a separate admin action — see the doc comment on
 * GBPToken.historyBackfilledAt for why this exists: the regular sync only
 * ever pulls a rolling 28-day window, so without this, "Last 6 Months
 * Trends" would only grow by ~1 day of real history per calendar day since
 * the business connected Google, taking ~6 real months to actually fill.
 *
 * No-ops immediately (and cheaply — one indexed findOne, no API call) once
 * already backfilled, so it's safe to call on every single sync forever.
 */
export async function backfillGbpInsightsIfNeeded(
  businessId: string,
  organizationId: string
): Promise<void> {
  await dbConnect();
  const tokenDoc = await GBPToken.findOne({ businessId }).select('historyBackfilledAt');
  if (!tokenDoc || tokenDoc.historyBackfilledAt) return;

  const now = new Date();
  // Same "yesterday, not today" convention as the regular sync — Google's
  // own reporting lag means today's numbers aren't finalized yet.
  const rangeEnd = new Date(now);
  rangeEnd.setDate(rangeEnd.getDate() - 1);
  const rangeStart = new Date(rangeEnd);
  rangeStart.setMonth(rangeStart.getMonth() - BACKFILL_MONTHS);

  let chunkEnd = new Date(rangeEnd);
  while (chunkEnd > rangeStart) {
    const chunkStart = new Date(chunkEnd);
    chunkStart.setDate(chunkStart.getDate() - CHUNK_DAYS);
    const effectiveStart = chunkStart < rangeStart ? rangeStart : chunkStart;

    const points = await fetchDailyMetrics(businessId, effectiveStart, chunkEnd);
    await Promise.all(
      points.map((p) =>
        GBPInsights.findOneAndUpdate(
          { businessId, date: new Date(p.date) },
          {
            $set: {
              businessId,
              organizationId,
              date: new Date(p.date),
              views: p.views,
              viewsMaps: p.viewsMaps,
              viewsSearch: p.viewsSearch,
              callClicks: p.callClicks,
              websiteClicks: p.websiteClicks,
              directionRequests: p.directionRequests,
              conversations: p.conversations,
              syncedAt: now,
            },
          },
          { upsert: true }
        )
      )
    );

    // Step to the next (older) chunk.
    const nextEnd = new Date(effectiveStart);
    nextEnd.setDate(nextEnd.getDate() - 1);
    chunkEnd = nextEnd;
  }

  // Only marked done after every chunk above has succeeded — if any chunk's
  // fetchDailyMetrics call throws, this line is never reached, so the next
  // sync (nightly or manual) retries the whole backfill from scratch rather
  // than getting stuck half-done and marked complete.
  await GBPToken.updateOne({ businessId }, { $set: { historyBackfilledAt: now } });
}
