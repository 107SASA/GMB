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
  websiteServicesNotOnGoogle, categoriesCompetitorsUse,
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
  return { candidates, shortlist: pickShortlist(scored, { city: opts.city.toLowerCase(), areas: opts.areas || [], servedHow: opts.servedHow }) };
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
