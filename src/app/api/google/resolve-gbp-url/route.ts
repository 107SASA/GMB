import { NextResponse } from 'next/server';
import { GooglePlacesService } from '@/services/google/places';

// Resolves a Google Maps / GBP URL to the same place-details shape that
// /api/google/place-details returns, enabling the "paste a URL" onboarding path.
//
// Supported formats:
//   https://maps.app.goo.gl/<code>          (short link — followed via redirect)
//   https://goo.gl/maps/<code>              (old short link)
//   https://www.google.com/maps/place/NAME/@lat,lng,...
//   https://maps.google.com/maps?q=NAME
//   https://www.google.com/maps?cid=<cid>   (cid lookup → name search fallback)

async function expandUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      // Signal abort after 5s so we don't hang the request
      signal: AbortSignal.timeout(5000),
    });
    return res.url; // final URL after all redirects
  } catch {
    return url; // return original if expansion fails
  }
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

function isShortUrl(url: string): boolean {
  return /maps\.app\.goo\.gl|goo\.gl\/maps/i.test(url);
}

export async function POST(req: Request) {
  try {
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
