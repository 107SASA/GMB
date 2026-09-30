export const runtime = 'nodejs';

import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { requireAuditAccess } from '@/lib/tenant';
import { buildRankMapUrl } from '@/services/audit/reportDisplay';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const kwIndex = Math.max(0, parseInt(searchParams.get('kwIndex') ?? '0', 10));

  // Single source of truth for "is this caller allowed to view this audit"
  // (owner, org-mate, or SUPER_ADMIN) — no dev-environment bypass; see
  // lib/tenant.ts. Previously this route only allowed owner-or-superadmin,
  // missing the org-member case audit/[id]/route.ts already allowed, so an
  // org-mate could see an audit's data but not its geo-map image.
  const ctx = await requireAuditAccess(id);
  if (!ctx.ok) {
    console.error(`[geo-map] Access denied for audit ${id}`);
    return new Response(ctx.response.status === 404 ? 'Not found' : 'Forbidden', { status: ctx.response.status });
  }
  const audit = ctx.audit;

  await dbConnect();

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error('[geo-map] GOOGLE_MAPS_API_KEY not set');
    return new Response('Maps API not configured', { status: 503 });
  }

  const geoGrid = audit.auditData?.geoGridRank;
  const keywords: any[] = geoGrid?.keywords ?? [];
  const kw = keywords[Math.min(kwIndex, keywords.length - 1)];
  if (!kw?.points?.length) {
    console.error(`[geo-map] No geo points for audit=${id} kwIndex=${kwIndex}, keywords=${keywords.length}`);
    return new Response('No geo data', { status: 404 });
  }

  const business = await Business.findById(audit.businessId).lean() as any;

  // Only the points that were actually searched — no padding to a 3×3 grid
  // with made-up rank-21 markers (a 3-point quick check used to show 6
  // fake markers). Colours come from the shared legend (reportDisplay.ts).
  const pts = (kw.points as any[]).map((p) => ({ lat: p.lat, lng: p.lng, rank: p.rank ?? null, found: p.found, status: p.status }));
  const center = business?.coordinates?.lat != null && business?.coordinates?.lng != null
    ? { lat: Number(business.coordinates.lat), lng: Number(business.coordinates.lng) }
    : null;
  const gridSpacingKm: number = geoGrid?.gridSpacingKm || 1.5;
  const zoom = gridSpacingKm <= 1 ? 14 : gridSpacingKm <= 2 ? 13 : 12;
  const mapUrl = buildRankMapUrl({ points: pts, center, apiKey, size: '640x360', zoom: center ? zoom : undefined });
  console.log(`[geo-map] Fetching: ${mapUrl.replace(apiKey, 'KEY_REDACTED')}`);

  try {
    const res = await fetch(mapUrl, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[geo-map] Google API error: status=${res.status} body=${body.slice(0, 200)}`);
      return new Response('Map unavailable', { status: 502 });
    }
    const contentType = res.headers.get('Content-Type') ?? '';
    if (!contentType.startsWith('image/')) {
      const body = await res.text().catch(() => '');
      console.error(`[geo-map] Google returned non-image: contentType=${contentType} body=${body.slice(0, 300)}`);
      return new Response('Map unavailable', { status: 502 });
    }
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch (err: any) {
    console.error('[geo-map] Fetch error:', err?.message);
    return new Response('Map unavailable', { status: 502 });
  }
}
