/**
 * Wires the GBP Intelligence orchestrator (sync.ts) to the real database,
 * token handling (lib/gbpClient.ts getValidToken — existing encryption and
 * refresh), the existing media reader and in-app notifications.
 *
 * Called from ONE place: the existing gbpSyncWorker (services/inngest/functions.ts),
 * which runs on connect, every 6 hours, and on manual "Sync now".
 */
import dbConnect from '@/lib/mongodb';
import GBPToken from '@/models/GBPToken';
import Business from '@/models/Business';
import Review from '@/models/Review';
import ProfileActivity from '@/models/ProfileActivity';
import GbpLocationSnapshot from '@/models/GbpLocationSnapshot';
import { getValidToken, listLocationMedia } from '@/lib/gbpClient';
import { notifyBusinessUsers } from '@/services/notifications';
import { createGbpReadApi, searchPlacesNear, type FetchFn } from './googleApi';
import { emptySections, runGbpIntelligenceSync } from './sync';
import { changeFieldLabel } from './changes';
import { recentMaterialChanges } from './auditInput';
import { FIX_GUIDE } from './health';
import type { GbpReviewsSummary, GbpSnapshotCore, SyncReason } from './types';
import { SNAPSHOT_SCHEMA_VERSION } from './types';

const iso = (d: unknown): string | null => (d ? new Date(d as any).toISOString() : null);

/** Stored document → the orchestrator's plain snapshot shape. */
export function snapshotDocToCore(doc: any): GbpSnapshotCore | null {
  if (!doc) return null;
  return {
    businessId: String(doc.businessId),
    accountId: doc.accountId ?? null,
    locationId: doc.locationId ?? null,
    placeId: doc.placeId ?? null,
    source: 'GOOGLE_BUSINESS_PROFILE',
    schemaVersion: doc.schemaVersion ?? SNAPSHOT_SCHEMA_VERSION,
    fetchedAt: iso(doc.fetchedAt),
    lastSuccessfulSyncAt: iso(doc.lastSuccessfulSyncAt),
    lastSyncReason: doc.lastSyncReason ?? null,
    lastSyncOutcome: doc.lastSyncOutcome ?? null,
    sections: { ...emptySections(), ...(doc.sections || {}) },
    externalChanges: Array.isArray(doc.externalChanges) ? doc.externalChanges : [],
    health: doc.health || { state: 'UNKNOWN', issues: [], lastCheckedAt: iso(doc.updatedAt) || new Date().toISOString() },
  };
}

/** Read the current snapshot for ONE business (tenant-scoped by businessId). */
export async function getGbpSnapshot(businessId: string): Promise<GbpSnapshotCore | null> {
  await dbConnect();
  const doc = await GbpLocationSnapshot.findOne({ businessId }).lean();
  return snapshotDocToCore(doc);
}

/**
 * Is a GBP Intelligence snapshot for the workspace's CURRENT location on file?
 * Database reads only. `connected:false` → there is nothing to wait for.
 */
export async function gbpSnapshotReadiness(businessId: string): Promise<{ connected: boolean; ready: boolean }> {
  await dbConnect();
  const token = await GBPToken.findOne({ businessId }).select('locationId').lean<{ locationId?: string }>();
  if (!token?.locationId) return { connected: false, ready: true };
  const snap = await GbpLocationSnapshot.findOne({ businessId }).select('locationId fetchedAt').lean<{ locationId?: string; fetchedAt?: Date }>();
  return { connected: true, ready: !!snap?.fetchedAt && snap.locationId === token.locationId };
}

async function readReviewsSummary(businessId: string): Promise<GbpReviewsSummary> {
  const [storedCount, unrepliedCount, newest, biz, token] = await Promise.all([
    Review.countDocuments({ businessId }),
    Review.countDocuments({ businessId, replyStatus: { $ne: 'POSTED' }, $or: [{ response: { $exists: false } }, { response: '' }, { response: null }] }),
    Review.findOne({ businessId }).sort({ postedAt: -1 }).select('postedAt').lean<{ postedAt?: Date }>(),
    Business.findById(businessId).select('googleReviewTotals').lean<{ googleReviewTotals?: { count?: number; rating?: number | null; source?: string } }>(),
    GBPToken.findOne({ businessId }).select('reviewSync').lean<{ reviewSync?: any }>(),
  ]);
  const totals = biz?.googleReviewTotals?.source === 'gbp_api' ? biz.googleReviewTotals : null;
  const googleTotalCount = typeof totals?.count === 'number' ? totals.count : null;
  return {
    googleTotalCount,
    googleAverageRating: totals?.rating ?? null,
    storedCount,
    unrepliedCount,
    newestReviewAt: iso(newest?.postedAt),
    complete: googleTotalCount == null ? null : storedCount >= googleTotalCount,
    lastSyncMode: token?.reviewSync?.mode ?? null,
    lastSyncAt: iso(token?.reviewSync?.lastRunAt),
    conflicts: Number(token?.reviewSync?.conflicts || 0),
  };
}

/** Profile fields GrowwMatics itself wrote live to Google since `since`. */
async function growmaticsEditedFields(businessId: string, since: Date | null): Promise<Set<string>> {
  const rows: any[] = await ProfileActivity.find({
    businessId,
    type: 'profile_updated',
    ...(since ? { createdAt: { $gt: since } } : {}),
  }).select('metadata').lean();
  const out = new Set<string>();
  for (const r of rows) {
    if (r?.metadata?.liveWriteApplied !== true) continue;
    for (const f of r?.metadata?.fields || []) out.add(String(f)); // title / description / primaryPhone / website
  }
  return out;
}

export interface IntelligenceRunSummary {
  ok: boolean;
  skipped?: string;
  outcome?: string | null;
  healthState?: string;
  calls?: Record<string, number>;
  newChanges?: number;
  /** For the existing Business gap-fill step — avoids a second location read. */
  profileForBusiness?: {
    title: string;
    description: string;
    primaryPhone: string;
    website: string;
    primaryCategory: string;
    address: string;
  } | null;
}

/**
 * ONE GBP Intelligence sync for one business. Never throws for Google
 * failures — they are recorded per section on the snapshot.
 */
export async function syncCompleteGbpIntelligence(
  businessId: string,
  opts: { reason?: SyncReason; force?: boolean } = {},
): Promise<IntelligenceRunSummary> {
  await dbConnect();
  const token: any = await GBPToken.findOne({ businessId }).select('accountId locationId organizationId').lean();
  if (!token?.locationId) return { ok: false, skipped: 'No connected Google location' };

  const prevDoc = await GbpLocationSnapshot.findOne({ businessId }).lean();
  const previous = snapshotDocToCore(prevDoc);
  // Previous snapshot from a different location (reconnected elsewhere) is not comparable.
  const comparablePrevious = previous && previous.locationId === token.locationId ? previous : null;

  const fetchFn = fetch as unknown as FetchFn;
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
  const result = await runGbpIntelligenceSync(
    {
      businessId,
      accountId: token.accountId || null,
      locationId: token.locationId,
      previous: comparablePrevious,
      reason: opts.reason || 'unknown',
      force: opts.force,
    },
    {
      now: () => new Date(),
      getAccessToken: () => getValidToken(businessId),
      api: createGbpReadApi(fetchFn),
      listMedia: () => listLocationMedia(businessId),
      readReviewsSummary: () => readReviewsSummary(businessId),
      searchPlaces: mapsKey ? (q, c, r) => searchPlacesNear(fetchFn, mapsKey, q, c, r) : undefined,
      growmaticsEditedFields: (since) => growmaticsEditedFields(businessId, since),
    },
  );

  const s = result.snapshot;
  await GbpLocationSnapshot.findOneAndUpdate(
    { businessId },
    {
      $set: {
        businessId,
        organizationId: token.organizationId,
        accountId: s.accountId,
        locationId: s.locationId,
        placeId: s.placeId,
        source: s.source,
        schemaVersion: s.schemaVersion,
        fetchedAt: s.fetchedAt ? new Date(s.fetchedAt) : null,
        lastSuccessfulSyncAt: s.lastSuccessfulSyncAt ? new Date(s.lastSuccessfulSyncAt) : null,
        lastSyncReason: s.lastSyncReason,
        lastSyncOutcome: s.lastSyncOutcome,
        sections: s.sections,
        externalChanges: s.externalChanges,
        health: s.health,
        healthState: s.health.state,
        // Dots are not safe in stored field names ("locations.get" → "locations_get").
        lastSyncCalls: Object.fromEntries(Object.entries(result.calls).map(([k, v]) => [k.replace(/\./g, '_'), v])),
      },
    },
    { upsert: true },
  );

  // Alerts (in-app): new health issues and material changes made outside
  // GrowwMatics. AUTH_REVOKED is alerted once by getValidToken itself;
  // SYNC_FAILED is our own retry state, not an owner alert.
  try {
    const alertCodes = result.newIssueCodes.filter((c) => c !== 'AUTH_REVOKED' && c !== 'SYNC_FAILED');
    if (alertCodes.length) {
      const first = FIX_GUIDE[alertCodes[0]];
      await notifyBusinessUsers(businessId, {
        type: 'gbp_health_issue',
        title: alertCodes.length === 1 ? first.explanation : `${alertCodes.length} Google Business Profile issues need attention`,
        body: `${first.recommendedAction}${alertCodes.length > 1 ? ` (+${alertCodes.length - 1} more on the Google Business Profile page)` : ''}`.slice(0, 300),
        link: '/dashboard/gbp-profile',
      });
    }
    if (comparablePrevious && result.newChanges.length) {
      const material = recentMaterialChanges({ ...s, externalChanges: result.newChanges }, null);
      if (material.length) {
        await notifyBusinessUsers(businessId, {
          type: 'gbp_external_change',
          title: 'Your Google listing changed outside GrowwMatics',
          body: `Changed: ${material.slice(0, 3).map((c) => changeFieldLabel(c.field)).join(', ')}${material.length > 3 ? ` and ${material.length - 3} more` : ''}. Check that these are correct.`,
          link: '/dashboard/gbp-profile',
        });
      }
    }
  } catch (err: any) {
    console.warn('[gbpIntelligence] notification failed:', err?.message);
  }

  console.log(`[gbpIntelligence] business=${businessId} reason=${opts.reason} outcome=${s.lastSyncOutcome} health=${s.health.state} calls=${JSON.stringify(result.calls)} changes=${result.newChanges.length}`);
  return {
    ok: true,
    outcome: s.lastSyncOutcome,
    healthState: s.health.state,
    calls: result.calls,
    newChanges: result.newChanges.length,
    profileForBusiness: result.profileForBusiness,
  };
}
