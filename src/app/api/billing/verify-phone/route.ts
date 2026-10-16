import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { requireClient } from '@/lib/auth';
import { generateOTP, hashOTP, verifyOTP } from '@/services/auth/otp';
import { sendOtpMessage } from '@/services/whatsapp/send';
import { checkRateLimit, resetRateLimit } from '@/lib/rateLimit';
import { isReviewerUser } from '@/lib/reviewerAccount';
import { markPhoneVerified } from '@/services/auth/phoneVerification';

export const dynamic = 'force-dynamic';

const SEND_MAX = 5;
const CONFIRM_MAX = 8;
const WINDOW_MS = 15 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;

/**
 * Proves the signed-in account's own phone number before a free trial
 * (accounts created from the free-report form never had to). Always the
 * account's stored login phone — the browser can't choose the number.
 *
 *   POST { action: 'send' }                 → WhatsApp code to the account's phone
 *   POST { action: 'confirm', code: '123456' } → marks the phone verified
 */
export async function POST(req: Request) {
  const auth = await requireClient();
  if (!auth.ok) return auth.response;

  await dbConnect();
  const body = await req.json().catch(() => ({}));
  const user = await User.findById(auth.userId)
    .select('phone isPhoneVerified phoneOtpHash phoneOtpExpiry email role')
    .lean<any>();
  if (!user?.phone) {
    return NextResponse.json({ success: false, error: 'Your account has no phone number.' }, { status: 400 });
  }
  if (user.isPhoneVerified) return NextResponse.json({ success: true, verified: true });
  if (isReviewerUser(user)) {
    return NextResponse.json({ success: false, error: 'Phone verification is not available for this account.' }, { status: 403 });
  }

  if (body?.action === 'send') {
    const rl = checkRateLimit(`billing-verify-send:${auth.userId}`, SEND_MAX, WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: `Too many code requests. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }
    const otp = generateOTP();
    await User.updateOne(
      { _id: auth.userId },
      { $set: { phoneOtpHash: hashOTP(otp), phoneOtpExpiry: new Date(Date.now() + OTP_TTL_MS) } }
    );
    const sent = await sendOtpMessage(
      user.phone,
      `Your GrowwMatics verification code is ${otp}. It expires in 10 minutes. Never share this code with anyone.`,
      otp
    );
    if (!sent.success) {
      console.error('[billing/verify-phone] WhatsApp send failed:', sent.error);
      return NextResponse.json({ success: false, error: 'Could not send the code right now. Please try again shortly.' }, { status: 502 });
    }
    return NextResponse.json({ success: true, verified: false, codeSent: true });
  }

  if (body?.action === 'confirm') {
    const rlKey = `billing-verify-confirm:${auth.userId}`;
    const rl = checkRateLimit(rlKey, CONFIRM_MAX, WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: `Too many attempts. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }
    const code = String(body.code ?? '').trim();
    const valid =
      /^\d{4,8}$/.test(code) &&
      !!user.phoneOtpHash &&
      !!user.phoneOtpExpiry &&
      new Date(user.phoneOtpExpiry).getTime() > Date.now() &&
      verifyOTP(code, user.phoneOtpHash);
    if (!valid) return NextResponse.json({ success: false, error: 'Incorrect or expired code.' }, { status: 400 });

    resetRateLimit(rlKey);
    await User.updateOne({ _id: auth.userId }, { $unset: { phoneOtpHash: '', phoneOtpExpiry: '' } });
    await markPhoneVerified(auth.userId, 'whatsapp_otp');
    return NextResponse.json({ success: true, verified: true });
  }

  return NextResponse.json({ success: false, error: 'Unknown action.' }, { status: 400 });
}
