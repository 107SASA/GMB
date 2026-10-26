import { NextResponse } from 'next/server';

import { consumeGbpConnectHandoff, WEB_SESSION_TTL_SECONDS } from '@/lib/gbpConnectHandoff';
import { signSessionToken } from '@/lib/session';

/**
 * GET /api/auth/google/mobile-handoff/<token> — opened by the iOS app in an
 * ephemeral in-app browser. Consumes the single-use handoff, gives this
 * browser a short web session for the handoff's workspace, and continues
 * into the existing /api/auth/google OAuth flow (state cookie, Google
 * consent, callback and location picker unchanged).
 */

const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

function failurePage(status: number): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link expired</title></head>
<body style="font-family:-apple-system,system-ui,sans-serif;margin:0;padding:48px 24px;text-align:center;color:#111">
<h1 style="font-size:20px">This link has expired</h1>
<p style="color:#555;line-height:1.5">Connect links work once and only for a couple of minutes.<br>Close this window and tap <strong>Connect</strong> in the GrowwMatics app again.</p>
</body></html>`;
  return new NextResponse(html, { status, headers: { ...NO_STORE, 'Content-Type': 'text/html; charset=utf-8' } });
}

const STATUS = { invalid: 404, expired_or_used: 410, session_revoked: 403, workspace_denied: 403 } as const;

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await consumeGbpConnectHandoff(token);
  if (!result.ok) return failurePage(STATUS[result.reason]);

  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const response = NextResponse.redirect(new URL('/api/auth/google', base), { headers: NO_STORE });
  const cookie = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: WEB_SESSION_TTL_SECONDS,
  };
  response.cookies.set(
    'session',
    await signSessionToken(result.userId, result.role, result.sessionEpoch, `${WEB_SESSION_TTL_SECONDS}s`),
    cookie
  );
  response.cookies.set('activeBusinessId', result.businessId, cookie);
  return response;
}
