/**
 * Growth Partner program — pure rules (application form, per-partner terms,
 * partner codes, invite status).
 * Run: node --experimental-strip-types --test tests/integration/growth-partner-rules.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  validatePartnerApplication,
  validatePartnerTerms,
  normalizeWebsite,
  generatePartnerCode,
  effectivePartnerInviteStatus,
  partnerInvitePath,
  escapeHtml,
  partnerLoginPhone,
} from '../../src/lib/partners/partnerRules.ts';
import { normalizePhoneE164 } from '../../src/lib/phone.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const VALID = {
  fullName: '  Asha   Verma ',
  email: 'Asha@Agency.IN ',
  phone: '+91 98765 43210',
  companyName: 'Bright Local Media',
  website: 'brightlocal.in',
  city: 'Pune',
  state: 'Maharashtra',
  applicantType: 'agency',
  message: '',
};

test('application: valid input is normalised', () => {
  const r = validatePartnerApplication(VALID);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.fullName, 'Asha Verma');
  assert.equal(r.value.email, 'asha@agency.in');
  assert.equal(r.value.phone, '+919876543210');
  assert.equal(r.value.website, 'https://brightlocal.in');
  assert.equal(r.value.message, null);
});

test('application: website is optional, but a junk one is rejected', () => {
  const noSite = validatePartnerApplication({ ...VALID, website: '' });
  assert.ok(noSite.ok && noSite.value.website === null);
  assert.equal(validatePartnerApplication({ ...VALID, website: 'not a site' }).ok, false);
  assert.equal(validatePartnerApplication({ ...VALID, website: 'javascript:alert(1)' }).ok, false);
});

test('application: required fields and types are enforced', () => {
  for (const key of ['fullName', 'email', 'phone', 'companyName', 'city', 'state']) {
    assert.equal(validatePartnerApplication({ ...VALID, [key]: '' }).ok, false, `${key} required`);
  }
  assert.equal(validatePartnerApplication({ ...VALID, email: 'nope' }).ok, false);
  assert.equal(validatePartnerApplication({ ...VALID, applicantType: 'admin' }).ok, false);
  // Mongo operator objects are not strings — they become empty and fail.
  assert.equal(validatePartnerApplication({ ...VALID, email: { $gt: '' } as any }).ok, false);
});

test('terms: all three main values are required, there is no default', () => {
  assert.equal(validatePartnerTerms({}).ok, false);
  assert.equal(validatePartnerTerms({ firstPaymentRate: 30, recurringRate: 15 }).ok, false);
  const r = validatePartnerTerms({ firstPaymentRate: '30', recurringRate: '12.555', holdDays: '15', recurringMonths: '' });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.value, { firstPaymentRate: 30, recurringRate: 12.56, holdDays: 15, recurringMonths: null });
});

test('terms: ranges are enforced; 0 is allowed', () => {
  assert.equal(validatePartnerTerms({ firstPaymentRate: 101, recurringRate: 10, holdDays: 7 }).ok, false);
  assert.equal(validatePartnerTerms({ firstPaymentRate: 30, recurringRate: -1, holdDays: 7 }).ok, false);
  assert.equal(validatePartnerTerms({ firstPaymentRate: 30, recurringRate: 10, holdDays: 7.5 }).ok, false);
  assert.equal(validatePartnerTerms({ firstPaymentRate: 30, recurringRate: 10, holdDays: 400 }).ok, false);
  assert.equal(validatePartnerTerms({ firstPaymentRate: 30, recurringRate: 10, holdDays: 7, recurringMonths: 0 }).ok, false);
  assert.ok(validatePartnerTerms({ firstPaymentRate: 0, recurringRate: 0, holdDays: 0 }).ok);
  const capped = validatePartnerTerms({ firstPaymentRate: 25, recurringRate: 10, holdDays: 30, recurringMonths: 12 });
  assert.ok(capped.ok && capped.value.recurringMonths === 12);
});

test('partner code: GP- plus 6 unambiguous characters', () => {
  const code = generatePartnerCode((n) => new Uint8Array(n).map((_, i) => i * 37));
  assert.match(code, /^GP-[A-HJKMNP-Z2-9]{6}$/);
});

test('invite: status and path', () => {
  const now = new Date('2026-11-11T00:00:00Z');
  assert.equal(effectivePartnerInviteStatus(null, now), 'none');
  assert.equal(effectivePartnerInviteStatus({ status: 'pending', expiresAt: '2026-11-10T00:00:00Z' }, now), 'expired');
  assert.equal(effectivePartnerInviteStatus({ status: 'pending', expiresAt: '2026-11-12T00:00:00Z' }, now), 'pending');
  assert.equal(effectivePartnerInviteStatus({ status: 'accepted', expiresAt: '2026-11-10T00:00:00Z' }, now), 'accepted');
  assert.equal(partnerInvitePath('abc'), '/partner-invite/abc');
});

test('website + html helpers', () => {
  assert.equal(normalizeWebsite('https://www.x.com/'), 'https://www.x.com');
  assert.equal(normalizeWebsite('localhost'), null);
  assert.equal(escapeHtml('<b>"A&B"</b>'), '&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;');
});

test('login phone: the partner User placeholder can never match a real number', () => {
  const placeholder = partnerLoginPhone('GP-7K3DQ2');
  assert.equal(placeholder, 'partner:GP-7K3DQ2');
  assert.equal(normalizePhoneE164(placeholder), null);
  assert.ok(!placeholder.startsWith('+'));
});

// ── Phase 2 guards: a partner login never becomes a customer session ─────

test('guards: customer API guard refuses partner accounts', () => {
  const src = read('src/lib/auth.ts');
  assert.match(src, /role === 'GROWTH_PARTNER'[\s\S]{0,400}PARTNER_ACCOUNT/);
});

test('guards: every customer login method refuses partner accounts', () => {
  assert.match(read('src/lib/authSession.ts'), /role === 'GROWTH_PARTNER'[\s\S]{0,300}status: 403/);
});

test('guards: partner login only accepts partner accounts', () => {
  assert.match(read('src/app/api/partner/auth/route.ts'), /role: 'GROWTH_PARTNER'/);
});

test('guards: /dashboard sends partners to /partner', () => {
  assert.match(read('src/proxy.ts'), /role === 'GROWTH_PARTNER'[\s\S]{0,120}'\/partner'/);
});

test('guards: admin customer lists exclude partners', () => {
  for (const f of [
    'src/app/api/admin/customers/route.ts',
    'src/app/api/admin/subscriptions/route.ts',
    'src/app/api/admin/usage-limits/route.ts',
    'src/app/api/admin/stats/route.ts',
  ]) {
    const src = read(f);
    assert.ok(!src.includes("role: { $ne: 'SUPER_ADMIN' }"), `${f} still counts partners as customers`);
    assert.ok(src.includes("'GROWTH_PARTNER'"), f);
  }
});

test('guards: partner accounts are created with the placeholder phone and a verified email', () => {
  const src = read('src/services/partners/partnerAccount.ts');
  assert.match(src, /phone: partnerLoginPhone\(/);
  assert.match(src, /role: 'GROWTH_PARTNER'/);
  assert.match(src, /email: invite\.email/);
});
