import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { SignJWT } from 'jose';
import { verifyReportConnectToken } from '@/lib/reportConnect';

const SCOPES = 'https://www.googleapis.com/auth/business.manage';

function getSigningKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return new TextEncoder().encode(secret);
}

/**
 * Entry point for the WhatsApp "connect your Google Business Profile" link.
 * Unauthenticated counterpart to /api/auth/google/route.ts — that route
 * requires requireBusinessContext() (a logged-in session with an active
 * Business), which a pre-signup WhatsApp visitor doesn't have yet. Same
 * double-submit CSRF state pattern, own cookie name and redirect URI so it
 * doesn't collide with the authenticated dashboard flow.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ connectToken: string }> }
) {
  const { connectToken } = await params;
  const payload = await verifyReportConnectToken(connectToken);
  if (!payload) {
    return NextResponse.redirect(new URL('/connect-google/error?reason=expired_link', req.url));
  }

  const redirectUri = process.env.GOOGLE_REPORT_CONNECT_REDIRECT_URI;
  if (!redirectUri) {
    console.error('[report-connect] GOOGLE_REPORT_CONNECT_REDIRECT_URI is not set');
    return NextResponse.redirect(new URL('/connect-google/error?reason=not_configured', req.url));
  }

  const state = crypto.randomBytes(16).toString('hex');
  const stateToken = await new SignJWT({ state, reportConversationId: payload.reportConversationId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(getSigningKey());

  const params_ = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  const googleUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params_.toString()}`;

  const response = NextResponse.redirect(googleUrl);
  response.cookies.set('report_oauth_state', stateToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60,
  });

  return response;
}
