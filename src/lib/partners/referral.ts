/**
 * Growth Partner referral links — pure rules, so tests load them directly.
 *
 * A partner shares growwmatics.ai/p/GP-XXXXXX (or any page with
 * ?ref=GP-XXXXXX). That stores a first-party cookie for 30 days holding the
 * code and the click time. A lead or workspace created AFTER that click —
 * through the free report, demo booking or sign-up — is credited to the
 * partner. Rules:
 *  - first partner wins: a valid cookie is never overwritten by another code;
 *  - only new business: something already in our pipeline before the click
 *    is never re-assigned;
 *  - referral leads keep our normal funnel (the AI helps them) — unlike
 *    leads a partner adds by hand, which stay AI-free.
 */

export const REF_COOKIE = 'gm_ref';
export const REF_DAYS = 30;
export const REF_MAX_AGE_SECONDS = REF_DAYS * 24 * 60 * 60;

const CODE_RE = /^GP-[A-HJKMNP-Z2-9]{6}$/;

export function normalizePartnerCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

export function encodeRef(code: string, clickedAtMs: number): string {
  return `${code}.${Math.floor(clickedAtMs)}`;
}

/** Parses the cookie; null when malformed or older than the window. */
export function parseRef(value: unknown, nowMs = Date.now()): { code: string; clickedAt: Date } | null {
  if (typeof value !== 'string') return null;
  const [rawCode, rawTs] = value.split('.');
  const code = normalizePartnerCode(rawCode);
  const ts = Number(rawTs);
  if (!code || !Number.isFinite(ts) || ts <= 0) return null;
  if (ts > nowMs + 60_000) return null; // from the future — tampered
  if (nowMs - ts > REF_MAX_AGE_SECONDS * 1000) return null;
  return { code, clickedAt: new Date(ts) };
}

/** Whether a new click may replace the cookie the browser already has. */
export function shouldSetRef(existing: unknown, nowMs = Date.now()): boolean {
  return parseRef(existing, nowMs) === null;
}

/**
 * A record counts as "brought by this click" when it was created at or after
 * the click (with a minute of clock slack).
 */
export function createdAfterClick(createdAt: Date | string | null | undefined, clickedAt: Date): boolean {
  if (!createdAt) return false;
  return new Date(createdAt).getTime() >= clickedAt.getTime() - 60_000;
}

/** Only same-site paths are allowed as the post-click destination. */
export function safeRedirectPath(to: unknown): string {
  if (typeof to !== 'string') return '/';
  if (!to.startsWith('/') || to.startsWith('//') || to.startsWith('/\\')) return '/';
  if (/[\r\n]/.test(to)) return '/';
  return to.slice(0, 300);
}

export function referralLinkPath(code: string): string {
  return `/p/${code}`;
}

/**
 * Partner sources where the partner only gets the CREDIT and our funnel keeps
 * running the lead: 'referral' (came through their link) and 'credit' (our
 * team linked it to them).
 */
export const CREDIT_ONLY_SOURCES = ['referral', 'credit'] as const;

/**
 * A partner lead is "partner-managed" (AI stays off, partner runs the stage)
 * when the partner added it themselves, or our team handed it to them
 * ('added'). Credit-only leads keep our funnel. Unknown source = managed, the
 * safe default.
 */
export function isPartnerManagedLead(lead: { partnerId?: unknown; partnerSource?: string | null } | null | undefined): boolean {
  return !!lead?.partnerId && !(CREDIT_ONLY_SOURCES as readonly string[]).includes(lead.partnerSource ?? '');
}
