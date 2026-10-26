/**
 * Shared harness for workflow tests that call REAL Super Admin route handlers
 * against an in-memory MongoDB. Import it FIRST in a test file: it replaces
 * next/headers with a fake request (headers + cookie jar) before any route
 * module loads, suppresses outbound sends and blocks non-local network calls.
 */
process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-not-real-0123456789abcdef';

export const fakeRequest = { headers: {} as Record<string, string>, cookies: {} as Record<string, string> };

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/^next[\\/]headers(\.js)?$/.test(request)) {
    return {
      ...origLoad.call(this, request, ...rest),
      headers: async () => new Headers(fakeRequest.headers),
      cookies: async () => ({
        get: (name: string) => (name in fakeRequest.cookies ? { name, value: fakeRequest.cookies[name] } : undefined),
        set: (name: string, value: string) => { fakeRequest.cookies[name] = value; },
        delete: (name: string) => { delete fakeRequest.cookies[name]; },
      }),
    };
  }
  return origLoad.call(this, request, ...rest);
};

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return originalFetch(input, init);
  throw new Error(`unexpected outbound request: ${url}`);
}) as typeof fetch;

let memoryServer: any = null;

/** Starts an in-memory MongoDB and connects the app's mongoose to it. Returns a skip reason when unavailable. */
export async function startMemoryDb(name: string): Promise<string | null> {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    return `mongodb-memory-server unavailable (${err?.message})`;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_${name}_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  return null;
}

export async function stopMemoryDb(): Promise<void> {
  const mongoose = (await import('mongoose')).default;
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
  Module._load = origLoad;
  globalThis.fetch = originalFetch;
}

/** Signs the fake request in as `user` (bearer session JWT). */
export async function signInAs(user: { _id: unknown; role: string; sessionEpoch?: number }): Promise<void> {
  const session = await import('../../src/lib/session');
  const token = await session.signSessionToken(String(user._id), user.role, user.sessionEpoch ?? 0);
  fakeRequest.headers = { authorization: `Bearer ${token}` };
  fakeRequest.cookies = {};
}

export function signOut(): void {
  fakeRequest.headers = {};
  fakeRequest.cookies = {};
}

let adminSeq = 0;

/** Creates a Super Admin user and signs in as them. */
export async function signInAsSuperAdmin(email = 'root-admin@example.invalid'): Promise<any> {
  const User = (await import('../../src/models/User')).default;
  adminSeq += 1;
  const admin: any = await User.create({ fullName: 'Root Admin', email, phone: `+91900009${String(adminSeq).padStart(4, '0')}`, role: 'SUPER_ADMIN' } as any);
  await signInAs(admin);
  return admin;
}

export const jsonReq = (url: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
