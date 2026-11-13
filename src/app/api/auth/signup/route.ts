import { NextResponse } from 'next/server';
import { normalizePhoneE164 } from '@/lib/phone';
import { getClientIp } from '@/lib/rateLimit';
import { checkDurableRateLimit } from '@/lib/durableRateLimit';
import { isQaTestingMode } from '@/lib/testingMode';
import { finalizeLogin } from '@/lib/authSession';
import { checkPhoneOtp, consumePhoneOtp } from '@/services/auth/freeReportOtp';
import { findAccountForPhone } from '@/lib/shadowAccount';
import { getFreeSignupSettings } from '@/lib/freeSignupSettings';
import { markPhoneVerified } from '@/services/auth/phoneVerification';
import { registerFreeAccount } from '@/services/auth/freeAccount';

export const dynamic = 'force-dynamic';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Free account sign-up, step 2 (app "Create free account"; website later):
 *   { phone, otp, name, business: { name?, category?, city?, googlePlaceId? }, channel? }
 * The WhatsApp code proves the number. Then:
 *   - number already has an account → just logged in (outcome 'existing')
 *   - otherwise a Free account is created (or an old shadow account taken
 *     over) — CRM + card scan open — and the free report starts in the
 *     background when a Google listing was picked.
 * Response = the normal login response (mobile: { token, expiresAt }) plus
 * { outcome, reportStarted }.
 */
export async function POST(req: Request) {
  try {
    if (!isQaTestingMode()) {
      const ipRate = await checkDurableRateLimit(`signup-ip:${getClientIp(req)}`, 10, 15 * 60 * 1000);
      if (!ipRate.allowed) {
        return NextResponse.json({ success: false, error: 'Too many attempts. Please try again in a few minutes.' }, { status: 429 });
      }
    }

    const body = await req.json().catch(() => ({}));
    const phone = normalizePhoneE164(String(body.phone || ''));
    if (!phone) return NextResponse.json({ success: false, error: 'Please enter a valid WhatsApp number.' }, { status: 400 });

    const otpCheck = await checkPhoneOtp(phone, String(body.otp || ''), 'signup');
    if (!otpCheck.ok) {
      return NextResponse.json({ success: false, error: otpCheck.error, otpRequired: true, otpExpired: !!otpCheck.expired }, { status: 401 });
    }

    const personName = str(body.name, 80);
    const business = {
      name: str(body.business?.name, 120),
      category: str(body.business?.category, 80),
      city: str(body.business?.city, 80),
      googlePlaceId: str(body.business?.googlePlaceId, 200) || undefined,
    };
    const channel = body.channel === 'website' ? 'website' : 'app';

    const account = await findAccountForPhone(phone);
    const isExisting = !!account.user && account.established;
    if (!isExisting) {
      if (!personName) return NextResponse.json({ success: false, error: 'Please enter your name.' }, { status: 400 });
      if (!business.name && !business.googlePlaceId) {
        return NextResponse.json({ success: false, error: 'Please pick your business on Google or type its name.' }, { status: 400 });
      }
      if (!(await getFreeSignupSettings()).enabled) {
        return NextResponse.json({ success: false, error: 'New sign-ups are paused right now. Please try again later.', code: 'SIGNUP_CLOSED' }, { status: 403 });
      }
    }

    const result = await registerFreeAccount({ phone, personName, business, channel });
    await consumePhoneOtp(phone, 'signup');
    await markPhoneVerified(result.user._id, 'whatsapp_otp').catch(() => {});

    const login = await finalizeLogin(result.user, req);
    if (login.status !== 200) return login; // staff / partner accounts sign in elsewhere
    const loginBody = await login.json();
    return NextResponse.json({ ...loginBody, outcome: result.outcome, reportStarted: !!result.auditId }, { status: 200 });
  } catch (error) {
    console.error('[signup]', error);
    return NextResponse.json({ success: false, error: 'Something went wrong on our end. Please try again.' }, { status: 500 });
  }
}
