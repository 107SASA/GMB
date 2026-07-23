import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { SignJWT } from 'jose';
import { requireBusinessContext } from '@/lib/tenant';

const SCOPES = 'https://www.googleapis.com/auth/business.manage';

function getSigningKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return new TextEncoder().encode(secret);
}

export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  // The #1 cause of "Error 400: redirect_uri_mismatch" is GOOGLE_REDIRECT_URI
  // not being registered (verbatim) in the OAuth client's Authorized redirect
  // URIs, or pointing at a different origin than the app is served from. Surface
  // an obvious log when the origins diverge so the misconfig is easy to spot.
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  try {
    if (redirectUri && appUrl && new URL(redirectUri).origin !== new URL(appUrl).origin) {
      console.warn(
        `[gbp-oauth] GOOGLE_REDIRECT_URI origin (${new URL(redirectUri).origin}) does not match ` +
          `NEXT_PUBLIC_APP_URL (${new URL(appUrl).origin}). Google will reject with redirect_uri_mismatch ` +
          `unless the exact redirect URI "${redirectUri}" is registered in the OAuth client.`
      );
    }
  } catch {
    /* malformed env URLs — ignore, the redirect below will still surface it */
  }

  const state = crypto.randomBytes(16).toString('hex');

  // Sign state + businessId into a short-lived JWT stored in a cookie
  const stateToken = await new SignJWT({ state, businessId: ctx.businessId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(getSigningKey());

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  const googleUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  const response = NextResponse.redirect(googleUrl);
  response.cookies.set('gbp_oauth_state', stateToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 5 * 60,
  });

  return response;
}
