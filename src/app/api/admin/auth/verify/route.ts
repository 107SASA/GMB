import { NextResponse } from 'next/server';
import { securityLogged } from '@/services/security/securityLog';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { createSession } from '@/lib/session';
import { getClientIp } from '@/lib/rateLimit';
import { checkDurableRateLimit } from '@/lib/durableRateLimit';
import { isQaTestingMode } from '@/lib/testingMode';
import { normalizeRecoveryCode, verifyAdminChallenge, type TwoStepMethod } from '@/lib/adminTwoStep';

/**
 * Step 2 of super admin sign-in: the 6-digit code from the email. Only this
 * route creates a super admin session (when two-step is on).
 */
async function handlePOST(req: Request) {
  try {
    const ip = getClientIp(req);
    if (!isQaTestingMode()) {
      const rl = await checkDurableRateLimit(`admin-login-code-ip:${ip}`, 30, 15 * 60 * 1000);
      if (!rl.allowed) {
        return NextResponse.json({ success: false, error: 'Too many attempts. Please try again later.' }, { status: 429 });
      }
    }

    const body = await req.json().catch(() => ({}));
    const challenge = body?.challenge;
    const method: TwoStepMethod = body?.method === 'totp' || body?.method === 'recovery' ? body.method : 'email';
    const code = typeof body?.code === 'string' ? body.code.replace(/\s/g, '') : '';
    const shapeOk = method === 'recovery' ? normalizeRecoveryCode(code).length === 10 : /^\d{6}$/.test(code);
    if (typeof challenge !== 'string' || !/^[a-f0-9]{64}$/.test(challenge) || !shapeOk) {
      return NextResponse.json({ success: false, error: method === 'recovery' ? 'Enter a recovery code like ABCD-EFGH-JK.' : 'Enter the 6-digit code.' }, { status: 401 });
    }

    const result = await verifyAdminChallenge(challenge, code, method);
    if (!result.ok) {
      const error =
        result.reason === 'wrong_code' ? `That code is not right. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'try' : 'tries'} left.`
        : result.reason === 'expired' ? 'This code has expired. Sign in again to get a new one.'
        : result.reason === 'too_many' ? 'Too many wrong codes. Sign in again to get a new one.'
        : 'This sign-in has expired. Please sign in again.';
      return NextResponse.json(
        { success: false, error, restart: result.reason !== 'wrong_code' },
        { status: 401 }
      );
    }

    await dbConnect();
    const user = await User.findById(result.userId).select('_id role sessionEpoch isDeleted fullName email').lean<any>();
    if (!user || user.role !== 'SUPER_ADMIN' || user.isDeleted) {
      return NextResponse.json({ success: false, error: 'This sign-in has expired. Please sign in again.', restart: true }, { status: 401 });
    }

    await createSession(String(user._id), user.role, user.sessionEpoch ?? 0);
    if (result.method === 'recovery') {
      const { logSecurityEvent } = await import('@/services/security/securityLog');
      await logSecurityEvent(req, { type: 'admin.recovery_code_used', outcome: 'info', severity: 'warning', userId: String(user._id), role: 'SUPER_ADMIN', subject: user.email, detail: 'Signed in with a one-time recovery code' });
    }
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

    return NextResponse.json({
      success: true,
      user: { id: String(user._id), fullName: user.fullName, email: user.email, role: user.role },
    });
  } catch (error: any) {
    console.error('Super Admin code verify error:', error);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}

/** Every call is recorded in the security log (Super Admin → Security Log). */
export const POST = securityLogged('admin.login_code', handlePOST, { role: 'SUPER_ADMIN' });
