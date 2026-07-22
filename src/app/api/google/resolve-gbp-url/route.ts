import { NextResponse } from 'next/server';
import { GooglePlacesService } from '@/services/google/places';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

// Resolves a Google Maps / GBP URL to the same place-details shape that
// /api/google/place-details returns, enabling the "paste a URL" onboarding path.
//
// Supported formats:
//   https://maps.app.goo.gl/<code>          (short link — followed via redirect)
//   https://goo.gl/maps/<code>              (old short link)
//   https://www.google.com/maps/place/NAME/@lat,lng,...
//   https://maps.google.com/maps?q=NAME
//   https://www.google.com/maps?cid=<cid>   (cid lookup → name search fallback)

// Hostnames this route is willing to make a server-side request to. Checked on
// the initial URL *and* on every redirect hop.
const ALLOWED_HOSTS = new Set([
  'maps.app.goo.gl',
  'goo.gl',
  'www.google.com',
  'google.com',
  'maps.google.com',
]);

function isAllowedHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Block file:, gopher:, etc. — only real web requests.
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return ALLOWED_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Expands a Google short link to its final URL.
 *
 * Redirects are followed MANUALLY so the hostname can be re-validated at every
 * hop. With `redirect: 'follow'` a goo.gl link could bounce the server to an
 * internal address (e.g. the 169.254.169.254 cloud-metadata endpoint) and this
 * route would happily fetch it — a public SSRF. Every hop must stay on an
 * allow-listed Google host.
 */
async function expandUrl(url: string): Promise<string> {
  let current = url;

  for (let hop = 0; hop < 5; hop++) {
    if (!isAllowedHost(current)) return url;

    try {
      const res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        // Signal abort after 5s so we don't hang the request
        signal: AbortSignal.timeout(5000),
      });

      const location = res.headers.get('location');
      if (!location) return current;

      // `location` may be relative — resolve against the current URL.
      current = new URL(location, current).toString();
    } catch {
      return url; // return original if expansion fails
    }
  }

  return current;
}

function extractPlaceNameFromUrl(url: string): string | null {
  try {
    // /maps/place/BUSINESS+NAME/@... or /maps/place/BUSINESS%20NAME/...
    const match = url.match(/\/maps\/place\/([^/@?&#]+)/);
    if (match?.[1]) {
      return decodeURIComponent(match[1].replace(/\+/g, ' ')).trim();
    }
    // ?q=BUSINESS+NAME
    const qMatch = new URL(url).searchParams.get('q');
    if (qMatch) return decodeURIComponent(qMatch.replace(/\+/g, ' ')).trim();

    return null;
  } catch {
    return null;
  }
}

// Matches on the parsed HOSTNAME, not anywhere in the raw string. The previous
// unanchored regex meant "http://169.254.169.254/?x=maps.app.goo.gl" counted as
// a short link and got fetched server-side.
function isShortUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'maps.app.goo.gl' || host === 'goo.gl';
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  try {
    // Unauthenticated by necessity — the public signup wizard calls this before
    // the account exists. IP rate limit protects GOOGLE_MAPS_API_KEY billing
    // and caps outbound fetches from this endpoint.
    const rl = checkRateLimit(`places-resolve:${getClientIp(req)}`, 30, 5 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }

    const { url } = await req.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ success: false, error: 'url is required' }, { status: 400 });
    }

    // Step 1: expand short links so we can parse the final URL
    let resolvedUrl = url.trim();
    if (isShortUrl(resolvedUrl)) {
      resolvedUrl = await expandUrl(resolvedUrl);
    }

    // Step 2: extract a searchable business name from the URL
    const placeName = extractPlaceNameFromUrl(resolvedUrl);
    if (!placeName || placeName.length < 2) {
      return NextResponse.json(
        { success: false, error: 'Could not extract a business name from this URL. Try pasting the full Google Maps link.' },
        { status: 422 }
      );
    }

    // Step 3: search Places Autocomplete with the extracted name
    const suggestions = await GooglePlacesService.autocomplete(placeName);
    if (!suggestions || suggestions.length === 0) {
      return NextResponse.json(
        { success: false, error: `No Google Places match found for "${placeName}". Try searching by name instead.` },
        { status: 404 }
      );
    }

    // Step 4: fetch full details for the best match
    const best = suggestions[0];
    const details = await GooglePlacesService.getDetails(best.placeId);
    if (!details) {
      return NextResponse.json(
        { success: false, error: 'Could not fetch place details.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: details,
      extractedName: placeName,
      matchedFrom: best.description,
    });
  } catch (error: any) {
    console.error('[resolve-gbp-url]', error);
    return NextResponse.json({ success: false, error: error.message || 'Internal error' }, { status: 500 });
  }
}
