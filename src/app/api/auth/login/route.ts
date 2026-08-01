import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import Business from '@/models/Business';
import { createSession, signSessionToken, SESSION_MAX_AGE_SECONDS } from '@/lib/session';
import { checkRateLimit, resetRateLimit, getClientIp } from '@/lib/rateLimit';
import { isQaTestingMode } from '@/lib/testingMode';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// Brute-force protection: max failed attempts per IP+email within the window.
const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Second, DB-backed layer: the in-memory limiter above is per-process and
// keyed by IP+email, so it can be bypassed by rotating IPs against a single
// target account. This persists across processes/IPs and locks the account
// itself once failures pile up, regardless of source.
const ACCOUNT_LOCK_THRESHOLD = 10;
const ACCOUNT_LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(req: Request) {
  try {
    await dbConnect();
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ success: false, error: 'Email and password required' }, { status: 400 });
    }

    const normalizedEmail = String(email).toLowerCase();
    const rlKey = `login:${getClientIp(req)}:${normalizedEmail}`;
    const rl = checkRateLimit(rlKey, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
    if (!rl.allowed && !isQaTestingMode()) {
      return NextResponse.json(
        { success: false, error: `Too many login attempts. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401 });
    }

    if (user.accountLockedUntil && user.accountLockedUntil.getTime() > Date.now() && !isQaTestingMode()) {
      const retryAfterSeconds = Math.ceil((user.accountLockedUntil.getTime() - Date.now()) / 1000);
      return NextResponse.json(
        {
          success: false,
          error: `Account temporarily locked due to repeated failed attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
        },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
      );
    }

    let isValid = false;
    const isBcrypt = user.passwordHash?.startsWith('$2b$') || user.passwordHash?.startsWith('$2a$');
    if (isBcrypt) {
      isValid = await bcrypt.compare(password, user.passwordHash!);
    } else if (user.passwordHash) {
      // Legacy plain-text password (pre-bcrypt). Compare in constant time to
      // avoid a timing oracle, and — if it matches — transparently upgrade the
      // stored value to a bcrypt hash so plaintext is permanently eliminated
      // after this login. New plaintext is never written anywhere.
      const a = Buffer.from(user.passwordHash);
      const b = Buffer.from(password);
      isValid = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (isValid) {
        user.passwordHash = await bcrypt.hash(password, 12);
        await user.save();
      }
    }

    if (!isValid) {
      // Skip tallying failed attempts in QA testing mode too, so accumulated
      // test failures don't leave a lockout in place once testing mode is
      // switched back off.
      if (!isQaTestingMode()) {
        const attempts = (user.failedLoginAttempts || 0) + 1;
        const update: Record<string, unknown> = { failedLoginAttempts: attempts };
        if (attempts >= ACCOUNT_LOCK_THRESHOLD) {
          update.accountLockedUntil = new Date(Date.now() + ACCOUNT_LOCK_DURATION_MS);
        }
        await User.updateOne({ _id: user._id }, { $set: update });
      }
      return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401 });
    }

    // Good credentials — clear the throttle so this user isn't penalised.
    resetRateLimit(rlKey);

    if (!user.isEmailVerified) {
      return NextResponse.json(
        {
          success: false,
          error: 'Please verify your email before logging in.',
          requiresVerification: true,
          email: user.email,
        },
        { status: 403 }
      );
    }

    await createSession(user._id.toString(), user.role);

    // Powers "Last Login" on the Profile page — was never written anywhere,
    // so it always showed as missing/"Never" regardless of actual login history.
    // Also clears the account-lockout counter on any successful login.
    await User.updateOne(
      { _id: user._id },
      { $set: { lastLoginAt: new Date(), failedLoginAttempts: 0 }, $unset: { accountLockedUntil: '' } }
    );

    // Sync activeBusinessId cookie so client-side context loads the right business
    let activeBusinessId = user.activeBusinessId?.toString();
    if (!activeBusinessId) {
      const business = await Business.findOne({ userId: user._id });
      if (business) {
        activeBusinessId = business._id.toString();
        await User.updateOne({ _id: user._id }, { $set: { activeBusinessId: business._id } });
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
      const token = await signSessionToken(user._id.toString(), user.role);
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
      return NextResponse.json({ success: true, token, expiresAt }, { status: 200 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error('Login Error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
