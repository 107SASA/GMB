/**
 * Super Admin invite links — pure, so tests load it directly.
 *
 * The accept page is public (src/app/(auth)/admin-invite/[token]) because the
 * invited person has no session yet; everything under /admin requires one.
 */

/** First configured absolute app URL, in the order the rest of the app prefers. */
export function configuredAppBase(env: Record<string, string | undefined>): string | null {
  for (const key of ['NEXT_PUBLIC_APP_URL', 'NEXTAUTH_URL', 'NEXT_PUBLIC_BASE_URL']) {
    const v = (env[key] || '').trim().replace(/\/+$/, '');
    if (/^https?:\/\/[^/\s]+/i.test(v)) return v;
  }
  return null;
}

/**
 * Origin of the request as the browser saw it (behind nginx the socket
 * host is localhost:3000, so the forwarded headers win).
 */
export function requestOrigin(headers: { get(name: string): string | null }, fallbackUrl: string): string | null {
  const host = (headers.get('x-forwarded-host') || headers.get('host') || '').split(',')[0].trim();
  const proto = (headers.get('x-forwarded-proto') || '').split(',')[0].trim();
  if (host) {
    const scheme = proto === 'http' || proto === 'https' ? proto : new URL(fallbackUrl).protocol.replace(':', '');
    return `${scheme}://${host}`;
  }
  try {
    return new URL(fallbackUrl).origin;
  } catch {
    return null;
  }
}

export function inviteAcceptPath(rawToken: string): string {
  return `/admin-invite/${rawToken}`;
}

/** Absolute invite link, or null when no base can be resolved. */
export function buildInviteLink(
  rawToken: string,
  env: Record<string, string | undefined>,
  headers: { get(name: string): string | null },
  requestUrl: string
): string | null {
  const base = configuredAppBase(env) || requestOrigin(headers, requestUrl);
  return base ? `${base}${inviteAcceptPath(rawToken)}` : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lower-cased email, or null when the value is not a plain email string. */
export function normalizeInviteEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

/** What the invites list should show — a pending row past its expiry is expired. */
export function effectiveInviteStatus(invite: { status: string; expiresAt: Date | string }, now = new Date()): string {
  if (invite.status === 'pending' && new Date(invite.expiresAt).getTime() <= now.getTime()) return 'expired';
  return invite.status;
}
