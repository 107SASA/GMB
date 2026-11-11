/**
 * Growth Partner program — pure rules, so tests load them directly.
 *
 * Phase 1 covers the public application form and the super admin's
 * approval: what an application must contain, and the commercial terms the
 * admin sets per partner at approval (first-payment %, recurring %, hold
 * days). There is no global default — every partner gets their own terms.
 */
import { normalizePhoneE164 } from '../phone.ts';

export const APPLICANT_TYPES = ['agency', 'freelancer', 'individual', 'other'] as const;
export type ApplicantType = (typeof APPLICANT_TYPES)[number];

export const APPLICANT_TYPE_LABELS: Record<ApplicantType, string> = {
  agency: 'Digital marketing agency',
  freelancer: 'Freelancer / consultant',
  individual: 'Individual',
  other: 'Other',
};

export interface PartnerApplicationInput {
  fullName: string;
  email: string;
  phone: string;
  companyName: string;
  website: string | null;
  city: string;
  state: string;
  applicantType: ApplicantType;
  message: string | null;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

/** A website the applicant typed, as an https URL, or null when it doesn't look like one. */
export function normalizeWebsite(value: unknown): string | null {
  const raw = text(value, 300);
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** Validates the public "Apply as a Growth Partner" form. */
export function validatePartnerApplication(body: Record<string, unknown>): Validation<PartnerApplicationInput> {
  const fullName = text(body.fullName, 120);
  if (fullName.length < 2) return { ok: false, error: 'Please enter your full name.' };

  const email = text(body.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Please enter a valid email address.' };

  const phone = normalizePhoneE164(text(body.phone, 30));
  if (!phone) return { ok: false, error: 'Please enter a valid mobile number with country code.' };

  const companyName = text(body.companyName, 160);
  if (companyName.length < 2) return { ok: false, error: 'Please enter your company name.' };

  const websiteRaw = text(body.website, 300);
  const website = normalizeWebsite(websiteRaw);
  if (websiteRaw && !website) return { ok: false, error: 'Please enter a valid website, e.g. www.youragency.com.' };

  const city = text(body.city, 80);
  if (city.length < 2) return { ok: false, error: 'Please enter your city.' };
  const state = text(body.state, 80);
  if (state.length < 2) return { ok: false, error: 'Please enter your state.' };

  const type = text(body.applicantType, 20) as ApplicantType;
  if (!APPLICANT_TYPES.includes(type)) return { ok: false, error: 'Please tell us what kind of partner you are.' };

  const message = text(body.message, 1000) || null;

  return {
    ok: true,
    value: { fullName, email, phone, companyName, website, city, state, applicantType: type, message },
  };
}

export interface PartnerTerms {
  /** % of the customer's first payment (excl. GST). */
  firstPaymentRate: number;
  /** % of every renewal payment after the first. */
  recurringRate: number;
  /** Days a commission waits (refund window) before it can be paid out. */
  holdDays: number;
  /** Optional cap on recurring commission, in months; null = for as long as the customer pays. */
  recurringMonths: number | null;
}

function percent(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}

function wholeNumber(value: unknown, max: number): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) return null;
  return n;
}

/** Validates the commercial terms the super admin sets for one partner. All three main values are required. */
export function validatePartnerTerms(body: Record<string, unknown>): Validation<PartnerTerms> {
  const firstPaymentRate = percent(body.firstPaymentRate);
  if (firstPaymentRate === null) return { ok: false, error: 'First-payment commission must be a % between 0 and 100.' };

  const recurringRate = percent(body.recurringRate);
  if (recurringRate === null) return { ok: false, error: 'Recurring commission must be a % between 0 and 100.' };

  const holdDays = wholeNumber(body.holdDays, 365);
  if (holdDays === null) return { ok: false, error: 'Hold period must be a whole number of days (0–365).' };

  let recurringMonths: number | null = null;
  if (body.recurringMonths !== '' && body.recurringMonths !== null && body.recurringMonths !== undefined) {
    recurringMonths = wholeNumber(body.recurringMonths, 240);
    if (recurringMonths === null || recurringMonths === 0) {
      return { ok: false, error: 'Recurring limit must be a number of months (1–240), or left empty for no limit.' };
    }
  }

  return { ok: true, value: { firstPaymentRate, recurringRate, holdDays, recurringMonths } };
}

// No 0/O/1/I/L — codes get read out over the phone.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A referral code like GP-7K3DQ2. `random` returns bytes (crypto.randomBytes in production). */
export function generatePartnerCode(random: (size: number) => Uint8Array): string {
  const bytes = random(6);
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `GP-${code}`;
}

/** Days an approval invite stays valid. */
export const PARTNER_INVITE_DAYS = 7;

export function partnerInvitePath(rawToken: string): string {
  return `/partner-invite/${rawToken}`;
}

/**
 * The `phone` stored on a partner's User (login) record. User.phone is
 * required and unique, but customer logins, the free report and the WhatsApp
 * agents all find users by phone — a partner's real number there could log
 * into, or attach a customer workspace to, the partner account. This value
 * can never match a real E.164 number; the real mobile lives on GrowthPartner.
 */
export function partnerLoginPhone(partnerCode: string): string {
  return `partner:${partnerCode}`;
}

/** What the admin list should show — a pending invite past its expiry is expired. */
export function effectivePartnerInviteStatus(
  invite: { status: string; expiresAt: Date | string } | null | undefined,
  now = new Date()
): 'none' | 'pending' | 'accepted' | 'expired' {
  if (!invite) return 'none';
  if (invite.status === 'pending' && new Date(invite.expiresAt).getTime() <= now.getTime()) return 'expired';
  return invite.status as 'pending' | 'accepted' | 'expired';
}

/** Escapes text for the HTML emails (applicant-typed values end up in them). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
