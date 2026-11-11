import { NextResponse } from 'next/server';
import { securityLogged, emailSubject } from '@/services/security/securityLog';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { createSession, destroySession, getSession } from '@/lib/session';
import { checkRateLimit, getClientIp, resetRateLimit } from '@/lib/rateLimit';
import { isQaTestingMode } from '@/lib/testingMode';
import bcrypt from 'bcryptjs';
import { checkDurableRateLimit, peekDurableRateLimit } from '@/lib/durableRateLimit';
import { ADMIN_CODE_TTL_MINUTES, isAdminTwoStepEnabled, maskEmail, startAdminChallenge } from '@/lib/adminTwoStep';

// Compared against when the email is unknown, so a wrong email takes as long
// as a wrong password and response timing can't reveal which admins exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

async function handlePOST(req: Request) {
  try {
    // SUPER_ADMIN is the highest-privilege role in the system — this had no
    // rate limiting at all, making it brute-forceable/credential-stuffable
    // with no lockout. Keyed by IP+email so one IP guessing many emails and
    // many IPs guessing one email are both throttled.
    const ip = getClientIp(req);
    await dbConnect();
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const rate = checkRateLimit(`admin-auth:${ip}:${String(email).toLowerCase().trim()}`, 5, 15 * 60 * 1000);
    if (!rate.allowed && !isQaTestingMode()) {
      return NextResponse.json(
        { success: false, error: 'Too many attempts. Please try again in a few minutes.' },
        { status: 429 }
      );
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401 });
    }
    const normalizedEmail = email.toLowerCase().trim();

    // The in-memory limit above resets on every restart and is per IP+email, so
    // guesses spread over many IPs were never slowed. These live in MongoDB:
    // per account (any IP) and per IP (any account). Only WRONG passwords are
    // counted (recorded below), so signing in and out never throttles you.
    const EMAIL_KEY = `admin-login-email:${normalizedEmail}`;
    const IP_KEY = `admin-login-ip:${ip}`;
    const HOUR = 60 * 60 * 1000;
    const QUARTER = 15 * 60 * 1000;
    if (!isQaTestingMode()) {
      const [byEmail, byIp] = await Promise.all([
        peekDurableRateLimit(EMAIL_KEY, HOUR),
        peekDurableRateLimit(IP_KEY, QUARTER),
      ]);
      if (byEmail >= 10 || byIp >= 20) {
        return NextResponse.json(
          { success: false, error: 'Too many wrong passwords. Please try again later.' },
          { status: 429 }
        );
      }
    }

    const user = await User.findOne({ email: normalizedEmail });
    const hash = user && user.role === 'SUPER_ADMIN' && user.passwordHash ? user.passwordHash : null;
    const passwordOk = await bcrypt.compare(password, hash || DUMMY_HASH);
    const isValid = Boolean(user && hash && passwordOk);

    if (!isValid || !user) {
      await Promise.all([checkDurableRateLimit(EMAIL_KEY, 10, HOUR), checkDurableRateLimit(IP_KEY, 20, QUARTER)]);
      return NextResponse.json(
        { success: false, error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    resetRateLimit(`admin-auth:${ip}:${normalizedEmail}`);

    // Step 2. With the authenticator app set up, nothing is emailed (so a
    // Resend outage can't lock anyone out); the admin can still ask for an
    // email code. Without the app, an email code is the only way in.
    if (isAdminTwoStepEnabled()) {
      const hasApp = Boolean((user as any).adminTotpEnabledAt);
      const started = await startAdminChallenge({ _id: user._id, email: user.email }, ip, { sendEmail: !hasApp });
      if (!hasApp && !started.sent) {
        console.error('[admin/auth] sign-in code email failed:', started.error);
        return NextResponse.json(
          { success: false, error: 'Your password is correct, but we could not send the sign-in code email. Try again in a minute. (Set up the authenticator app so email is not needed.)' },
          { status: 503 }
        );
      }
      return NextResponse.json({
        success: true,
        step: 'code',
        challenge: started.challenge,
        methods: hasApp ? ['totp', 'email', 'recovery'] : ['email'],
        defaultMethod: hasApp ? 'totp' : 'email',
        emailSent: started.sent,
        emailHint: maskEmail(user.email),
        expiresInMinutes: ADMIN_CODE_TTL_MINUTES,
      });
    }

    await createSession(user._id.toString(), user.role, (user as any).sessionEpoch ?? 0);

    return NextResponse.json({
      success: true,
      user: {
        id: user._id.toString(),
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error: any) {
    console.error('Super Admin Login Error:', error);
    return NextResponse.json(
      { success: false, error: 'Server error' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    // Deleting the cookie alone leaves a copied token valid for 30 days. For a
    // super admin, bump the session epoch so every token issued so far is
    // rejected by requireSuperAdmin (this signs that admin out on all devices).
    const session = await getSession();
    if (session?.role === 'SUPER_ADMIN') {
      await dbConnect();
      await User.updateOne({ _id: session.userId, role: 'SUPER_ADMIN' }, { $inc: { sessionEpoch: 1 } });
    }
    await destroySession();
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, error: 'Logout failed' }, { status: 500 });
  }
}

/** Every call is recorded in the security log (Super Admin → Security Log). */
export const POST = securityLogged('admin.login', handlePOST, { subjectOf: emailSubject, role: 'SUPER_ADMIN' });
