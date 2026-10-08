import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import GBPToken from '@/models/GBPToken';
import GbpLocationSnapshot from '@/models/GbpLocationSnapshot';
import { inngest } from '@/services/inngest/client';
import { checkRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

const WAIT_MS = 25_000;
const POLL_MS = 1_000;
const MIN_INTERVAL_MS = 30_000;

/**
 * Manual "Sync now" (web Insights page, dashboard GBP section, mobile
 * Performance tab). Runs the SAME pipeline as connect and the 6-hourly
 * schedule — the `gbp/sync.requested` event handled by gbpSyncWorker
 * (metrics, keywords, reviews, GBP Intelligence snapshot, profile gap-fill,
 * history backfill) — instead of a second inline copy of that logic.
 *
 * Callers refetch as soon as this returns, so it waits up to WAIT_MS for the
 * worker to finish. `synced` says whether it finished in that time; if not,
 * the sync still completes in the background.
 */
export async function POST() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  await dbConnect();
  const tokenDoc = await GBPToken.findOne({ businessId: ctx.businessId }).select('_id').lean();
  if (!tokenDoc) {
    return NextResponse.json(
      { success: false, error: 'Google Business Profile not connected' },
      { status: 400 }
    );
  }

  const rl = checkRateLimit(`gbp-manual-sync:${ctx.businessId}`, 1, MIN_INTERVAL_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: 'A sync was just started — please wait a moment before syncing again.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  const startedAt = new Date();
  await inngest.send({
    // Same event id within the window → Inngest drops the duplicate.
    id: `gbp-manual-sync-${ctx.businessId}-${Math.floor(startedAt.getTime() / MIN_INTERVAL_MS)}`,
    name: 'gbp/sync.requested',
    data: { businessId: ctx.businessId, reason: 'manual' },
  });

  // The intelligence step runs after metrics and reviews, so a snapshot
  // fetched after `startedAt` means the data the caller re-reads is fresh.
  const deadline = Date.now() + WAIT_MS;
  let synced = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const snap = await GbpLocationSnapshot.findOne({ businessId: ctx.businessId }).select('fetchedAt lastSyncOutcome healthState').lean<{ fetchedAt?: Date; lastSyncOutcome?: string; healthState?: string }>();
    if (snap?.fetchedAt && new Date(snap.fetchedAt).getTime() >= startedAt.getTime()) {
      synced = true;
      return NextResponse.json({ success: true, synced, queued: true, outcome: snap.lastSyncOutcome ?? null, healthState: snap.healthState ?? null });
    }
  }
  return NextResponse.json({ success: true, synced, queued: true });
}
