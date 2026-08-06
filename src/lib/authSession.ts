import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import Business from '@/models/Business';
import User from '@/models/User';
import { createSession, signSessionToken, SESSION_MAX_AGE_SECONDS } from '@/lib/session';

/**
 * Everything that needs to happen once a login attempt (whichever method —
 * email+password, phone+OTP, …) has been verified: create the session,
 * record lastLoginAt, clear any account lockout, sync the activeBusinessId
 * cookie, and answer mobile clients with a bearer token instead of a cookie.
 *
 * Extracted from the original email/password login route so a second login
 * method doesn't have to reimplement (and risk drifting from) this exact
 * sequence.
 */
export async function finalizeLogin(
  user: { _id: unknown; role: string; activeBusinessId?: unknown },
  req: Request
): Promise<NextResponse> {
  const userId = String(user._id);

  await createSession(userId, user.role);

  await User.updateOne(
    { _id: userId },
    { $set: { lastLoginAt: new Date(), failedLoginAttempts: 0 }, $unset: { accountLockedUntil: '' } }
  );

  // Sync activeBusinessId cookie so client-side context loads the right business
  let activeBusinessId = user.activeBusinessId ? String(user.activeBusinessId) : undefined;
  if (!activeBusinessId) {
    const business = await Business.findOne({ userId }).select('_id').lean() as any;
    if (business) {
      activeBusinessId = business._id.toString();
      await User.updateOne({ _id: userId }, { $set: { activeBusinessId: business._id } });
    }
  }

  if (activeBusinessId) {
    const cookieStore = await cookies();
    cookieStore.set('activeBusinessId', activeBusinessId, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  // Mobile clients get the JWT in the body (no cookie support); web never does.
  if (req.headers.get('x-client') === 'mobile') {
    const token = await signSessionToken(userId, user.role);
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
    return NextResponse.json({ success: true, token, expiresAt }, { status: 200 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
