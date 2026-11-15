import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import User from '@/models/User';
import {
  resolveLoginWorkspace,
  CHOOSE_WORKSPACE_COOKIE,
  CHOOSE_WORKSPACE_COOKIE_OPTIONS,
} from '@/lib/loginWorkspace';
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
  user: { _id: unknown; role: string; activeBusinessId?: unknown; sessionEpoch?: number },
  req: Request
): Promise<NextResponse> {
  // Growth Partners sign in only at /partner-login (POST /api/partner/auth),
  // never through the customer login methods.
  if (user.role === 'GROWTH_PARTNER') {
    return NextResponse.json(
      { success: false, error: 'This is a Growth Partner account. Please sign in at the partner login page.', code: 'PARTNER_ACCOUNT' },
      { status: 403 }
    );
  }

  // Super admins and Content Studio team members sign in only at /admin-login
  // (password + emailed code).
  // Letting them in here skipped that page's rate limits and the code step.
  if (user.role === 'SUPER_ADMIN' || user.role === 'TEAM_MEMBER') {
    return NextResponse.json(
      { success: false, error: 'This is a staff account. Please sign in at the admin login page.', code: 'ADMIN_ACCOUNT' },
      { status: 403 }
    );
  }

  const userId = String(user._id);
  // Embed the user's current session epoch so this token survives until the
  // next invalidateUserSessions() call for them (see src/lib/sessionInvalidation.ts).
  const sessionEpoch = (user as any).sessionEpoch ?? 0;

  await createSession(userId, user.role, sessionEpoch);

  await User.updateOne(
    { _id: userId },
    { $set: { lastLoginAt: new Date(), failedLoginAttempts: 0 }, $unset: { accountLockedUntil: '' } }
  );

  // Pre-select the last-used workspace (falls back to a paid one, then the
  // oldest) and sync the cookie so client-side context loads that business.
  const { activeBusinessId, workspaceCount } = await resolveLoginWorkspace(user);
  const isMobile = req.headers.get('x-client') === 'mobile';

  const cookieStore = await cookies();
  if (activeBusinessId) {
    cookieStore.set('activeBusinessId', activeBusinessId, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  // 2+ workspaces on the web: ask which one to open (proxy.ts → /select-workspace).
  // The apps show their own picker after login instead.
  if (!isMobile && workspaceCount > 1) {
    cookieStore.set(CHOOSE_WORKSPACE_COOKIE, '1', CHOOSE_WORKSPACE_COOKIE_OPTIONS);
  } else {
    cookieStore.delete(CHOOSE_WORKSPACE_COOKIE);
  }

  // Mobile clients get the JWT in the body (no cookie support); web never does.
  if (isMobile) {
    const token = await signSessionToken(userId, user.role, sessionEpoch);
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
    return NextResponse.json({ success: true, token, expiresAt }, { status: 200 });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
