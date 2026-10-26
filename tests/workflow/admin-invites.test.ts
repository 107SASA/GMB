/**
 * Super Admin invitations through the REAL routes (POST/GET /api/admin/invites,
 * POST /api/admin/invites/accept) against an in-memory MongoDB.
 *
 * Run: npx tsx --test tests/workflow/admin-invites.test.ts
 */
import { fakeRequest, jsonReq, signInAsSuperAdmin, signOut, startMemoryDb, stopMemoryDb } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

for (const k of ['NEXT_PUBLIC_APP_URL', 'NEXTAUTH_URL', 'NEXT_PUBLIC_BASE_URL']) delete process.env[k];
process.env.QA_TESTING_MODE = 'true'; // lifts the per-IP accept rate limit for repeated calls

let skipReason: string | null = null;
let m: any = {};

before(async () => {
  skipReason = await startMemoryDb('admin_invites');
  if (skipReason) return;
  m = {
    invites: await import('../../src/app/api/admin/invites/route'),
    accept: await import('../../src/app/api/admin/invites/accept/route'),
    link: await import('../../src/lib/admin/inviteLink'),
    User: (await import('../../src/models/User')).default,
    AdminInvite: (await import('../../src/models/AdminInvite')).default,
  };
});
after(stopMemoryDb);

const BASE = 'https://growwmatics.example.invalid';
const PASSWORD = 'Str0ng!Passw0rd#2026';

async function createInvite(email: string, headers: Record<string, string> = {}) {
  const auth = fakeRequest.headers.authorization;
  const res = await m.invites.POST(jsonReq(`http://localhost:3000/api/admin/invites`, 'POST', { email }, headers));
  fakeRequest.headers.authorization = auth;
  return { res, body: await res.json() };
}

const tokenFrom = (link: string) => link.split('/admin-invite/')[1];

let phoneSeq = 0;
const nextPhone = () => `98765${String(++phoneSeq).padStart(5, '0')}`;

async function accept(body: Record<string, unknown>) {
  signOut(); // the invitee has no session
  if (!('phone' in body)) body = { ...body, phone: nextPhone() };
  const res = await m.accept.POST(jsonReq(`${BASE}/api/admin/invites/accept`, 'POST', body));
  return { res, body: await res.json() };
}

test('accept page is public: it lives outside the /admin layout guard, and old links redirect to it', () => {
  assert.ok(existsSync('src/app/(auth)/admin-invite/[token]/page.tsx'), 'public accept page');
  assert.ok(!existsSync('src/app/admin/invite/[token]/page.tsx'), 'no copy left behind the Super Admin layout');
  const config = readFileSync('next.config.ts', 'utf8');
  assert.match(config, /source: '\/admin\/invite\/:token', destination: '\/admin-invite\/:token'/);
  const page = readFileSync('src/app/(auth)/admin-invite/[token]/page.tsx', 'utf8');
  assert.match(page, /router\.push\('\/admin-login'\)/, 'redirects to the real login page');
  assert.doesNotMatch(page, /\/admin\/login/);
});

test('link uses the configured app URL, else the forwarded request origin — never "undefined"', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await signInAsSuperAdmin('inviter-1@example.invalid');
  const { res, body } = await createInvite('First@Example.com', { 'x-forwarded-host': 'growwmatics.com', 'x-forwarded-proto': 'https' });
  assert.equal(res.status, 200);
  assert.match(body.data.inviteLink, /^https:\/\/growwmatics\.com\/admin-invite\/[0-9a-f]{64}$/);
  assert.equal(body.data.invite.email, 'first@example.com');
  assert.equal(body.data.invite.tokenHash, undefined, 'hash never returned');

  process.env.NEXT_PUBLIC_APP_URL = 'https://app.growwmatics.example/';
  try {
    const second = await createInvite('second@example.com');
    assert.match(second.body.data.inviteLink, /^https:\/\/app\.growwmatics\.example\/admin-invite\//);
  } finally {
    delete process.env.NEXT_PUBLIC_APP_URL;
  }
  assert.equal(m.link.configuredAppBase({ NEXTAUTH_URL: 'undefined' }), null, 'a junk value is not a base URL');
});

test('create rejects missing, malformed and non-string emails, and duplicates', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await signInAsSuperAdmin('inviter-2@example.invalid');
  for (const email of [undefined, '', 'not-an-email', { $gt: '' }, ['a@b.co']]) {
    const { res } = await createInvite(email as any);
    assert.equal(res.status, 400, `rejects ${JSON.stringify(email)}`);
  }
  assert.equal((await createInvite('dupe@example.com')).res.status, 200);
  const again = await createInvite('DUPE@example.com');
  assert.equal(again.res.status, 400);
  assert.match(again.body.error, /pending invite already exists/);
});

test('only a Super Admin can create or list invites', async (t) => {
  if (skipReason) return t.skip(skipReason);
  signOut();
  assert.equal((await m.invites.POST(jsonReq(`${BASE}/api/admin/invites`, 'POST', { email: 'x@example.com' }))).status, 401);
  const client: any = await m.User.create({ fullName: 'Client', email: 'client@example.invalid', phone: '+919000000301', role: 'CLIENT' } as any);
  const { signInAs } = await import('../helpers/adminRouteHarness');
  await signInAs(client);
  assert.equal((await m.invites.POST(jsonReq(`${BASE}/api/admin/invites`, 'POST', { email: 'x@example.com' }))).status, 403);
  assert.equal((await m.invites.GET()).status, 403);
});

test('accept: creates exactly one SUPER_ADMIN, then the link is single-use', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await signInAsSuperAdmin('inviter-3@example.invalid');
  const { body } = await createInvite('newadmin@example.com', { host: 'localhost:3000' });
  const token = tokenFrom(body.data.inviteLink);

  const ok = await accept({ token, name: 'New Admin', password: PASSWORD });
  assert.equal(ok.res.status, 200, JSON.stringify(ok.body));
  const user: any = await m.User.findOne({ email: 'newadmin@example.com' }).lean();
  assert.equal(user.role, 'SUPER_ADMIN');
  assert.equal(user.fullName, 'New Admin');
  assert.notEqual(user.passwordHash, PASSWORD, 'password stored hashed');

  const reuse = await accept({ token, name: 'Again', password: PASSWORD });
  assert.equal(reuse.res.status, 400);
  assert.match(reuse.body.error, /already been used/);
  assert.equal(await m.User.countDocuments({ email: 'newadmin@example.com' }), 1);
});

test('accept: two simultaneous submissions of one link create one account', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await signInAsSuperAdmin('inviter-4@example.invalid');
  const { body } = await createInvite('race@example.com', { host: 'localhost:3000' });
  const token = tokenFrom(body.data.inviteLink);
  signOut();
  const results = await Promise.all([1, 2, 3].map((n) =>
    m.accept.POST(jsonReq(`${BASE}/api/admin/invites/accept`, 'POST', { token, name: `Racer ${n}`, password: PASSWORD, phone: nextPhone() }))));
  assert.equal(results.filter((r: Response) => r.status === 200).length, 1, 'exactly one wins');
  assert.equal(await m.User.countDocuments({ email: 'race@example.com' }), 1);
});

test('accept: expired, unknown and injected tokens are refused; expired shows as expired in the list', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await signInAsSuperAdmin('inviter-5@example.invalid');
  const { body } = await createInvite('late@example.com', { host: 'localhost:3000' });
  const token = tokenFrom(body.data.inviteLink);
  await m.AdminInvite.updateOne({ email: 'late@example.com' }, { expiresAt: new Date(Date.now() - 1000) });

  const list = await (await m.invites.GET()).json();
  assert.equal(list.data.find((i: any) => i.email === 'late@example.com').status, 'expired');

  const late = await accept({ token, name: 'Late', password: PASSWORD });
  assert.equal(late.res.status, 400);
  assert.match(late.body.error, /expired/);
  assert.equal(await m.User.countDocuments({ email: 'late@example.com' }), 0);

  // An expired invite no longer blocks re-inviting the same email.
  await signInAsSuperAdmin('inviter-6@example.invalid');
  assert.equal((await createInvite('late@example.com', { host: 'localhost:3000' })).res.status, 200);

  assert.equal((await accept({ token: 'f'.repeat(64), name: 'X', password: PASSWORD })).res.status, 400);
  assert.equal((await accept({ token: { $gt: '' }, name: 'X', password: PASSWORD })).res.status, 400);
});

test('accept: a weak password is refused and the invite stays usable', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await signInAsSuperAdmin('inviter-7@example.invalid');
  const { body } = await createInvite('weak@example.com', { host: 'localhost:3000' });
  const token = tokenFrom(body.data.inviteLink);
  assert.equal((await accept({ token, name: 'Weak', password: 'short' })).res.status, 400);
  assert.equal((await m.AdminInvite.findOne({ email: 'weak@example.com' }).lean()).status, 'pending');
  assert.equal((await accept({ token, name: 'Weak', password: PASSWORD })).res.status, 200);
});

test('accept: phone is required, normalised, and must not belong to another account', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await signInAsSuperAdmin('inviter-8@example.invalid');
  const a = tokenFrom((await createInvite('phone-a@example.com', { host: 'localhost:3000' })).body.data.inviteLink);
  await signInAsSuperAdmin('inviter-9@example.invalid');
  const b = tokenFrom((await createInvite('phone-b@example.com', { host: 'localhost:3000' })).body.data.inviteLink);

  const missing = await accept({ token: a, name: 'A', password: PASSWORD, phone: '' });
  assert.equal(missing.res.status, 400);
  assert.match(missing.body.error, /mobile number is required/);

  assert.equal((await accept({ token: a, name: 'A', password: PASSWORD, phone: '094233 07981' })).res.status, 200);
  assert.equal((await m.User.findOne({ email: 'phone-a@example.com' }).lean()).phone, '+919423307981', 'stored as E.164');

  const taken = await accept({ token: b, name: 'B', password: PASSWORD, phone: '+91 94233 07981' });
  assert.equal(taken.res.status, 400);
  assert.match(taken.body.error, /already used/);
  assert.equal((await m.AdminInvite.findOne({ email: 'phone-b@example.com' }).lean()).status, 'pending', 'invite still usable');
  assert.equal((await accept({ token: b, name: 'B', password: PASSWORD })).res.status, 200, 'a second admin can be created');
});
