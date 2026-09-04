import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { normalizePhoneE164, phoneDedupeKey } from '@/lib/phone';
import { generateOTP, hashOTP, verifyOTP } from '@/services/auth/otp';
import { sendOtpMessage } from '@/services/whatsapp/send';
import { finalizeLogin } from '@/lib/authSession';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isQaTestingMode } from '@/lib/testingMode';

export const dynamic = 'force-dynamic';

/**
 * Confirms the signup OTP sent by POST /api/onboarding and, unlike
 * /api/auth/verify-email (which just flips a flag and sends the visitor back
 * to /login), completes the login itself — one code instead of two round
 * trips, since phone/WhatsApp OTP is both the verification proof AND the
 * login credential for these accounts.
 */

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_LOCK_THRESHOLD = 10;
const ACCOUNT_LOCK_DURATION_MS = 15 * 60 * 1000;
const GENERIC_ERROR = 'Incorrect or expired code.';

export async function POST(req: Request) {
  try {
    await dbConnect();
    const { phone, otp } = await req.json();

    if (!phone || !otp) {
      return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 400 });
    }

    const normalized = normalizePhoneE164(String(phone));
    if (!normalized) {
      return NextResponse.json({ success: false, error: 'Invalid phone number.' }, { status: 400 });
    }

    const rlKey = `verify-phone-otp:${getClientIp(req)}:${normalized}`;
    const rl = checkRateLimit(rlKey, MAX_ATTEMPTS, WINDOW_MS);
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
      return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 400 });
    }

    if (user.isPhoneVerified) {
      // Already completed (e.g. a duplicate submit) — same code, so still
      // finish the login rather than surfacing an error for what isn't one.
      return await finalizeLogin(user, req);
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

    const isExpired = !user.phoneOtpExpiry || user.phoneOtpExpiry.getTime() < Date.now();
    const isValid = !!user.phoneOtpHash && !isExpired && verifyOTP(String(otp), user.phoneOtpHash);

    if (!isValid) {
      if (!isQaTestingMode()) {
        const attempts = (user.failedOtpAttempts || 0) + 1;
        const update: Record<string, unknown> = { failedOtpAttempts: attempts };
        if (attempts >= ACCOUNT_LOCK_THRESHOLD) {
          update.accountLockedUntil = new Date(Date.now() + ACCOUNT_LOCK_DURATION_MS);
        }
        await User.updateOne({ _id: user._id }, { $set: update });
      }
      return NextResponse.json({ success: false, error: GENERIC_ERROR }, { status: 400 });
    }

    await User.updateOne(
      { _id: user._id },
      {
        $set: { isPhoneVerified: true, phoneVerifiedAt: new Date(), failedOtpAttempts: 0 },
        $unset: { phoneOtpHash: '', phoneOtpExpiry: '' },
      }
    );

    return await finalizeLogin(user, req);
  } catch (error: any) {
    console.error('Verify phone OTP error:', error);
    return NextResponse.json({ success: false, error: 'Something went wrong on our end. Please try again, and contact support if this keeps happening.' }, { status: 500 });
  }
}

/** Resends a fresh signup OTP for an unverified account (mirrors /api/auth/resend-email-otp). */
export async function PUT(req: Request) {
  try {
    await dbConnect();
    const { phone } = await req.json();

    const normalized = normalizePhoneE164(String(phone || ''));
    if (!normalized) {
      return NextResponse.json({ success: false, error: 'Invalid phone number.' }, { status: 400 });
    }

    const rlKey = `verify-phone-otp-resend:${getClientIp(req)}:${normalized}`;
    const rl = checkRateLimit(rlKey, 5, WINDOW_MS);
    if (!rl.allowed && !isQaTestingMode()) {
      return NextResponse.json(
        { success: false, error: `Too many requests. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }

    const user = await User.findOne({ phone: normalized });
    // Same generic response whether or not the account exists — don't let
    // this endpoint be used to probe for registered phone numbers.
    if (!user || user.isPhoneVerified) {
      return NextResponse.json({ success: true });
    }

    const otp = generateOTP();
    // updateOne (not user.save()) — see phone-login/request/route.ts: a drifted
    // legacy field must never block a resend.
    await User.updateOne(
      { _id: user._id },
      { $set: { phoneOtpHash: hashOTP(otp), phoneOtpExpiry: new Date(Date.now() + 10 * 60 * 1000) } }
    );

    const result = await sendOtpMessage(
      user.phone,
      `Your GrowwMatics AI signup code is ${otp}. It expires in 10 minutes. Never share this code with anyone.`
    );
    if (!result.success) {
      console.error('[verify-phone-otp/resend] WhatsApp send failed:', result.error);
      return NextResponse.json({ success: false, error: 'Could not send the code right now. Please try again shortly.' }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Resend phone OTP error:', error);
    return NextResponse.json({ success: false, error: 'Something went wrong on our end.' }, { status: 500 });
  }
}
