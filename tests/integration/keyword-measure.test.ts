/**
 * Keyword system measurement helpers (docs/KEYWORD_SYSTEM_PLAN.md S2/S4/S5):
 * Maps searches → rank, businesses above us → competitors, Google Ads
 * answers → volume. A failed search is never "not found"; a phrase Google
 * answered with no number is "too few searches", never 0.
 * Run: node --experimental-strip-types --test tests/integration/keyword-measure.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { competitorsAboveFrom, groupByKeyword, rankFromObservations, volumeOf } from '../../src/services/seo/keywordMeasure.ts';
import type { SearchObservation } from '../../src/services/audit/facts.ts';

const obs = (o: Partial<SearchObservation>): SearchObservation => ({
  keyword: 'dentist kolkata', kind: 'discovery', status: 'ok', found: false, rank: null, ahead: [], ...o,
});
const biz = (name: string, position: number, reviewCount: number | null = null, rating: number | null = null) => ({ name, position, reviewCount, rating });

test('rank: average and best over the points where we were found', () => {
  const r = rankFromObservations([
    obs({ found: true, rank: 4 }), obs({ found: true, rank: 7 }), obs({ found: false }),
  ]);
  assert.deepEqual(r, { avg: 5.5, best: 4, foundPct: 0.7, points: 3, status: 'measured' });
});

test('rank: failed searches are unavailable, never "not found"; none = not measured', () => {
  assert.equal(rankFromObservations([obs({ status: 'unavailable' })]).status, 'unavailable');
  assert.equal(rankFromObservations([]).status, 'not_measured');
  const notFound = rankFromObservations([obs({}), obs({ status: 'unavailable' })]);
  assert.deepEqual(notFound, { avg: null, best: null, foundPct: 0, points: 1, status: 'measured' });
});

test('competitors above: most frequent first, top 3, ordered by position', () => {
  const c = competitorsAboveFrom([
    obs({ ahead: [biz('Apollo Dental', 1, 900, 4.8), biz('Smile Care', 2, 300), biz('Tiny Clinic', 3)] }),
    obs({ ahead: [biz('Apollo Dental', 2, 910, 4.8), biz('Smile Care', 1, 305), biz('Gentle Dental', 3, 50)] }),
    obs({ status: 'unavailable', ahead: [biz('Ignored', 1)] }),
  ]);
  // Apollo and Smile Care appear in both searches (avg #1.5 → #2); Tiny Clinic once.
  assert.deepEqual(c.map((x) => [x.name, x.rank]), [['Apollo Dental', 2], ['Smile Care', 2], ['Tiny Clinic', 3]]);
  assert.equal(c.find((x) => x.name === 'Apollo Dental')?.reviews, 910);
  assert.ok(!c.some((x) => x.name === 'Ignored'));
});

test('volume: measured, too few searches, or not asked — never invented', () => {
  const country = new Map<string, number | null>([['dentist kolkata', 2400], ['dentist salt lake', null]]);
  const city = new Map<string, number | null>([['dentist kolkata', 880]]);
  const at = '2026-11-09T00:00:00.000Z';
  assert.deepEqual(volumeOf('Dentist Kolkata', { country, city }, at), { country: 2400, city: 880, area: null, status: 'measured', measuredAt: at });
  assert.equal(volumeOf('dentist salt lake', { country, city }, at).status, 'too_few_searches');
  assert.equal(volumeOf('braces', { country, city }, at).status, 'not_measured');
  assert.equal(volumeOf('braces', { country, city }, at).measuredAt, null);
  const area = new Map([['dentist salt lake', { term: 'dentist', area: 'Kolkata', level: 'city' as const, searchVolume: 2400 }]]);
  assert.equal(volumeOf('dentist salt lake', { country, area }, at).status, 'measured');
  assert.equal(volumeOf('ideas only', { country, ideaVolume: 140 }, at).country, 140);
});

test('observations group by keyword, case-insensitively', () => {
  const g = groupByKeyword([obs({ keyword: 'Dentist Kolkata' }), obs({ keyword: 'dentist kolkata ' }), obs({ keyword: 'braces' })]);
  assert.equal(g.get('dentist kolkata')?.length, 2);
  assert.equal(g.size, 2);
});
