import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';

const COOKIE_NAME = 'session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET environment variable is not set');
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(userId: string, role: string): Promise<string> {
  return new SignJWT({ userId, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(getSecret());
}

async function verifySessionToken(token: string): Promise<{ userId: string; role: string } | null> {
  const { payload } = await jwtVerify(token, getSecret());
  const { userId, role } = payload as { userId: string; role: string };
  if (!userId || !role) return null;
  return { userId, role };
}

export async function createSession(userId: string, role: string): Promise<void> {
  const token = await signSessionToken(userId, role);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function getSession(): Promise<{ userId: string; role: string } | null> {
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
}
