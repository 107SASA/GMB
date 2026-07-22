import { NextResponse } from 'next/server';
import { GooglePlacesService } from '@/services/google/places';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

// Unauthenticated by necessity — the public signup wizard calls this before the
// account exists. IP rate limit protects GOOGLE_MAPS_API_KEY billing.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 5 * 60 * 1000;

export async function GET(request: Request) {
  try {
    const rl = checkRateLimit(`places-details:${getClientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }

    const { searchParams } = new URL(request.url);
    const placeId = searchParams.get('placeId');

    if (!placeId) {
      return NextResponse.json({ success: false, error: 'Missing placeId' }, { status: 400 });
    }

    const details = await GooglePlacesService.getDetails(placeId);
    
    if (!details) {
      return NextResponse.json({ success: false, error: 'Details not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: details });
  } catch (error: any) {
    console.error("Place Details API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
