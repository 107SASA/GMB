/**
 * SEC-4 — server-side session invalidation.
 *
 * Pure-function test of the epoch-comparison predicate that requireClient(),
 * requireSuperAdmin() and proxy.ts all use. The end-to-end flow (reset
 * password -> old cookie 401s -> re-login works) is in api-boundaries.test.ts
 * (needs a running server).
 *
 * Run with: node --test tests/integration/security/session-epoch.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSessionEpochValid } from '../../../src/lib/sessionEpoch.ts';

test('matching epoch → valid', () => {
  const now = Date.now();
  assert.equal(isSessionEpochValid(now, now), true);
});

test('a token from BEFORE an invalidation is rejected', () => {
  const issuedAt = 0;              // pre-feature token / never-invalidated user
  const afterInvalidation = Date.now(); // invalidateUserSessions() bumped it
  assert.equal(isSessionEpochValid(issuedAt, afterInvalidation), false);
});

test('a token issued AFTER the invalidation (re-login) is accepted', () => {
  const epoch = Date.now();
  // finalizeLogin embeds the user's current epoch → they match
  assert.equal(isSessionEpochValid(epoch, epoch), true);
});

test('bootstrap: pre-migration user (no field) + pre-feature token (no claim) both = 0 → valid', () => {
  assert.equal(isSessionEpochValid(undefined, undefined), true);
  assert.equal(isSessionEpochValid(0, undefined), true);
  assert.equal(isSessionEpochValid(undefined, 0), true);
});

test('pre-feature token (0) against a user who HAS been invalidated → rejected', () => {
  assert.equal(isSessionEpochValid(undefined, 1_726_000_000_000), false);
  assert.equal(isSessionEpochValid(0, 1_726_000_000_000), false);
});

test('two different invalidations never collide (timestamps are monotonic-ish)', () => {
  const a = 1_726_000_000_000;
  const b = 1_726_000_000_050;
  assert.equal(isSessionEpochValid(a, b), false);
});
