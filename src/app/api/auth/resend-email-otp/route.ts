import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { generateOTP, hashOTP } from '@/services/auth/otp';
import { sendEmailOtp } from '@/services/email';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isQaTestingMode } from '@/lib/testingMode';

export async function POST(req: Request) {
  try {
    await dbConnect();

    // Cap by IP (email-enumeration/spam guard, matches forgot-password) and
    // by account (resend cooldown) so this can't be used to email-bomb a
    // victim or, combined with the old failedOtpAttempts reset below, to
    // brute-force the verify-email OTP in unlimited 5-guess batches.
    const ip = getClientIp(req);
    const ipRate = checkRateLimit(`resend-otp-ip:${ip}`, 10, 15 * 60 * 1000);
    if (!ipRate.allowed && !isQaTestingMode()) {
      return NextResponse.json({ success: true });
    }

    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = String(email).toLowerCase();
    const emailRate = checkRateLimit(`resend-otp-email:${normalizedEmail}`, 3, 15 * 60 * 1000);
    if (!emailRate.allowed && !isQaTestingMode()) {
      return NextResponse.json({ success: true });
    }

    const user = await User.findOne({ email: normalizedEmail });

    // Don't reveal whether the account exists or is already verified.
    if (!user || user.isEmailVerified) {
      return NextResponse.json({ success: true });
    }

    const otp = generateOTP();
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          emailOtpHash: hashOTP(otp),
          emailOtpExpiry: new Date(Date.now() + 15 * 60 * 1000),
          // Resetting failedOtpAttempts here is still safe: this route is
          // now rate-limited to 3 resends / 15min per account (see above),
          // so the old bypass (guess 4-5 times, resend to wipe the counter,
          // repeat unboundedly) is capped at ~15 guesses per 15 minutes
          // against a 6-digit code — negligible — instead of unlimited.
          failedOtpAttempts: 0,
        },
      }
    );

    const otpResult = await sendEmailOtp(user.email, otp, 'verify');
    if (!otpResult.success) {
      console.error('Failed to send resend-OTP email:', otpResult.error);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Resend Email OTP Error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
