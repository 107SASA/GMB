/**
 * Final evidence / data-quality audit (Sep 2026): ranking statistics,
 * competitor relevance, review reply state, finding execution metadata,
 * invented-claim validation, provider metering and audit comparison.
 * Pure functions — no DB, no network, no `@/` aliases.
 *
 * Run with: node --experimental-strip-types --test tests/integration/audit-final.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildObservation,
  buildReviewFacts,
  competitorRelevance,
  competitorsFromObservations,
  isNonBusinessResult,
  summarizeRankings,
} from '../../src/services/audit/facts.ts';
import { findingExecution } from '../../src/services/audit/findings.ts';
import { claimsFabricatedOutcome, claimsUnknownService, dropUnsupportedSentences, groundText, allowedNumbersFrom, inventedClaimChecker, namesUnknownBusiness } from '../../src/services/audit/validateAudit.ts';
import { compareAudits, buildOptimizationPlan } from '../../src/services/audit/optimizationPlan.ts';
import { meter, mergeIntoMeter, providerCallLines, runWithMeter, currentMeterReasons } from '../../src/lib/providerMeter.ts';
import { buildIntakePrefill } from '../../src/services/intel/intakePrefill.ts';

const biz = (name: string, placeId: string, extra: Record<string, unknown> = {}) => ({ name, placeId, rating: 4.5, reviewCount: 50, ...extra });
const filler = (n: number, from = 0) => Array.from({ length: n }, (_, i) => biz(`F${from + i}`, `f${from + i}`));

// ── Ranking ────────────────────────────────────────────────────────────────

test('ranking: #2, #8, not found, not found, #4 → average 4.7 where found, visibility 3/5', () => {
  const obs = [
    buildObservation({ keyword: 'a', kind: 'primary', targetPosition: 2, results: [biz('X', 'x'), biz('T', 't'), ...filler(5)] }),
    buildObservation({ keyword: 'b', kind: 'primary', targetPosition: 8, results: [...filler(7), biz('T', 't')] }),
    buildObservation({ keyword: 'c', kind: 'primary', targetPosition: null, results: filler(20) }),
    buildObservation({ keyword: 'd', kind: 'primary', targetPosition: null, results: filler(20) }),
    buildObservation({ keyword: 'e', kind: 'primary', targetPosition: 4, results: [...filler(3), biz('T', 't')] }),
  ];
  const s = summarizeRankings(obs);
  assert.equal(s.averageObservedRank, 4.7, 'never (2+8+21+21+4)/5');
  assert.equal(s.foundCount, 3);
  assert.equal(s.notFoundCount, 2);
  assert.equal(s.visibilityRate, 0.6);
  assert.equal(s.top3Count, 1);
  assert.equal(s.top5Count, 2);
  assert.equal(s.top10Count, 3);
  assert.equal(s.unavailableCount, 0);
  assert.ok(obs.filter((o) => !o.found).every((o) => o.rank === null), 'not found is null, never 21');
});

test('ranking: provider failure is unavailable — never a poor rank', () => {
  const failed = buildObservation({ keyword: 'a', kind: 'primary', targetPosition: null, results: null });
  const ok = buildObservation({ keyword: 'b', kind: 'primary', targetPosition: 3, results: [...filler(2), biz('T', 't')] });
  const mixed = summarizeRankings([failed, ok]);
  assert.equal(mixed.status, 'partial');
  assert.equal(mixed.testedCount, 1);
  assert.equal(mixed.unavailableCount, 1);
  assert.equal(mixed.averageObservedRank, 3);
  const allFailed = summarizeRankings([failed, failed]);
  assert.equal(allFailed.status, 'unavailable');
  assert.equal(allFailed.averageObservedRank, null);
  assert.equal(allFailed.visibilityRate, null, 'no rate from zero valid searches');
  assert.equal(failed.ahead.length, 0, 'a failed search yields no competitors');
});

// ── Competitors ────────────────────────────────────────────────────────────

test('competitors: deduped by Place ID, above-target vs total appearances, measured relevance', () => {
  const s = (target: number | null, names: string[]) =>
    buildObservation({
      keyword: `k${Math.random()}`, kind: 'primary', targetPosition: target,
      results: names.map((n) => (n === 'T' ? biz('T', 't') : biz(n === 'A2' ? 'A (Branch Name Variant)' : n, n === 'A2' ? 'a' : n.toLowerCase(), { category: `${n} category` }))),
    });
  const obs = [
    s(3, ['A', 'B', 'T', 'C']),  // A, B above; C below
    s(2, ['A2', 'T', 'B', 'C']), // A above (same place id, different name); B, C below
    s(1, ['T', 'A', 'C']),       // nobody above
    s(null, ['A', 'D']),         // not found: all above
  ];
  const comps = competitorsFromObservations(obs);
  const a = comps.find((c) => c.placeId === 'a')!;
  const b = comps.find((c) => c.placeId === 'b')!;
  const d = comps.find((c) => c.placeId === 'd')!;
  assert.equal(comps.filter((c) => c.placeId === 'a').length, 1, 'deduplicated by Place ID');
  assert.equal(a.searchesAhead, 3);
  assert.equal(a.appearances, 4, 'appears in all 4 searches (once below the target)');
  assert.equal(a.relevance, 'strong');
  assert.equal(b.searchesAhead, 1);
  assert.equal(b.appearances, 2);
  assert.equal(b.relevance, 'incidental', 'one sighting above is never a major competitor');
  assert.equal(d.relevance, 'incidental');
  assert.ok(!comps.some((c) => c.placeId === 'c'), 'never above the target → not a competitor ahead');
  assert.ok(comps.every((c) => c.similarityScore === null), 'no hardcoded similarity');
  assert.equal(a.category, 'A category', "competitor's own category, never the target's");
  assert.equal(competitorRelevance(2, 10), 'moderate');
});

test('competitors: a town/locality pin in the results is never a competitor (live: "Ojhar — Maharashtra")', () => {
  const o = buildObservation({
    keyword: 'website development ojhar', kind: 'discovery', targetPosition: 3,
    results: [
      { name: 'Ojhar', placeId: 'town', address: 'Maharashtra' },
      biz('Real Agency', 'r', { category: 'Website designer', address: 'Shop 4, Main Road, Ojhar 422206' }),
      biz('T', 't'),
    ],
  });
  assert.equal(o.rank, 3, "the target's rank stays Google's literal position");
  assert.deepEqual(o.ahead.map((a) => a.name), ['Real Agency']);
  assert.equal(isNonBusinessResult({ name: 'Unrated New Shop', address: '12, MG Road, Pune' }), false, 'a street address is a business');
});

// ── Reviews ────────────────────────────────────────────────────────────────

test('reviews: lifetime stays separate from the recent window; small samples are labelled', () => {
  const f = buildReviewFacts({ count: 3, rating: 5, source: 'google_places' }, { periodDays: 14, synced: true, reviews: [{ rating: 5, hasReply: true, text: 'Great work on our website, very responsive' }] });
  assert.equal(f.lifetime.totalCount, 3);
  assert.equal(f.recent.newReviewCount, 1, '14-day count is never the total');
  assert.equal(f.lifetime.sampleSize, 'very_small');
  assert.equal(f.recent.responseRate, 1);
});

test('reviews: missing text → no themes source; missing reply data → unknown, not unanswered', () => {
  const noText = buildReviewFacts(null, { periodDays: 14, synced: true, reviews: [{ rating: 4, hasReply: false }] });
  assert.equal(noText.recent.textSampleCount, 0);
  const oldRecords = buildReviewFacts(null, { periodDays: 14, synced: true, reviews: [{ rating: 5, hasReply: null }, { rating: 4, hasReply: false }] });
  assert.equal(oldRecords.recent.responseRate, null, 'a partial reply picture is not reported as a rate');
  assert.equal(oldRecords.recent.replyUnknownCount, 1);
  const notSynced = buildReviewFacts({ count: 118, rating: 4.5, source: 'serpapi' }, { periodDays: 14, synced: false, reviews: [] });
  assert.equal(notSynced.recent.responseRate, null);
  assert.equal(notSynced.recent.newReviewCount, null);
});

// ── Findings: execution metadata ───────────────────────────────────────────

test('findings: owner action, GrowwMatics action, GBP connection, measurement', () => {
  const reviews = findingExecution({ source: 'google_places', category: 'reviews', growwmaticsCapability: 'review_requests', recommendedAction: 'Ask for reviews' });
  assert.equal(reviews.evidenceState, 'VERIFIED');
  assert.match(reviews.growwmaticsAction!, /review-request/);
  assert.equal(reviews.requiresGbpConnection, false, 'WhatsApp review requests do not need the GBP API');
  assert.match(reviews.measurement, /review count/i);
  const phone = findingExecution({ source: 'google_places', category: 'profile', growwmaticsCapability: 'update_phone', recommendedAction: 'Add phone' });
  assert.equal(phone.requiresGbpConnection, true);
  const cats = findingExecution({ source: 'website', category: 'website', growwmaticsCapability: null, recommendedAction: 'Verify your Google services list' });
  assert.equal(cats.growwmaticsAction, null, 'never implies GrowwMatics can do what it cannot');
  assert.equal(cats.ownerAction, 'Verify your Google services list');
  assert.equal(cats.evidenceState, 'SOURCE_CLAIM');
});

test('optimization plan: executed-by, owner confirmation and GBP requirement per task', () => {
  const [item] = buildOptimizationPlan([{ id: 'reviews.volume_gap', category: 'reviews', title: 't', evidence: '3 lifetime Google reviews', evidenceIds: [], source: 'google_places', severity: 'high', actionability: 'indirectly_influenceable', growwmaticsCapability: 'review_requests', recommendedAction: 'Implement a review request workflow' }]);
  assert.equal(item.executedBy, 'growwmatics_and_owner');
  assert.equal(item.requiresOwnerConfirmation, true);
  assert.equal(item.requiresGbpConnection, false);
  assert.equal(item.executionStatus, 'not_started');
  assert.equal(item.evidenceState, 'VERIFIED');
});

// ── AI output validation ───────────────────────────────────────────────────

const ctx = {
  businessNames: ['Mulsetu', 'AdScapes Digital Marketing Agency', 'AMM DigiSol'],
  places: ['Ojhar', 'Nashik', 'Om Sai Nagar'],
  serviceTerms: ['Website Development', 'AI & Automation', 'Mobile App Development', 'Software company'],
};

test('AI: invented competitor rejected, real competitor accepted', () => {
  assert.equal(namesUnknownBusiness('Competitors such as Pixel Forge Studios rank above you.', ctx), 'Pixel Forge Studios');
  assert.equal(namesUnknownBusiness('Businesses shown above you include AdScapes Digital Marketing Agency and AMM DigiSol.', ctx), null);
  assert.equal(namesUnknownBusiness('Ask every recent customer for a Google review.', ctx), null);
  // Live false positives (Sep 2026): Title Case headings are not business names.
  assert.equal(namesUnknownBusiness('Fewer Reviews Than Competitors', ctx), null);
  assert.equal(namesUnknownBusiness('Competitors Ranking Ahead', ctx), null);
});

test('AI: invented service rejected, stated service accepted', () => {
  assert.equal(claimsUnknownService('Mulsetu offers CCTV installation and website development.', ctx), 'CCTV installation');
  assert.equal(claimsUnknownService('Mulsetu offers website development and mobile app development.', ctx), null);
  // Live false positives: listing features and trailing commentary are not service claims.
  assert.equal(claimsUnknownService('Your website provides an online booking link.', ctx), null);
  assert.equal(claimsUnknownService('Its website lists six technology services and offers an online booking link, showing a clear service focus.', ctx), null);
  assert.equal(claimsUnknownService('The website provides an easy online booking link.', ctx), null);
  // …while a real invented service in the same shape is still caught.
  assert.equal(claimsUnknownService('Mulsetu offers website development, AI automation and digital marketing, showing breadth.', ctx), 'digital marketing');
  const check = inventedClaimChecker(ctx);
  assert.equal(check('Mulsetu provides plumbing services in Ojhar.'), true);
  assert.equal(check('Mulsetu builds websites for clients in Nashik.'), false);
});

test('AI: invented number rejected, real number accepted', () => {
  const allowed = allowedNumbersFrom([{ reviews: 3, rating: 5, searches: 11 }]);
  assert.equal(groundText('You have 3 reviews across 11 searches.', allowed), 'You have 3 reviews across 11 searches.');
  assert.equal(groundText('Competitor A has 142 reviews.', allowed), undefined, 'a number not in the facts is rejected');
});

test('AI: fabricated outcomes / ROI rejected even with whitelisted numbers', () => {
  for (const s of ['You could get 30 more calls a month.', 'Expect 2x more leads.', 'This adds ₹50,000 extra revenue.',
    'It will increase your calls by 40%.', 'You will rank #1 within 90 days.']) {
    assert.equal(claimsFabricatedOutcome(s), true, s);
  }
  assert.equal(claimsFabricatedOutcome('Re-measure the same 11 searches in 30 days.'), false);
  assert.equal(dropUnsupportedSentences('Your rating is strong. You could get 30 more calls a month.'), 'Your rating is strong.');
});

// ── Website ────────────────────────────────────────────────────────────────

test('website: no website and failed crawl produce no website claims', () => {
  assert.deepEqual(buildIntakePrefill({ business: {}, website: null }), {});
  assert.deepEqual(buildIntakePrefill({ business: {}, website: { status: 'failed', services: [{ value: 'SEO', sourceUrl: 'https://x.test' }] } }), {});
  const partial = buildIntakePrefill({ business: {}, website: { status: 'partial', services: [{ value: 'SEO Services', sourceUrl: 'https://x.test/services' }] } });
  assert.equal(partial.services?.sourceUrl, 'https://x.test/services', 'source URL retained from a partial crawl');
});

// ── Cost metering ──────────────────────────────────────────────────────────

test('cost: provider calls recorded with reason, endpoint and list price', async () => {
  const { counts, reasons } = await runWithMeter(async () => {
    meter('dataForSeoMapsLiveTask', 1, 'rank_search_grid_point');
    meter('dataForSeoMapsLiveTask', 1, 'rank_search_grid_point');
    meter('dataForSeoAdsVolumeLiveTask', 1, 'keyword_demand');
    meter('rankCacheHit', 1, 'rank_blob_reused');
    mergeIntoMeter({ serpApiSearch: 2 }, { 'serpApiSearch|review_page': 2 });
    assert.equal(currentMeterReasons()?.['serpApiSearch|review_page'], 2);
  });
  assert.equal(counts.dataForSeoMapsLiveTask, 2);
  assert.equal(counts.serpApiSearch, 2);
  const prices: Record<string, number> = { dataForSeoMapsLiveTask: 0.002, dataForSeoAdsVolumeLiveTask: 0.09, serpApiSearch: 0.015 };
  const lines = providerCallLines(reasons, (k) => prices[k] ?? null);
  const ads = lines.find((l) => l.endpoint === 'Google Ads Search Volume Live')!;
  assert.equal(ads.provider, 'DataForSEO');
  assert.equal(ads.listPriceUsd, 0.09);
  assert.equal(lines[0].endpoint, 'Google Ads Search Volume Live', 'sorted most expensive first');
  assert.equal(lines.find((l) => l.reason === 'rank_blob_reused')?.listPriceUsd, null, 'cache hits cost nothing');
  meter('dataForSeoMapsLiveTask'); // outside an audit: ignored, never throws
});

test('cost: a cache hit replaces the paid calls it stands for', async () => {
  const cold = await runWithMeter(async () => { for (let i = 0; i < 11; i++) meter('dataForSeoMapsLiveTask', 1, 'rank'); });
  const warm = await runWithMeter(async () => { meter('rankCacheHit', 1, 'rank_blob_reused'); });
  assert.equal(cold.counts.dataForSeoMapsLiveTask, 11);
  assert.equal(warm.counts.dataForSeoMapsLiveTask, undefined);
});

// ── Comparison / ROI baseline ──────────────────────────────────────────────

test('comparison: customer actions compared only when both audits measured them', () => {
  const base = { auditId: 'a', kind: 'connected_baseline' as const, at: '2026-09-01', keywords: ['x'], searches: 9, foundCount: 5, top3Count: 1, averageObservedRank: 6, reviewCount: 10, rating: 4.6, completionPercentage: 80, completionScope: 'full' };
  const withPerf = compareAudits(
    { ...base, performance: { days: 28, calls: 12, websiteClicks: 30, directionRequests: 8 } },
    { ...base, auditId: 'b', kind: 'monthly', performance: { days: 28, calls: 19, websiteClicks: 30, directionRequests: 5 } },
  );
  const calls = withPerf.rows.find((r) => r.metric.startsWith('Calls'))!;
  assert.equal(calls.change, 'better');
  assert.equal(withPerf.rows.find((r) => r.metric.startsWith('Direction'))!.change, 'worse');
  const freeToConnected = compareAudits({ ...base, kind: 'free_report', completionScope: 'places' }, { ...base, auditId: 'c', performance: { days: 28, calls: 4, websiteClicks: 2, directionRequests: 1 } });
  assert.equal(freeToConnected.rows.find((r) => r.metric.startsWith('Calls'))!.change, 'not_comparable', 'no trend from a single measurement');
  assert.equal(freeToConnected.rows.find((r) => r.metric === 'Profile completion')!.change, 'not_comparable');
});
