import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { normalizePhoneE164, phoneDedupeKey } from '@/lib/phone';
import { verifyOTP } from '@/services/auth/otp';
import { finalizeLogin } from '@/lib/authSession';
import { checkRateLimit, resetRateLimit, getClientIp } from '@/lib/rateLimit';
import { isQaTestingMode } from '@/lib/testingMode';

export const dynamic = 'force-dynamic';

const VERIFY_MAX_ATTEMPTS = 8;
const VERIFY_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const ACCOUNT_LOCK_THRESHOLD = 10;
const ACCOUNT_LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(req: Request) {
  try {
    await dbConnect();
    const { phone, otp } = await req.json();

    if (!phone || !otp) {
      return NextResponse.json({ success: false, error: 'Phone number and code required.' }, { status: 400 });
    }

    const normalized = normalizePhoneE164(String(phone));
    if (!normalized) {
      return NextResponse.json({ success: false, error: 'Invalid phone number.' }, { status: 400 });
    }

    const rlKey = `phone-login-verify:${getClientIp(req)}:${normalized}`;
    const rl = checkRateLimit(rlKey, VERIFY_MAX_ATTEMPTS, VERIFY_WINDOW_MS);
    if (!rl.allowed && !isQaTestingMode()) {
      return NextResponse.json(
        { success: false, error: `Too many attempts. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }

    let user = await User.findOne({ phone: normalized });
    if (!user) {
      const dedupeKey = phoneDedupeKey(normalized);
      if (dedupeKey) user = await User.findOne({ phone: { $regex: `${dedupeKey}$` } });
    }

    if (!user) {
      return NextResponse.json({ success: false, error: 'No account found for this phone number.' }, { status: 404 });
    }

    if (user.accountLockedUntil && user.accountLockedUntil.getTime() > Date.now() && !isQaTestingMode()) {
      const retryAfterSeconds = Math.ceil((user.accountLockedUntil.getTime() - Date.now()) / 1000);
      return NextResponse.json(
        {
          success: false,
          error: `Account temporarily locked due to repeated failed attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
        },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
      );
    }

    const otpValid =
      !!user.phoneOtpHash &&
      !!user.phoneOtpExpiry &&
      user.phoneOtpExpiry.getTime() > Date.now() &&
      verifyOTP(String(otp), user.phoneOtpHash);

    if (!otpValid) {
      if (!isQaTestingMode()) {
        const attempts = (user.failedLoginAttempts || 0) + 1;
        const update: Record<string, unknown> = { failedLoginAttempts: attempts };
        if (attempts >= ACCOUNT_LOCK_THRESHOLD) {
          update.accountLockedUntil = new Date(Date.now() + ACCOUNT_LOCK_DURATION_MS);
        }
        await User.updateOne({ _id: user._id }, { $set: update });
      }
      return NextResponse.json({ success: false, error: 'Incorrect or expired code.' }, { status: 401 });
    }

    // Good code — clear the throttle and the one-time OTP so it can't be replayed.
    resetRateLimit(rlKey);
    await User.updateOne(
      { _id: user._id },
      { $unset: { phoneOtpHash: '', phoneOtpExpiry: '' } }
    );

    return await finalizeLogin(user, req);
  } catch (error: any) {
    console.error('Phone login (verify) error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
