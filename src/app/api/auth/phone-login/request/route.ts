import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { normalizePhoneE164, phoneDedupeKey } from '@/lib/phone';
import { generateOTP, hashOTP } from '@/services/auth/otp';
import { sendOutboundMessage } from '@/services/whatsapp/send';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isQaTestingMode } from '@/lib/testingMode';

export const dynamic = 'force-dynamic';

// Each request sends a real WhatsApp message (a cost, and an abuse vector if
// unthrottled) — tighter than the email/password login limiter.
const REQUEST_MAX_ATTEMPTS = 5;
const REQUEST_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function POST(req: Request) {
  try {
    await dbConnect();
    const { phone } = await req.json();

    if (!phone) {
      return NextResponse.json({ success: false, error: 'Phone number required.' }, { status: 400 });
    }

    const normalized = normalizePhoneE164(String(phone));
    if (!normalized) {
      return NextResponse.json(
        { success: false, error: 'Please enter a valid phone number, e.g. +14155550100.' },
        { status: 400 }
      );
    }

    const rlKey = `phone-login:${getClientIp(req)}:${normalized}`;
    const rl = checkRateLimit(rlKey, REQUEST_MAX_ATTEMPTS, REQUEST_WINDOW_MS);
    if (!rl.allowed && !isQaTestingMode()) {
      return NextResponse.json(
        { success: false, error: `Too many code requests. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }

    // Exact match first; fall back to a last-10-digits match for any legacy
    // record whose phone wasn't stored in strict E.164 (e.g. an older
    // shadow account created from a WhatsApp webhook payload).
    let user = await User.findOne({ phone: normalized });
    if (!user) {
      const dedupeKey = phoneDedupeKey(normalized);
      if (dedupeKey) user = await User.findOne({ phone: { $regex: `${dedupeKey}$` } });
    }

    if (!user) {
      // Deliberately specific — unlike email login, a wrong phone number on
      // this flow just means "you haven't signed up yet, or typed it wrong",
      // not a credential being tested; the OTP itself is still required to
      // actually get in, so this doesn't materially help an attacker.
      return NextResponse.json(
        { success: false, error: 'No account found for this phone number.' },
        { status: 404 }
      );
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

    const otp = generateOTP();
    user.phoneOtpHash = hashOTP(otp);
    user.phoneOtpExpiry = new Date(Date.now() + OTP_TTL_MS);
    await user.save();

    // No businessId — this is a platform-level auth message, not tied to any
    // one workspace, so it routes through the platform's own WhatsApp number
    // (see services/whatsapp/send.ts's resolveProvider).
    const result = await sendOutboundMessage(
      user.phone,
      `Your GrowwMatics AI login code is ${otp}. It expires in 10 minutes. Never share this code with anyone.`
    );

    if (!result.success) {
      console.error('[phone-login/request] WhatsApp send failed:', result.error);
      return NextResponse.json(
        { success: false, error: 'Could not send the code right now. Please try again shortly, or log in with email instead.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, maskedPhone: maskPhone(user.phone) });
  } catch (error: any) {
    console.error('Phone login (request) error:', error);
    return NextResponse.json({ success: false, error: 'Something went wrong on our end. Please try again, and contact support if this keeps happening.' }, { status: 500 });
  }
}

function maskPhone(phone: string): string {
  return phone.length > 4 ? `${phone.slice(0, -4).replace(/\d/g, '•')}${phone.slice(-4)}` : phone;
}
