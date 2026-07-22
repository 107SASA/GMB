import { NextResponse } from 'next/server';
import { GooglePlacesService } from '@/services/google/places';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

// Must stay unauthenticated: the public signup wizard (/onboarding →
// StepBusiness) calls this before the account exists. So the quota is
// protected by an IP rate limit instead of a session check — without it,
// anyone can drain GOOGLE_MAPS_API_KEY billing. Also restrict the key by
// HTTP referrer + API in Google Cloud Console.
const RATE_LIMIT = 60;                 // requests
const RATE_WINDOW_MS = 5 * 60 * 1000;  // per 5 minutes per IP

export async function GET(request: Request) {
  try {
    const rl = checkRateLimit(`places-autocomplete:${getClientIp(request)}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query) {
      return NextResponse.json({ success: true, data: [] });
    }

    const results = await GooglePlacesService.autocomplete(query);
    return NextResponse.json({ success: true, data: results });
  } catch (error: any) {
    console.error("Autocomplete API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
