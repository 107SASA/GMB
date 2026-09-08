/**
 * Auth-primitive security tests (pure functions, no DB/server):
 *  - OTP: a wrong or tampered code never verifies; hashing is deterministic
 *    and the compare is constant-time (crypto.timingSafeEqual).
 *  - checkRateLimit: the Nth+1 attempt in a window is blocked, and a
 *    successful reset restores the budget.
 *
 * The account-level lockout, replay ($unset after verify) and per-route
 * wiring are covered by the HTTP suite in api-boundaries.test.ts (needs a
 * running server + DB).
 *
 * Run with: node --test tests/integration/security/otp-and-ratelimit.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateOTP, hashOTP, verifyOTP } from '../../../src/services/auth/otp.ts';
import { checkRateLimit, resetRateLimit } from '../../../src/lib/rateLimit.ts';

test('generateOTP is a 6-digit numeric string', () => {
  for (let i = 0; i < 200; i++) {
    const otp = generateOTP();
    assert.match(otp, /^[0-9]{6}$/);
  }
});

test('verifyOTP accepts the exact code and rejects everything else', () => {
  const otp = '482913';
  const hash = hashOTP(otp);
  assert.equal(verifyOTP(otp, hash), true);
  assert.equal(verifyOTP('482914', hash), false);
  assert.equal(verifyOTP('000000', hash), false);
  assert.equal(verifyOTP(otp + ' ', hash), false);
  assert.equal(verifyOTP('', hash), false);
});

test('hashOTP is deterministic and not the plaintext', () => {
  assert.equal(hashOTP('123456'), hashOTP('123456'));
  assert.notEqual(hashOTP('123456'), '123456');
  assert.match(hashOTP('123456'), /^[0-9a-f]{64}$/);
});

test('checkRateLimit blocks the (limit+1)th attempt inside the window', () => {
  const key = `test:otp-brute:${Date.now()}:${Math.random()}`;
  const LIMIT = 5;
  for (let i = 0; i < LIMIT; i++) {
    assert.equal(checkRateLimit(key, LIMIT, 60_000).allowed, true, `attempt ${i + 1} should be allowed`);
  }
  const blocked = checkRateLimit(key, LIMIT, 60_000);
  assert.equal(blocked.allowed, false, 'the 6th attempt must be blocked');
  assert.ok(blocked.retryAfterSeconds > 0);
});

test('resetRateLimit (called on a successful login) restores the budget', () => {
  const key = `test:otp-reset:${Date.now()}:${Math.random()}`;
  checkRateLimit(key, 2, 60_000);
  checkRateLimit(key, 2, 60_000);
  assert.equal(checkRateLimit(key, 2, 60_000).allowed, false);
  resetRateLimit(key);
  assert.equal(checkRateLimit(key, 2, 60_000).allowed, true);
});
