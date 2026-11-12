/**
 * Free report must prove the WhatsApp number with a code before any report,
 * shadow account or sales lead is created.
 * Run: node --experimental-strip-types --test tests/integration/free-report-otp.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('start route checks the WhatsApp code before creating anything', () => {
  const src = read('src/app/api/free-report/start/route.ts');
  const check = src.indexOf('checkFreeReportOtp(normalizedPhone');
  assert.ok(check > 0, 'start route must call checkFreeReportOtp');
  assert.ok(check < src.indexOf('provisionShadowAccount({'), 'code check must come before the shadow account');
  assert.ok(check < src.indexOf('fileFreeReportPlatformLead('), 'code check must come before the CRM lead');
  assert.ok(check < src.indexOf('createPendingAuditAndDispatch('), 'code check must come before the audit');
  assert.ok(check < src.indexOf('free-report-phone:'), 'a wrong code must not use up the per-phone report limit');
  assert.match(src, /if \(!otpCheck\.ok\)[\s\S]{0,200}status: 401/);
});

test('code is single-use once a report is returned, and marks the phone verified', () => {
  const src = read('src/app/api/free-report/start/route.ts');
  const successReturns = src.match(/success: true/g)?.length ?? 0;
  const consumes = src.match(/await consumeFreeReportOtp\(normalizedPhone\)/g)?.length ?? 0;
  assert.equal(consumes, successReturns, 'every success return must consume the code');
  assert.match(src, /markPhoneVerified\(user\._id, 'whatsapp_otp'\)/);
});

test('send-otp route is rate limited per IP and per phone', () => {
  const src = read('src/app/api/free-report/send-otp/route.ts');
  assert.match(src, /free-report-otp-ip:/);
  assert.match(src, /free-report-otp-phone:/);
  assert.match(src, /free-report-otp-phone-day:/);
});

test('code checker limits wrong attempts and stores only a hash', () => {
  const src = read('src/services/auth/freeReportOtp.ts');
  assert.match(src, /MAX_WRONG_ATTEMPTS = 5/);
  assert.match(src, /codeHash: hashOTP\(otp\)/);
  assert.doesNotMatch(read('src/models/PhoneOtpChallenge.ts'), /\bcode: \{/);
});

test('free report form sends the code with the report request', () => {
  const src = read('src/app/free-report/page.tsx');
  assert.match(src, /\/api\/free-report\/send-otp/);
  assert.match(src, /phone,\s*otp,/);
});
