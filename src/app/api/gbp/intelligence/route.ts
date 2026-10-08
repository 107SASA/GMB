import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import GBPToken from '@/models/GBPToken';
import { getGbpSnapshot } from '@/services/gbp/intelligence/runner';
import { serviceLabel } from '@/services/gbp/intelligence/normalize';
import { canonHours, changeFieldLabel } from '@/services/gbp/intelligence/changes';

export const dynamic = 'force-dynamic';

/**
 * Read-only GBP Intelligence view for the ACTIVE workspace (tenant-scoped by
 * requireBusinessContext → businessId). Built field by field from the stored
 * snapshot: never returns tokens, raw Google payloads or another business's
 * data. Does not call Google — "Sync now" is POST /api/gbp/sync.
 */
export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  await dbConnect();
  const token = await GBPToken.findOne({ businessId: ctx.businessId })
    .select('authStatus lastSyncAt connectedAt')
    .lean<{ authStatus?: { state?: string; detectedAt?: Date } | null; lastSyncAt?: Date | null; connectedAt?: Date }>();
  const s = await getGbpSnapshot(ctx.businessId);

  const connection = !token
    ? { state: 'NOT_CONNECTED' as const }
    : token.authStatus?.state === 'REVOKED'
      ? { state: 'REAUTH_REQUIRED' as const, since: token.authStatus.detectedAt ?? null }
      : { state: 'CONNECTED' as const, connectedAt: token.connectedAt ?? null, metricsSyncedAt: token.lastSyncAt ?? null };

  if (!s) {
    return NextResponse.json({ success: true, connection, snapshot: null });
  }

  const sec = s.sections;
  const loc = sec.location.data;
  const meta = (k: keyof typeof sec) => ({
    status: sec[k].meta.status,
    fetchedAt: sec[k].meta.fetchedAt,
    lastSuccessfulFetchAt: sec[k].meta.lastSuccessfulFetchAt,
    error: sec[k].meta.error ? { category: sec[k].meta.error!.category } : null,
    note: sec[k].meta.note ?? null,
  });
  const today = new Date().toISOString().slice(0, 10);

  return NextResponse.json({
    success: true,
    connection,
    snapshot: {
      fetchedAt: s.fetchedAt,
      lastSuccessfulSyncAt: s.lastSuccessfulSyncAt,
      lastSyncOutcome: s.lastSyncOutcome,
      sectionStatus: Object.fromEntries((Object.keys(sec) as Array<keyof typeof sec>).map((k) => [k, meta(k)])),
      profile: loc
        ? {
            title: loc.title,
            primaryPhone: loc.primaryPhone,
            additionalPhones: loc.additionalPhones,
            website: loc.websiteUri,
            address: loc.address?.formatted ?? null,
            postalCode: loc.address?.postalCode ?? null,
            pin: loc.latlng,
            primaryCategory: loc.primaryCategory?.displayName ?? null,
            additionalCategories: loc.additionalCategories.map((c) => c.displayName),
            description: loc.description,
            regularHours: loc.regularHours == null ? null : canonHours(loc.regularHours),
            specialHours: loc.specialHours.filter((p) => p.endDate >= today),
            services: loc.services.map((x) => ({ name: serviceLabel(x), description: x.description })),
            serviceArea: (loc.serviceArea?.places || []).map((p) => p.placeName).filter(Boolean),
            openStatus: loc.openInfo?.status ?? null,
            mapsUri: loc.metadata.mapsUri,
          }
        : null,
      attributes: sec.attributes.data ? sec.attributes.data.map((a) => ({ label: a.label, value: a.value })) : null,
      media: sec.media.data,
      posts: sec.posts.data
        ? { total: sec.posts.data.total, truncated: sec.posts.data.truncated, live: sec.posts.data.live, byTopicType: sec.posts.data.byTopicType, newestCreateTime: sec.posts.data.newestCreateTime }
        : null,
      reviews: sec.reviews.data,
      products: { available: false, note: sec.products.meta.note ?? null },
      googleUpdates: sec.googleUpdates.data
        ? { diffFields: sec.googleUpdates.data.diffFields, pendingFields: sec.googleUpdates.data.pendingFields }
        : null,
      duplicates: sec.duplicates.data
        ? {
            googleFlagged: !!sec.duplicates.data.googleFlaggedDuplicateOf,
            placesCheckedAt: sec.duplicates.data.placesCheckedAt,
            candidates: sec.duplicates.data.candidates,
          }
        : null,
      health: s.health,
      externalChanges: s.externalChanges.slice(0, 20).map((c) => ({ ...c, label: changeFieldLabel(c.field) })),
    },
  });
}
