import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { hashOTP, verifyOTP } from '@/services/auth/otp';
import { generateToken } from '@/services/auth/security';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isQaTestingMode } from '@/lib/testingMode';

const MAX_ATTEMPTS = 5;
const RESET_TOKEN_TTL_MINUTES = 10;
const GENERIC_ERROR = 'Invalid or expired code.';

export async function POST(req: Request) {
  try {
    await dbConnect();

    // SEC-11: the per-account `passwordResetAttempts` counter is reset to 0
    // every time forgot-password re-sends a code (60s cooldown), so on its own
    // it only ever bounded a burst. This per-IP cap is the real lockout — a
    // 6-digit code brute-forced at 8 tries / 15 min / IP is infeasible.
    const ipRl = checkRateLimit(`verify-reset-otp:${getClientIp(req)}`, 8, 15 * 60 * 1000);
    if (!ipRl.allowed && !isQaTestingMode()) {
      return NextResponse.json(
        { success: false, error: 'Too many attempts. Please try again in a few minutes.' },
        { status: 429, headers: { 'Retry-After': String(ipRl.retryAfterSeconds) } }
      );
    }

    const { email, otp } = await req.json();

    if (!email || !otp || typeof email !== 'string' || typeof otp !== 'string') {
      return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 400 });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim(), isDeleted: { $ne: true } });

    // Don't reveal whether the account exists — same generic error either way.
    if (!user) {
      return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 400 });
    }

    if (user.passwordResetAttempts >= MAX_ATTEMPTS) {
      return NextResponse.json(
        { success: false, error: 'Too many attempts. Please request a new code.' },
        { status: 429 }
      );
    }

    const isExpired = !user.passwordResetExpiry || user.passwordResetExpiry.getTime() < Date.now();
    const isValid = !!user.passwordResetOtp && !isExpired && verifyOTP(otp, user.passwordResetOtp);

    if (!isValid) {
      await User.updateOne({ _id: user._id }, { $inc: { passwordResetAttempts: 1 } });
      return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 400 });
    }

    // OTP is correct — consume it immediately so it can never be reused,
    // and mint a short-lived, single-purpose token that authorizes setting
    // a new password (or simply returning to login) without re-entering the OTP.
    const resetToken = generateToken(
      { userId: user._id.toString(), purpose: 'password_reset' },
      `${RESET_TOKEN_TTL_MINUTES}m`
    );
    const resetTokenExpiry = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordResetTokenHash: hashOTP(resetToken),
          passwordResetTokenExpiry: resetTokenExpiry,
          passwordResetAttempts: 0,
        },
        $unset: { passwordResetOtp: '', passwordResetExpiry: '' },
      }
    );

    return NextResponse.json({ success: true, resetToken });
  } catch (error: any) {
    console.error('Verify Reset OTP Error:', error);
    return NextResponse.json({ success: false, error: 'Something went wrong on our end. Please try again, and contact support if this keeps happening.' }, { status: 500 });
  }
}
