import { NextResponse } from 'next/server';
import { securityLogged } from '@/services/security/securityLog';
import { destroySession, getSession } from '@/lib/session';
import { invalidateUserSessions } from '@/lib/sessionInvalidation';

/**
 * Logout.
 *
 * Default: clears the session cookie for THIS device only (fast, no DB write).
 *
 * `?scope=all` (or body `{ allDevices: true }`): also bumps the user's
 * sessionEpoch so every other session / mobile bearer token for the account
 * is revoked on its next request — "log out everywhere".
 */
async function handlePOST(req: Request) {
  let allDevices = false;
  try {
    const url = new URL(req.url);
    if (url.searchParams.get('scope') === 'all') allDevices = true;
  } catch {
    /* ignore */
  }
  if (!allDevices) {
    try {
      const body = await req.json();
      if (body && body.allDevices === true) allDevices = true;
    } catch {
      /* no body — fine */
    }
  }

  if (allDevices) {
    const session = await getSession();
    if (session?.userId) {
      await invalidateUserSessions(session.userId, 'logout_all');
    }
  }

  await destroySession();
  return NextResponse.json({ success: true, allDevices });
}

/** Every call is recorded in the security log (Super Admin → Security Log). */
export const POST = securityLogged('auth.logout', handlePOST);
