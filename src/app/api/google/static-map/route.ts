import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

// Same pattern as /api/google/autocomplete and /api/google/place-details:
// unauthenticated (the free-report page's rank visual needs this before any
// login exists) but IP rate-limited to protect GOOGLE_MAPS_API_KEY billing.
// The key itself never reaches the client — this route fetches the map
// image server-side and streams the bytes back, unlike a raw
// maps.googleapis.com/staticmap URL embedded directly in an <img src>,
// which would expose the key in the page source.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 5 * 60 * 1000;
const STATIC_MAP_BASE = 'https://maps.googleapis.com/maps/api/staticmap';
const MAX_POINTS = 12;

// Mirrors NOT_FOUND_RANK in src/services/audit/seoAnalyzer.ts.
const NOT_FOUND_RANK = 21;

function colorForRank(rank: number): string {
  if (rank <= 5) return '0x62bd32';            // Good — top 5
  if (rank < NOT_FOUND_RANK) return '0x0a8a3e'; // Average — 6-20
  return '0xba1a1a';                            // Poor — beyond 20
}

const LETTERS = 'ABCDEFGHIJKL';

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

    let parsed: Array<{ lat: number; lng: number; rank: number }>;
    try {
      parsed = JSON.parse(pointsRaw);
    } catch {
      return NextResponse.json({ error: 'Invalid points' }, { status: 400 });
    }
    // Capped so a malformed/oversized payload can't be used to build an
    // arbitrarily large request against our billed Maps key.
    const points = (Array.isArray(parsed) ? parsed : [])
      .filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && Number.isFinite(p?.rank))
      .slice(0, MAX_POINTS);
    if (points.length === 0) return NextResponse.json({ error: 'No valid points' }, { status: 400 });

    // No stored business centroid is passed through to the report API
    // response (only per-point lat/lng), so approximate "your location"
    // as the geometric center of the grid points — for a 1.5km-spaced grid
    // this is off from the true center by well under a km, negligible at
    // the zoom level of a several-km-wide illustrative map.
    const centerLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const centerLng = points.reduce((s, p) => s + p.lng, 0) / points.length;

    const url = new URL(STATIC_MAP_BASE);
    url.searchParams.set('size', '600x320');
    url.searchParams.set('scale', '2');
    url.searchParams.set('maptype', 'roadmap');
    url.searchParams.set('key', KEY);
    url.searchParams.append('markers', `color:0x111111|label:Y|${centerLat},${centerLng}`);
    points.forEach((p, i) => {
      url.searchParams.append('markers', `color:${colorForRank(p.rank)}|label:${LETTERS[i] || '*'}|${p.lat},${p.lng}`);
    });

    const imgRes = await fetch(url.toString());
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
