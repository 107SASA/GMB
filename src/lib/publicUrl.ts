/**
 * Absolute URL for a redirect. Behind the production reverse proxy the
 * request URL's host is the app's own localhost:3000, so `new URL(path,
 * req.url)` sent people to https://localhost:3000/... — use the public site
 * address (NEXT_PUBLIC_APP_URL) when it is set, else the request's origin
 * (local development).
 */
export function publicUrl(path: string, req: { url: string }): URL {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  return new URL(path, base && /^https?:\/\//.test(base) ? base : req.url);
}
