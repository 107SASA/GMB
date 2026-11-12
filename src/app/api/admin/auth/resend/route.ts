import { NextResponse } from 'next/server';
import { securityLogged } from '@/services/security/securityLog';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { getClientIp } from '@/lib/rateLimit';
import { checkDurableRateLimit } from '@/lib/durableRateLimit';
import { isQaTestingMode } from '@/lib/testingMode';
import { resendAdminChallenge } from '@/lib/adminTwoStep';

/** Emails a fresh sign-in code (60 s cooldown, max 5 per sign-in). */
async function handlePOST(req: Request) {
  try {
    if (!isQaTestingMode()) {
      const rl = await checkDurableRateLimit(`admin-login-resend-ip:${getClientIp(req)}`, 10, 15 * 60 * 1000);
      if (!rl.allowed) {
        return NextResponse.json({ success: false, error: 'Too many requests. Please try again later.' }, { status: 429 });
      }
    }
    const body = await req.json().catch(() => ({}));
    const challenge = body?.challenge;
    if (typeof challenge !== 'string' || !/^[a-f0-9]{64}$/.test(challenge)) {
      return NextResponse.json({ success: false, error: 'This sign-in has expired. Please sign in again.', restart: true }, { status: 401 });
    }

    await dbConnect();
    const result = await resendAdminChallenge(challenge, async (userId) => {
      const u = await User.findById(userId).select('email role isDeleted').lean<any>();
      return u && (u.role === 'SUPER_ADMIN' || u.role === 'TEAM_MEMBER') && !u.isDeleted ? u.email : null;
    });

    if (!result.ok) {
      if (result.reason === 'cooldown') {
        return NextResponse.json(
          { success: false, error: `Please wait ${result.retryAfterSeconds}s before asking for another code.`, retryAfterSeconds: result.retryAfterSeconds },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { success: false, error: result.reason === 'too_many' ? 'Too many codes sent. Please sign in again.' : 'This sign-in has expired. Please sign in again.', restart: true },
        { status: 401 }
      );
    }
    if (!result.sent) {
      return NextResponse.json({ success: false, error: 'Could not send the email. Try again in a minute.' }, { status: 503 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Super Admin code resend error:', error);
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500 });
  }
}

export const POST = securityLogged('admin.login_code_resend', handlePOST, { role: 'SUPER_ADMIN' });
