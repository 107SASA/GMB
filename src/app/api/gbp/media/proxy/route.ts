import { requireBusinessContext } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

/**
 * Streams a Google Business Profile media URL (googleUrl/thumbnailUrl from the
 * My Business v4 media API) through our own origin instead of letting the
 * browser fetch lh3.googleusercontent.com directly. Some of those photo URLs
 * get blocked client-side by Chrome's ORB (Opaque Response Blocking) when
 * loaded cross-origin — proxying sidesteps that regardless of upstream cause.
 */

const ALLOWED_HOSTS = /^lh[0-9]\.googleusercontent\.com$/;

export async function GET(request: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  const { searchParams } = new URL(request.url);
  const target = searchParams.get('url');
  if (!target) {
    return new Response('Missing url', { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response('Invalid url', { status: 400 });
  }

  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.test(parsed.hostname)) {
    return new Response('URL not allowed', { status: 400 });
  }

  try {
    const res = await fetch(parsed.toString(), { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      return new Response('Media unavailable', { status: 502 });
    }
    const contentType = res.headers.get('Content-Type') ?? '';
    if (!contentType.startsWith('image/')) {
      return new Response('Media unavailable', { status: 502 });
    }
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch {
    return new Response('Media unavailable', { status: 502 });
  }
}
