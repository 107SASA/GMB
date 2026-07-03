import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { verifyOTP } from '@/services/auth/otp';

const MAX_ATTEMPTS = 5;
const GENERIC_ERROR = 'Invalid or expired code.';

export async function POST(req: Request) {
  try {
    await dbConnect();
    const { email, otp } = await req.json();

    if (!email || !otp) {
      return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 400 });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 400 });
    }

    if (user.isEmailVerified) {
      return NextResponse.json({ success: true, message: 'Already verified.' });
    }

    if (user.failedOtpAttempts >= MAX_ATTEMPTS) {
      return NextResponse.json(
        { success: false, error: 'Too many attempts. Please request a new code.' },
        { status: 429 }
      );
    }

    const isExpired = !user.emailOtpExpiry || user.emailOtpExpiry.getTime() < Date.now();
    const isValid = !!user.emailOtpHash && !isExpired && verifyOTP(otp, user.emailOtpHash);

    if (!isValid) {
      await User.updateOne({ _id: user._id }, { $inc: { failedOtpAttempts: 1 } });
      return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 400 });
    }

    await User.updateOne(
      { _id: user._id },
      {
        $set: { isEmailVerified: true, emailVerifiedAt: new Date(), failedOtpAttempts: 0 },
        $unset: { emailOtpHash: '', emailOtpExpiry: '' },
      }
    );

    return NextResponse.json({ success: true, message: 'Email verified successfully.' });
  } catch (error: any) {
    console.error('Verify Email Error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
