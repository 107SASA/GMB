/**
 * Free report keyword shortlist (docs/FREE_REPORT_REBUILD_PLAN.md Part C):
 * every possible keyword → volume for all → ~10 shortlisted → only those
 * rank-checked. Built on the connected audit's own keyword modules. No I/O.
 *
 * Run: npx tsx --test tests/workflow/audit-free-report-shortlist.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freeReportServices, freeReportCandidates, pickShortlist, groundedInBusiness,
  websiteServicesNotOnGoogle, categoriesCompetitorsUse, keepsAServiceHead, serviceGroupKey,
} from '../../src/services/audit/freeReportShortlist';
import { addEvidenceText } from '../../src/services/audit/businessUnderstanding';
import { volumeOf } from '../../src/services/seo/keywordMeasure';
import { scoreCandidates, planRankChecks } from '../../src/services/seo/keywordSet';

const evidence = (text: string) => addEvidenceText(new Set<string>(), text);

function run(opts: {
  terms: string[]; categories?: string[]; site?: string[]; offered?: any; servedHow?: any;
  city: string; areas?: string[]; ideas?: Array<{ keyword: string; volume: number | null }>;
  evidenceText: string; country?: Record<string, number>; cityVol?: Record<string, number>;
}) {
  const services = freeReportServices({ aiTerms: opts.terms, categories: opts.categories || [], websiteServices: opts.site || [], offered: opts.offered });
  const candidates = freeReportCandidates({
    businessName: 'Test Business', city: opts.city, areas: opts.areas || [], services,
    ideas: opts.ideas || [], evidence: evidence(opts.evidenceText), servedHow: opts.servedHow,
  });
  const country = new Map(candidates.map((c) => [c.keyword, opts.country?.[c.keyword] ?? null]));
  const city = new Map(candidates.map((c) => [c.keyword, opts.cityVol?.[c.keyword] ?? null]));
  const volumes = new Map(candidates.map((c) => [c.id, volumeOf(c.keyword, { country, city, ideaVolume: c.sources.includes('google_ideas') ? c.ideaVolume : undefined }, '2026-11-20')]));
  const scored = scoreCandidates({ candidates, volumes, ranks: new Map(), competitors: new Map(), ourReviews: null });
  return { candidates, shortlist: pickShortlist(scored, { city: opts.city.toLowerCase(), areas: opts.areas || [], servedHow: opts.servedHow, categories: opts.categories, primaryCategory: opts.categories?.[0] ?? null }) };
}

test('yoga studio (Mohali, Nov 2026): city phrases first, one "near me", areas served, grounded ideas only', () => {
  const { candidates, shortlist } = run({
    terms: ['yoga classes', 'meditation classes', 'yoga studio', 'yoga training'],
    categories: ['Yoga studio', 'Yoga instructor'],
    site: ['Group yoga', '1:1 yoga', 'Online yoga'],
    city: 'Mohali',
    areas: ['chandigarh', 'zirakpur'],
    ideas: [{ keyword: 'power yoga mohali', volume: 90 }, { keyword: 'hot yoga mohali', volume: 50 }, { keyword: 'zumba classes mohali', volume: 400 }],
    evidenceText: 'Yoga se hoga. Group yoga, 1:1 yoga, online yoga, meditation. Power yoga every morning.',
    country: { 'yoga classes near me': 246000, 'meditation classes near me': 12100, 'yoga studio near me': 6600, 'yoga classes mohali': 210, 'yoga classes chandigarh': 590 },
  });
  const ks = shortlist.map((k) => k.keyword);
  assert.ok(candidates.length >= 15, `every possible keyword (${candidates.length})`);
  assert.equal(ks.filter((k) => /near me/.test(k)).length, 1, ks.join(' | '));
  assert.ok(ks.includes('yoga classes mohali'));
  assert.ok(ks.includes('meditation classes mohali'), 'a main service is checked even with no Google number');
  assert.ok(ks.includes('yoga classes chandigarh'), 'an area served with searches is checked');
  assert.ok(candidates.some((c) => c.keyword === 'power yoga mohali'), '"power yoga" is on the website → kept');
  assert.ok(!candidates.some((c) => /hot yoga|zumba/.test(c.keyword)), 'ideas the business does not offer are dropped');
  assert.ok(shortlist.length <= 10);
});

test('Google ideas without a place get the city; the shortlist never holds a country-wide phrase', () => {
  const { candidates, shortlist } = run({
    terms: ['yoga classes'], city: 'Mohali',
    ideas: [{ keyword: 'yoga', volume: 201000 }, { keyword: 'yoga classes', volume: 40500 }, { keyword: 'yoga classes delhi', volume: 3000 }],
    evidenceText: 'yoga classes studio',
    country: { yoga: 201000, 'yoga mohali': 70, 'yoga classes near me': 246000 },
  });
  const ks = candidates.map((c) => c.keyword);
  assert.ok(ks.includes('yoga mohali'));
  assert.ok(!ks.includes('yoga') && !ks.includes('yoga classes delhi'), ks.join(' | '));
  assert.ok(shortlist.every((k) => /mohali|near me/.test(k.keyword)), shortlist.map((k) => k.keyword).join(' | '));
});

test('a service keeps its own wording over a reordered Google idea on a tie', () => {
  const { shortlist } = run({
    terms: ['meditation classes'], city: 'Mohali',
    ideas: [{ keyword: 'class meditation', volume: 10 }],
    evidenceText: 'meditation classes',
  });
  assert.equal(shortlist[0].keyword, 'meditation classes mohali');
});

test('cashew maker: "manufacturer" / "wholesaler" shapes for its product', () => {
  const { candidates } = run({
    terms: ['cashew', 'cashew nuts'], categories: ['Manufacturer'], offered: 'made_to_order',
    city: 'Mangaluru', evidenceText: 'Shree Cashew Industries cashew processing W240 cashew nuts wholesale',
  });
  const ks = candidates.map((c) => c.keyword);
  assert.ok(ks.includes('cashew manufacturer mangaluru'), ks.join(' | '));
  assert.ok(ks.includes('cashew wholesaler mangaluru'));
  assert.ok(!ks.includes('manufacturer mangaluru'), 'a vague category alone is never a keyword');
});

test('online business: no "near me" at all', () => {
  const { candidates, shortlist } = run({
    terms: ['app development company', 'custom software development'], servedHow: 'online',
    city: 'Chennai', evidenceText: 'app development custom software development company',
    country: { 'app development company chennai': 4400 },
  });
  assert.ok(!candidates.some((c) => /near me/.test(c.keyword)));
  assert.equal(shortlist[0].keyword, 'app development company chennai');
});

test('grounding: every offer word must be the business\'s own', () => {
  const ev = evidence('Dental clinic. Root canal treatment, teeth whitening, braces.');
  assert.ok(groundedInBusiness('root canal treatment nashik', ev, ['nashik']));
  assert.ok(groundedInBusiness('teeth whitening near me', ev, []));
  assert.ok(!groundedInBusiness('dental implants nashik', ev, ['nashik']), '"implants" is not on the site');
});

test('website services not covered by the Google categories', () => {
  assert.deepEqual(
    websiteServicesNotOnGoogle(['Group yoga', 'Meditation classes', 'Online yoga', 'Sound healing'], ['Yoga studio', 'Yoga instructor']),
    ['Meditation classes', 'Sound healing'],
  );
  assert.deepEqual(websiteServicesNotOnGoogle(['Group yoga'], []), [], 'nothing on Google to compare with → no claim');
});

test('categories 2+ competitors above use and the business does not', () => {
  const rows = categoriesCompetitorsUse(['Yoga studio'], [
    { name: 'HemSach Yoga', category: 'Yoga studio', additionalCategories: ['Yoga instructor', 'Meditation center'] },
    { name: 'Vinay Yoga Trainer', category: 'Yoga instructor', additionalCategories: [] },
    { name: 'Studio Samyama', category: 'Yoga studio', additionalCategories: ['Meditation center', 'Store'] },
  ]);
  assert.deepEqual(rows.map((r) => r.category), ['Meditation center', 'Yoga instructor']);
  assert.ok(!rows.some((r) => r.category === 'Store'), 'vague categories are not suggested');
});

test('connected audit re-checks the free report keywords on its first plan', () => {
  const cand = (keyword: string) => ({ id: `kw:${keyword.replace(/\s+/g, '-')}`, keyword, sources: ['previous' as const], owner: false, serviceId: 'svc:x', service: 'x', relevance: 'category' as const, ideaVolume: null, gbpImpressions: null, competitor: null });
  const candidates = [cand('yoga classes mohali'), cand('yoga classes chandigarh')];
  const checks = planRankChecks({ candidates, preScored: [], previous: [], carried: ['kw:yoga-classes-chandigarh'], limits: { core: 0, rotating: 0, explore: 0 } });
  assert.deepEqual(checks.map((c) => c.keyword), ['yoga classes chandigarh']);
});

// ── Every keyword keeps what the business sells (Nov 2026) ─────────────────

test('jewellery tools supplier (Bengaluru, real report): no "goldsmith near me", one keyword per product before second shapes', () => {
  const { candidates, shortlist } = run({
    terms: ['jewellery tools', 'goldsmith supplies', 'jewellery equipment', 'plating solutions', 'rodium bath', 'abrasives for jewellery', 'jewellery consumables', 'abrasives'],
    categories: ['Jewelry equipment supplier'], offered: 'products', city: 'Bengaluru',
    ideas: [{ keyword: 'goldsmith near me', volume: 720 }, { keyword: 'goldsmith tools', volume: 90 }, { keyword: 'jewellery tools near me', volume: null }],
    evidenceText: 'Modern Jewellery tools. Jewelry equipment supplier. Goldsmith supplies, goldsmith tools, plating solutions, rodium bath, abrasives, adhesives, air scriber, jewellery consumables.',
  });
  const ks = shortlist.map((k) => k.keyword);
  assert.ok(!candidates.some((c) => c.keyword === 'goldsmith near me'), 'a goldsmith is another trade');
  assert.ok(candidates.some((c) => c.keyword === 'goldsmith tools bengaluru'), 'keeps "tools" → kept');
  assert.equal(ks.filter((k) => /near me/.test(k)).length, 1, ks.join(' | '));
  assert.ok(ks.some((k) => /^(jewellery tools|goldsmith supplies|jewellery equipment|jewelry equipment supplier) near me$/.test(k)), ks.join(' | '));
  assert.ok(ks.includes('jewellery consumables bengaluru'), `every product line gets a slot: ${ks.join(' | ')}`);
  // "jewellery tools" and "jewellery tools shop" are one offer: the shop shape only after every other product.
  const shop = ks.indexOf('jewellery tools shop bengaluru');
  if (shop >= 0) assert.ok(shop > ks.indexOf('jewellery consumables bengaluru'), ks.join(' | '));
  // The Google category's offer first; a word found once on one page after the connected ones.
  assert.match(ks[0], /equipment/);
  assert.ok(ks.includes('plating solutions bengaluru'), `a product with no other keyword is checked before second shapes: ${ks.join(' | ')}`);
  assert.ok(ks.indexOf('abrasives for jewellery bengaluru') > ks.indexOf('goldsmith supplies bengaluru'), '"for jewellery" does not make abrasives the category\'s offer');
  if (ks.includes('rodium bath bengaluru')) assert.ok(ks.indexOf('rodium bath bengaluru') > ks.indexOf('jewellery consumables bengaluru'), ks.join(' | '));
  assert.ok(shortlist.length <= 10);
});

test('a Google idea must keep the service\'s main word (repair, dentist, restaurant, salon, yoga)', () => {
  const svc = (...names: string[]) => names.map((name) => ({ name }));
  assert.ok(!keepsAServiceHead('ac near me', svc('ac repair', 'ac installation'), []), '"ac near me" is an AC shop');
  assert.ok(keepsAServiceHead('split ac repair near me', svc('ac repair'), []));
  assert.ok(keepsAServiceHead('dentist near me', svc('Dentist', 'root canal treatment'), []));
  assert.ok(keepsAServiceHead('biryani near me', svc('biryani restaurant'), []), 'the dish, not "restaurant", is the main word');
  assert.ok(keepsAServiceHead('beauty parlour near me', svc('beauty salon', 'bridal makeup'), []));
  assert.ok(!keepsAServiceHead('bridal near me', svc('bridal makeup'), []), '"bridal" alone could be a dress shop');
  assert.ok(keepsAServiceHead('yoga near me', svc('yoga classes'), []), '"classes" is a kind word');
  assert.ok(keepsAServiceHead('cashew wholesaler mangaluru', svc('cashew'), ['mangaluru']));
});

test('same offer, different words: one group (spelling, "shop", "supplier", the venue word)', () => {
  assert.equal(serviceGroupKey('Jewelry equipment supplier'), serviceGroupKey('jewellery equipment'));
  assert.equal(serviceGroupKey('jewellery tools shop'), serviceGroupKey('jewellery tools'));
  assert.equal(serviceGroupKey('yoga studio'), serviceGroupKey('yoga classes'));
  assert.notEqual(serviceGroupKey('abrasives for jewellery'), serviceGroupKey('jewellery tools'));
});

test('salon with many services: each service checked once before any second shape', () => {
  const { shortlist } = run({
    terms: ['beauty salon', 'bridal makeup', 'hair spa', 'keratin treatment', 'nail art', 'facial'],
    categories: ['Beauty salon'], offered: 'services', city: 'Pune',
    ideas: [{ keyword: 'bridal makeup near me', volume: 9900 }, { keyword: 'bridal near me', volume: 20000 }],
    evidenceText: 'Glow beauty salon Pune. Bridal makeup, hair spa, keratin treatment, nail art, facial, bridal packages.',
    country: { 'bridal makeup near me': 9900, 'hair spa pune': 320 },
  });
  const ks = shortlist.map((k) => k.keyword);
  for (const s of ['beauty salon pune', 'bridal makeup pune', 'hair spa pune', 'keratin treatment pune', 'nail art pune', 'facial pune']) {
    assert.ok(ks.includes(s), `${s} missing: ${ks.join(' | ')}`);
  }
  assert.ok(!ks.includes('bridal near me'));
  assert.ok(ks.includes('bridal makeup near me'));
});

test('restaurant: dish searches kept, unrelated dishes dropped', () => {
  const { candidates } = run({
    terms: ['biryani restaurant', 'north indian restaurant'], categories: ['North Indian restaurant'], city: 'Hyderabad',
    ideas: [{ keyword: 'biryani near me', volume: 90000 }, { keyword: 'pizza near me', volume: 50000 }],
    evidenceText: 'Paradise biryani house. North Indian restaurant. Chicken biryani, mutton biryani, tandoori.',
  });
  const ks = candidates.map((c) => c.keyword);
  assert.ok(ks.includes('biryani near me'), ks.join(' | '));
  assert.ok(!ks.includes('pizza near me'));
});

test('office furniture store (Surat, live v21): the primary category is the main keyword, not the broader, more searched "furniture store"', () => {
  const { shortlist } = run({
    terms: ['chair manufacturer', 'office chairs', 'furniture store', 'sofa shop', 'plastic chairs'],
    categories: ['Office furniture store', 'Sofa store'], offered: 'both', city: 'Surat',
    ideas: [{ keyword: 'office furniture surat', volume: 320 }],
    evidenceText: 'CHAIR WORLD office furniture store office chairs plastic chairs sofa furniture chair manufacturer',
    country: { 'furniture store surat': 1900, 'office chairs surat': 260, 'office furniture surat': 320, 'sofa shop surat': 480 },
  });
  assert.equal(shortlist[0].keyword, 'office furniture surat', shortlist.map((k) => k.keyword).join(' | '));
  assert.ok(shortlist.some((k) => k.keyword === 'furniture store surat'), 'the broader phrase is still checked');
});

test('yoga studio with "Fitness center" (live v23): "near me" is for yoga, not "fitness gyms near me"', () => {
  const { shortlist, candidates } = run({
    terms: ['yoga classes', 'meditation classes', 'yoga studio'],
    categories: ['Yoga studio', 'Fitness center', 'Meditation center'], city: 'Mohali',
    ideas: [{ keyword: 'fitness gyms near me', volume: 368000 }, { keyword: 'yoga classes near me', volume: 246000 }],
    // The owner's own words only — no Google place type "gym".
    evidenceText: 'YOGA SE HOGA yoga studio fitness center meditation center yoga classes meditation',
    country: { 'fitness gyms near me': 368000, 'yoga classes near me': 246000, 'yoga classes mohali': 210 },
  });
  const ks = shortlist.map((k) => k.keyword);
  assert.ok(!candidates.some((c) => /gyms/.test(c.keyword)), '"gyms" is not the owner\'s word');
  assert.equal(ks.filter((k) => /near me/.test(k)).length, 1, ks.join(' | '));
  assert.ok(ks.includes('yoga classes near me'), ks.join(' | '));
});
