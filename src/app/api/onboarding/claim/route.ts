import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { requireClient } from '@/lib/auth';
import { validatePasswordStrength } from '@/services/auth/security';
import { generateOTP, hashOTP } from '@/services/auth/otp';
import { sendEmailOtp } from '@/services/email';
import { checkRateLimit } from '@/lib/rateLimit';
import { isQaTestingMode } from '@/lib/testingMode';
import bcrypt from 'bcryptjs';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Converts a shadow account (see src/lib/shadowAccount.ts) into a normal,
 * password-protected account by setting a real email + password on the SAME
 * User document. Deliberately separate from /api/onboarding — that route is
 * unmodified and always creates a fresh Organization+Business, which would
 * duplicate the workspace a shadow account already has.
 */
export async function POST(req: Request) {
  try {
    const authResult = await requireClient();
    if (!authResult.ok) return authResult.response;

    // Keyed by userId, not IP — this also stops the route being used as an
    // unlimited email-existence oracle (the 409 below is distinguishable)
    // by one authenticated shadow session trying many emails.
    const rate = checkRateLimit(`onboarding-claim:${authResult.userId}`, 8, 15 * 60 * 1000);
    if (!rate.allowed && !isQaTestingMode()) {
      return NextResponse.json({ error: 'Too many attempts. Please try again in a few minutes.' }, { status: 429 });
    }

    await dbConnect();

    const user = await User.findById(authResult.userId);
    if (!user) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }
    if (!user.isShadowAccount) {
      return NextResponse.json({ error: 'This account has already been claimed' }, { status: 400 });
    }

    const body = await req.json();
    const email = String(body.email || '').trim().toLowerCase();
    const fullName = String(body.fullName || '').trim();

    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }
    if (!fullName) {
      return NextResponse.json({ error: 'Please enter your name.' }, { status: 400 });
    }

    const passwordCheck = validatePasswordStrength(body.password || '');
    if (!passwordCheck.isValid) {
      return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
    }

    const emailTaken = await User.findOne({ email, _id: { $ne: user._id } });
    if (emailTaken) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Try signing in instead.' },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    const otp = generateOTP();

    user.fullName = fullName;
    user.email = email;
    user.passwordHash = passwordHash;
    user.isShadowAccount = false;
    user.claimedAt = new Date();
    user.isEmailVerified = false;
    user.emailOtpHash = hashOTP(otp);
    user.emailOtpExpiry = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    const otpResult = await sendEmailOtp(user.email, otp, 'verify');
    if (!otpResult.success) {
      console.error('Failed to send claim-verification OTP email:', otpResult.error);
    }

    return NextResponse.json({ success: true, requiresVerification: true, email: user.email }, { status: 200 });
  } catch (error: any) {
    console.error('Onboarding Claim Error:', error);
    if (error?.code === 11000) {
      return NextResponse.json(
        { error: 'An account with this email already exists. Try signing in instead.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Could not save your account. Please try again.' }, { status: 500 });
  }
}
