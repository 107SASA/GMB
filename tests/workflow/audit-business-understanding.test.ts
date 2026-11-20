/**
 * S1–S3 of the free report rebuild (docs/FREE_REPORT_REBUILD_PLAN.md): the
 * AI's answer about a business is checked against the business's own
 * evidence, then turned into keywords picked by real search volume.
 * Cases from the 22 free reports checked in Nov 2026. No AI is called here.
 *
 * Run: npx tsx --test tests/workflow/audit-business-understanding.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUnderstanding, cleanSearchTerm, isGrounded, evidenceStems, isUnderstandingReusable, inputsHash, searchCityName, type UnderstandingInput,
} from '../../src/services/audit/businessUnderstanding';
import { candidatesFromUnderstanding, pickRankChecks, cleanAreas } from '../../src/services/audit/understoodKeywords';

const now = new Date('2026-11-20T10:00:00Z');
const meta = { model: 'test', now };
const base: UnderstandingInput = {
  name: '', city: 'Bengaluru', area: '', primaryCategory: null, additionalCategories: [], placeTypes: [],
  googleDescription: null, ownerDescription: null, addressShown: null, websiteTitle: null, websiteDescription: null, websiteServices: [],
};

const zuper: UnderstandingInput = {
  ...base, name: 'Zuper LED Bangalore', primaryCategory: 'Manufacturer', ownerDescription: 'Led manufacturing',
  websiteTitle: 'Zuper LED - LED video wall and display screens', websiteServices: ['P1.25', 'P1.5', 'P2.5', 'Follow Us'],
};

test('a manufacturer is understood from its description and website, never as "manufacturer"', () => {
  const u = parseUnderstanding({
    industry: 'Business', servedHow: 'online', offered: 'made_to_order', trade: 'LED display manufacturing',
    offerings: [{ name: 'LED video wall', source: 'website' }, { name: 'LED display screens', source: 'website' }, { name: 'solar panels', source: 'none' }],
    searchTerms: ['led display', 'led video wall', 'manufacturer', 'best led screen', 'p1 25', 'zuper led'],
    sameTradeCategories: ['LED sign manufacturer'], confidence: 'high',
  }, zuper, meta)!;
  assert.ok(u);
  assert.deepEqual(u.offerings.map((o) => o.name), ['led video wall', 'led display screens']); // "solar panels" is not in the evidence
  assert.ok(u.searchTerms.includes('led display'));
  assert.ok(!u.searchTerms.includes('manufacturer'), 'a kind-of-business word alone is not a search term');
  assert.ok(!u.searchTerms.some((t) => t.includes('best')), '"best" is never a term');
  assert.ok(!u.searchTerms.includes('zuper led'), 'the brand is not a customer search');
  assert.equal(u.offered, 'made_to_order');
});

test('a hidden address is never a storefront, whatever the AI says', () => {
  const clean: UnderstandingInput = { ...base, name: 'Spark Clean', primaryCategory: 'Janitorial service', addressShown: false };
  const u = parseUnderstanding({ servedHow: 'storefront', offerings: ['deep cleaning'], searchTerms: ['janitorial service', 'deep cleaning'] }, clean, meta)!;
  assert.equal(u.servedHow, 'service_area');
});

test('nothing grounded → no understanding (the category rules run instead)', () => {
  const thin: UnderstandingInput = { ...base, name: 'Pooja Enterprises', primaryCategory: 'Manufacturer' };
  assert.equal(parseUnderstanding({ offerings: ['steel pipes'], searchTerms: ['steel pipes'] }, thin, meta), null);
  assert.equal(parseUnderstanding(null, thin, meta), null);
  assert.equal(parseUnderstanding('rubbish', thin, meta), null);
});

test('search terms lose places, "near me" phrases and kind-only words', () => {
  const opts = { brandWords: ['dabba', 'central'], places: ['Bengaluru', 'BTM Layout'] };
  assert.equal(cleanSearchTerm('Tiffin service Bengaluru', opts), 'tiffin service');
  assert.equal(cleanSearchTerm('tiffin service in BTM Layout', opts), 'tiffin service');
  assert.equal(cleanSearchTerm('tiffin near me', opts), null);
  assert.equal(cleanSearchTerm('Dabba Central', opts), null);
  assert.equal(cleanSearchTerm('wholesaler', opts), null);
  assert.equal(cleanSearchTerm('cashew wholesaler', opts), 'cashew wholesaler');
});

test('grounding uses word stems: "counselling" matches a "Counselor" category', () => {
  const inspiron: UnderstandingInput = { ...base, name: 'Inspiron Psychological Well-Being Centre', primaryCategory: 'Mental health service', additionalCategories: ['Counselor', 'Child psychologist'] };
  const s = evidenceStems(inspiron);
  assert.equal(isGrounded('counselling', s), true);
  assert.equal(isGrounded('psychologist', s), true);
  assert.equal(isGrounded('dental clinic', s), false);
});

test('a saved answer is reused only for the same inputs and within 30 days', () => {
  const u = parseUnderstanding({ offerings: ['led video wall'], searchTerms: ['led display'] }, zuper, meta)!;
  assert.equal(isUnderstandingReusable(u, zuper, new Date(now.getTime() + 86_400_000)), true);
  assert.equal(isUnderstandingReusable(u, { ...zuper, ownerDescription: 'LED signage' }, now), false);
  assert.equal(isUnderstandingReusable(u, zuper, new Date(now.getTime() + 31 * 86_400_000)), false);
  assert.notEqual(inputsHash(zuper), inputsHash({ ...zuper, websiteTitle: 'other' }));
});

test('keywords: city and "near me" for each term, maker shapes for a manufacturer, at most 2 clean areas', () => {
  const areas = cleanAreas(['2nd Stage', 'Peenya, Bengaluru, Karnataka', 'Ward 12', 'Bengaluru', 'Yeshwanthpur', 'Jalahalli'], 'Bengaluru');
  assert.deepEqual(areas, ['peenya', 'yeshwanthpur']);
  const c = candidatesFromUnderstanding({ searchTerms: ['led display', 'led video wall'], offered: 'made_to_order' }, { city: 'Bengaluru', areas });
  const ks = c.map((x) => x.keyword);
  assert.ok(ks.includes('led display bengaluru'));
  assert.ok(ks.includes('led display near me'));
  assert.ok(ks.includes('led display manufacturer bengaluru'));
  assert.ok(ks.includes('led display peenya'));
  assert.ok(!ks.some((k) => /\bbest\b/.test(k)));
});

test('rank checks: city phrases first (most-searched term first), areas only with searches, one "near me"', () => {
  const c = candidatesFromUnderstanding({ searchTerms: ['psychologist', 'counselling centre'], offered: 'services' }, { city: 'Bengaluru', areas: ['indiranagar'] });
  const vol = new Map<string, number | null>([
    ['psychologist bengaluru', 1900], ['psychologist near me', 22200], ['psychologist indiranagar', 90],
    ['counselling centre bengaluru', 320], ['counselling centre near me', 2400], ['counselling centre indiranagar', null],
  ]);
  const { picked, mainTerm } = pickRankChecks(c, vol);
  assert.equal(mainTerm, 'psychologist');
  assert.deepEqual(picked.map((p) => p.keyword), ['psychologist bengaluru', 'counselling centre bengaluru', 'psychologist indiranagar', 'psychologist near me']);
  assert.ok(!picked.some((p) => p.keyword === 'counselling centre indiranagar'), 'an area phrase with no searches is not checked');
});

test('rank checks: a yoga studio is not checked on 6 "near me" phrases (Nov 2026, Mohali)', () => {
  const terms = ['yoga classes', 'meditation classes', 'yoga studio', 'yoga training', 'online yoga', 'personal yoga'];
  const c = candidatesFromUnderstanding({ searchTerms: terms, offered: 'services' }, { city: 'Mohali', areas: [] });
  // Real nationwide volumes from the report; the city phrases had none.
  const vol = new Map<string, number | null>([
    ['yoga classes near me', 246000], ['meditation classes near me', 12100], ['yoga studio near me', 6600],
    ['yoga training near me', 1300], ['online yoga near me', 40], ['personal yoga near me', 20],
  ]);
  const { picked, mainTerm } = pickRankChecks(c, vol);
  assert.equal(picked.filter((p) => p.shape === 'near_me').length, 1);
  assert.equal(picked[0].keyword, 'yoga classes mohali');
  assert.ok(picked.some((p) => p.keyword === 'yoga classes near me'));
  assert.equal(picked.length, 6);
  assert.equal(mainTerm, 'yoga classes');
});

test('the city people search, not the district name in the address', () => {
  assert.equal(searchCityName('Sahibzada Ajit Singh Nagar'), 'Mohali');
  assert.equal(searchCityName('Gautam Buddh Nagar'), 'Noida');
  assert.equal(searchCityName('Rangareddy District'), 'Hyderabad');
  assert.equal(searchCityName('Nashik'), 'Nashik');
});

test('rank checks: with no volume at all, the city phrases still give 3 checks', () => {
  const c = candidatesFromUnderstanding({ searchTerms: ['coir mattress', 'coir products', 'coconut fibre'], offered: 'made_to_order' }, { city: 'Alappuzha', areas: [] });
  const { picked, mainTerm } = pickRankChecks(c, new Map());
  assert.equal(picked.length, 3);
  assert.ok(picked.every((p) => p.shape === 'city' && p.volume == null));
  assert.equal(mainTerm, 'coir mattress');
});

test('the main phrase comes from the 3 main terms, not a side service with big volume', () => {
  const c = candidatesFromUnderstanding({ searchTerms: ['custom software development', 'app development company', 'web development services', 'digital marketing agency'], offered: 'services' }, { city: 'Chennai', areas: [] });
  const vol = new Map<string, number | null>([
    ['custom software development near me', 50], ['app development company chennai', 4400],
    ['web development services near me', 320], ['digital marketing agency near me', 12100],
  ]);
  assert.equal(pickRankChecks(c, vol).mainTerm, 'app development company');
});

test('a term carrying the other name of the city is cleaned ("bangalore tiffin" in Bengaluru)', () => {
  const dabba: UnderstandingInput = { ...base, name: 'The Dabba Central (Tiffin Service)', primaryCategory: 'Tiffin center' };
  const u = parseUnderstanding({ offerings: ['tiffin service'], searchTerms: ['tiffin service', 'bangalore tiffin'] }, dabba, meta)!;
  assert.ok(u.searchTerms.includes('tiffin service'));
  assert.ok(!u.searchTerms.some((t) => t.includes('bangalore')));
});
