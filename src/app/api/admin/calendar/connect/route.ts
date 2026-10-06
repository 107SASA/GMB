import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { CALENDAR_SCOPES } from '@/services/calendar/demoScheduling';
import { calendarRedirectUri } from '@/services/calendar/salespersonCalendar';

export const dynamic = 'force-dynamic';

/**
 * Starts Google Calendar OAuth for the signed-in Super Admin.
 * Separate from /api/auth/google, which is the Business Profile connection.
 *
 * Required env (already used by GBP, plus one redirect):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_TOKEN_SECRET          encrypts the refresh token at rest
 *   SESSION_SECRET               signs the OAuth state cookie
 *   GOOGLE_CALENDAR_REDIRECT_URI optional; defaults to
 *     ${NEXT_PUBLIC_APP_URL}/api/auth/google/calendar/callback
 * Register that exact redirect URI on the existing OAuth client.
 * Scopes: calendar.freebusy, calendar.events, userinfo.email.
 */

function signingKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return new TextEncoder().encode(secret);
}

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json({ success: false, error: 'Google OAuth client is not configured.' }, { status: 500 });
  }

  const state = crypto.randomBytes(16).toString('hex');
  const stateToken = await new SignJWT({ state, userId: auth.userId, purpose: 'calendar' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(signingKey());

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: calendarRedirectUri(),
    response_type: 'code',
    scope: CALENDAR_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  });

  const response = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  response.cookies.set('calendar_oauth_state', stateToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60,
  });
  return response;
}
