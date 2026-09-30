import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { buildRankMapUrl } from '@/services/audit/reportDisplay';

// Same pattern as /api/google/autocomplete and /api/google/place-details:
// unauthenticated (the free-report page's rank visual needs this before any
// login exists) but IP rate-limited to protect GOOGLE_MAPS_API_KEY billing.
// The key itself never reaches the client — this route fetches the map
// image server-side and streams the bytes back, unlike a raw
// maps.googleapis.com/staticmap URL embedded directly in an <img src>,
// which would expose the key in the page source.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 5 * 60 * 1000;
const MAX_POINTS = 12;
export async function GET(request: Request) {
  try {
    const rl = checkRateLimit(`static-map:${getClientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
      );
    }

    const KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!KEY) return NextResponse.json({ error: 'Maps not configured' }, { status: 503 });

    const { searchParams } = new URL(request.url);
    const pointsRaw = searchParams.get('points'); // JSON: [{lat,lng,rank}]
    if (!pointsRaw) return NextResponse.json({ error: 'Missing points' }, { status: 400 });

    let parsed: Array<{ lat: number; lng: number; rank: number | null; found?: boolean; status?: string }>;
    try {
      parsed = JSON.parse(pointsRaw);
    } catch {
      return NextResponse.json({ error: 'Invalid points' }, { status: 400 });
    }
    // Capped so a malformed/oversized payload can't be used to build an
    // arbitrarily large request against our billed Maps key. `rank: null`
    // = not found (new audits); status 'unavailable' = the search failed.
    // Both are drawn in their own colour — never dropped, never "20+".
    const points = (Array.isArray(parsed) ? parsed : [])
      .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && (p.rank === null || Number.isFinite(p.rank)))
      .slice(0, MAX_POINTS)
      .map((p) => ({ lat: p.lat, lng: p.lng, rank: p.rank, found: p.found, status: p.status }));
    if (points.length === 0) return NextResponse.json({ error: 'No valid points' }, { status: 400 });

    // Same colours/legend as every other report surface (reportDisplay.ts).
    const url = buildRankMapUrl({ points, apiKey: KEY, size: '600x320' });

    const imgRes = await fetch(url);
    if (!imgRes.ok) return NextResponse.json({ error: 'Failed to fetch map' }, { status: 502 });

    const buf = await imgRes.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        'Content-Type': imgRes.headers.get('Content-Type') || 'image/png',
        // Rank data itself has a 7-day cache TTL server-side (see
        // PlaceInsightCache) — an hour of image caching is well within that
        // and cuts down on redundant Static Maps calls for repeat page views.
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error: any) {
    console.error('Static Map API Error:', error);
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
