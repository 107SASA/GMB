import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { generateOTP, hashOTP } from '@/services/auth/otp';
import { sendEmailOtp } from '@/services/email';

// How long a password-reset OTP remains valid.
const OTP_EXPIRY_MINUTES = 10;
// Minimum time between two OTP sends for the same account (matches the
// resend cooldown enforced client-side, but re-checked server-side too).
const RESEND_COOLDOWN_MS = 60 * 1000;

const GENERIC_MESSAGE = 'If an account exists with this email, an OTP has been sent.';

/**
 * Starts (or restarts, for "resend") the forgot-password flow.
 * Always responds with a generic success message so the caller can never
 * learn whether a given email address is registered.
 */
export async function POST(req: Request) {
  try {
    await dbConnect();
    const { email } = await req.json();

    if (!email || typeof email !== 'string') {
      // Still generic — invalid input looks the same as "no such account".
      return NextResponse.json({ success: true, message: GENERIC_MESSAGE });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim(), isDeleted: { $ne: true } });

    if (user) {
      const now = Date.now();
      const lastSent = user.passwordResetLastSentAt?.getTime() ?? 0;

      // Respect the resend cooldown server-side. We still return the
      // generic success message so no timing/state info leaks to the client.
      if (now - lastSent >= RESEND_COOLDOWN_MS) {
        const otp = generateOTP();

        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              passwordResetOtp: hashOTP(otp),
              passwordResetExpiry: new Date(now + OTP_EXPIRY_MINUTES * 60 * 1000),
              passwordResetAttempts: 0,
              passwordResetLastSentAt: new Date(now),
            },
            $unset: { passwordResetTokenHash: '', passwordResetTokenExpiry: '' },
          }
        );

        const result = await sendEmailOtp(user.email, otp, 'reset', OTP_EXPIRY_MINUTES);
        if (!result.success) {
          console.error('Failed to send password-reset OTP email:', result.error);
        }
      }
    }

    return NextResponse.json({ success: true, message: GENERIC_MESSAGE });
  } catch (error: any) {
    console.error('Forgot Password Error:', error);
    // Never surface internal errors here either — keep the response generic.
    return NextResponse.json({ success: true, message: GENERIC_MESSAGE });
  }
}
