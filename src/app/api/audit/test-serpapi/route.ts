import { NextResponse } from 'next/server';
import axios from 'axios';

const SERPAPI_BASE = 'https://serpapi.com/search.json';
const PLACES_BASE  = 'https://maps.googleapis.com/maps/api/place/textsearch/json';

/**
 * Diagnostic endpoint — tests SerpApi AND Google Places API.
 * Usage: GET /api/audit/test-serpapi?category=IT+Company&city=Bengaluru
 * Only available when NODE_ENV !== 'production'.
 */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const category = (searchParams.get('category') || 'IT Company').trim();
  const city     = (searchParams.get('city')     || 'Bengaluru').trim();
  const query    = `${category} in ${city}`;

  // ── Test Google Places API ─────────────────────────────────────────────────
  const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY;
  let placesResult: any = { skipped: 'No GOOGLE_MAPS_API_KEY' };

  if (GOOGLE_KEY) {
    const t0 = Date.now();
    try {
      const res = await axios.get(PLACES_BASE, {
        params: { query, key: GOOGLE_KEY, type: 'establishment' },
        timeout: 20000,
      });
      const results: any[] = res.data.results || [];
      placesResult = {
        ok:           true,
        elapsedMs:    Date.now() - t0,
        status:       res.data.status,
        resultsCount: results.length,
        topResults:   results.slice(0, 5).map((r: any) => ({
          name:    r.name,
          rating:  r.rating,
          reviews: r.user_ratings_total,
          address: r.formatted_address,
        })),
      };
    } catch (err: any) {
      placesResult = {
        ok:        false,
        elapsedMs: Date.now() - t0,
        error:     err.message,
        status:    err.response?.status,
      };
    }
  }

  // ── Test SerpApi ───────────────────────────────────────────────────────────
  const SERPAPI_KEY = process.env.SERPAPI_KEY;
  let serpResult: any = { skipped: 'No SERPAPI_KEY' };

  if (SERPAPI_KEY) {
    const t1 = Date.now();
    try {
      const res = await axios.get(SERPAPI_BASE, {
        params: { engine: 'google_maps', q: query, api_key: SERPAPI_KEY, num: 10 },
        timeout: 20000,
      });
      const results: any[] = res.data.local_results || [];
      serpResult = {
        ok:           true,
        elapsedMs:    Date.now() - t1,
        resultsCount: results.length,
        topResults:   results.slice(0, 5).map((r: any) => ({
          name:    r.title,
          rating:  r.rating,
          reviews: r.reviews,
        })),
        serpApiError: res.data.error || null,
      };
    } catch (err: any) {
      serpResult = {
        ok:              false,
        elapsedMs:       Date.now() - t1,
        error:           err.message,
        status:          err.response?.status,
        serpApiMessage:  err.response?.data?.error,
      };
    }
  }

  return NextResponse.json({ query, googlePlaces: placesResult, serpApi: serpResult });
}
