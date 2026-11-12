import { NextResponse } from 'next/server';
import { normalizePhoneE164 } from '@/lib/phone';
import { getClientIp } from '@/lib/rateLimit';
import { checkDurableRateLimit } from '@/lib/durableRateLimit';
import { isQaTestingMode } from '@/lib/testingMode';
import { sendFreeReportOtp } from '@/services/auth/freeReportOtp';

export const dynamic = 'force-dynamic';

/**
 * Step 1 of the free report: send a WhatsApp code to the visitor's number.
 * POST /api/free-report/start refuses to run without that code.
 * Each call sends a paid WhatsApp message, so it is limited per IP and per
 * number (MongoDB-backed, so the limit holds across server instances).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const phone = normalizePhoneE164(String(body.phone || ''));
    if (!phone) {
      return NextResponse.json(
        { success: false, error: 'Please enter a valid WhatsApp number, e.g. +919876543210.' },
        { status: 400 }
      );
    }

    if (!isQaTestingMode()) {
      const ip = getClientIp(req);
      const [ipRate, phoneShort, phoneDay] = await Promise.all([
        checkDurableRateLimit(`free-report-otp-ip:${ip}`, 6, 15 * 60 * 1000),
        checkDurableRateLimit(`free-report-otp-phone:${phone}`, 3, 15 * 60 * 1000),
        checkDurableRateLimit(`free-report-otp-phone-day:${phone}`, 8, 24 * 60 * 60 * 1000),
      ]);
      if (!ipRate.allowed || !phoneShort.allowed || !phoneDay.allowed) {
        return NextResponse.json(
          { success: false, error: 'Too many code requests. Please try again in a few minutes.' },
          { status: 429 }
        );
      }
    }

    const result = await sendFreeReportOtp(phone);
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error }, { status: 502 });
    }
    return NextResponse.json({ success: true, maskedPhone: maskPhone(phone) });
  } catch (error) {
    console.error('Free Report send-otp error:', error);
    return NextResponse.json(
      { success: false, error: 'Could not send the code right now. Please try again.' },
      { status: 500 }
    );
  }
}

function maskPhone(phone: string): string {
  return phone.length > 4 ? `${phone.slice(0, -4).replace(/\d/g, '•')}${phone.slice(-4)}` : phone;
}
