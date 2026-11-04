/**
 * Competitor relevance + search term for businesses whose Google category is
 * generic. Built from a real free report (Durva Fireworks, Janori, 3 Nov 2026):
 * Google category "Store", 9 "store …" searches, 25 businesses above it — of
 * which only "Matoshree Fireworks (Ozar Branch)" (also categorised "Store")
 * sells fireworks.
 *
 * Run: npx tsx --test tests/workflow/audit-competitor-relevance.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTradeProfile, classifyCompetitor, specificWords } from '../../src/services/audit/competitorRelevance';
import { resolveSearchCategory } from '../../src/services/audit/seoAnalyzer';
import { buildFreeReportKeywords } from '../../src/services/audit/keywordSeeds';

// ── Search term ─────────────────────────────────────────────────────────────

test('weak category + trade in the name: "Durva Fireworks" / Store is searched as "Fireworks Store"', () => {
  assert.equal(resolveSearchCategory('Store', 'Durva Fireworks', ['Janori', 'MIDC', '']), 'Fireworks Store');
  assert.equal(resolveSearchCategory('Shop', 'Om Mobile', ['Pune']), 'Mobile Shop');
  // "hardware" is already a known category word → the name phrase alone (unchanged behaviour).
  assert.equal(resolveSearchCategory('Store', 'Patil Hardware', ['Ojhar']), 'Hardware');
  assert.equal(resolveSearchCategory('Store', 'Shree Sweets', ['Nashik']), 'Sweets Store');
});

test('a name ending in a firm word (not a trade) keeps the plain category', () => {
  assert.equal(resolveSearchCategory('Store', 'Shree Ganesh Traders', ['Nashik']), 'Store');
  assert.equal(resolveSearchCategory('Store', 'Patil Brothers', ['Nashik']), 'Store');
  assert.equal(resolveSearchCategory('Store', 'Durva', ['Janori']), 'Store');
});

test('a specific Google category is used as-is (unchanged behaviour)', () => {
  assert.equal(resolveSearchCategory('Fireworks store', 'Durva Fireworks', ['Janori']), 'Fireworks store');
  assert.equal(resolveSearchCategory('Bakery', 'Shree Sweets', ['Nashik']), 'Bakery');
});

test('free-report keywords for Durva are fireworks searches, not "store …"', () => {
  const { keywords } = buildFreeReportKeywords(
    { name: 'Durva Fireworks', category: 'Store', city: 'Janori', area: 'MIDC' },
    ['Bajrang', 'Panchwad Nagar', 'Sabhaj Nagar'],
  );
  assert.ok(keywords.length > 0);
  for (const k of keywords) assert.match(k.toLowerCase(), /fireworks/, k);
  assert.ok(!keywords.some((k) => /^store\b/i.test(k)), keywords.join(' | '));
});

// ── Relevance: Durva's real 25 ──────────────────────────────────────────────

const durva = buildTradeProfile({ searchCategory: 'Fireworks Store', category: 'Store' })!;
const searches = ['Fireworks Store janori', 'Fireworks Store near me'];

const REAL_AHEAD: Array<[string, string | null]> = [
  ['SAMARTH MEDICAL AND GENERAL STORE', 'Pharmacy'],
  ['Swami samarth kiran and general stores', 'Indian grocery store'],
  ['R.B.Supermarket', 'Supermarket'],
  ['MAHALAXMI GENERAL TR', 'General store'],
  ['Janki Alankar', 'Store'],
  ['Sarvadnya Enterprises', 'Hardware store'],
  ['Fashion World - Ozone Mall, Nashik', 'Clothing store'],
  ['Swami Kirana And General Stores', 'Indian grocery store'],
  ['Gajlakshmi Provision', 'Store'],
  ['SAMARTH STATIONARY AND GENERAL STORE', 'Stationery store'],
  ['G T Stores', 'General store'],
  ['Rishi Collection', 'Jewelry store'],
  ['DDIGGI BAG', 'Bag shop'],
  ['Ratan General Stores', 'General store'],
  ['Yash Kitchen Appliances', 'Countertop store'],
  ['Sadguru Paan Shop', 'General store'],
  ['Asif Khatik', 'Clothing store'],
  ['Jay Babaji Mobile Shop', 'Cell phone accessory store'],
  ['Chintamani Mens Wear', 'Clothing store'],
  ['Sadguru Electronic', 'Electronics store'],
  ['Sarovar Nutrifert and bio organic pvt ltd', 'Corporate office'],
  ['BARATIZ DESIGNER MALL', 'Clothing store'],
  ['JAIHARI FLORA FARM JANORI', 'Warehouse'],
  ['Ukay Metal Ind. Pvt Ltd, Janori Plant Nashik', null],
  ['Matoshree Fireworks ( Ozar Branch )', 'Store'],
];

test('Durva: the trade is fireworks, alternatives included (crackers, fataka …)', () => {
  for (const t of ['fireworks', 'firecrackers', 'crackers', 'fataka', 'patake']) assert.ok(durva.terms.includes(t), t);
  assert.ok(!durva.terms.includes('store'), 'the outlet word is not the trade');
});

test("Durva's real 25: only Matoshree Fireworks counts; the 24 unrelated never do", () => {
  const results = REAL_AHEAD.map(([name, category]) => ({ name, m: classifyCompetitor({ name, category, keywords: searches }, durva) }));
  const counted = results.filter((r) => r.m.counted).map((r) => r.name);
  assert.deepEqual(counted, ['Matoshree Fireworks ( Ozar Branch )']);
  assert.equal(results.find((r) => r.name.startsWith('Matoshree'))!.m.level, 'probable');
  assert.equal(results.find((r) => r.name.startsWith('SAMARTH MEDICAL'))!.m.level, 'unrelated');
  assert.equal(results.find((r) => r.name === 'Janki Alankar')!.m.level, 'unverified', 'generic "Store", no trade evidence');
});

// ── Generic categories are eligible with evidence ───────────────────────────

test('a generic-category business with a local trade name + its website confirming is a confirmed competitor', () => {
  const m = classifyCompetitor(
    { name: 'Shree Fataka Bhandar', category: 'Store', websiteText: 'Wholesale crackers and sparklers for Diwali', keywords: searches },
    durva,
  );
  assert.equal(m.level, 'confirmed');
  assert.ok(m.signals.some((s) => s.includes('fataka')) && m.signals.some((s) => s.includes('website')));
});

test('a generic-category shop whose website shows it sells crackers counts, even without the trade in its name', () => {
  const m = classifyCompetitor(
    { name: 'Gajlakshmi Provision', category: 'Store', websiteText: 'Seasonal firecrackers stall every Diwali', keywords: searches },
    durva,
  );
  assert.equal(m.level, 'probable');
  assert.equal(m.counted, true);
});

test('a matching category on either side confirms — primary or additional', () => {
  assert.equal(classifyCompetitor({ name: 'Anything', category: 'Fireworks supplier' }, durva).level, 'confirmed');
  assert.equal(classifyCompetitor({ name: 'Ratan General Stores', category: 'General store', additionalCategories: ['Fireworks store'] }, durva).level, 'confirmed');
});

test('a keyword match alone is not enough', () => {
  // Name only, and Google never showed it for a fireworks search.
  assert.equal(classifyCompetitor({ name: 'Crackers Corner', category: 'Store', keywords: ['store janori'] }, durva).counted, false);
  // Name only, against a specific different category.
  assert.equal(classifyCompetitor({ name: 'Cracker Barrel Cafe', category: 'Restaurant', keywords: searches }, durva).level, 'unrelated');
  // …but name + an independent source outweighs a wrong specific category.
  assert.equal(
    classifyCompetitor({ name: 'Krishna Crackers', category: 'Gift shop', snippet: 'Fireworks and crackers wholesale', keywords: searches }, durva).level,
    'confirmed',
  );
});

test('no trade word for the target → no profile (nothing is filtered)', () => {
  assert.equal(buildTradeProfile({ searchCategory: 'Store', category: 'Store' }), null);
  assert.deepEqual(specificWords('General store'), []);
  assert.deepEqual(specificWords('Indian grocery store'), ['grocery']);
});

test('the profile also reads connected-GBP categories', () => {
  const p = buildTradeProfile({ searchCategory: 'Store', category: 'Store', additionalCategories: ['Fireworks store'] })!;
  assert.ok(p.terms.includes('crackers'));
  assert.ok(p.basis.some((b) => b.includes('additional category')));
});
