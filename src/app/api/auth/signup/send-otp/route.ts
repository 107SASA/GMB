import { NextResponse } from 'next/server';
import { normalizePhoneE164 } from '@/lib/phone';
import { getClientIp } from '@/lib/rateLimit';
import { checkDurableRateLimit } from '@/lib/durableRateLimit';
import { isQaTestingMode } from '@/lib/testingMode';
import { sendPhoneOtp } from '@/services/auth/freeReportOtp';
import { findAccountForPhone } from '@/lib/shadowAccount';
import { getFreeSignupSettings } from '@/lib/freeSignupSettings';
import { isReviewerUser } from '@/lib/reviewerAccount';

export const dynamic = 'force-dynamic';

/**
 * Free account sign-up, step 1: send a WhatsApp code to the number
 * (docs/FREE_ACCOUNT_REGISTRATION_PLAN.md). Each call sends a paid WhatsApp
 * message, so it is limited per IP and per number (MongoDB-backed).
 * `existingAccount: true` lets the app say "You already have an account —
 * this code signs you in".
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const phone = normalizePhoneE164(String(body.phone || ''));
    if (!phone) {
      return NextResponse.json({ success: false, error: 'Please enter a valid WhatsApp number, e.g. +919876543210.' }, { status: 400 });
    }

    if (!isQaTestingMode()) {
      const ip = getClientIp(req);
      const [ipRate, phoneShort, phoneDay] = await Promise.all([
        checkDurableRateLimit(`signup-otp-ip:${ip}`, 6, 15 * 60 * 1000),
        checkDurableRateLimit(`signup-otp-phone:${phone}`, 3, 15 * 60 * 1000),
        checkDurableRateLimit(`signup-otp-phone-day:${phone}`, 8, 24 * 60 * 60 * 1000),
      ]);
      if (!ipRate.allowed || !phoneShort.allowed || !phoneDay.allowed) {
        return NextResponse.json({ success: false, error: 'Too many code requests. Please try again in a few minutes.' }, { status: 429 });
      }
    }

    const account = await findAccountForPhone(phone);
    const existingAccount = !!account.user && account.established;
    if (!existingAccount && !(await getFreeSignupSettings()).enabled) {
      return NextResponse.json({ success: false, error: 'New sign-ups are paused right now. Please try again later.', code: 'SIGNUP_CLOSED' }, { status: 403 });
    }

    // Store-reviewer account: fixed code, nothing to send (lib/reviewerAccount.ts).
    if (account.user && isReviewerUser(account.user)) {
      return NextResponse.json({ success: true, maskedPhone: maskPhone(phone), existingAccount: true });
    }

    const result = await sendPhoneOtp(phone, 'signup');
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: 502 });
    return NextResponse.json({ success: true, maskedPhone: maskPhone(phone), existingAccount });
  } catch (error) {
    console.error('[signup/send-otp]', error);
    return NextResponse.json({ success: false, error: 'Could not send the code right now. Please try again.' }, { status: 500 });
  }
}

function maskPhone(phone: string): string {
  return phone.length > 4 ? `${phone.slice(0, -4).replace(/\d/g, '•')}${phone.slice(-4)}` : phone;
}
