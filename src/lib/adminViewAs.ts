/**
 * "Login as customer" — a SUPER_ADMIN viewing a customer's dashboard.
 *
 * Two cookies, both short-lived (VIEW_AS_MAX_AGE_SEC):
 *   - activeBusinessId — the normal workspace selector, pointed at the
 *     customer's business (requireBusinessContext already lets SUPER_ADMIN
 *     act on any business).
 *   - adminViewAs      — the marker that this is an admin session inside a
 *     customer's workspace. Drives the red banner + Exit, the action log in
 *     proxy.ts, and keeps admin visits out of the customer's activity.
 *
 * The marker is NOT a credential — every reader must also confirm the
 * session user is SUPER_ADMIN. A regular user setting this cookie by hand
 * gains nothing (their business access is still owner-scoped).
 */

export const VIEW_AS_COOKIE = 'adminViewAs';
export const VIEW_AS_MAX_AGE_SEC = 2 * 60 * 60; // 2 hours

export interface AdminViewAs {
  /** Customer business being viewed. */
  businessId: string;
  businessName: string;
  /** The customer (business owner) user id. */
  ownerUserId?: string;
  /** ISO time the admin entered. */
  startedAt: string;
  /** The admin's own activeBusinessId before entering — restored on Exit. */
  prevBusinessId?: string;
}

export function encodeViewAs(v: AdminViewAs): string {
  return Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
}

export function decodeViewAs(raw: string | undefined | null): AdminViewAs | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!v || typeof v.businessId !== 'string' || typeof v.startedAt !== 'string') return null;
    const started = Date.parse(v.startedAt);
    // Belt to the cookie's own maxAge: never honour a marker older than the window.
    if (!Number.isFinite(started) || Date.now() - started > VIEW_AS_MAX_AGE_SEC * 1000) return null;
    return {
      businessId: v.businessId,
      businessName: typeof v.businessName === 'string' ? v.businessName : '',
      ownerUserId: typeof v.ownerUserId === 'string' ? v.ownerUserId : undefined,
      startedAt: v.startedAt,
      prevBusinessId: typeof v.prevBusinessId === 'string' ? v.prevBusinessId : undefined,
    };
  } catch {
    return null;
  }
}

export const viewAsCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: VIEW_AS_MAX_AGE_SEC,
};
