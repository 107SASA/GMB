import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { hashOTP, verifyOTP } from '@/services/auth/otp';
import { generateToken } from '@/services/auth/security';

const MAX_ATTEMPTS = 5;
const RESET_TOKEN_TTL_MINUTES = 10;
const GENERIC_ERROR = 'Invalid or expired code.';

export async function POST(req: Request) {
  try {
    await dbConnect();
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
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
