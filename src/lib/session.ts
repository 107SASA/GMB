import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';

const COOKIE_NAME = 'session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET environment variable is not set');
  return new TextEncoder().encode(secret);
}

export interface SessionClaims {
  userId: string;
  role: string;
  /**
   * Session-invalidation epoch (see src/lib/sessionInvalidation.ts). The value
   * User.sessionEpoch held when this token was issued. requireClient /
   * requireSuperAdmin / proxy.ts reject the token if it no longer matches the
   * user's current sessionEpoch. Tokens issued before this field existed carry
   * no `sv` claim and resolve to 0 — the same bootstrap value a never-
   * invalidated user has — so old sessions keep working until the first
   * invalidation for that user.
   */
  sessionEpoch: number;
}

export async function signSessionToken(
  userId: string,
  role: string,
  sessionEpoch: number = 0
): Promise<string> {
  return new SignJWT({ userId, role, sv: sessionEpoch })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  const { payload } = await jwtVerify(token, getSecret());
  const { userId, role, sv } = payload as { userId?: string; role?: string; sv?: unknown };
  if (!userId || !role) return null;
  return { userId, role, sessionEpoch: typeof sv === 'number' ? sv : 0 };
}

export async function createSession(
  userId: string,
  role: string,
  sessionEpoch: number = 0
): Promise<void> {
  const token = await signSessionToken(userId, role, sessionEpoch);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function getSession(): Promise<SessionClaims | null> {
  try {
    // Mobile clients authenticate via "Authorization: Bearer <jwt>" instead of the cookie.
    const authHeader = (await headers()).get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const bearerToken = authHeader.slice('Bearer '.length).trim();
      if (bearerToken) {
        try {
          const session = await verifySessionToken(bearerToken);
          if (session) return session;
        } catch {
          // Invalid/expired bearer token — fall back to cookie logic below
        }
      }
    }

    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;

    return await verifySessionToken(token);
  } catch {
    // Expired, tampered, or missing — treat as unauthenticated
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  // The active-workspace cookie is meaningless without a session — leaving it
  // behind just confuses the next sign-in (and proxy.ts's workspace gate).
  cookieStore.delete('activeBusinessId');
}
