import { normalizePhoneE164 } from './phone.ts';

/**
 * App-store reviewer sign-in (Google Play "App access" declaration).
 *
 * Phone login is WhatsApp-OTP only, and a store reviewer can't receive the
 * code (and can't contact us). This gives ONE designated phone number a fixed,
 * non-expiring code so the reviewer can log in.
 *
 * Off unless BOTH env vars are set:
 *   REVIEWER_PHONE  e.g. 9876543210 or +919876543210
 *   REVIEWER_OTP    6 digits (the mobile login screen only accepts 6)
 *
 * Scope is deliberately narrow: it matches that exact number only, and
 * `isReviewerUser` refuses anything but a plain CLIENT account, so the bypass
 * can never be pointed at an admin by setting REVIEWER_PHONE to their number.
 * Rate limits and account lockout still apply.
 */
export interface ReviewerConfig {
  phone: string; // E.164
  otp: string;
}

export function getReviewerConfig(): ReviewerConfig | null {
  const rawPhone = process.env.REVIEWER_PHONE?.trim();
  const otp = process.env.REVIEWER_OTP?.trim();
  if (!rawPhone || !otp || !/^\d{6}$/.test(otp)) return null;
  const phone = normalizePhoneE164(rawPhone);
  return phone ? { phone, otp } : null;
}

/** True when `normalizedPhone` is the configured reviewer number. */
export function isReviewerPhone(normalizedPhone: string): boolean {
  const cfg = getReviewerConfig();
  return !!cfg && cfg.phone === normalizedPhone;
}

/** True when this user is the reviewer AND is a plain CLIENT account. */
export function isReviewerUser(user: { phone?: string | null; role?: string | null }): boolean {
  const cfg = getReviewerConfig();
  return !!cfg && !!user.phone && user.phone === cfg.phone && user.role === 'CLIENT';
}

export function isReviewerOtp(otp: string): boolean {
  const cfg = getReviewerConfig();
  return !!cfg && String(otp) === cfg.otp;
}
