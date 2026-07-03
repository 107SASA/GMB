import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { generateOTP, hashOTP } from '@/services/auth/otp';
import { sendEmailOtp } from '@/services/email';

export async function POST(req: Request) {
  try {
    await dbConnect();
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

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
