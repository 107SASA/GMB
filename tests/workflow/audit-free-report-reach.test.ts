/**
 * Free report v20 — reach check (docs/FREE_REPORT_REBUILD_PLAN.md Part D
 * step 5): the main keyword searched farther from the business, by how it
 * serves and what it offers — the same rules for every category.
 *
 * Run: npx tsx --test tests/workflow/audit-free-report-reach.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planReachSearches, buildReachFacts, REACH_LIMITS } from '../../src/services/audit/reachCheck';
import { haversineKm } from '../../src/services/audit/areaDiscovery';
import { buildEvidenceAndFindings } from '../../src/services/audit/findings';
import { buildReviewFacts, summarizeRankings, suspensionRiskHeuristic } from '../../src/services/audit/facts';

const pin = { lat: 12.9716, lng: 77.5946 };
const centre = { lat: 12.9784, lng: 77.6408 }; // ~5 km east
const plan = (servedHow: string, offered: string, extra: Partial<Parameters<typeof planReachSearches>[0]> = {}) =>
  planReachSearches({ pin, keyword: 'jewellery equipment bengaluru', servedHow, offered, city: 'Bengaluru', cityCentre: centre, covered: [], ...extra });

test('a shop customers visit: 4 points around it, 3 to 10 km, no city centre', () => {
  const p = plan('storefront', 'products');
  assert.deepEqual(p.map((x) => x.label), ['~3 km north', '~6 km east', '~6 km west', '~10 km south']);
  for (const x of p) assert.ok(Math.abs(haversineKm(pin, x.point) - x.distanceKm) < 0.2, x.label);
});

test('maker / wholesaler: city centre + farther points, at most 6', () => {
  const p = plan('storefront', 'made_to_order');
  assert.equal(p[0].label, 'Bengaluru centre');
  assert.deepEqual(p.map((x) => x.label), ['Bengaluru centre', '~10 km west', '~25 km north', '~25 km south'],
    '"~6 km east" is too close to the centre (~5 km east) and is skipped');
  assert.ok(p.length <= REACH_LIMITS.maxPoints);
});

test('service-area / hybrid: city centre + two farther points (areas served are searched elsewhere)', () => {
  assert.deepEqual(plan('service_area', 'services').map((x) => x.label), ['Bengaluru centre', '~10 km west']);
  assert.deepEqual(plan('hybrid', 'services', { cityCentre: null }).map((x) => x.label), ['~6 km east', '~10 km west']);
});

test('online: city level, far points only', () => {
  assert.deepEqual(plan('online', 'services').map((x) => x.label), ['Bengaluru centre', '~15 km east', '~30 km west']);
});

test('never repeats a place already searched; no keyword → nothing', () => {
  const p = plan('storefront', 'products', { covered: [{ lat: pin.lat + 3 / 111, lng: pin.lng }] });
  assert.ok(!p.some((x) => x.label === '~3 km north'));
  assert.deepEqual(plan('storefront', 'products', { keyword: '' }), []);
});

const obs = (area: string, o: { found: boolean; rank: number | null; status?: 'ok' | 'unavailable'; ahead?: string[] }) => ({
  keyword: 'k', kind: 'discovery' as const, area, status: o.status ?? 'ok' as const, found: o.found, rank: o.rank,
  ahead: (o.ahead || []).map((name, i) => ({ name, position: i + 1 })) as any,
});

test('facts: top 3 up to the farthest unbroken point; weak places; unmeasured is never "not found"', () => {
  const places = plan('storefront', 'products');
  const r = buildReachFacts('jewellery equipment bengaluru', places, [
    obs('~3 km north', { found: true, rank: 1 }),
    obs('~6 km east', { found: true, rank: 2, ahead: ['Shree Tools'] }),
    obs('~6 km west', { found: true, rank: 14, ahead: ['Random Cafe', 'Gold Tools Co'] }),
    obs('~10 km south', { found: false, rank: null, status: 'unavailable' }),
  ], { sameTrade: (n) => n === 'Gold Tools Co' })!;
  assert.equal(r.top3WithinKm, 6);
  assert.deepEqual(r.weakIn, ['~6 km west']);
  const west = r.points.find((p) => p.label === '~6 km west')!;
  assert.equal(west.shownFirst, 'Gold Tools Co', 'a same-trade business is named first');
  const south = r.points.find((p) => p.label === '~10 km south')!;
  assert.equal(south.status, 'unavailable');
  assert.equal(south.rank, null);
});

const base = {
  fields: {}, title: { name: 'X', wordCount: 1 },
  primaryRanking: summarizeRankings([]), nearbyRanking: summarizeRankings([]), nearbyByKeyword: [],
  competitors: [], competitorsAhead: { count: 0, names: [] },
  reviews: buildReviewFacts({ count: 1002, rating: 4.8, source: 'google_places' }, { periodDays: 14, synced: false, reviews: [] }),
  reviewComparison: null, keywordRows: [], suspensionRisk: suspensionRiskHeuristic({ selfPraiseTerm: null }),
};

test('finding: a strong business that drops out farther away gets an honest issue; all strong → none', () => {
  const reach = {
    keyword: 'jewellery equipment bengaluru', top3WithinKm: 6, weakIn: ['~10 km south'],
    points: [
      { label: '~3 km north', distanceKm: 3, status: 'ok' as const, rank: 1, shownFirst: null },
      { label: '~6 km east', distanceKm: 6, status: 'ok' as const, rank: 2, shownFirst: 'Shree Tools' },
      { label: '~10 km south', distanceKm: 10, status: 'ok' as const, rank: null, shownFirst: 'Gold Tools Co' },
    ],
  };
  const f = buildEvidenceAndFindings({ ...base, reach } as any).findings.find((x) => x.id === 'ranking.reach');
  assert.ok(f);
  assert.equal(f!.title, 'You lead near your business, but drop out farther away for "jewellery equipment bengaluru"');
  assert.match(f!.evidence, /Top 3 up to ~6 km\. ~10 km south: not in the top 20 \(Gold Tools Co shown first\)/);
  assert.equal(f!.severity, 'medium');
  const none = buildEvidenceAndFindings({ ...base, reach: { ...reach, weakIn: [] } } as any).findings;
  assert.ok(!none.some((x) => x.id === 'ranking.reach'));
});
