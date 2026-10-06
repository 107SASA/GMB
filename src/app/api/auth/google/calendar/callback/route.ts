import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import dbConnect from '@/lib/mongodb';
import SalespersonCalendarConnection from '@/models/SalespersonCalendarConnection';
import { encrypt } from '@/lib/crypto';
import { exchangeCalendarCode } from '@/services/calendar/salespersonCalendar';

export const dynamic = 'force-dynamic';

function signingKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return new TextEncoder().encode(secret);
}

function appRedirect(path: string, request: NextRequest): NextResponse {
  const base = process.env.NEXT_PUBLIC_APP_URL || request.url;
  return NextResponse.redirect(new URL(path, base));
}

/** Calendar OAuth callback. Does not read or write GBP tokens. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const stateFromGoogle = searchParams.get('state');
  if (searchParams.get('error') || !code || !stateFromGoogle) {
    return appRedirect('/admin/booking-agent?calendar=denied', request);
  }

  const cookie = request.cookies.get('calendar_oauth_state')?.value;
  if (!cookie) return appRedirect('/admin/booking-agent?calendar=denied', request);

  let userId = '';
  try {
    const { payload } = await jwtVerify(cookie, signingKey());
    if (payload.purpose !== 'calendar' || payload.state !== stateFromGoogle || typeof payload.userId !== 'string') {
      return appRedirect('/admin/booking-agent?calendar=denied', request);
    }
    userId = payload.userId;
  } catch {
    return appRedirect('/admin/booking-agent?calendar=denied', request);
  }

  try {
    await dbConnect();
    const tokens = await exchangeCalendarCode(code);
    await SalespersonCalendarConnection.findOneAndUpdate(
      { userId },
      {
        $set: {
          userId,
          googleEmail: tokens.email,
          calendarId: 'primary',
          refreshTokenEnc: encrypt(tokens.refreshToken),
          accessTokenEnc: encrypt(tokens.accessToken),
          accessTokenExpiresAt: tokens.expiresAt,
          status: 'active',
          lastCheckedAt: new Date(),
          lastError: '',
        },
      },
      { upsert: true }
    );
  } catch (err: any) {
    console.warn('[calendar-oauth] connection failed:', err?.message || 'unknown');
    return appRedirect('/admin/booking-agent?calendar=failed', request);
  }

  const response = appRedirect('/admin/booking-agent?calendar=connected', request);
  response.cookies.set('calendar_oauth_state', '', { httpOnly: true, path: '/', maxAge: 0 });
  return response;
}
