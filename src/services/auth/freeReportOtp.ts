import dbConnect from '@/lib/mongodb';
import PhoneOtpChallenge from '@/models/PhoneOtpChallenge';
import { generateOTP, hashOTP, verifyOTP } from '@/services/auth/otp';
import { sendOtpMessage } from '@/services/whatsapp/send';
import { isQaTestingMode } from '@/lib/testingMode';

/**
 * WhatsApp code check for the public free report. Visitors were typing
 * made-up or other people's numbers; each report spends real money and
 * files a sales lead, so the number must be proven first.
 *
 * Flow: sendFreeReportOtp(phone) → visitor types the code →
 * POST /api/free-report/start carries { phone, otp } → checkFreeReportOtp.
 * The code stays valid until it expires or the report is created
 * (consumeFreeReportOtp), so a retry after a passing error (e.g. a network
 * drop) does not need a new code.
 */

export const FREE_REPORT_OTP_TTL_MS = 10 * 60 * 1000;
const MAX_WRONG_ATTEMPTS = 5;
const PURPOSE = 'free_report' as const;

export type SendFreeReportOtpResult = { ok: true } | { ok: false; error: string };

export async function sendFreeReportOtp(phone: string): Promise<SendFreeReportOtpResult> {
  await dbConnect();
  const otp = generateOTP();
  await PhoneOtpChallenge.findOneAndUpdate(
    { phone, purpose: PURPOSE },
    {
      $set: {
        codeHash: hashOTP(otp),
        attempts: 0,
        expiresAt: new Date(Date.now() + FREE_REPORT_OTP_TTL_MS),
      },
    },
    { upsert: true }
  );

  const result = await sendOtpMessage(
    phone,
    `Your Growwmatics AI verification code is ${otp}. It expires in 10 minutes. Never share this code with anyone.`,
    otp
  );
  if (result.success) return { ok: true };

  // Local QA without a WhatsApp provider: print the code instead of failing.
  if (isQaTestingMode()) {
    console.warn(`[free-report-otp] QA mode — WhatsApp send failed, code for ${phone} is ${otp}`);
    return { ok: true };
  }
  console.error('[free-report-otp] WhatsApp send failed:', result.error);
  await PhoneOtpChallenge.deleteOne({ phone, purpose: PURPOSE });
  return { ok: false, error: 'Could not send the code to this WhatsApp number. Please check the number and try again.' };
}

export type CheckFreeReportOtpResult =
  | { ok: true }
  | { ok: false; error: string; expired?: boolean };

/** Checks the code without using it up. Wrong codes count toward a limit. */
export async function checkFreeReportOtp(phone: string, otp: string): Promise<CheckFreeReportOtpResult> {
  await dbConnect();
  const code = String(otp || '').replace(/\D/g, '');
  if (code.length !== 6) return { ok: false, error: 'Please enter the 6-digit code sent to your WhatsApp.' };

  const challenge = await PhoneOtpChallenge.findOne({ phone, purpose: PURPOSE });
  if (!challenge || challenge.expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: 'This code has expired. Please request a new one.', expired: true };
  }
  if (challenge.attempts >= MAX_WRONG_ATTEMPTS) {
    await PhoneOtpChallenge.deleteOne({ _id: challenge._id });
    return { ok: false, error: 'Too many wrong codes. Please request a new one.', expired: true };
  }

  if (!verifyOTP(code, challenge.codeHash)) {
    const attempts = challenge.attempts + 1;
    if (attempts >= MAX_WRONG_ATTEMPTS) {
      await PhoneOtpChallenge.deleteOne({ _id: challenge._id });
      return { ok: false, error: 'Too many wrong codes. Please request a new one.', expired: true };
    }
    await PhoneOtpChallenge.updateOne({ _id: challenge._id }, { $set: { attempts } });
    return { ok: false, error: 'Incorrect code. Please check WhatsApp and try again.' };
  }
  return { ok: true };
}

/** Call once the report has been created, so the code can't be used again. */
export async function consumeFreeReportOtp(phone: string): Promise<void> {
  await dbConnect();
  await PhoneOtpChallenge.deleteOne({ phone, purpose: PURPOSE });
}
