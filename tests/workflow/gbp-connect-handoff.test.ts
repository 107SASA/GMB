/**
 * iOS → web Google Business Profile connect handoff — the REAL routes
 * (POST /api/auth/google/mobile-handoff, GET …/mobile-handoff/[token], and
 * the unchanged GET /api/auth/google) with the REAL requireBusinessContext /
 * requireClient / bearer-JWT checks, against an in-memory MongoDB. Only
 * next/headers is replaced by a fake request (headers + cookie jar). Nothing
 * contacts Google: the OAuth route only builds the redirect URL.
 *
 * Run: npx tsx --test tests/workflow/gbp-connect-handoff.test.ts
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
Object.assign(process.env, {
  SESSION_SECRET: 'test-session-secret-not-real-0123456789abcdef',
  NEXT_PUBLIC_APP_URL: 'https://app.example.invalid',
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
  GOOGLE_REDIRECT_URI: 'https://app.example.invalid/api/auth/google/callback',
});

// ── Fake request context for next/headers ────────────────────────────────
const req = { headers: {} as Record<string, string>, cookies: {} as Record<string, string> };
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/^next[\\/]headers(\.js)?$/.test(request)) {
    return {
      ...origLoad.call(this, request, ...rest),
      headers: async () => new Headers(req.headers),
      cookies: async () => ({
        get: (name: string) => (name in req.cookies ? { name, value: req.cookies[name] } : undefined),
        set: (name: string, value: string) => { req.cookies[name] = value; },
        delete: (name: string) => { delete req.cookies[name]; },
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
let skipReason: string | null = null;
let app: any = {};
let ownerA: any, userB: any, bizA: any, bizB: any;

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_gbp_handoff_${Date.now()}`);
  const dbConnect = (await import('../../src/lib/mongodb')).default;
  await dbConnect();
  app = {
    issueRoute: await import('../../src/app/api/auth/google/mobile-handoff/route'),
    redeemRoute: await import('../../src/app/api/auth/google/mobile-handoff/[token]/route'),
    oauthRoute: await import('../../src/app/api/auth/google/route'),
    handoff: await import('../../src/lib/gbpConnectHandoff'),
    session: await import('../../src/lib/session'),
    rateLimit: await import('../../src/lib/rateLimit'),
    User: (await import('../../src/models/User')).default,
    Business: (await import('../../src/models/Business')).default,
    Handoff: (await import('../../src/models/GbpConnectHandoff')).default,
    mongoose: (await import('mongoose')).default,
  };
  const { Types } = app.mongoose;
  ownerA = await app.User.create({ fullName: 'Owner A', email: 'a@example.invalid', phone: '+919000000101', role: 'CLIENT', organizationId: new Types.ObjectId() } as any);
  userB = await app.User.create({ fullName: 'Owner B', email: 'b@example.invalid', phone: '+919000000102', role: 'CLIENT', organizationId: new Types.ObjectId() } as any);
  bizA = new Types.ObjectId();
  bizB = new Types.ObjectId();
  // Raw inserts: only the ownership fields matter to these routes.
  await app.Business.collection.insertMany([
    { _id: bizA, name: 'A Salon', userId: ownerA._id, organizationId: ownerA.organizationId },
    { _id: bizB, name: 'B Bakery', userId: userB._id, organizationId: userB.organizationId },
  ]);
});

after(async () => {
  if (app.mongoose?.connection?.readyState === 1) {
    await app.mongoose.connection.dropDatabase();
    await app.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
  Module._load = origLoad;
  globalThis.fetch = originalFetch;
});

beforeEach(async () => {
  req.headers = {};
  req.cookies = {};
  if (app.rateLimit) {
    app.rateLimit.resetRateLimit(`gbp-handoff:${ownerA._id}`);
    app.rateLimit.resetRateLimit(`gbp-handoff:${userB._id}`);
  }
});

/** Signs in as `user` the way the mobile apps do (bearer JWT + workspace header). */
async function asApp(user: any, businessId: unknown) {
  const fresh: any = await app.User.findById(user._id).lean();
  const token = await app.session.signSessionToken(String(user._id), fresh.role, fresh.sessionEpoch ?? 0);
  req.headers = { authorization: `Bearer ${token}`, 'x-business-id': String(businessId), 'x-client': 'mobile' };
}

async function issue(): Promise<Response> {
  return app.issueRoute.POST(new Request('https://app.example.invalid/api/auth/google/mobile-handoff', { method: 'POST' }));
}

async function redeem(token: string): Promise<Response> {
  req.headers = {};
  req.cookies = {};
  return app.redeemRoute.GET(new Request(`https://app.example.invalid/api/auth/google/mobile-handoff/${token}`), {
    params: Promise.resolve({ token }),
  });
}

const tokenOf = (url: string) => url.split('/').pop()!;

function cookiesOf(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of (res.headers as any).getSetCookie() as string[]) {
    const [pair, ...attrs] = c.split(';');
    const [name, value] = pair.split('=');
    out[name.trim()] = value;
    out[`${name.trim()}:attrs`] = attrs.join(';').toLowerCase();
  }
  return out;
}

test('issue: no app session → 401, nothing stored', async (t) => {
  if (skipReason) return t.skip(skipReason);
  req.headers = { 'x-business-id': String(bizA) };
  const res = await issue();
  assert.equal(res.status, 401);
  assert.equal(await app.Handoff.countDocuments(), 0);
});

test('issue: another account\'s workspace → 403, nothing stored (workspace isolation)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await asApp(ownerA, bizB);
  const res = await issue();
  assert.equal(res.status, 403);
  assert.equal(await app.Handoff.countDocuments(), 0);
});

test('issue: own workspace → single-use URL; only the token hash is stored', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await asApp(ownerA, bizA);
  const res = await issue();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.match(body.url, /^https:\/\/app\.example\.invalid\/api\/auth\/google\/mobile-handoff\/[0-9a-f]{64}$/);
  assert.equal(body.expiresInSeconds, 120);
  const raw = tokenOf(body.url);
  const stored = await app.Handoff.findOne({}).sort({ createdAt: -1 }).lean();
  assert.notEqual(stored.tokenHash, raw, 'raw token is never stored');
  assert.equal(String(stored.businessId), String(bizA));
  assert.equal(String(stored.userId), String(ownerA._id));
});

test('redeem: sets a 15-minute web session for that workspace and continues into the existing OAuth route', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await asApp(ownerA, bizA);
  const { url } = await (await issue()).json();

  const res = await redeem(tokenOf(url));
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), 'https://app.example.invalid/api/auth/google');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const jar = cookiesOf(res);
  assert.equal(jar.activeBusinessId, String(bizA));
  assert.match(jar['session:attrs'], /max-age=900/);
  assert.match(jar['session:attrs'], /httponly/);
  const claims = await app.session.verifySessionToken(jar.session);
  assert.equal(claims.userId, String(ownerA._id));
  const { exp } = JSON.parse(Buffer.from(jar.session.split('.')[1], 'base64url').toString());
  assert.ok(exp * 1000 <= Date.now() + 15 * 60 * 1000 + 5000, 'web session expires in 15 minutes, not 30 days');

  // The browser follows the redirect with those cookies: the UNCHANGED OAuth
  // route accepts them and signs the state for the handed-off workspace.
  req.headers = {};
  req.cookies = { session: jar.session, activeBusinessId: jar.activeBusinessId };
  const oauth = await app.oauthRoute.GET();
  assert.equal(oauth.status, 307);
  const google = new URL(oauth.headers.get('location')!);
  assert.equal(google.host, 'accounts.google.com');
  const stateCookie = cookiesOf(oauth).gbp_oauth_state;
  const state = JSON.parse(Buffer.from(stateCookie.split('.')[1], 'base64url').toString());
  assert.equal(state.businessId, String(bizA));
  assert.equal(state.state, google.searchParams.get('state'));
  assert.ok(!oauth.headers.get('location')!.includes(jar.session), 'no session token in the Google URL');
});

test('redeem: replay is rejected (single use)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await asApp(ownerA, bizA);
  const raw = tokenOf((await (await issue()).json()).url);
  assert.equal((await redeem(raw)).status, 307);
  const replay = await redeem(raw);
  assert.equal(replay.status, 410);
  assert.deepEqual((replay.headers as any).getSetCookie(), [], 'a rejected link sets no cookies');
});

test('redeem: two simultaneous redeems — exactly one wins', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await asApp(ownerA, bizA);
  const raw = tokenOf((await (await issue()).json()).url);
  const results = await Promise.all([app.handoff.consumeGbpConnectHandoff(raw), app.handoff.consumeGbpConnectHandoff(raw)]);
  assert.equal(results.filter((r: any) => r.ok).length, 1);
});

test('redeem: expired link → 410', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { rawToken } = await app.handoff.issueGbpConnectHandoff({
    userId: String(ownerA._id), businessId: String(bizA), sessionEpoch: 0, now: Date.now() - 3 * 60 * 1000,
  });
  assert.equal((await redeem(rawToken)).status, 410);
});

test('redeem: malformed → 404, unknown well-formed → 410', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal((await redeem('not-a-token')).status, 404);
  assert.equal((await redeem('a'.repeat(64))).status, 410);
});

test('redeem: signing out everywhere after issue revokes the link', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await asApp(userB, bizB);
  const raw = tokenOf((await (await issue()).json()).url);
  await app.User.updateOne({ _id: userB._id }, { $set: { sessionEpoch: Date.now() } });
  assert.equal((await redeem(raw)).status, 403);
  await app.User.updateOne({ _id: userB._id }, { $set: { sessionEpoch: 0 } });
});

test('redeem: losing access to the workspace after issue revokes the link', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await asApp(ownerA, bizA);
  const raw = tokenOf((await (await issue()).json()).url);
  await app.Business.collection.updateOne({ _id: bizA }, { $set: { userId: userB._id, organizationId: userB.organizationId } });
  try {
    assert.equal((await redeem(raw)).status, 403);
  } finally {
    await app.Business.collection.updateOne({ _id: bizA }, { $set: { userId: ownerA._id, organizationId: ownerA.organizationId } });
  }
});

test('OAuth callback (unchanged) still rejects a mismatched, missing or expired state for a handed-off session', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { NextRequest } = await import('next/server');
  const { SignJWT } = await import('jose');
  const callback = await import('../../src/app/api/auth/google/callback/route');
  await asApp(ownerA, bizA);
  const jar = cookiesOf(await redeem(tokenOf((await (await issue()).json()).url)));
  req.headers = {};
  req.cookies = { session: jar.session, activeBusinessId: jar.activeBusinessId };
  const oauth = await app.oauthRoute.GET();
  const stateCookie = cookiesOf(oauth).gbp_oauth_state;
  const realState = new URL(oauth.headers.get('location')!).searchParams.get('state')!;
  const callbackTo = async (state: string | null, cookie: string | null) => {
    const url = `https://app.example.invalid/api/auth/google/callback?code=fake-code${state ? `&state=${state}` : ''}`;
    const res = await callback.GET(new NextRequest(url, { headers: cookie ? { cookie: `gbp_oauth_state=${cookie}` } : {} }));
    return res.headers.get('location') ?? '';
  };

  assert.match(await callbackTo('f'.repeat(32), stateCookie), /error=state_mismatch/, 'state from another flow');
  assert.match(await callbackTo(realState, null), /error=state_mismatch/, 'no state cookie');
  assert.match(await callbackTo(null, stateCookie), /error=state_mismatch/, 'no state parameter');
  const expired = await new SignJWT({ state: realState, businessId: String(bizA) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 300)
    .sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
  assert.match(await callbackTo(realState, expired), /error=state_mismatch/, 'expired state cookie');
});

test('issue: rate limited per user', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await asApp(ownerA, bizA);
  for (let i = 0; i < 10; i++) assert.equal((await issue()).status, 200);
  assert.equal((await issue()).status, 429);
});

test('signSessionToken default lifetime is still 30 days (existing logins unchanged)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const token = await app.session.signSessionToken('u1', 'CLIENT', 0);
  const { exp, iat } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  assert.equal(exp - iat, 30 * 24 * 60 * 60);
});
