/**
 * HTTP-level security-boundary tests — the authentication / authorization /
 * webhook / injection guarantees from the security audit.
 *
 * These hit the REAL routes over HTTP (same reasoning as
 * admin-invite-accept.test.ts: this repo has no Jest/Vitest + `@/` alias
 * resolution, and testing an API route at its HTTP edge is the right level
 * anyway).
 *
 * PREREQUISITES:
 *   1. `npm run dev` running on http://localhost:3000
 *   2. MONGODB_URI reachable
 * If the server is not up, every test here is SKIPPED (not failed) so a
 * lint/typecheck/CI run without a live stack stays green.
 *
 * Run with: node --test tests/integration/security/api-boundaries.test.ts
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://localhost:3000';
let serverUp = false;

before(async () => {
  try {
    const r = await fetch(`${BASE}/api/auth/me`, { signal: AbortSignal.timeout(2000) });
    serverUp = r.status === 200 || r.status === 401; // route responded
  } catch {
    serverUp = false;
  }
  if (!serverUp) {
    console.warn('[api-boundaries] dev server not reachable on :3000 — skipping HTTP security tests.');
  }
});

const j = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ---- Authentication --------------------------------------------------------

test('unauthenticated request to an authed route → 401', async (t) => {
  if (!serverUp) return t.skip('dev server not reachable');
  const r = await fetch(`${BASE}/api/user/profile`);
  assert.equal(r.status, 401);
});

test('unauthenticated request to a business route → 401/400 (never 200)', async (t) => {
  if (!serverUp) return t.skip('dev server not reachable');
  const r = await fetch(`${BASE}/api/crm/leads`);
  assert.notEqual(r.status, 200);
});

test('invalid session cookie → 401 (not a 500, not accepted)', async (t) => {
  if (!serverUp) return t.skip('dev server not reachable');
  const r = await fetch(`${BASE}/api/user/profile`, { headers: { Cookie: 'session=not-a-real-jwt' } });
  assert.equal(r.status, 401);
});

// ---- Authorization / admin ------------------------------------------------

test('unauthenticated → admin API → 401/403 (never 200)', async (t) => {
  if (!serverUp) return t.skip('dev server not reachable');
  for (const path of ['/api/admin/customers', '/api/admin/revenue', '/api/admin/stats']) {
    const r = await fetch(`${BASE}${path}`);
    assert.ok(r.status === 401 || r.status === 403, `${path} returned ${r.status}`);
  }
});

test('unauthenticated → admin impersonate → rejected, no cookie set', async (t) => {
  if (!serverUp) return t.skip('dev server not reachable');
  const r = await fetch(`${BASE}/api/admin/impersonate`, j({ businessId: '000000000000000000000000' }));
  assert.ok(r.status === 401 || r.status === 403);
  assert.equal(r.headers.get('set-cookie'), null);
});

// ---- Injection (SEC-1) ---------------------------------------------------

test('object as invite token → 400 (NoSQL operator not used as a query)', async (t) => {
  if (!serverUp) return t.skip('dev server not reachable');
  const r = await fetch(`${BASE}/api/admin/invites/accept`, j({
    token: { $gte: '' }, name: 'x', password: 'Str0ng!Pass1',
  }));
  assert.equal(r.status, 400);
});

test('array as invite token → 400', async (t) => {
  if (!serverUp) return t.skip('dev server not reachable');
  const r = await fetch(`${BASE}/api/admin/invites/accept`, j({
    token: ['a', 'b'], name: 'x', password: 'Str0ng!Pass1',
  }));
  assert.equal(r.status, 400);
});

test('login with an operator object as email → rejected (coerced/validated, not injected)', async (t) => {
  if (!serverUp) return t.skip('dev server not reachable');
  const r = await fetch(`${BASE}/api/auth/login`, j({ email: { $ne: null }, password: { $ne: null } }));
  assert.notEqual(r.status, 200);
});

// ---- Webhooks -----------------------------------------------------------

test('Razorpay webhook without a signature → 403', async (t) => {
  if (!serverUp) return t.skip('dev server not reachable');
  const r = await fetch(`${BASE}/api/webhook/razorpay`, j({ event: 'subscription.activated' }));
  assert.equal(r.status, 403);
});

test('Razorpay webhook with a bogus signature → 403', async (t) => {
  if (!serverUp) return t.skip('dev server not reachable');
  const r = await fetch(`${BASE}/api/webhook/razorpay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'deadbeef' },
    body: JSON.stringify({ event: 'subscription.activated' }),
  });
  assert.equal(r.status, 403);
});

test('Meta webhook GET with a wrong verify_token → 403', async (t) => {
  if (!serverUp) return t.skip('dev server not reachable');
  const r = await fetch(`${BASE}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123`);
  assert.equal(r.status, 403);
});

// Rate-limit XFF-spoofing resistance is proven deterministically at the unit
// level in client-ip.test.ts (getClientIp uses the Nginx-appended last hop /
// X-Real-IP, never the attacker-controlled prefix). An HTTP version needs a
// controlled proxy topology, so it is not duplicated here.
