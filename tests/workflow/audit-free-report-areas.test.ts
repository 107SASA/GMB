/**
 * Free report v16: the areas a business's website says it serves are searched
 * from inside each area, and a miss becomes a verified issue. Case: a Mohali
 * yoga studio whose website lists Mohali, Chandigarh, Panchkula, Zirakpur and
 * whose v15 report showed "#1 everywhere" (Nov 2026).
 *
 * Run: npx tsx --test tests/workflow/audit-free-report-areas.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { websiteServiceAreaPlaces, planServiceAreaSearches, WEBSITE_AREA_LIMITS } from '../../src/services/audit/areaDiscovery';
import { areaCoverage, type AreaVisibilityFacts } from '../../src/services/audit/areaVisibility';
import { buildEvidenceAndFindings } from '../../src/services/audit/findings';
import { buildReviewFacts, summarizeRankings, suspensionRiskHeuristic } from '../../src/services/audit/facts';

test('website areas: split, own city dropped, no states or "all over India", at most 4', () => {
  const places = websiteServiceAreaPlaces(['Mohali, Chandigarh, Panchkula & Zirakpur', 'Punjab', 'All over India', 'Kharar and Landran'], 'Mohali');
  assert.deepEqual(places.map((p) => p.placeName), ['Chandigarh', 'Panchkula', 'Zirakpur', 'Kharar']);
  assert.ok(places.every((p) => p.placeId === null));
});

test('website areas farther than 60 km are not searched', () => {
  const pin = { lat: 30.7046, lng: 76.7179 }; // Mohali
  const { searches, skipped } = planServiceAreaSearches(pin, 'yoga classes', [
    { name: 'Chandigarh', point: { lat: 30.7333, lng: 76.7794 } },
    { name: 'Ludhiana', point: { lat: 30.901, lng: 75.8573 } },
  ], WEBSITE_AREA_LIMITS);
  assert.deepEqual(searches.map((s) => s.keyword), ['yoga classes Chandigarh', 'yoga classes near me']);
  assert.match(skipped[0].reason, /more than 60 km/);
});

const row = (keyword: string, rank: number | null) => ({ keyword, status: 'ok' as const, found: rank != null, rank, searchVolume: null });
const area = (name: string, rank: number | null) => ({
  area: name, placeId: null, status: 'measured' as const, note: null, distanceKm: 8,
  searches: [row(`yoga classes ${name}`, rank)], bestRank: rank, searchesOk: 1, rankedIn: rank != null ? 1 : 0, competitors: [],
});
const av: AreaVisibilityFacts = {
  version: 1, source: 'website', configured: 3,
  primary: { label: 'Around your address', searches: [row('yoga classes mohali', 3)], bestRank: 3, searchesOk: 1, rankedIn: 1 },
  areas: [area('Chandigarh', null), area('Zirakpur', null), area('Panchkula', 14)],
};

test('coverage: the address counts as one area', () => {
  assert.deepEqual(areaCoverage(av), { measured: 4, visibleIn: 2, missing: ['Chandigarh', 'Zirakpur'] });
});

test('a missed area is a verified ranking issue, high when half or more are missed', () => {
  const { findings } = buildEvidenceAndFindings({
    fields: {}, title: { name: 'YOGA SE HOGA', wordCount: 4 },
    primaryRanking: summarizeRankings([]), nearbyRanking: summarizeRankings([]), nearbyByKeyword: [],
    competitors: [], competitorsAhead: { count: 0, names: [] } as any,
    reviews: buildReviewFacts({ count: 73, rating: 4.9, source: 'google_places' }, { periodDays: 14, synced: false, reviews: [] }),
    reviewComparison: null, keywordRows: [],
    suspensionRisk: suspensionRiskHeuristic({ selfPraiseTerm: null }),
    areaCoverage: { ...areaCoverage(av)!, source: 'website' },
  } as any);
  const f = findings.find((x) => x.id === 'ranking.service_areas.not_found');
  assert.ok(f);
  assert.equal(f!.title, 'Not found in 2 of the 4 areas your website says you serve');
  assert.equal(f!.severity, 'high');
  assert.match(f!.evidence, /Chandigarh, Zirakpur/);
});
