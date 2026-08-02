/**
 * Integration test for the admin-invite flow (create -> accept), run against
 * a REAL running dev server + real MongoDB — not a unit test with mocks.
 *
 * Why HTTP-level rather than importing the route modules directly: this repo
 * has no Jest/Vitest config (no path-alias resolution for the `@/...`
 * imports every route uses), and Node's native TS support doesn't rewrite
 * tsconfig `paths`. Hitting the routes over HTTP sidesteps that entirely and
 * is arguably a better test for an API route anyway — it exercises the same
 * code path a real invite acceptance does, session cookies included.
 *
 * Prerequisites to run:
 *   1. `npm run dev` running on http://localhost:3000
 *   2. MONGODB_URI reachable (same one .env.local points at)
 *
 * Run with: node --test tests/integration/admin-invite-accept.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const BASE_URL = 'http://localhost:3000';

function loadEnvLocal() {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Z0-9_]+$/.test(key) || process.env[key]) continue;
    let val = line.slice(eq + 1);
    const hashIdx = val.indexOf('#');
    if (hashIdx !== -1) val = val.slice(0, hashIdx);
    process.env[key] = val.trim().replace(/^"(.*)"$/, '$1');
  }
}

const SUPER_ADMIN_EMAIL = 'qa-invite-test-admin@example.invalid';
const SUPER_ADMIN_PASSWORD = 'doesntmatterInviteTest1!';
const INVITEE_EMAIL = 'qa-invite-test-invitee@example.invalid';

let superAdminId: any;
let createdInviteeId: any = null;

before(async () => {
  loadEnvLocal();
  await mongoose.connect(process.env.MONGODB_URI as string);
  const db = mongoose.connection.db!;
  await db.collection('users').deleteMany({ email: { $in: [SUPER_ADMIN_EMAIL, INVITEE_EMAIL] } });
  await db.collection('admininvites').deleteMany({ email: INVITEE_EMAIL });

  const res = await db.collection('users').insertOne({
    fullName: 'QA Invite Test Super Admin',
    email: SUPER_ADMIN_EMAIL,
    passwordHash: await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12),
    role: 'SUPER_ADMIN',
    isEmailVerified: true,
  });
  superAdminId = res.insertedId;
});

after(async () => {
  const db = mongoose.connection.db!;
  await db.collection('admininvites').deleteMany({ email: INVITEE_EMAIL });
  await db.collection('users').deleteMany({ email: { $in: [SUPER_ADMIN_EMAIL, INVITEE_EMAIL] } });
  await mongoose.disconnect();
});

test('accepting a real admin invite creates a user with role SUPER_ADMIN, not a 500', async () => {
  // 1. Log in as an existing super admin to get a real session cookie.
  const loginRes = await fetch(`${BASE_URL}/api/admin/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: SUPER_ADMIN_EMAIL, password: SUPER_ADMIN_PASSWORD }),
  });
  assert.equal(loginRes.status, 200, 'super admin login should succeed');
  const cookie = loginRes.headers.get('set-cookie') || '';
  assert.ok(cookie.length > 0, 'login should set a session cookie');

  // 2. Create a real invite as that super admin.
  const inviteRes = await fetch(`${BASE_URL}/api/admin/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ email: INVITEE_EMAIL }),
  });
  assert.equal(inviteRes.status, 200, 'invite creation should succeed');
  const inviteBody = await inviteRes.json();
  const token = inviteBody?.data?.invite?.token;
  assert.ok(typeof token === 'string' && token.length > 0, 'response should include a real invite token');

  // 3. Accept the invite — this is the exact call that used to 500 because
  // the route wrote role: 'super_admin' against an enum that only allows
  // 'SUPER_ADMIN'.
  const acceptRes = await fetch(`${BASE_URL}/api/admin/invites/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, name: 'QA Invite Test Invitee', password: 'doesntmatterInvitee1!' }),
  });
  assert.notEqual(acceptRes.status, 500, 'accepting a valid invite must never 500');
  assert.equal(acceptRes.status, 200, 'accepting a valid invite should succeed');
  const acceptBody = await acceptRes.json();
  assert.equal(acceptBody.success, true);

  // 4. The actual regression check: the User document that was created has
  // the schema-valid role, and can therefore pass requireSuperAdmin() checks.
  const db = mongoose.connection.db!;
  const created = await db.collection('users').findOne({ email: INVITEE_EMAIL });
  assert.ok(created, 'invite acceptance should have created a User document');
  createdInviteeId = created!._id;
  assert.equal(created!.role, 'SUPER_ADMIN', 'created user must have the schema-valid role, not lowercase');

  // 5. The invite itself should be marked accepted, and can't be replayed.
  const invite = await db.collection('admininvites').findOne({ email: INVITEE_EMAIL });
  assert.equal(invite?.status, 'accepted');

  const replayRes = await fetch(`${BASE_URL}/api/admin/invites/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, name: 'Replay Attempt', password: 'irrelevant1!' }),
  });
  assert.equal(replayRes.status, 400, 'an already-accepted invite must not be usable a second time');
});
