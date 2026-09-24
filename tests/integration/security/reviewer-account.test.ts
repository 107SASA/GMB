/**
 * App-store reviewer login bypass — must be off by default, match only the
 * configured number, never apply to an admin, and leave the normal OTP flow,
 * rate limits and lockout untouched.
 *
 * Run with: node --test tests/integration/security/reviewer-account.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getReviewerConfig, isReviewerOtp, isReviewerPhone, isReviewerUser } from '../../../src/lib/reviewerAccount.ts';

const REVIEWER = '+919876543210';
const OLD_REAL_ACCOUNT = '+919730986643'; // real account — must never become the reviewer

function withEnv(phone: string | undefined, otp: string | undefined, fn: () => void) {
  const p = process.env.REVIEWER_PHONE, o = process.env.REVIEWER_OTP;
  if (phone === undefined) delete process.env.REVIEWER_PHONE; else process.env.REVIEWER_PHONE = phone;
  if (otp === undefined) delete process.env.REVIEWER_OTP; else process.env.REVIEWER_OTP = otp;
  try { fn(); } finally {
    if (p === undefined) delete process.env.REVIEWER_PHONE; else process.env.REVIEWER_PHONE = p;
    if (o === undefined) delete process.env.REVIEWER_OTP; else process.env.REVIEWER_OTP = o;
  }
}

test('disabled when env vars are unset (or only one is set)', () => {
  withEnv(undefined, undefined, () => {
    assert.equal(getReviewerConfig(), null);
    assert.equal(isReviewerPhone(REVIEWER), false);
    assert.equal(isReviewerOtp('000000'), false);
    assert.equal(isReviewerUser({ phone: REVIEWER, role: 'CLIENT' }), false);
  });
  withEnv('9876543210', undefined, () => assert.equal(getReviewerConfig(), null));
  withEnv(undefined, '000000', () => assert.equal(getReviewerConfig(), null));
});

test('non-6-digit REVIEWER_OTP disables the bypass entirely', () => {
  for (const bad of ['0000', '00000', '0000000', 'abcdef', '00 000']) {
    withEnv('9876543210', bad, () => {
      assert.equal(getReviewerConfig(), null, `otp "${bad}"`);
      assert.equal(isReviewerPhone(REVIEWER), false);
      assert.equal(isReviewerUser({ phone: REVIEWER, role: 'CLIENT' }), false);
    });
  }
});

test('works only for 9876543210 with 000000', () => {
  withEnv('9876543210', '000000', () => {
    assert.equal(getReviewerConfig()?.phone, REVIEWER);
    assert.equal(isReviewerPhone(REVIEWER), true);
    assert.equal(isReviewerOtp('000000'), true);
    assert.equal(isReviewerUser({ phone: REVIEWER, role: 'CLIENT' }), true);
  });
  withEnv('+919876543210', '000000', () => assert.equal(getReviewerConfig()?.phone, REVIEWER));
});

test('4-digit or wrong code is rejected', () => {
  withEnv('9876543210', '000000', () => {
    assert.equal(isReviewerOtp('0000'), false);
    assert.equal(isReviewerOtp('123456'), false);
    assert.equal(isReviewerOtp(''), false);
  });
});

test('the old real account (9730986643) and other numbers are not the reviewer', () => {
  withEnv('9876543210', '000000', () => {
    assert.equal(isReviewerPhone(OLD_REAL_ACCOUNT), false);
    assert.equal(isReviewerUser({ phone: OLD_REAL_ACCOUNT, role: 'CLIENT' }), false);
    assert.equal(isReviewerUser({ phone: '+919999999999', role: 'CLIENT' }), false);
    assert.equal(isReviewerUser({ phone: '9876543210', role: 'CLIENT' }), false); // legacy non-E.164 record never qualifies
  });
});

test('never applies to an admin account', () => {
  withEnv('9876543210', '000000', () => {
    assert.equal(isReviewerUser({ phone: REVIEWER, role: 'SUPER_ADMIN' }), false);
    assert.equal(isReviewerUser({ phone: REVIEWER, role: undefined }), false);
  });
});

// ---- route wiring (static): the bypass must sit AFTER rate limit + lockout,
// and the normal OTP branch must still be present. ----
const read = (p: string) => fs.readFileSync(path.resolve(import.meta.dirname, '../../../', p), 'utf8');

test('request route: rate limit + lockout run before the reviewer short-circuit; normal send intact', () => {
  const src = read('src/app/api/auth/phone-login/request/route.ts');
  const rl = src.indexOf('checkRateLimit(');
  const lock = src.indexOf('accountLockedUntil');
  const bypass = src.indexOf('isReviewerUser(user)');
  const gen = src.indexOf('generateOTP()');
  assert.ok(rl > -1 && lock > -1 && bypass > -1 && gen > -1);
  assert.ok(rl < bypass && lock < bypass, 'bypass must come after rate limit and lockout');
  assert.ok(bypass < gen, 'reviewer returns before a real OTP is generated/sent');
  assert.ok(src.includes('sendOtpMessage('), 'normal WhatsApp send still present');
});

test('verify route: rate limit + lockout + failed-attempt counting intact; normal OTP check still present', () => {
  const src = read('src/app/api/auth/phone-login/verify/route.ts');
  assert.ok(src.indexOf('checkRateLimit(') < src.indexOf('isReviewerUser(user)'));
  assert.ok(src.indexOf('accountLockedUntil') < src.indexOf('isReviewerUser(user)'));
  assert.ok(src.includes('verifyOTP(String(otp), user.phoneOtpHash)'), 'normal hash check present');
  assert.ok(src.includes('ACCOUNT_LOCK_THRESHOLD'), 'lockout still applies to failed attempts');
  assert.ok(src.includes('finalizeLogin('), 'reviewer goes through the real session issuance');
});

test('reviewer env vars are backend-only: not referenced in the mobile app or any NEXT_PUBLIC var', () => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.name === 'node_modules' || e.name === '.expo') return [];
      const f = path.join(dir, e.name);
      return e.isDirectory() ? walk(f) : /\.(tsx?|jsx?|json|js)$/.test(e.name) ? [f] : [];
    });
  const root = path.resolve(import.meta.dirname, '../../../');
  for (const f of [...walk(path.join(root, 'mobile', 'src')), ...walk(path.join(root, 'src', 'components'))]) {
    const txt = fs.readFileSync(f, 'utf8');
    assert.ok(!/REVIEWER_(PHONE|OTP)/.test(txt), `${f} references reviewer env`);
  }
  assert.ok(!/NEXT_PUBLIC_REVIEWER|EXPO_PUBLIC_REVIEWER/.test(read('src/lib/reviewerAccount.ts')));
});
