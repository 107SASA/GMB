/**
 * Free-report keywords from the business's own services, picked by search
 * volume; vague categories never become keywords when services exist; no
 * advice to put keywords in the business name.
 * Run: node --experimental-strip-types --test tests/integration/free-report-keywords.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freeReportServices, freeReportCandidates, candidateVolumes, pickFreeReportChecks,
} from '../../src/services/seo/freeReportKeywords.ts';
import { advisesKeywordInName } from '../../src/services/audit/validateAudit.ts';

const MULSETU = ['AI & Automation', 'Website Development', 'SaaS Development', 'Custom Software & ERP', 'Mobile App Development', 'MVP Development'];

test('website services become the keywords; a vague "Shop" / "Service" category is dropped', () => {
  for (const category of ['Shop', 'Service', 'Store', 'Office']) {
    const c = freeReportCandidates({ businessName: 'Mulsetu', city: 'Nashik', areas: ['Ojhar'], category, websiteServices: MULSETU });
    assert.ok(c.length > 0);
    assert.ok(!c.some((k) => /\b(shop|service|store|office)\b/.test(k.keyword)), `no "${category}" keyword: ${c.map((k) => k.keyword)}`);
    assert.ok(c.some((k) => k.keyword === 'website development nashik'));
    assert.ok(c.some((k) => k.keyword === 'ai and automation ojhar'));
  }
});

test('"near me" is built for every service, not only the first two', () => {
  const c = freeReportCandidates({ businessName: 'Mulsetu', city: 'Nashik', areas: [], category: null, websiteServices: MULSETU });
  for (const s of ['ai and automation', 'website development', 'mvp development']) {
    assert.ok(c.some((k) => k.keyword === `${s} near me`), s);
  }
});

test('a trade category is kept: "Mobile phone shop", "Hardware store"', () => {
  assert.ok(freeReportServices({ websiteServices: ['Screen repair'], category: 'Mobile phone shop' }).some((s) => s.name === 'mobile phone shop'));
  assert.ok(freeReportServices({ websiteServices: [], category: 'Hardware store' }).some((s) => s.name === 'hardware store'));
});

test('a vague category is used only when the website names nothing', () => {
  assert.deepEqual(freeReportServices({ websiteServices: [], category: 'Shop' }).map((s) => s.name), ['shop']);
});

test('the highest-demand phrase is checked first, and every service gets a phrase before any gets two', () => {
  const c = freeReportCandidates({ businessName: 'Mulsetu', city: 'Nashik', areas: ['Ojhar'], category: null, websiteServices: MULSETU });
  const vol = new Map<string, number | null>(c.map((k) => [k.keyword, null]));
  vol.set('website development near me', 9900);
  vol.set('website development nashik', 50);
  vol.set('mobile app development near me', 1300);
  const picked = pickFreeReportChecks(c, candidateVolumes(c, { country: vol }, 'now'), 8);
  assert.equal(picked[0].keyword, 'website development near me');
  assert.equal(picked.length, 8);
  const firstSix = new Set(picked.slice(0, 6).map((k) => k.serviceId));
  assert.equal(firstSix.size, 6, 'one phrase per service first');
  assert.ok(picked.slice(0, 6).some((k) => k.keyword === 'mobile app development near me'));
});

test('no services and no category → nothing to search (never the brand name)', () => {
  assert.deepEqual(freeReportCandidates({ businessName: 'Mulsetu', city: 'Nashik', areas: [], category: null, websiteServices: [] }), []);
});

test('advice to put keywords in the business name is caught; real advice is not', () => {
  assert.ok(advisesKeywordInName('Update the GBP title and description to include the exact phrase "shop nashik" and align the primary category.'));
  assert.ok(advisesKeywordInName('Optimize the GBP title and description with the exact phrase "shop nashik".'));
  assert.ok(advisesKeywordInName('Add the keyword dentist to your business name.'));
  assert.ok(!advisesKeywordInName('Add the business phone number to the Google Business Profile.'));
  assert.ok(!advisesKeywordInName('Use "website development nashik" in your website page title.'));
  assert.ok(!advisesKeywordInName('Keep your business name the same on every directory.'));
  assert.ok(!advisesKeywordInName('Create a Google Post targeting "website development near me".'));
});
