/**
 * Keywords page view (docs/KEYWORD_SYSTEM_PLAN.md §9): every label comes from
 * measured numbers — "Few searches" instead of 0, "Checked in the next
 * report" instead of a guess — and every owner keyword is listed, measured
 * or not.
 * Run: node --experimental-strip-types --test tests/integration/keyword-view.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKeywordsView, rankView, volumeView } from '../../src/services/seo/keywordView.ts';
import type { PlanKeyword } from '../../src/services/seo/keywordTypes.ts';
import { keywordId } from '../../src/services/seo/ids.ts';

const at = '2026-11-01T00:00:00.000Z';
const row = (keyword: string, o: Partial<PlanKeyword> = {}): PlanKeyword => ({
  id: keywordId(keyword), keyword, sources: ['service'], owner: false, serviceId: null, service: null, relevance: 'gbp',
  ideaVolume: null, gbpImpressions: null, competitor: null,
  volume: { country: 500, city: null, area: null, status: 'measured', measuredAt: at },
  rank: { avg: 8, best: 6, foundPct: 1, points: 3, status: 'measured' },
  competitorsAbove: [{ name: 'Apollo Dental', rank: 1, reviews: 900, rating: 4.8 }],
  score: 1, demand: 1, winnability: 1, verdict: 'quick_win', reason: 'Quick win: …', role: 'core', rankTrend: 2, ...o,
});

test('volume labels: city first, then India, then "few searches" with the area number', () => {
  assert.deepEqual(volumeView({ country: 500, city: 120, area: null, status: 'measured', measuredAt: at }), { text: '120 / month', note: 'in your city', value: 120 });
  assert.deepEqual(volumeView({ country: 2400, city: null, area: null, status: 'measured', measuredAt: at }), { text: '2,400 / month', note: 'across India', value: 2400 });
  const few = volumeView({ country: null, city: null, area: { term: 'dentist', area: 'Kolkata', level: 'city', searchVolume: 1900 }, status: 'measured', measuredAt: at });
  assert.equal(few.text, 'Few searches');
  assert.equal(few.value, null);
  assert.match(few.note!, /"dentist" gets 1,900 \/ month in Kolkata/);
  assert.equal(volumeView({ country: null, city: null, area: null, status: 'too_few_searches', measuredAt: at }).text, 'Few searches');
  assert.equal(volumeView(undefined).text, '—');
});

test('rank labels never turn a failed or missing check into "not found"', () => {
  assert.equal(rankView({ avg: 8.4, best: 6, foundPct: 1, points: 3, status: 'measured' }).text, '#8');
  assert.equal(rankView({ avg: null, best: null, foundPct: 0, points: 3, status: 'measured' }).text, 'Not in top 20');
  assert.equal(rankView({ avg: null, best: null, foundPct: 0, points: 3, status: 'unavailable' }).text, 'Could not check this month');
  assert.equal(rankView(undefined).text, 'Checked in the next report');
});

test('every owner keyword is listed; ones added after the report are pending', () => {
  const v = buildKeywordsView({
    keywordSet: [
      row('root canal treatment kolkata', { owner: true }),
      row('teeth whitening kolkata', { owner: true, role: 'owner', verdict: 'low_demand' }),
      row('dentist near me', { role: 'rotating' }),
      row('braces cost kolkata', { role: 'watch' }),
    ],
    gaps: [{ keyword: 'invisalign kolkata', volume: 90, competitor: 'Apollo Dental', competitorRank: 2 }],
    ownerKeywords: ['Root canal treatment Kolkata', 'teeth whitening kolkata', 'kids dentist kolkata'],
  });
  assert.deepEqual(v.yours.map((r) => [r.keyword, r.role]), [
    ['root canal treatment kolkata', 'core'],
    ['teeth whitening kolkata', 'owner'],
    ['kids dentist kolkata', 'pending'],
  ]);
  assert.equal(v.yours[1].verdictLabel, 'Few searches');
  assert.equal(v.yours[2].rankText, 'Checked in the next report');
  assert.deepEqual(v.targets.map((r) => r.keyword), ['root canal treatment kolkata', 'dentist near me']);
  assert.equal(v.competitors[0].topCompetitor?.name, 'Apollo Dental');
  assert.equal(v.gaps[0].volumeText, '90 / month');
  assert.equal(v.hasResearch, true);
});

test('no research yet: owner keywords show as pending, nothing invented', () => {
  const v = buildKeywordsView({ keywordSet: [], gaps: [], ownerKeywords: ['dentist kolkata'] });
  assert.equal(v.hasResearch, false);
  assert.equal(v.yours[0].volumeText, '—');
  assert.equal(v.targets.length, 0);
});

test('Monday notice: only when this week\'s report changed the selection', async () => {
  const { keywordChangeNotice } = await import('../../src/services/seo/keywordView.ts');
  const since = new Date('2026-11-02T00:00:00.000Z');
  const plan = {
    activeFrom: '2026-11-05T00:00:00.000Z',
    keywordSet: [row('dental implants kolkata'), row('braces kolkata', { role: 'rotating' })],
    keywordSetChanges: [
      { keyword: 'braces kolkata', change: 'rotating_added' },
      { keyword: 'teeth whitening kolkata', change: 'core_removed' },
      { keyword: 'dental implants kolkata', change: 'core_kept' },
    ],
  };
  const n = keywordChangeNotice(plan, since)!;
  assert.equal(n.title, 'Your keywords for this month');
  assert.equal(n.body, 'Focus keywords: "dental implants kolkata". New this month: "braces kolkata". Replaced: "teeth whitening kolkata" — the reason is in SEO Plan → Keywords. Your posts and profile now target these.');
  assert.equal(keywordChangeNotice({ ...plan, activeFrom: '2026-10-20T00:00:00.000Z' }, since), null, 'older plan: already told');
  assert.equal(keywordChangeNotice({ ...plan, keywordSetChanges: [{ keyword: 'x', change: 'core_kept' }] }, since), null, 'nothing changed');
});
