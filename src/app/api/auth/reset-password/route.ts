import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { verifyOTP } from '@/services/auth/otp';
import { hashPassword, validatePasswordStrength, verifyToken } from '@/services/auth/security';

const GENERIC_TOKEN_ERROR = 'This reset link has expired or is invalid. Please start the password reset process again.';

export async function POST(req: Request) {
  try {
    await dbConnect();
    const { resetToken, newPassword, confirmPassword } = await req.json();

    if (!resetToken || !newPassword || !confirmPassword) {
      return NextResponse.json({ success: false, error: 'All fields are required.' }, { status: 400 });
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json({ success: false, error: 'Passwords do not match.' }, { status: 400 });
    }

    const strength = validatePasswordStrength(newPassword);
    if (!strength.isValid) {
      return NextResponse.json({ success: false, error: strength.error }, { status: 400 });
    }

    let payload: any;
    try {
      payload = verifyToken(resetToken);
    } catch {
      return NextResponse.json({ success: false, error: GENERIC_TOKEN_ERROR }, { status: 400 });
    }

    if (!payload || payload.purpose !== 'password_reset' || !payload.userId) {
      return NextResponse.json({ success: false, error: GENERIC_TOKEN_ERROR }, { status: 400 });
    }

    const user = await User.findById(payload.userId);
    if (!user) {
      return NextResponse.json({ success: false, error: GENERIC_TOKEN_ERROR }, { status: 400 });
    }

    const isExpired = !user.passwordResetTokenExpiry || user.passwordResetTokenExpiry.getTime() < Date.now();
    const isValid = !!user.passwordResetTokenHash && !isExpired && verifyOTP(resetToken, user.passwordResetTokenHash);

    if (!isValid) {
      return NextResponse.json({ success: false, error: GENERIC_TOKEN_ERROR }, { status: 400 });
    }

    const newPasswordHash = await hashPassword(newPassword);
    // Single-use: invalidate the token immediately so it can't be replayed.
    // Uses updateOne (not user.save()) so this only touches the fields below —
    // a legacy/out-of-sync value on an unrelated field (e.g. an old `role`
    // string that predates the current enum) can never block a password reset.
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash: newPasswordHash,
          passwordResetAttempts: 0,
          failedLoginAttempts: 0,
        },
        $unset: {
          passwordResetTokenHash: '',
          passwordResetTokenExpiry: '',
          passwordResetOtp: '',
          passwordResetExpiry: '',
          accountLockedUntil: '',
        },
      }
    );

    return NextResponse.json({ success: true, message: 'Your password has been reset successfully.' });
  } catch (error: any) {
    console.error('Reset Password Error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
