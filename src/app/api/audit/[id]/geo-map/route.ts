export const runtime = 'nodejs';

import { requireClient } from '@/lib/auth';
import dbConnect from '@/lib/mongodb';
import Audit from '@/models/Audit';
import Business from '@/models/Business';

function buildStaticMapUrl(
  centerLat: number,
  centerLng: number,
  points: Array<{ lat: number; lng: number; rank: number }>,
  apiKey: string,
  gridSpacingKm = 1.5,
): string {
  // Dynamically pick zoom: show the full grid comfortably
  const zoom = gridSpacingKm <= 1 ? 14 : gridSpacingKm <= 2 ? 13 : 12;

  const parts: string[] = [
    `center=${centerLat},${centerLng}`,
    `zoom=${zoom}`,
    'size=640x360',
    'scale=2',
    'maptype=roadmap',
    // Cleaner map style – hide POI icons and transit clutter
    'style=feature:poi%7Celement:labels%7Cvisibility:off',
    'style=feature:transit%7Cvisibility:off',
  ];

  // Non-center points first so the center renders on top
  for (let i = 0; i < points.length; i++) {
    if (i === 4) continue;
    const p = points[i];
    let color: string;
    let labelPart = '';
    if (p.rank <= 5)       { color = '0x22c55e'; if (p.rank <= 9) labelPart = `%7Clabel:${p.rank}`; }
    else if (p.rank <= 10) { color = '0xf59e0b'; if (p.rank <= 9) labelPart = `%7Clabel:${p.rank}`; }
    else if (p.rank <= 20) { color = '0xef4444'; }
    else                   { color = '0x94a3b8'; }
    parts.push(`markers=color:${color}%7Csize:mid${labelPart}%7C${p.lat},${p.lng}`);
  }

  // Business location (center grid point) — blue, large, on top
  const cpt = points[4] ?? { lat: centerLat, lng: centerLng };
  parts.push(`markers=color:0x1d4ed8%7Csize:large%7Clabel:Y%7C${cpt.lat ?? centerLat},${cpt.lng ?? centerLng}`);

  parts.push(`key=${encodeURIComponent(apiKey)}`);
  return `https://maps.googleapis.com/maps/api/staticmap?${parts.join('&')}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const kwIndex = Math.max(0, parseInt(searchParams.get('kwIndex') ?? '0', 10));

  await dbConnect();

  const audit = await Audit.findById(id).lean() as any;
  if (!audit) return new Response('Not found', { status: 404 });

  const isOwner =
    String(audit.userId) === String(auth.userId) ||
    (auth.user as any)?.role === 'SUPER_ADMIN' ||
    process.env.NODE_ENV !== 'production';

  if (!isOwner) return new Response('Forbidden', { status: 403 });

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return new Response('Maps API not configured', { status: 503 });

  const geoGrid = audit.auditData?.geoGridRank;
  const keywords: any[] = geoGrid?.keywords ?? [];
  const kw = keywords[Math.min(kwIndex, keywords.length - 1)];
  if (!kw?.points?.length) return new Response('No geo data', { status: 404 });

  const business = await Business.findById(audit.businessId).lean() as any;

  // Sort points geographically (N→S, W→E) to match the 3×3 grid layout
  const pts: Array<{ lat: number; lng: number; rank: number }> = [...kw.points]
    .sort((a: any, b: any) => b.lat - a.lat || a.lng - b.lng)
    .slice(0, 9);

  const fallbackLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const fallbackLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  while (pts.length < 9) pts.push({ lat: fallbackLat, lng: fallbackLng, rank: 21 });

  const cLat: number = business?.coordinates?.lat ?? fallbackLat;
  const cLng: number = business?.coordinates?.lng ?? fallbackLng;
  const gridSpacingKm: number = geoGrid?.gridSpacingKm ?? 1.5;

  const mapUrl = buildStaticMapUrl(cLat, cLng, pts, apiKey, gridSpacingKm);

  try {
    const res = await fetch(mapUrl, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return new Response('Map unavailable', { status: 502 });
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'image/png',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch {
    return new Response('Map unavailable', { status: 502 });
  }
}
