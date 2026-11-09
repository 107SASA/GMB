/**
 * Keyword system foundation (docs/KEYWORD_SYSTEM_PLAN.md, Phase 1):
 * research candidates, scoring/verdicts, target selection (90-day core lock,
 * swap limit, owner guarantee), rank-check planning and competitor gaps.
 * Run: node --experimental-strip-types --test tests/integration/keyword-system.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidates, cleanOwnerKeywords, type ResearchInput } from '../../src/services/seo/keywordResearch.ts';
import { scoreKeyword, bestDemand } from '../../src/services/seo/keywordScore.ts';
import { selectTargets } from '../../src/services/seo/keywordSelect.ts';
import {
  buildKeywordSet, competitorGaps, legacyKeywordLists, planRankChecks, scoreCandidates,
  NOT_MEASURED_RANK, NOT_MEASURED_VOLUME,
} from '../../src/services/seo/keywordSet.ts';
import type { VerifiedService } from '../../src/services/seo/trackedKeywords.ts';
import type {
  KeywordCandidate, KeywordRank, KeywordVolume, PlanKeyword, ScoredKeyword,
} from '../../src/services/seo/keywordTypes.ts';
import { keywordId } from '../../src/services/seo/ids.ts';

// ── Fixtures ───────────────────────────────────────────────────────────────

const svc = (name: string, source: VerifiedService['source'] = 'gbp'): VerifiedService => ({
  id: `svc:${name.toLowerCase().replace(/\s+/g, '-')}`, name, source, state: source === 'gbp' ? 'VERIFIED' : 'OWNER_CONFIRMED',
});
const SERVICES = [svc('Root canal treatment'), svc('Dental implants'), svc('Teeth whitening'), svc('Braces')];

const research = (over: Partial<ResearchInput> = {}): ResearchInput => ({
  businessName: 'Smilewell Dental Clinic',
  category: 'Dentist',
  city: 'Kolkata',
  serviceAreas: ['Salt Lake', 'New Town'],
  ownerKeywords: [],
  services: SERVICES,
  gbpSearchTerms: [],
  googleIdeas: [],
  competitorKeywords: [],
  competitorNames: ['Apollo Dental Care'],
  ownerRemoved: [],
  ...over,
});

const vol = (country: number | null, o: Partial<KeywordVolume> = {}): KeywordVolume => ({
  country, city: null, area: null, status: country == null ? 'too_few_searches' : 'measured', measuredAt: '2026-11-01T00:00:00.000Z', ...o,
});
const rank = (avg: number | null, o: Partial<KeywordRank> = {}): KeywordRank => ({
  avg, best: avg, foundPct: avg == null ? 0 : 1, points: 3, status: 'measured', ...o,
});
const cand = (keyword: string, o: Partial<KeywordCandidate> = {}): KeywordCandidate => ({
  id: keywordId(keyword), keyword, sources: ['service'], owner: false,
  serviceId: 'svc:x', service: 'X', relevance: 'gbp', ideaVolume: null, gbpImpressions: null, competitor: null, ...o,
});
const scored = (keyword: string, v: KeywordVolume, r: KeywordRank, o: Partial<KeywordCandidate> = {}, ourReviews: number | null = 100): ScoredKeyword =>
  scoreKeyword({ candidate: cand(keyword, o), volume: v, rank: r, competitorsAbove: [], ourReviews });

const NOW = new Date('2026-11-09T00:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

// ── Owner keyword cap ──────────────────────────────────────────────────────

test('owner keywords are cleaned, deduped and capped at 20', () => {
  const many = Array.from({ length: 100 }, (_, i) => `service ${i} kolkata`);
  assert.equal(cleanOwnerKeywords(many).length, 20);
  assert.deepEqual(cleanOwnerKeywords(['Root Canal', 'root canal', '.', '123', '  Braces  ']), ['Root Canal', 'Braces']);
  assert.deepEqual(cleanOwnerKeywords('not an array'), []);
});

// ── S1 research ────────────────────────────────────────────────────────────

test('owner keywords are always kept, even with no matching service', () => {
  const c = buildCandidates(research({ ownerKeywords: ['root canal treatment kolkata', 'cosmetic surgery'] }));
  const owner = c.filter((x) => x.owner);
  assert.equal(owner.length, 2);
  assert.equal(owner.find((x) => x.keyword === 'cosmetic surgery')?.relevance, 'none');
  assert.equal(c[0].keyword, 'root canal treatment kolkata', 'owner keywords come first');
});

test('research builds services × city, × service areas and "near me"', () => {
  const kw = buildCandidates(research()).map((x) => x.keyword);
  assert.ok(kw.includes('dental implants kolkata'));
  assert.ok(kw.includes('root canal treatment salt lake'));
  assert.ok(kw.includes('root canal treatment near me'));
});

test('claim words, brand names, competitor names and removed keywords are dropped (non-owner)', () => {
  const kw = buildCandidates(research({
    googleIdeas: [
      { keyword: 'best dental implants kolkata', volume: 900 },
      { keyword: 'smilewell dental implants', volume: 50 },
      { keyword: 'apollo dental implants', volume: 400 },
      { keyword: 'braces cost kolkata', volume: 210 },
      { keyword: 'car repair kolkata', volume: 5000 },
    ],
    ownerRemoved: ['braces kolkata'],
  })).map((x) => x.keyword);
  assert.ok(!kw.includes('best dental implants kolkata'), 'claim word');
  assert.ok(!kw.includes('smilewell dental implants'), 'own brand');
  assert.ok(!kw.includes('apollo dental implants'), 'competitor name');
  assert.ok(!kw.includes('car repair kolkata'), 'no matching service');
  assert.ok(!kw.includes('braces kolkata'), 'owner removed it');
  assert.ok(kw.includes('braces cost kolkata'));
});

test('a keyword from several sources is one candidate with every source', () => {
  const c = buildCandidates(research({
    ownerKeywords: ['dental implants kolkata'],
    gbpSearchTerms: [{ keyword: 'Dental implants Kolkata', impressions: 42 }],
    googleIdeas: [{ keyword: 'dental implants kolkata', volume: 320 }],
  }));
  const row = c.filter((x) => x.keyword === 'dental implants kolkata');
  assert.equal(row.length, 1);
  assert.deepEqual(row[0].sources.sort(), ['gbp_search_term', 'google_ideas', 'owner', 'service'].sort());
  assert.equal(row[0].gbpImpressions, 42);
  assert.equal(row[0].ideaVolume, 320);
  assert.equal(row[0].owner, true);
});

test('candidates are capped', () => {
  const ideas = Array.from({ length: 900 }, (_, i) => ({ keyword: `dental implants option ${i}`, volume: i }));
  assert.equal(buildCandidates(research({ googleIdeas: ideas })).length, 700);
});

test('no services → the category stands in', () => {
  const kw = buildCandidates(research({ services: [] })).map((x) => x.keyword);
  assert.ok(kw.includes('dentist kolkata'));
  assert.ok(kw.includes('dentist near me'));
});

// ── S3 scoring ─────────────────────────────────────────────────────────────

test('demand prefers city volume, then country, then half the area demand', () => {
  assert.deepEqual(bestDemand(vol(500, { city: 120 }), null), { searches: 120, basis: 'city' });
  assert.deepEqual(bestDemand(vol(500), null), { searches: 500, basis: 'country' });
  assert.deepEqual(
    bestDemand(vol(null, { area: { term: 'dentist', area: 'Kolkata', level: 'city', searchVolume: 2400 } }), null),
    { searches: 1200, basis: 'area' },
  );
  assert.deepEqual(bestDemand(vol(null), null), { searches: null, basis: 'none' });
});

test('verdicts follow the measured numbers', () => {
  assert.equal(scored('a', vol(300), rank(6)).verdict, 'quick_win');
  assert.equal(scored('b', vol(300), rank(2)).verdict, 'defend');
  assert.equal(scored('c', vol(300), rank(15)).verdict, 'strong');
  assert.equal(scored('d', vol(null), rank(6)).verdict, 'low_demand');
  assert.equal(scored('e', vol(300), NOT_MEASURED_RANK).verdict, 'new');
  assert.equal(scored('f', vol(300), rank(6), { relevance: 'none' }).verdict, 'not_relevant');
  assert.equal(scored('g', NOT_MEASURED_VOLUME, NOT_MEASURED_RANK).verdict, 'new', 'volume not asked yet is not "low demand"');
});

test('GBP impressions count as demand when Google Ads has no number', () => {
  const k = scored('h', vol(null), rank(8), { gbpImpressions: 35, sources: ['gbp_search_term'] });
  assert.equal(k.verdict, 'quick_win');
  assert.match(k.reason, /35 customers saw your profile/);
});

test('far-off rank against much stronger competitors is "hard"', () => {
  const k = scoreKeyword({
    candidate: cand('i'), volume: vol(300), rank: rank(null),
    competitorsAbove: [{ name: 'Apollo', rank: 1, reviews: 900, rating: 4.8 }, { name: 'B', rank: 2, reviews: 600, rating: 4.6 }],
    ourReviews: 40,
  });
  assert.equal(k.verdict, 'hard');
  assert.match(k.reason, /Apollo is #1 with many more reviews/);
});

test('a quick win outscores a top-3 keyword with the same demand', () => {
  assert.ok(scored('j', vol(300), rank(6)).score > scored('k', vol(300), rank(2)).score);
});

test('reasons state only measured facts', () => {
  assert.equal(scored('l', vol(320), rank(9)).reason, 'Quick win: 320 Google searches a month; you are #9 on Google Maps.');
  assert.equal(scored('m', vol(null), rank(null)).reason, 'Few searches: Google reports too few searches for this exact phrase; you are not in the top 20 on Google Maps yet.');
});

// ── S6 selection ───────────────────────────────────────────────────────────

const pool = (n: number, base = 1000) =>
  Array.from({ length: n }, (_, i) => scored(`keyword ${i}`, vol(base - i * 50), rank(12), { serviceId: `svc:${i}`, service: `S${i}` }));

test('first plan: 5 core + 5 rotating by score, the rest watched', () => {
  const { keywords } = selectTargets({ scored: pool(15), previous: [], now: NOW });
  assert.deepEqual(keywords.filter((k) => k.role === 'core').map((k) => k.keyword), ['keyword 0', 'keyword 1', 'keyword 2', 'keyword 3', 'keyword 4']);
  assert.equal(keywords.filter((k) => k.role === 'rotating').length, 5);
  assert.equal(keywords.filter((k) => k.role === 'watch').length, 5);
  for (const k of keywords.filter((x) => x.role === 'core')) {
    assert.equal(k.coreSince, NOW.toISOString());
    assert.equal(k.coreStartRank, 12);
  }
});

test('owner keywords that score in the top 10 get up to 2 core slots', () => {
  const owners = [
    scored('owner a', vol(800), rank(12), { owner: true, sources: ['owner'], serviceId: 'svc:oa' }),
    scored('owner b', vol(760), rank(12), { owner: true, sources: ['owner'], serviceId: 'svc:ob' }),
    scored('owner c', vol(720), rank(12), { owner: true, sources: ['owner'], serviceId: 'svc:oc' }),
    scored('owner weak', vol(5), rank(12), { owner: true, sources: ['owner'], serviceId: 'svc:ow' }),
  ];
  const { keywords } = selectTargets({ scored: [...pool(12), ...owners], previous: [], now: NOW });
  const core = keywords.filter((k) => k.role === 'core');
  assert.equal(core.filter((k) => k.owner).length, 2);
  assert.ok(core.some((k) => k.keyword === 'owner a') && core.some((k) => k.keyword === 'owner b'));
  assert.notEqual(keywords.find((k) => k.keyword === 'owner c')?.role, 'core', 'only 2 guaranteed owner slots');
  assert.equal(keywords.find((k) => k.keyword === 'owner weak')?.role, 'owner', 'weak owner keyword stays measured, not targeted');
});

test('low-demand and unrelated keywords are never targeted', () => {
  const { keywords } = selectTargets({
    scored: [scored('dead', vol(null), rank(5)), scored('unrelated', vol(900), rank(5), { relevance: 'none', owner: true }), ...pool(3)],
    previous: [], now: NOW,
  });
  const targets = keywords.filter((k) => k.role === 'core' || k.role === 'rotating').map((k) => k.keyword);
  assert.ok(!targets.includes('dead') && !targets.includes('unrelated'));
  assert.equal(keywords.find((k) => k.keyword === 'unrelated')?.role, 'owner');
});

const asPrev = (k: ScoredKeyword, o: Partial<PlanKeyword>): PlanKeyword => ({ ...k, role: 'core', rankTrend: null, ...o });

test('core keywords are locked for 90 days even when not moving', () => {
  const stuck = scored('stuck', vol(100), rank(18), { serviceId: 'svc:stuck' });
  const prev = [asPrev(stuck, { coreSince: daysAgo(60), coreStartRank: 18 })];
  const { keywords } = selectTargets({ scored: [stuck, ...pool(10)], previous: prev, now: NOW });
  assert.equal(keywords.find((k) => k.keyword === 'stuck')?.role, 'core');
  assert.equal(keywords.find((k) => k.keyword === 'stuck')?.coreSince, daysAgo(60));
});

test('after 90 days a stalled core keyword is swapped, max 2 per run', () => {
  const stuck = [0, 1, 2].map((i) => scored(`stuck ${i}`, vol(100), rank(18), { serviceId: `svc:st${i}` }));
  const prev = stuck.map((k) => asPrev(k, { coreSince: daysAgo(120), coreStartRank: 19 }));
  const { keywords, changes } = selectTargets({ scored: [...stuck, ...pool(10)], previous: prev, now: NOW });
  const removed = changes.filter((c) => c.change === 'core_removed');
  assert.equal(removed.length, 2);
  assert.match(removed[0].reason, /After 120 days it moved only 1 position \(now #18\)/);
  assert.equal(keywords.filter((k) => k.keyword.startsWith('stuck') && k.role === 'core').length, 1);
  assert.match(changes.find((c) => c.change === 'core_kept')!.reason, /swap limit/);
});

test('after 90 days a core keyword that moved up is kept', () => {
  const rising = scored('rising', vol(100), rank(7), { serviceId: 'svc:r' });
  const { keywords } = selectTargets({
    scored: [rising, ...pool(10)], previous: [asPrev(rising, { rank: rank(10), coreSince: daysAgo(100), coreStartRank: 15 })], now: NOW,
  });
  assert.equal(keywords.find((k) => k.keyword === 'rising')?.role, 'core');
  assert.equal(keywords.find((k) => k.keyword === 'rising')?.rankTrend, 3, 'moved #10 → #7 since last plan');
});

test('a stalled core keyword stays when nothing better exists', () => {
  const stuck = scored('stuck', vol(5000), rank(18), { serviceId: 'svc:s' });
  const { changes } = selectTargets({
    scored: [stuck, ...pool(3, 100)], previous: [asPrev(stuck, { coreSince: daysAgo(200), coreStartRank: 18 })], now: NOW,
  });
  assert.match(changes.find((c) => c.keyword === 'stuck')!.reason, /no better keyword/);
});

test('pinned keywords are never swapped', () => {
  const pinned = scored('pinned', vol(10), rank(19), { serviceId: 'svc:p' });
  const { keywords } = selectTargets({
    scored: [pinned, ...pool(10)], previous: [asPrev(pinned, { coreSince: daysAgo(300), coreStartRank: 19, pinned: true })], now: NOW,
  });
  const row = keywords.find((k) => k.keyword === 'pinned')!;
  assert.equal(row.role, 'core');
  assert.equal(row.pinned, true);
});

test('a core keyword whose service was removed leaves, even inside the lock', () => {
  const gone = scored('gone', vol(900), rank(5), { relevance: 'none' });
  const { keywords, changes } = selectTargets({
    scored: [gone, ...pool(8)], previous: [asPrev(gone, { coreSince: daysAgo(10), coreStartRank: 5 })], now: NOW,
  });
  assert.notEqual(keywords.find((k) => k.keyword === 'gone')?.role, 'core');
  assert.match(changes.find((c) => c.keyword === 'gone')!.reason, /no longer matches a service/);
});

test('rotating: quick wins first, one per service', () => {
  const qa = scored('qw a', vol(80), rank(6), { serviceId: 'svc:same' });
  const qb = scored('qw b', vol(70), rank(7), { serviceId: 'svc:same' });
  const { keywords } = selectTargets({ scored: [...pool(5, 5000), qa, qb, ...pool(6, 900).map((k) => ({ ...k, id: `${k.id}-x`, keyword: `${k.keyword} x`, serviceId: `${k.serviceId}-x` }))], previous: [], now: NOW });
  const rot = keywords.filter((k) => k.role === 'rotating');
  assert.equal(rot[0].keyword, 'qw a');
  assert.ok(!rot.some((k) => k.keyword === 'qw b'), 'second keyword of the same service waits');
});

test('rank trend compares with the previous plan', () => {
  const k = scored('t', vol(300), rank(6));
  const { keywords } = selectTargets({ scored: [k], previous: [{ ...k, rank: rank(11), role: 'rotating', rankTrend: null }], now: NOW });
  assert.equal(keywords[0].rankTrend, 5);
});

// ── S4 rank-check plan ─────────────────────────────────────────────────────

test('rank checks: previous core keeps 9 points, every owner keyword is checked, total capped at 50', () => {
  const owners = Array.from({ length: 20 }, (_, i) => cand(`owner kw ${i}`, { owner: true, sources: ['owner'] }));
  const others = Array.from({ length: 100 }, (_, i) => cand(`other kw ${i}`));
  const candidates = [...owners, ...others];
  const preScored = scoreCandidates({
    candidates,
    volumes: new Map(others.map((c, i) => [c.id, vol(1000 - i)])),
    ranks: new Map(), competitors: new Map(), ourReviews: 50,
  });
  const prevCore = { ...preScored.find((k) => k.keyword === 'other kw 90')!, role: 'core' as const, rankTrend: null };
  const plan = planRankChecks({ candidates, preScored, previous: [prevCore] });
  assert.equal(plan.length, 50);
  assert.deepEqual(plan.find((p) => p.keyword === 'other kw 90'), { id: prevCore.id, keyword: 'other kw 90', points: 9, set: 'core' });
  assert.equal(plan.filter((p) => p.set === 'core').length, 5);
  assert.equal(plan.filter((p) => p.set === 'owner').length, 20);
  assert.ok(plan.every((p) => p.points >= 1));
});

// ── Assembly ───────────────────────────────────────────────────────────────

test('buildKeywordSet scores, selects and finds competitor gaps', () => {
  const candidates = [cand('braces kolkata'), cand('dental implants kolkata')];
  const { keywordSet, gaps } = buildKeywordSet({
    candidates,
    volumes: new Map([[candidates[0].id, vol(400)], [candidates[1].id, vol(250)]]),
    ranks: new Map([[candidates[0].id, rank(null)], [candidates[1].id, rank(4)]]),
    competitors: new Map([[candidates[0].id, [{ name: 'Apollo Dental', rank: 1, reviews: 300, rating: 4.7 }]]]),
    ourReviews: 120,
    previous: [],
    now: NOW,
  });
  assert.equal(keywordSet.length, 2);
  assert.deepEqual(gaps, [{ keyword: 'braces kolkata', volume: 400, competitor: 'Apollo Dental', competitorRank: 1 }]);
  const lists = legacyKeywordLists(keywordSet);
  assert.deepEqual(lists.primaryKeywords.sort(), ['braces kolkata', 'dental implants kolkata']);
});

test('no competitor gap when we already rank', () => {
  const k = scoreKeyword({ candidate: cand('x'), volume: vol(100), rank: rank(5), competitorsAbove: [{ name: 'A', rank: 1, reviews: 10, rating: 4 }], ourReviews: 10 });
  assert.deepEqual(competitorGaps([k]), []);
});
