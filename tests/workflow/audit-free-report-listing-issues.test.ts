/**
 * Free report v23 (docs/FREE_REPORT_REBUILD_PLAN.md Part E): more issues that
 * are true, measured and fixable — the same rules for every category. Each is
 * tested both ways: shown when true, never shown when not proven.
 *
 * Run: npx tsx --test tests/workflow/audit-free-report-listing-issues.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  primaryCategoryDoesNotFit, moreSpecificCategory, categoryLowDemand, photosVsCompetitors,
} from '../../src/services/audit/freeReportShortlist';
import { addEvidenceText } from '../../src/services/audit/businessUnderstanding';
import { buildEvidenceAndFindings } from '../../src/services/audit/findings';
import { buildReviewFacts, summarizeRankings, suspensionRiskHeuristic } from '../../src/services/audit/facts';

// ── Primary category that does not fit ────────────────────────────────────

test('primary category: a tool supplier listed as "Jewelry store" is flagged, with a real suggestion', () => {
  const r = primaryCategoryDoesNotFit(
    { fits: 'no', reason: 'sells tools to jewellers', better: 'Jewelry equipment supplier' },
    'Jewelry store',
    { offerings: [{ name: 'jewellery tools' }], searchTerms: ['goldsmith supplies', 'jewellery equipment'] },
  );
  assert.deepEqual(r, { category: 'Jewelry store', reason: 'sells tools to jewellers', better: 'Jewelry equipment supplier' });
});

test('primary category: a wrong AI "no" is overruled when the category is what they sell; unsure / no answer → nothing', () => {
  assert.equal(primaryCategoryDoesNotFit({ fits: 'no', reason: '' }, 'Yoga studio', { searchTerms: ['yoga classes'] }), null);
  assert.equal(primaryCategoryDoesNotFit({ fits: 'no', reason: '' }, 'Dental clinic', { offerings: [{ name: 'dental implants' }], searchTerms: ['dental clinic'] }), null);
  // Known limit: with only "dental implants" (main word "implants") the code cannot overrule — it relies on the AI's
  // "no only when clearly something else"; the same word shape is a correct "no" for "Jewelry store" vs "jewellery tools".

  assert.equal(primaryCategoryDoesNotFit({ fits: 'unsure', reason: '' }, 'Jewelry store', { searchTerms: ['jewellery tools'] }), null);
  assert.equal(primaryCategoryDoesNotFit(null, 'Jewelry store', { searchTerms: ['jewellery tools'] }), null);
  const vague = primaryCategoryDoesNotFit({ fits: 'no', reason: '', better: 'Store' }, 'Jewelry store', { searchTerms: ['jewellery tools'] });
  assert.equal(vague?.better, null, 'a vague suggestion ("Store") is never shown');
});

// ── Category too broad ────────────────────────────────────────────────────

test('too broad: "Restaurant" when same-trade competitors above use "Biryani restaurant" and the business serves biryani', () => {
  const ev = addEvidenceText(new Set(), 'Paradise biryani house restaurant chicken biryani mutton biryani');
  const r = moreSpecificCategory('Restaurant', [
    { name: 'Shah Ghouse', category: 'Biryani restaurant' },
    { name: 'Bawarchi', category: 'Biryani restaurant' },
    { name: 'Pizza Hut', category: 'Pizza restaurant' },
  ], ev);
  assert.deepEqual(r, { category: 'Biryani restaurant', competitors: ['Shah Ghouse', 'Bawarchi'] });
});

test('too broad: never a category for something the business does not offer, never when already specific', () => {
  const ev = addEvidenceText(new Set(), 'Paradise biryani house restaurant');
  assert.equal(moreSpecificCategory('Restaurant', [{ name: 'Pizza Hut', category: 'Pizza restaurant' }], ev), null, '"pizza" is not theirs');
  const ev2 = addEvidenceText(new Set(), 'office furniture office chairs');
  assert.equal(moreSpecificCategory('Office furniture store', [{ name: 'X', category: 'Furniture store' }], ev2), null, 'a broader one is not suggested');
  assert.equal(moreSpecificCategory('Restaurant', [], ev), null);
});

// ── Category phrase nobody searches ───────────────────────────────────────

const kw = (keyword: string, service: string, city: number | null, country: number | null = null) =>
  ({ keyword, service, serviceId: `svc:${service}`, volume: { city, country }, score: 1, verdict: 'keep' } as any);

test('low demand: no searches for the category phrase, real searches for an own offer → shown', () => {
  const r = categoryLowDemand([
    kw('jewellery equipment supplier bengaluru', 'jewellery equipment supplier', null),
    kw('jewellery tools bengaluru', 'jewellery tools', 140),
    kw('jewellery tools near me', 'jewellery tools', 900),
  ], 'Jewelry equipment supplier');
  assert.deepEqual(r, { categoryKeyword: 'jewellery equipment supplier bengaluru', categoryVolume: null, betterKeyword: 'jewellery tools bengaluru', betterVolume: 140 });
});

test('low demand: not shown when the category phrase is searched, or nothing better is proven', () => {
  assert.equal(categoryLowDemand([kw('yoga studio mohali', 'yoga studio', 40), kw('yoga classes mohali', 'yoga classes', 210)], 'Yoga studio'), null);
  assert.equal(categoryLowDemand([kw('x supplier pune', 'x supplier', null), kw('x pune', 'x', 20)], 'X supplier'), null, 'under 50 is not proof');
  assert.equal(categoryLowDemand([kw('a b c', 'a', 500)], 'Store'), null, 'a vague category is never compared');
});

// ── Photos ────────────────────────────────────────────────────────────────

test('photos: far fewer than ≥ 2 same-trade businesses above → shown; otherwise not', () => {
  assert.deepEqual(photosVsCompetitors(12, [{ name: 'A', totalPhotos: 80 }, { name: 'B', totalPhotos: 200 }, { name: 'C', totalPhotos: 150 }]), { own: 12, median: 150, competitors: 3 });
  assert.equal(photosVsCompetitors(60, [{ name: 'A', totalPhotos: 300 }, { name: 'B', totalPhotos: 400 }]), null, '50+ photos is not a problem');
  assert.equal(photosVsCompetitors(12, [{ name: 'A', totalPhotos: 30 }, { name: 'B', totalPhotos: 20 }]), null, 'not far behind');
  assert.equal(photosVsCompetitors(12, [{ name: 'A', totalPhotos: 300 }, { name: 'B', totalPhotos: null }]), null, 'one count is not enough');
  assert.equal(photosVsCompetitors(null, [{ name: 'A', totalPhotos: 300 }, { name: 'B', totalPhotos: 300 }]), null, 'own count unknown');
});

// ── Findings ──────────────────────────────────────────────────────────────

const base = {
  fields: {}, title: { name: 'X', wordCount: 1 },
  primaryRanking: summarizeRankings([]), nearbyRanking: summarizeRankings([]), nearbyByKeyword: [],
  competitors: [], competitorsAhead: { count: 0, names: [] },
  reviews: buildReviewFacts({ count: 50, rating: 4.5, source: 'google_places' }, { periodDays: 14, synced: false, reviews: [] }),
  reviewComparison: null, keywordRows: [], suspensionRisk: suspensionRiskHeuristic({ selfPraiseTerm: null }),
};
const ids = (input: any) => buildEvidenceAndFindings({ ...base, ...input } as any).findings.map((f) => f.id);

test('findings: each new issue appears only with its proof; not-claimed is never sold as a platform fix', () => {
  assert.ok(ids({ listingClaimed: false }).includes('profile.not_claimed'));
  assert.ok(!ids({ listingClaimed: true }).includes('profile.not_claimed'));
  assert.ok(!ids({ listingClaimed: null }).includes('profile.not_claimed'), 'unknown → nothing');
  const claim = buildEvidenceAndFindings({ ...base, listingClaimed: false } as any).findings.find((f) => f.id === 'profile.not_claimed')!;
  assert.equal(claim.growwmaticsCapability, null);

  const pm = buildEvidenceAndFindings({ ...base, primaryCategoryMismatch: { category: 'Jewelry store', trade: 'jewellery tools supplier', reason: '', better: 'Jewelry equipment supplier' } } as any).findings
    .find((f) => f.id === 'profile.primary_category_mismatch')!;
  assert.equal(pm.title, 'Your main Google category "Jewelry store" doesn\'t match what you do');
  assert.match(pm.recommendedAction, /Jewelry equipment supplier/);

  const tb = buildEvidenceAndFindings({
    ...base,
    categoryTooBroad: { category: 'Restaurant', suggest: 'Biryani restaurant', competitors: ['Shah Ghouse'] },
    categoryGap: [{ category: 'Biryani restaurant', competitors: ['Shah Ghouse', 'Bawarchi'] }],
  } as any).findings;
  assert.ok(tb.some((f) => f.id === 'profile.category_too_broad'));
  assert.ok(!tb.some((f) => f.id === 'competitors.category_gap'), 'the same category is not suggested twice');

  const ld = buildEvidenceAndFindings({ ...base, categoryLowDemand: { categoryKeyword: 'jewellery equipment supplier bengaluru', categoryVolume: null, betterKeyword: 'jewellery tools bengaluru', betterVolume: 140 } } as any).findings
    .find((f) => f.id === 'keywords.category_low_demand')!;
  assert.match(ld.evidence, /no Google search numbers.*140 searches\/month/);
  assert.match(ld.recommendedAction, /"jewellery tools"/);

  const ph = buildEvidenceAndFindings({ ...base, photosVsCompetitors: { own: 12, median: 150, competitors: 3 } } as any).findings
    .find((f) => f.id === 'profile.photos_vs_competitors')!;
  assert.equal(ph.title, 'You have 12 photos — businesses above you have about 150');
  assert.equal(ph.growwmaticsCapability, 'photo_uploads');
});
