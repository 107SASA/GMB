/**
 * Free account sign-up — Phase 1 (server). docs/FREE_ACCOUNT_REGISTRATION_PLAN.md
 * Run: node --experimental-strip-types --test tests/integration/free-account-signup.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { freeCrmAccessReplyText, appAccessReplyText } from '../../src/services/whatsapp/appAccessHelp.ts';
import { freeAccountCallReasons } from '../../src/services/leads/freeAccountSignals.ts';
import { isStaleShadowAccount, shadowCleanupModeFromEnv } from '../../src/services/account/shadowCleanup.ts';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('sign-up: the WhatsApp code is checked before any account is touched or anyone is logged in', () => {
  const src = read('src/app/api/auth/signup/route.ts');
  const check = src.indexOf("checkPhoneOtp(phone, String(body.otp || ''), 'signup')");
  assert.ok(check > 0, 'sign-up must check a signup-purpose code');
  assert.ok(check < src.indexOf('registerFreeAccount('), 'code before creating the account');
  assert.ok(check < src.lastIndexOf('finalizeLogin('), 'code before the normal login');
  // The only earlier login: the store-reviewer number with its fixed code (lib/reviewerAccount.ts).
  assert.match(src, /isReviewerUser\(reviewer\.user\) && isReviewerOtp\(/);
  assert.ok(src.indexOf('finalizeLogin(') > src.indexOf('isReviewerOtp('));
  assert.ok(src.indexOf('registerFreeAccount(') < src.indexOf("consumePhoneOtp(phone, 'signup')"), 'code used up only after success');
  assert.match(src, /if \(!otpCheck\.ok\)[\s\S]{0,200}status: 401/);
});

test('sign-up: codes are rate limited per IP and per number, and respect the admin switch', () => {
  const src = read('src/app/api/auth/signup/send-otp/route.ts');
  for (const key of ['signup-otp-ip:', 'signup-otp-phone:', 'signup-otp-phone-day:']) assert.ok(src.includes(key), key);
  assert.match(src, /getFreeSignupSettings\(\)\)\.enabled/);
  assert.match(src, /sendPhoneOtp\(phone, 'signup'\)/);
});

test('sign-up: a verified free account is a real account (no longer shadow), filed for sales, report started', () => {
  const src = read('src/services/auth/freeAccount.ts');
  assert.match(src, /isShadowAccount: false/);
  assert.match(src, /phoneVerified: true/);
  assert.match(src, /fileSignupPlatformLead\(/);
  assert.match(src, /startOrReuseFreeReport\(/);
  // An established account is never modified — only logged in.
  assert.ok(src.indexOf("outcome: 'existing'") < src.indexOf('provisionShadowAccount('));
});

test('OTP purposes are separate (a sign-up code cannot open a free report and vice versa)', () => {
  assert.match(read('src/models/PhoneOtpChallenge.ts'), /enum: \['free_report', 'signup'\]/);
});

test('in-app free report: starting one is for Free CRM workspaces only; the full report opens in app mode', () => {
  const src = read('src/app/api/app/free-report/route.ts');
  assert.ok(src.indexOf('freeCrmAllowed(') < src.indexOf('startOrReuseFreeReport('));
  assert.match(src, /reportShareLink\(audit\._id, userId, \{ app: true \}\)/);
  const page = read('src/app/reports/[token]/page.tsx');
  assert.match(page, /get\('app'\) === '1'/);
  assert.match(page, /\{!appMode && \(/);
});

test('WhatsApp: free accounts get their own reply (report + plans), not "complete your payment"', () => {
  const free = freeCrmAccessReplyText({ reportUrl: 'https://x/reports/abc', subscribeUrl: 'https://x/pricing' });
  assert.match(free, /free CRM and visiting-card scan are active/);
  assert.match(free, /https:\/\/x\/reports\/abc/);
  assert.match(free, /https:\/\/x\/pricing/);
  assert.doesNotMatch(free, /complete your payment/i);
  assert.match(appAccessReplyText('https://x/pricing'), /complete your payment/i); // unchanged for checkout drop-offs
  const hook = read('src/app/api/whatsapp/webhook/route.ts');
  assert.ok(hook.indexOf('freeCrmContextForPhone(') < hook.indexOf('appAccessReplyText(config?.subscribeUrl)'));
});

// ── Phase 3 ──────────────────────────────────────────────────────────────

const NOW = new Date('2026-11-13T10:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

test('needs a call: unlock request, low score, heavy scanning, near lead cap, regular use', () => {
  const base = { reportScore: 75, scansThisMonth: 5, maxScansPerMonth: 50, activeLeads: 20, maxActiveLeads: 200, activeDaysLast7: 1, unlockRequestedAt: null, now: NOW };
  assert.deepEqual(freeAccountCallReasons(base), []);
  const all = freeAccountCallReasons({ ...base, reportScore: 41, scansThisMonth: 40, activeLeads: 185, activeDaysLast7: 4, unlockRequestedAt: daysAgo(2) });
  assert.equal(all.length, 5);
  assert.match(all[0], /Asked to unlock/);
  // An old unlock request (> 14 days) no longer counts; unlimited caps never trigger.
  assert.deepEqual(freeAccountCallReasons({ ...base, unlockRequestedAt: daysAgo(20), maxScansPerMonth: -1, maxActiveLeads: -1, scansThisMonth: 999, activeLeads: 999 }), []);
});

test('shadow clean-up: only never-verified, never-paid, inactive 90+ day customer shadow accounts', () => {
  const stale = { isShadowAccount: true, role: 'CLIENT', createdAt: daysAgo(120), lastLoginAt: null, lastSeenAt: null };
  assert.equal(isStaleShadowAccount(stale, [{ subscriptionStatus: 'trialing' }], NOW), true);
  assert.equal(isStaleShadowAccount({ ...stale, phoneVerifiedAt: daysAgo(100) }, [], NOW), false); // verified → real person
  assert.equal(isStaleShadowAccount({ ...stale, isShadowAccount: false }, [], NOW), false); // real account
  assert.equal(isStaleShadowAccount({ ...stale, role: 'SUPER_ADMIN' }, [], NOW), false);
  assert.equal(isStaleShadowAccount({ ...stale, createdAt: daysAgo(30) }, [], NOW), false); // too new
  assert.equal(isStaleShadowAccount({ ...stale, lastLoginAt: daysAgo(10) }, [], NOW), false); // active
  assert.equal(isStaleShadowAccount(stale, [{ subscriptionStatus: 'canceled' }], NOW), false); // paid once
  assert.equal(isStaleShadowAccount(stale, [{ razorpaySubscriptionId: 'sub_x' }], NOW), false);
  assert.equal(isStaleShadowAccount(stale, [{ trialStartedAt: daysAgo(100) }], NOW), false);
});

test('shadow clean-up is a dry run unless SHADOW_CLEANUP_MODE=live, and never deletes data in use', () => {
  const prev = process.env.SHADOW_CLEANUP_MODE;
  delete process.env.SHADOW_CLEANUP_MODE;
  assert.equal(shadowCleanupModeFromEnv(), 'dry_run');
  process.env.SHADOW_CLEANUP_MODE = 'live';
  assert.equal(shadowCleanupModeFromEnv(), 'live');
  if (prev === undefined) delete process.env.SHADOW_CLEANUP_MODE; else process.env.SHADOW_CLEANUP_MODE = prev;
  const src = read('src/services/account/shadowCleanup.ts');
  assert.ok(src.indexOf('Lead.exists(') < src.indexOf('softDeleteAccount('), 'accounts with CRM leads are skipped');
  // The account deletion and the clean-up share one soft-delete.
  assert.match(read('src/app/api/user/delete-account/route.ts'), /softDeleteAccount\(/);
  assert.match(read('src/services/account/softDelete.ts'), /role === 'SUPER_ADMIN'/);
});

test('website: sign-up page, login and Pricing point to the free account', () => {
  assert.match(read('src/app/(auth)/signup/SignupForm.tsx'), /channel: 'website'/);
  assert.match(read('src/app/(auth)/login/LoginForm.tsx'), /href="\/signup"/);
  assert.match(read('src/components/sections/pricing/PricingCards.tsx'), /href="\/signup"/);
});

test('admin: free-account filter + call reasons on Leads; funnel is super-admin only', () => {
  assert.match(read('src/services/admin/conversionReport.ts'), /freeAccount'/);
  assert.match(read('src/services/admin/pipelineQuery.ts'), /'freeAccount\.callReasons\.0'/);
  assert.match(read('src/app/api/admin/free-accounts/funnel/route.ts'), /requireSuperAdmin\(\)/);
});
