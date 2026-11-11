/**
 * Growth Partner referral links — cookie rules, attribution window, and
 * which partner leads stay AI-free.
 * Run: node --experimental-strip-types --test tests/integration/growth-partner-referral.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  REF_MAX_AGE_SECONDS,
  createdAfterClick,
  encodeRef,
  isPartnerManagedLead,
  normalizePartnerCode,
  parseRef,
  referralLinkPath,
  safeRedirectPath,
  shouldSetRef,
} from '../../src/lib/partners/referral.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);

test('codes: GP- + 6 unambiguous characters, case-insensitive', () => {
  assert.equal(normalizePartnerCode(' gp-7k3dq2 '), 'GP-7K3DQ2');
  assert.equal(normalizePartnerCode('GP-7K3DQ0'), null, 'no 0/O/1/I/L');
  assert.equal(normalizePartnerCode({ $ne: '' } as any), null);
  assert.equal(referralLinkPath('GP-7K3DQ2'), '/p/GP-7K3DQ2');
});

test('cookie: round-trips, expires after 30 days, rejects tampering', () => {
  const v = encodeRef('GP-7K3DQ2', NOW - 1000);
  const parsed = parseRef(v, NOW);
  assert.ok(parsed && parsed.code === 'GP-7K3DQ2');
  assert.equal(parseRef(encodeRef('GP-7K3DQ2', NOW - REF_MAX_AGE_SECONDS * 1000 - 1), NOW), null, 'older than 30 days');
  assert.equal(parseRef(encodeRef('GP-7K3DQ2', NOW + 3_600_000), NOW), null, 'from the future');
  assert.equal(parseRef('GP-7K3DQ2', NOW), null);
  assert.equal(parseRef('junk.123', NOW), null);
});

test('first partner wins: a valid cookie is never replaced', () => {
  assert.equal(shouldSetRef(undefined, NOW), true);
  assert.equal(shouldSetRef(encodeRef('GP-7K3DQ2', NOW - 86_400_000), NOW), false);
  assert.equal(shouldSetRef(encodeRef('GP-7K3DQ2', NOW - 31 * 86_400_000), NOW), true, 'expired cookie can be replaced');
});

test('only new business is credited', () => {
  const click = new Date(NOW);
  assert.equal(createdAfterClick(new Date(NOW + 5_000), click), true);
  assert.equal(createdAfterClick(new Date(NOW - 30_000), click), true, 'a minute of clock slack');
  assert.equal(createdAfterClick(new Date(NOW - 3_600_000), click), false, 'existed before the click');
  assert.equal(createdAfterClick(null, click), false);
});

test('redirect target: same-site paths only', () => {
  assert.equal(safeRedirectPath('/free-report'), '/free-report');
  assert.equal(safeRedirectPath('https://evil.example'), '/');
  assert.equal(safeRedirectPath('//evil.example'), '/');
  assert.equal(safeRedirectPath('/\\evil.example'), '/');
  assert.equal(safeRedirectPath(undefined), '/');
});

test('partner-managed vs referral leads', () => {
  assert.equal(isPartnerManagedLead({ partnerId: 'x', partnerSource: 'added' }), true);
  assert.equal(isPartnerManagedLead({ partnerId: 'x', partnerSource: null }), true, 'unknown source is the safe default (AI off)');
  assert.equal(isPartnerManagedLead({ partnerId: 'x', partnerSource: 'referral' }), false, 'referral leads keep our funnel');
  assert.equal(isPartnerManagedLead({ partnerId: null }), false);
});

test('attribution: only unassigned records created after the click; referral leads keep the funnel', () => {
  const src = read('src/services/partners/referralAttribution.ts');
  assert.match(src, /status: 'active'/, 'only active partners get credit');
  assert.match(src, /lead\.partnerId\) return false/);
  assert.match(src, /createdAfterClick\(lead\.createdAt, ref\.clickedAt\)/);
  assert.match(src, /\{ _id: lead\._id, partnerId: null \}/, 'atomic: never overwrites another partner');
  assert.match(src, /partnerSource: 'referral'/);
  assert.doesNotMatch(src, /currentAgent|nurtureStatus/, 'referral attribution never changes who handles the lead');
  assert.match(src, /\{ _id: business\._id, partnerId: null \}/);
});

test('attribution is wired into the free report, demo booking and sign-up', () => {
  assert.match(read('src/app/api/free-report/start/route.ts'), /attributeLeadFromReferral[\s\S]{0,300}attributeBusinessFromReferral\(business\._id\)/);
  assert.match(read('src/app/api/leads/book-demo/route.ts'), /attributeLeadFromReferral\(lead\._id\)/);
  assert.match(read('src/app/api/onboarding/route.ts'), /attributeBusinessFromReferral\(newBusiness\._id\)/);
});

test('partners can’t edit or move referral leads (our team runs them)', () => {
  const src = read('src/services/partners/partnerLeads.ts');
  const update = src.slice(src.indexOf('export async function updatePartnerLead'), src.indexOf('export async function addPartnerNote'));
  assert.match(update, /partnerSource === 'referral'[\s\S]{0,200}fail\(409/);
});
