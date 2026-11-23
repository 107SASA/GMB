/**
 * Free report v19 (docs/FREE_REPORT_REBUILD_PLAN.md Part D, steps 1–4), for
 * every kind of business:
 *  1. shop / checkout text is never a website service;
 *  2. website items grouped into offer families the way customers search,
 *     spelling fixed only for a word that is on the site;
 *  3. offers whose keyword was searched and not found → a verified issue;
 *  4. extra Google categories that do not fit → not keywords, and an issue.
 * Live case: Modern Jewellery tools, Bengaluru (Nov 2026).
 *
 * Run: npx tsx --test tests/workflow/audit-free-report-offers.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeServiceName } from '../../src/services/intel/websiteExtract';
import {
  checkFamilies, checkCategoryFit, editDistance, isSpellingFixOf, evidenceStems, normalizeInput,
  type UnderstandingInput,
} from '../../src/services/audit/businessUnderstanding';
import { freeReportServices, categoriesThatDoNotFit } from '../../src/services/audit/freeReportShortlist';
import { buildEvidenceAndFindings } from '../../src/services/audit/findings';
import { buildReviewFacts, summarizeRankings, suspensionRiskHeuristic } from '../../src/services/audit/facts';

const input = (o: Partial<UnderstandingInput>): UnderstandingInput => ({
  name: '', city: '', area: '', primaryCategory: null, additionalCategories: [], placeTypes: [],
  googleDescription: null, ownerDescription: null, addressShown: null, websiteTitle: null, websiteDescription: null,
  websiteServices: [], ...o,
});

const jewellery = input({
  name: 'Modern Jewellery tools', city: 'Bengaluru', primaryCategory: 'Jewelry equipment supplier',
  additionalCategories: ['Goldsmith', 'Wholesale jeweler'],
  websiteServices: ['CONDUCTING SALT', 'PLATING SOLUTIONS ANTI TARNISH', 'PLATING SOLUTIONS BATH', 'PLATING SOLUTIONS PEN',
    'PLATING SOLUTIONS SILVER', 'RODHIUM BATH', 'RODHIUM PEN', 'Abrasives', 'Jewellery tools'],
});

// ── 1. Shop text ──────────────────────────────────────────────────────────

test('shop / checkout text and prices are never a service; real offers with the same words stay', () => {
  for (const s of ['Estimated total', 'Subtotal', 'Add to cart', 'Buy it now', 'Sold out', 'Quick view', 'Your cart is empty',
    'Shipping & returns', 'Refund policy', '₹1,250', 'Rs. 499', 'INR 2,000.00', 'Total']) {
    assert.equal(looksLikeServiceName(s), false, s);
  }
  for (const s of ['PLATING SOLUTIONS ANTI TARNISH', 'RODHIUM BATH', 'Total body checkup', 'International shipping services',
    'Price negotiation coaching', 'Root canal treatment', 'Chicken dum biryani']) {
    assert.equal(looksLikeServiceName(s), true, s);
  }
});

// ── 2. Families ───────────────────────────────────────────────────────────

test('spelling fix: a word on the site, 1–2 letters apart, same first letter', () => {
  assert.equal(editDistance('rodhium', 'rhodium'), 2);
  assert.equal(editDistance('jewelery', 'jewellery'), 1);
  assert.ok(isSpellingFixOf('rhodium', 'rodhium'));
  assert.ok(!isSpellingFixOf('bathroom', 'bath'), 'a longer, different word is not a fix');
  assert.ok(!isSpellingFixOf('silver', 'gold'));
  assert.ok(!isSpellingFixOf('plating', 'painting'), 'different words, 3 letters apart');
});

test('families: grouped items kept, spelling fixed, invented products and made-up items dropped', () => {
  const i = normalizeInput(jewellery);
  const fams = checkFamilies([
    { name: 'rhodium plating solution', covers: ['RODHIUM BATH', 'RODHIUM PEN'] },
    { name: 'silver plating solution', covers: ['PLATING SOLUTIONS SILVER'] },
    { name: 'plating pen', covers: ['PLATING SOLUTIONS PEN'] },
    { name: 'gold plating machine', covers: ['PLATING SOLUTIONS BATH'] }, // "gold", "machine" are not on the site
    { name: 'diamond tools', covers: ['Diamond cutters'] },              // covers nothing real
    { name: 'conducting salt', covers: [] },                            // covers nothing
  ], i, evidenceStems(i));
  assert.deepEqual(fams.map((f) => f.name), ['rhodium plating solution', 'silver plating solution', 'plating pen']);
  assert.deepEqual(fams[0].covers, ['RODHIUM BATH', 'RODHIUM PEN']);
});

test('families for other trades: salon, restaurant, coaching', () => {
  const salon = normalizeInput(input({ name: 'Glow Salon', primaryCategory: 'Beauty salon', websiteServices: ["Men's haircut", 'Kids haircut', 'Hair spa (60 min)'] }));
  assert.deepEqual(checkFamilies([{ name: 'haircut', covers: ["Men's haircut", 'Kids haircut'] }, { name: 'hair spa', covers: ['Hair spa (60 min)'] }], salon, evidenceStems(salon)).map((f) => f.name), ['haircut', 'hair spa']);
  const food = normalizeInput(input({ name: 'Paradise', primaryCategory: 'Biryani restaurant', websiteServices: ['Chicken dum biryani', 'Mutton biryani'] }));
  assert.deepEqual(checkFamilies([{ name: 'biryani', covers: ['Chicken dum biryani', 'Mutton biryani'] }, { name: 'pizza', covers: ['Mutton biryani'] }], food, evidenceStems(food)).map((f) => f.name), ['biryani']);
  const coaching = normalizeInput(input({ name: 'Code Academy', primaryCategory: 'Computer training school', websiteServices: ['Python batch (Jan)', 'Advanced Python'] }));
  assert.deepEqual(checkFamilies([{ name: 'python course', covers: ['Python batch (Jan)', 'Advanced Python'] }], coaching, evidenceStems(coaching)).map((f) => f.name), ['python course'], '"course" is a kind word');
});

test('keyword services: families replace the items they cover; the AI\'s own misspelling is fixed too', () => {
  const i = normalizeInput(jewellery);
  const families = checkFamilies([{ name: 'rhodium plating solution', covers: ['RODHIUM BATH', 'RODHIUM PEN'] }], i, evidenceStems(i));
  const names = freeReportServices({
    aiTerms: ['jewellery tools', 'rodium bath'], categories: ['Jewelry equipment supplier', 'Goldsmith'],
    websiteServices: i.websiteServices, offered: 'products', families, evidence: evidenceStems(i), excludeCategories: ['Goldsmith'],
  }).map((s) => s.name);
  assert.ok(names.includes('rhodium plating solution'), names.join(' | '));
  assert.ok(names.includes('rhodium bath'), `"rodium" (AI) → "rhodium": ${names.join(' | ')}`);
  assert.ok(!names.some((n) => /rodhium|rodium/.test(n)), names.join(' | '));
  assert.ok(!names.includes('rodhium pen'), 'covered by the family');
  assert.ok(names.includes('conducting salt'), 'an item no family covers stays');
  assert.ok(!names.includes('goldsmith'), 'a category that does not fit is not an offer');
});

test('no families (AI failed or old saved answer): website items used as before', () => {
  const names = freeReportServices({ aiTerms: ['yoga classes'], categories: ['Yoga studio'], websiteServices: ['Group yoga'], offered: 'services' }).map((s) => s.name);
  assert.deepEqual(names, ['yoga classes', 'yoga studio', 'group yoga']);
});

// ── 4. Categories that do not fit ─────────────────────────────────────────

test('category fit: only the listing\'s own extra categories are kept from the AI', () => {
  const rows = checkCategoryFit([
    { category: 'Goldsmith', fits: 'no', reason: 'sells tools to goldsmiths' },
    { category: 'goldsmith', fits: 'no' },
    { category: 'Jewelry store', fits: 'no' }, // not on the listing
    { category: 'Wholesale jeweler', fits: 'maybe' },
  ], normalizeInput(jewellery));
  assert.deepEqual(rows.map((r) => [r.category, r.fits]), [['Goldsmith', 'no'], ['Wholesale jeweler', 'unsure']]);
});

test('a "no" stands only when the category\'s main word is not something the business sells', () => {
  const sells = { offerings: [{ name: 'jewellery tools' }], families: [{ name: 'rhodium plating solution' }], searchTerms: ['goldsmith supplies', 'jewellery equipment'] };
  assert.deepEqual(categoriesThatDoNotFit([{ category: 'Goldsmith', fits: 'no', reason: 'x' }, { category: 'Wholesale jeweler', fits: 'no', reason: 'y' }], sells).map((c) => c.category), ['Goldsmith', 'Wholesale jeweler']);
  // A wrong "no" from the AI is overruled: a yoga studio's "Yoga studio" / "Yoga instructor"-type category.
  assert.deepEqual(categoriesThatDoNotFit([{ category: 'Yoga studio', fits: 'no' }], { searchTerms: ['yoga classes'] }), []);
  assert.deepEqual(categoriesThatDoNotFit([{ category: 'Dental clinic', fits: 'no' }], { offerings: [{ name: 'dental implants' }, { name: 'dental clinic' }] }), []);
  assert.deepEqual(categoriesThatDoNotFit([{ category: 'Goldsmith', fits: 'unsure' }], sells), [], 'unsure → kept as today');
  assert.deepEqual(categoriesThatDoNotFit(null, sells), [], 'AI failed → nothing flagged');
});

// ── 3 + 4. Findings ───────────────────────────────────────────────────────

const base = {
  fields: {}, title: { name: 'Modern Jewellery tools', wordCount: 3 },
  primaryRanking: summarizeRankings([]), nearbyRanking: summarizeRankings([]), nearbyByKeyword: [],
  competitors: [], competitorsAhead: { count: 0, names: [] },
  reviews: buildReviewFacts({ count: 1002, rating: 4.8, source: 'google_places' }, { periodDays: 14, synced: false, reviews: [] }),
  reviewComparison: null, keywordRows: [], suspensionRisk: suspensionRiskHeuristic({ selfPraiseTerm: null }),
};

test('offers Google does not show the business for: one verified issue, worded by what is sold', () => {
  const { findings } = buildEvidenceAndFindings({
    ...base,
    offersNotOnGoogle: { offered: 'products', offers: [
      { name: 'rhodium plating solution', covers: ['RODHIUM BATH', 'RODHIUM PEN'], keyword: 'rhodium plating solution bengaluru' },
      { name: 'silver plating solution', covers: ['PLATING SOLUTIONS SILVER'], keyword: 'silver plating solution bengaluru' },
    ] },
  } as any);
  const f = findings.find((x) => x.id === 'offers.not_on_google');
  assert.ok(f);
  assert.equal(f!.title, "Google doesn't show you for 2 things you sell");
  assert.match(f!.evidence, /rhodium plating solution bengaluru": not in the top 20 \(on your website: RODHIUM BATH, RODHIUM PEN\)/);
  assert.match(f!.recommendedAction, /Products section/);

  const svc = buildEvidenceAndFindings({ ...base, offersNotOnGoogle: { offered: 'services', offers: [{ name: 'hair spa', covers: [], keyword: 'hair spa pune' }] } } as any).findings
    .find((x) => x.id === 'offers.not_on_google');
  assert.equal(svc!.title, 'Google doesn\'t show you for "hair spa"');
  assert.match(svc!.recommendedAction, /List these services/);

  assert.ok(!buildEvidenceAndFindings({ ...base, offersNotOnGoogle: null } as any).findings.some((x) => x.id === 'offers.not_on_google'));
});

test('categories that do not fit: one issue naming them and what the business does', () => {
  const { findings } = buildEvidenceAndFindings({
    ...base,
    categoryMismatch: { trade: 'wholesale jewellery tools and consumables', categories: [{ category: 'Goldsmith', reason: '' }, { category: 'Wholesale jeweler', reason: '' }] },
  } as any);
  const f = findings.find((x) => x.id === 'profile.category_mismatch');
  assert.ok(f);
  assert.equal(f!.title, 'Your Google profile lists "Goldsmith" and "Wholesale jeweler", which don\'t match what you do');
  assert.match(f!.evidence, /What you do: wholesale jewellery tools and consumables/);
  assert.equal(f!.growwmaticsCapability, 'update_categories');
});

// ── Live run v20 (23 Nov 2026): the AI's first term was the wrong trade ────

test('an offer that is a category that does not fit, in other words, is dropped ("jewelry wholesale" = "Wholesale jeweler")', () => {
  const names = freeReportServices({
    aiTerms: ['jewelry wholesale', 'jewelry tools', 'jewelry equipment', 'jewelry plating'],
    categories: ['Jewelry equipment supplier', 'Goldsmith', 'Wholesale jeweler'],
    websiteServices: [], offered: 'products',
    excludeCategories: ['Goldsmith', 'Wholesale jeweler'], country: 'India',
  }).map((s) => s.name);
  assert.ok(!names.some((n) => /wholesale/.test(n)), names.join(' | '));
  assert.ok(!names.includes('goldsmith'));
  assert.ok(names.includes('jewellery tools'), `kept, in Indian spelling: ${names.join(' | ')}`);
  assert.ok(names.includes('jewellery equipment supplier'));
  assert.ok(!names.some((n) => /jewelry/.test(n)), 'US spelling not used in India');
});

test('outside India the spelling is left as written; a fitting category is never dropped', () => {
  const names = freeReportServices({ aiTerms: ['jewelry tools'], categories: [], websiteServices: [], country: 'United States' }).map((s) => s.name);
  assert.deepEqual(names, ['jewelry tools']);
  const yoga = freeReportServices({ aiTerms: ['yoga classes'], categories: ['Yoga studio'], websiteServices: [], excludeCategories: ['Gym'] }).map((s) => s.name);
  assert.deepEqual(yoga, ['yoga classes', 'yoga studio']);
});

test('replay (v21): the wrong-trade rule drops only the same words, never a main service that shares one', () => {
  const names = freeReportServices({
    aiTerms: ['yoga classes', 'meditation classes', 'yoga studio'], categories: ['Yoga studio', 'Fitness center', 'Yoga instructor'],
    websiteServices: [], offered: 'services', excludeCategories: ['Fitness center', 'Yoga instructor'], country: 'India',
  }).map((s) => s.name);
  assert.ok(names.includes('yoga classes'), names.join(' | '));
  assert.ok(!names.includes('yoga instructor') && !names.includes('fitness centre'), names.join(' | '));
  const jw = freeReportServices({
    aiTerms: ['jewelry tools', 'wholesale jewellery shop', 'goldsmith', 'goldsmith supplies'], categories: [], websiteServices: [], offered: 'products',
    excludeCategories: ['Wholesale jeweler', 'Goldsmith'], country: 'India',
    families: [{ name: 'rhodium services', covers: ['RODHIUM BATH'] }],
  }).map((s) => s.name);
  assert.ok(!jw.some((n) => /wholesale|^goldsmith$/.test(n)), jw.join(' | '));
  assert.ok(jw.includes('goldsmith supplies'));
  assert.ok(jw.includes('rhodium') && !jw.some((n) => /services/.test(n)), `a product family has no "services": ${jw.join(' | ')}`);
});
