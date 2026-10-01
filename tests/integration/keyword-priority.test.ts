/**
 * Weekly keyword prioritisation — proof that it never selects unsupported
 * services, fake rankings, fake search volume, invented customer searches or
 * brand-name keywords, and that every reason matches its evidence.
 * Run: node --experimental-strip-types --test tests/integration/keyword-priority.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prioritizeKeywords, proposedPick, brandWords, reasonFor, type PriorityInput, type MeasuredKeywordRow } from '../../src/services/content/keywordPriority.ts';
import { planWeeklySlots, type ContentFacts, type ContentSeoPlan } from '../../src/services/content/plan.ts';
import { summarizeContent, withKeywordRanks, contentActivityLines } from '../../src/services/lifecycle/monthly.ts';

const base = (over: Partial<PriorityInput> = {}): PriorityInput => ({
  businessName: 'Sahyadri Tile Works',
  serviceTerms: ['Tile contractor', 'Tile installation', 'Bathroom renovation', 'Kitchen tiling'],
  places: ['Nashik', 'Gangapur Road'],
  measured: [],
  searchTerms: [],
  proposed: [],
  recentlyTargeted: [],
  ...over,
});
const row = (keyword: string, o: Partial<MeasuredKeywordRow> = {}): MeasuredKeywordRow => ({ keyword, rank: null, found: true, rankStatus: 'ok', searchVolume: null, demandStatus: 'unavailable', ...o });
const all = (r: ReturnType<typeof prioritizeKeywords>) => [r.seo, r.search, r.local].filter(Boolean).map((p) => p!.keyword);

// ── Opportunity ordering ───────────────────────────────────────────────────

test('positions 4–20 with measured demand beat an already-top-3 keyword with more searches', () => {
  const r = prioritizeKeywords(base({
    measured: [
      row('tile contractor nashik', { rank: 2, searchVolume: 1000, demandStatus: 'measured' }),
      row('bathroom renovation nashik', { rank: 8, searchVolume: 170, demandStatus: 'measured' }),
    ],
  }));
  assert.equal(r.seo?.keyword, 'bathroom renovation nashik');
  assert.equal(r.seo?.reason, 'Selected because the business was observed at #8 on Google Maps for this measured keyword and the keyword has 170 measured monthly searches; it matches the verified service "Bathroom renovation".');
});

test('not-found keywords are opportunities (ranked below 4–20, above top-3)', () => {
  const r = prioritizeKeywords(base({
    measured: [
      row('tile installation nashik', { found: false, rank: null }),
      row('tile contractor nashik', { rank: 1 }),
    ],
  }));
  assert.equal(r.seo?.keyword, 'tile installation nashik');
  assert.equal(r.seo?.evidence.notFound, true);
  assert.match(r.seo!.reason, /was not found in the top 20/);
});

test('recently targeted keywords are rotated out when another opportunity exists', () => {
  const measured = [row('bathroom renovation nashik', { rank: 8 }), row('kitchen tiling nashik', { rank: 12 })];
  assert.equal(prioritizeKeywords(base({ measured })).seo?.keyword, 'bathroom renovation nashik');
  assert.equal(prioritizeKeywords(base({ measured, recentlyTargeted: ['Bathroom Renovation Nashik'] })).seo?.keyword, 'kitchen tiling nashik');
});

// ── Never: unsupported services ────────────────────────────────────────────

test('never selects a keyword that matches no verified service or category', () => {
  const r = prioritizeKeywords(base({
    measured: [row('swimming pool construction nashik', { rank: 6, searchVolume: 900, demandStatus: 'measured' })],
    searchTerms: [{ keyword: 'roof waterproofing nashik', impressions: 400 }],
  }));
  assert.deepEqual(all(r), []);
  assert.ok(r.rejected.some((x) => x.keyword.startsWith('swimming') && /no verified service/.test(x.why)));
  assert.ok(r.rejected.some((x) => x.keyword.startsWith('roof') && /no verified service/.test(x.why)));
});

// ── Never: fake rankings ───────────────────────────────────────────────────

test('a failed rank check is never treated as a rank, and no rank appears in the reason', () => {
  const r = prioritizeKeywords(base({ measured: [row('bathroom renovation nashik', { rank: 21, rankStatus: 'unavailable', found: false })] }));
  assert.equal(r.seo, null, 'no rank, no measured demand → no opportunity');
  const r2 = prioritizeKeywords(base({ measured: [row('bathroom renovation nashik', { rank: 7, rankStatus: 'unavailable', searchVolume: 170, demandStatus: 'measured' })] }));
  assert.equal(r2.seo?.evidence.rank, undefined);
  assert.equal(r2.seo?.evidence.notFound, undefined);
  assert.doesNotMatch(r2.seo!.reason, /#\d|observed|not found/);
});

test('legacy placeholder ranks (21 = "not found" filler) are never read as a position', () => {
  const r = prioritizeKeywords(base({ measured: [row('bathroom renovation nashik', { rank: 21, found: true })] }));
  assert.equal(r.seo, null);
});

// ── Never: fake search volume ──────────────────────────────────────────────

test('search volume is used only when it was measured', () => {
  const est = prioritizeKeywords(base({ measured: [row('bathroom renovation nashik', { rank: 9, searchVolume: 5000, demandStatus: 'unavailable' })] }));
  assert.equal(est.seo?.evidence.searchVolume, undefined);
  assert.doesNotMatch(est.seo!.reason, /searches/);
  const none = prioritizeKeywords(base({ measured: [row('kitchen tiling nashik', { searchVolume: 800, demandStatus: 'estimated' })] }));
  assert.equal(none.seo, null, 'an estimated volume alone is not evidence');
});

// ── Never: invented customer searches ──────────────────────────────────────

test('customer search terms come only from Google Business Profile data', () => {
  const noData = prioritizeKeywords(base({ measured: [row('bathroom renovation nashik', { rank: 8 })] }));
  assert.equal(noData.search, null, 'no GBP search data → no customer-search pick');
  const zero = prioritizeKeywords(base({ searchTerms: [{ keyword: 'tile installation near me', impressions: 0 }] }));
  assert.equal(zero.search, null, 'zero impressions is not a customer search');
  const real = prioritizeKeywords(base({ searchTerms: [{ keyword: 'tile installation near me', impressions: 64, year: 2026, month: 9 }] }));
  assert.equal(real.search?.keyword, 'tile installation near me');
  assert.equal(real.search?.evidence.source, 'gbp_search_terms');
  assert.match(real.search!.reason, /Google reported 64 impressions for this search on the profile \(2026-09\)/);
});

// ── Never: brand-name keywords ─────────────────────────────────────────────

test('brand-name keywords are never opportunities (measured or searched)', () => {
  const r = prioritizeKeywords(base({
    measured: [row('sahyadri tile works', { rank: 1, searchVolume: 90, demandStatus: 'measured' }), row('sahyadri tiles nashik', { rank: 6 })],
    searchTerms: [{ keyword: 'sahyadri tile works nashik', impressions: 300 }],
  }));
  assert.deepEqual(all(r), []);
  assert.ok(r.rejected.filter((x) => /brand/.test(x.why)).length === 3);
  assert.deepEqual(brandWords('Sahyadri Tile Works', ['Tile installation']), ['sahyadri'], 'generic words (tile, works) are not brand words');
  const generic = prioritizeKeywords(base({ measured: [row('tile works nashik', { rank: 9 })] }));
  assert.equal(generic.seo?.keyword, 'tile works nashik', '"tile works" is a service phrase, not the brand');
});

test('keywords carrying claim words the post fact-check rejects are never selected', () => {
  const r = prioritizeKeywords(base({ measured: [row('best tile contractor nashik', { rank: 5, searchVolume: 300, demandStatus: 'measured' })] }));
  assert.equal(r.seo, null);
  assert.ok(r.rejected.some((x) => /claim word/.test(x.why)));
});

// ── Proposed stays separate ────────────────────────────────────────────────

test('proposed keywords are never scored as opportunities and are labelled unmeasured', () => {
  const r = prioritizeKeywords(base({ proposed: ['floor tiles nashik'] }));
  assert.deepEqual(all(r), []);
  const p = proposedPick('floor tiles nashik', base());
  assert.equal(p?.measured, false);
  assert.equal(p?.reason, 'From the SEO plan’s proposed keywords — not measured.');
  assert.equal(proposedPick('sahyadri offers', base()), null);
});

test('no evidence → empty reason, never a fabricated one', () => {
  assert.equal(reasonFor({ source: 'measured', local: false }), '');
});

// ── Slots + monthly ────────────────────────────────────────────────────────

const facts: ContentFacts = {
  businessName: 'Sahyadri Tile Works', category: 'Tile contractor', city: 'Nashik', area: 'Gangapur Road',
  ownerServices: ['Tile installation', 'Bathroom renovation'], websiteServices: [{ value: 'Kitchen tiling' }],
};

test('the 4 slots keep their structure; slots 1–3 carry the evidence-based keyword + reason', () => {
  const pr = prioritizeKeywords(base({
    measured: [row('bathroom renovation nashik', { rank: 8, searchVolume: 170, demandStatus: 'measured' }), row('kitchen tiling gangapur road nashik', { rank: 14 })],
    searchTerms: [{ keyword: 'tile installation near me', impressions: 64, year: 2026, month: 9 }],
  }));
  const plan: ContentSeoPlan = {
    seoPlanId: 'p1',
    themes: [{ weekday: 'Mon', theme: 'Planning a bathroom renovation', keyword: 'bathroom renovation nashik', postType: 'Educational' }],
    measuredKeywords: ['bathroom renovation nashik'], proposedKeywords: [],
    priorities: { seo: pr.seo, search: pr.search, local: pr.local },
  };
  const s = planWeeklySlots({ facts, plan, weekIndex: 0, offer: null, festivals: [] });
  assert.equal(s.length, 4);
  assert.equal(s[0].keyword, 'bathroom renovation nashik');
  assert.equal(s[0].seoTheme, 'Planning a bathroom renovation', 'pick matched the plan theme');
  assert.match(s[0].keywordReason!, /#8/);
  assert.equal(s[1].keyword, 'tile installation near me');
  assert.equal(s[1].keywordSource, 'search_term');
  assert.equal(s[2].purpose, 'local');
  assert.equal(s[2].keyword, 'kitchen tiling gangapur road nashik');
  assert.notEqual(s[3].purpose, undefined);
  assert.equal(new Set(s.map((x) => x.keyword).filter(Boolean)).size, s.filter((x) => x.keyword).length, 'no keyword repeated across slots');
});

test('monthly: targeted keywords with measured rank before/after; not comparable when either check is missing', () => {
  const content = summarizeContent([
    { status: 'published', liveWriteApplied: true, contentMeta: { keyword: 'bathroom renovation nashik', keywordSource: 'measured', keywordMeasured: true } },
    { status: 'scheduled', contentMeta: { keyword: 'bathroom renovation nashik', keywordSource: 'measured', keywordMeasured: true } },
    { status: 'published', liveWriteApplied: true, contentMeta: { keyword: 'kitchen tiling nashik', keywordSource: 'measured', keywordMeasured: true } },
    { status: 'published', liveWriteApplied: true, contentMeta: { keyword: 'tile installation near me', keywordSource: 'search_term', keywordMeasured: true } },
  ]);
  const prev = { keywordTable: [row('bathroom renovation nashik', { rank: 9 }), row('kitchen tiling nashik', { rankStatus: 'unavailable' })] };
  const cur = { keywordTable: [row('bathroom renovation nashik', { rank: 6 }), row('kitchen tiling nashik', { rank: 11 })] };
  const c = withKeywordRanks(content, prev, cur);
  const b = c.keywordsTargeted!.find((k) => k.keyword === 'bathroom renovation nashik')!;
  assert.deepEqual([b.posts, b.published, b.rankBefore, b.rankAfter, b.comparable], [2, 1, '#9', '#6', true]);
  const k = c.keywordsTargeted!.find((x) => x.keyword === 'kitchen tiling nashik')!;
  assert.equal(k.comparable, false, 'previous check failed → not comparable, no rank invented');
  const line = contentActivityLines(c).find((l) => l.startsWith('Keywords targeted'))!;
  assert.match(line, /bathroom renovation nashik — 2 posts, rank #9 → #6/);
  assert.match(line, /kitchen tiling nashik — 1 post, rank change not comparable/);
  assert.match(line, /tile installation near me \(customer search on Google\) — 1 post/);
});
