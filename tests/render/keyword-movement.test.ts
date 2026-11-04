/**
 * Month-on-month keyword ranking movement: positions gained or lost, and an
 * unbroken comparable history (Nov #3 → Dec #2 → Jan #1), built only from
 * stored measurements — same keyword, same location, same grid (centre,
 * spacing, points). A gap is never filled in.
 * Run: npx tsx --test tests/render/keyword-movement.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildObservation, type SearchObservation } from '../../src/services/audit/facts';
import { addressArea, buildKeywordMovement, compareMeasurements, gridKey, measurementRows, monthlyHistoryAudits, movementCounts, RANK_HISTORY_AUDITS, type KeywordMeasurement } from '../../src/services/seo/measurements';
import fs from 'node:fs';

const ME = 'me';
const RIVAL = { name: 'AdScapes Digital Marketing Agency', placeId: 'r1', category: 'Marketing agency' };
// The reduced grid tracked keywords use: centre + east + south at 1.5 km.
const GRID = [{ lat: 20.1234, lng: 73.9123 }, { lat: 20.1234, lng: 73.9267 }, { lat: 20.1099, lng: 73.9123 }];
const MOVED = GRID.map((p) => ({ lat: p.lat + 0.01, lng: p.lng })); // map pin corrected ~1 km north

/** One keyword searched at every grid point, at `rank` (null = not in the top 20, 'fail' = provider failed). */
function searched(keyword: string, rank: number | null | 'fail', points: Array<{ lat: number; lng: number } | null> = GRID): SearchObservation[] {
  return points.map((point) => {
    const listings = rank === 'fail' || rank === null ? [RIVAL] : [...Array(rank - 1).fill(RIVAL), { name: 'Mulsetu', placeId: ME, category: 'Software company' }];
    return buildObservation({
      keyword, kind: 'discovery', point,
      results: rank === 'fail' ? null : listings.map((l) => ({ name: l.name, placeId: l.placeId, category: l.category })),
      targetPosition: rank === 'fail' || rank === null ? null : rank,
      isTarget: (r) => r.placeId === ME,
    });
  });
}
const rows = (obs: SearchObservation[]): KeywordMeasurement[] =>
  measurementRows(obs, { scope: 'address_tracked', areaOf: () => addressArea('Around your address'), serviceOf: () => ({ id: 'svc:web', name: 'Website Development' }) });
const month = (at: string, ...obs: SearchObservation[][]) => ({ at, measurements: rows(obs.flat()) });

test('grid fingerprint: same points → same key; a moved pin, other spacing or fewer points → different', () => {
  assert.equal(gridKey(GRID), gridKey([...GRID].reverse()), 'order does not matter');
  assert.notEqual(gridKey(GRID), gridKey(MOVED));
  assert.notEqual(gridKey(GRID), gridKey(GRID.slice(0, 2)));
  assert.equal(gridKey([null]), 'city');
  assert.equal(rows(searched('website development ojhar', 2))[0].grid, gridKey(GRID));
});

test('improved / declined / stable / new, with positions gained or lost', () => {
  const prev = rows([...searched('kw improved', 3), ...searched('kw declined', 2), ...searched('kw stable', 4), ...searched('kw entered', null), ...searched('kw dropped', 5)]);
  const cur = rows([...searched('kw improved', 1), ...searched('kw declined', 5), ...searched('kw stable', 4), ...searched('kw entered', 6), ...searched('kw dropped', null), ...searched('kw new', 2)]);
  const by = Object.fromEntries(compareMeasurements(prev, cur).map((c) => [c.keyword, c]));
  assert.deepEqual([by['kw improved'].change, by['kw improved'].beforeRank, by['kw improved'].afterRank, by['kw improved'].positionsGained], ['improved', 3, 1, 2]);
  assert.deepEqual([by['kw declined'].change, by['kw declined'].positionsGained], ['declined', -3]);
  assert.deepEqual([by['kw stable'].change, by['kw stable'].positionsGained], ['stable', 0]);
  assert.deepEqual([by['kw entered'].change, by['kw entered'].beforeRank, by['kw entered'].afterRank, by['kw entered'].positionsGained, by['kw entered'].note], ['improved', null, 6, null, 'Now in the top 20']);
  assert.deepEqual([by['kw dropped'].change, by['kw dropped'].positionsGained, by['kw dropped'].note], ['declined', null, 'No longer in the top 20']);
  assert.deepEqual([by['kw new'].change, by['kw new'].beforeRank, by['kw new'].positionsGained], ['new', null, null]);
});

test('not comparable: moved pin, unrecorded earlier grid, different points, unavailable', () => {
  const kw = 'website development ojhar';
  const cur = rows(searched(kw, 2));
  const reason = (prev: KeywordMeasurement[]) => compareMeasurements(prev, cur)[0];
  assert.deepEqual([reason(rows(searched(kw, 3, MOVED))).change, reason(rows(searched(kw, 3, MOVED))).note], ['not_comparable', 'Searched from a different location or grid']);
  const legacy = rows(searched(kw, 3)).map(({ grid, ...m }) => m); // stored before the grid was recorded
  assert.deepEqual([reason(legacy).change, reason(legacy).note], ['not_comparable', 'The earlier search location was not recorded']);
  assert.equal(reason(rows(searched(kw, 3, GRID.slice(0, 1)))).note, 'Measured at a different number of points');
  assert.equal(reason(rows(searched(kw, 'fail'))).note, 'One of the two measurements was unavailable');
  assert.equal(reason(legacy).positionsGained, null, 'no number without a comparison');
});

test('history: Nov #3 → Dec #2 → Jan #1, oldest first', () => {
  const kw = 'website development ojhar';
  const [m] = buildKeywordMovement(month('2027-01-28', searched(kw, 1)), [month('2026-12-28', searched(kw, 2)), month('2026-11-28', searched(kw, 3))]);
  assert.deepEqual(m.history, [{ at: '2026-11-28', rank: 3 }, { at: '2026-12-28', rank: 2 }, { at: '2027-01-28', rank: 1 }]);
  assert.deepEqual([m.change, m.beforeRank, m.afterRank, m.positionsGained], ['improved', 2, 1, 1]);
});

test('interrupted histories stop at the gap — nothing is filled in', () => {
  const kw = 'website development ojhar';
  const cur = month('2027-02-28', searched(kw, 1));
  // Not measured in January: history is this month only, and the change is "new".
  const missing = buildKeywordMovement(cur, [month('2027-01-28', searched('other', 4)), month('2026-12-28', searched(kw, 2))])[0];
  assert.deepEqual(missing.history, [{ at: '2027-02-28', rank: 1 }]);
  assert.equal(missing.change, 'new');
  // Unavailable in December: Jan → Feb only.
  const unavailable = buildKeywordMovement(cur, [month('2027-01-28', searched(kw, 2)), month('2026-12-28', searched(kw, 'fail')), month('2026-11-28', searched(kw, 3))])[0];
  assert.deepEqual(unavailable.history.map((h) => h.at), ['2027-01-28', '2027-02-28']);
  // Map pin moved in December: the months before it are not chained on.
  const moved = buildKeywordMovement(cur, [month('2027-01-28', searched(kw, 2)), month('2026-12-28', searched(kw, 3, MOVED))])[0];
  assert.deepEqual(moved.history.map((h) => h.rank), [2, 1]);
  // Earlier measurement without a recorded grid: not chained.
  const legacyPrev = { at: '2027-01-28', measurements: rows(searched(kw, 2)).map(({ grid, ...m }) => m) };
  const legacy = buildKeywordMovement(cur, [legacyPrev])[0];
  assert.deepEqual(legacy.history, [{ at: '2027-02-28', rank: 1 }]);
  assert.equal(legacy.change, 'not_comparable');
  // Unavailable this month: no history at all.
  assert.deepEqual(buildKeywordMovement(month('2027-02-28', searched(kw, 'fail')), [month('2027-01-28', searched(kw, 2))])[0].history, []);
});

test('not in the top 20 is a real point in the history (null rank), unlike a gap', () => {
  const kw = 'ai and automation ojhar';
  const [m] = buildKeywordMovement(month('2027-01-28', searched(kw, 4)), [month('2026-12-28', searched(kw, null))]);
  assert.deepEqual(m.history, [{ at: '2026-12-28', rank: null }, { at: '2027-01-28', rank: 4 }]);
  assert.equal(m.change, 'improved');
});

test('counts for the summary line', () => {
  assert.deepEqual(movementCounts([{ change: 'improved' }, { change: 'improved' }, { change: 'declined' }, { change: 'stable' }, { change: 'new' }, { change: 'not_comparable' }]),
    { improved: 2, declined: 1, stable: 1, new: 1, not_comparable: 1 });
});

// ── Display: web monthly section, PDF, mobile view ─────────────────────────

const rankings = {
  counts: { improved: 1, declined: 0, stable: 1, new: 0, not_comparable: 1 },
  rows: [
    { keyword: 'website development ojhar', area: 'Around your address', previous: '#3', current: '#1', movement: '▲ 2', change: 'improved', status: 'Improved', history: 'Nov #3 → Dec #2 → Jan #1' },
    { keyword: '<b>best</b> website development ojhar', area: 'Around your address', previous: '#1.6', current: '#1.6', movement: '', change: 'stable', status: 'Unchanged', history: null },
    { keyword: 'saas development ojhar', area: 'Ojhar', previous: '#2', current: '#3', movement: '', change: 'not_comparable', status: 'Not comparable — searched from a different location or grid', history: null },
  ],
};
const monthly = (over: any = {}) => ({
  period: { start: '2026-12-28T00:00:00Z', end: '2027-01-28T00:00:00Z' }, changes: [], growwmaticsOptimized: [], ownerOptimized: [],
  performance: { status: 'unavailable', rows: [] }, ranking: [], reviews: { newReviews: 0 }, contentActivity: null,
  profileHealth: { completionPercentage: null, scope: null, missing: [], unknown: 0 }, planCompleted: [], planPending: [], remainingIssues: [],
  improved: [], declined: [], ...over,
});

test('web monthly report: keyword rankings table with history', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const MonthlySections = (await import('../../src/components/audit/MonthlySections')).default;
  const html = renderToStaticMarkup(React.createElement(MonthlySections, { monthly: monthly({ keywordRankings: rankings }) }));
  assert.match(html, /Keyword rankings/);
  assert.match(html, /1 up, 0 down, 1 unchanged, 1 not comparable/);
  assert.match(html, /▲ 2/);
  assert.match(html, /Nov #3 → Dec #2 → Jan #1/);
  assert.match(html, /First comparable month/);
  assert.match(html, /Not comparable — searched from a different location or grid/);
  assert.ok(html.includes('&lt;b&gt;best&lt;/b&gt;'), 'keyword text is escaped');
  const old = renderToStaticMarkup(React.createElement(MonthlySections, { monthly: monthly() }));
  assert.ok(!/Keyword rankings/.test(old), 'older monthly reports render as before');
});

test('PDF: the same rows, escaped', async () => {
  process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/keyword-movement';
  const { buildReportHtml } = await import('../../src/lib/pdf/reportHtml');
  const html = buildReportHtml({ audit: { _id: 'a', businessName: 'Mulsetu', location: 'Ojhar', status: 'COMPLETED', fastMode: false, createdAt: '2027-01-28T00:00:00Z', auditData: { monthly: monthly({ keywordRankings: rankings }) } } } as any);
  assert.match(html, /Keyword rankings/);
  assert.match(html, /website development ojhar \(Around your address\): #3 → #1 \(▲ 2\) — Improved · Nov #3 → Dec #2 → Jan #1/);
  assert.ok(!html.includes('<b>best</b>'));
});

test('mobile view: a summary line then one line per keyword; empty before tracking existed', async () => {
  const { buildMobileReportView } = await import('../../src/services/audit/mobileView');
  const v = buildMobileReportView({ auditData: { monthly: monthly({ keywordRankings: rankings }) } });
  assert.equal(v.monthly?.keywordRankings[0], '1 up, 0 down, 1 unchanged, 1 not comparable');
  assert.equal(v.monthly?.keywordRankings[1], 'website development ojhar (Around your address): #3 → #1 (▲ 2) — Improved · Nov #3 → Dec #2 → Jan #1');
  assert.deepEqual(buildMobileReportView({ auditData: { monthly: monthly() } }).monthly?.keywordRankings, []);
});

// ── One history point per calendar month ───────────────────────────────────

const KW = 'website development ojhar';
const audit = (id: string, at: string, rank: number | null | 'fail', points = GRID) => ({ id, ...month(at, searched(KW, rank, points)) });
const movementFor = (currentAt: string, currentRank: number, earlier: ReturnType<typeof audit>[]) => {
  const months = monthlyHistoryAudits(earlier, currentAt);
  return { months, row: buildKeywordMovement(month(currentAt, searched(KW, currentRank)), months)[0] };
};

test('several audits in one month: only the latest is that month\'s point; records are not dropped', () => {
  const earlier = [
    audit('nov', '2026-11-28T06:00:00Z', 3),
    audit('dec-early', '2026-12-05T06:00:00Z', 5),
    audit('dec-late', '2026-12-28T06:00:00Z', 2),
  ];
  const { months, row } = movementFor('2027-01-28T06:00:00Z', 1, earlier);
  assert.deepEqual(months.map((m) => m.id), ['dec-late', 'nov']);
  assert.deepEqual(row.history.map((h) => h.rank), [3, 2, 1], 'Nov #3 → Dec #2 → Jan #1 — no second December point');
  assert.deepEqual([row.beforeRank, row.positionsGained], [2, 1], 'compared with the latest December audit');
  assert.equal(earlier.length, 3, 'the input list (audit records) is left as it was');
});

test('latest audit of the month unavailable: that month breaks the history — no fallback to an earlier same-month audit', () => {
  const { months, row } = movementFor('2027-01-28T06:00:00Z', 1, [
    audit('nov', '2026-11-28T06:00:00Z', 3),
    audit('dec-early', '2026-12-05T06:00:00Z', 2),
    audit('dec-late', '2026-12-28T06:00:00Z', 'fail'),
  ]);
  assert.equal(months[0].id, 'dec-late');
  assert.equal(row.change, 'not_comparable');
  assert.equal(row.note, 'One of the two measurements was unavailable');
  assert.equal(row.positionsGained, null);
  assert.deepEqual(row.history.map((h) => h.at), ['2027-01-28T06:00:00Z'], 'December is a gap, so November is not chained either');
});

test('latest audit of the month on a different grid: not comparable — the earlier same-month audit is not used instead', () => {
  const { months, row } = movementFor('2027-01-28T06:00:00Z', 1, [
    audit('dec-early', '2026-12-05T06:00:00Z', 2),
    audit('dec-late', '2026-12-28T06:00:00Z', 2, MOVED),
  ]);
  assert.equal(months[0].id, 'dec-late');
  assert.deepEqual([row.change, row.note], ['not_comparable', 'Searched from a different location or grid']);
  assert.equal(row.history.length, 1);
});

test('an earlier audit in the current month is not the baseline — the previous month is', () => {
  const { months, row } = movementFor('2027-01-28T06:00:00Z', 1, [
    audit('dec', '2026-12-28T06:00:00Z', 4),
    audit('jan-early', '2027-01-03T06:00:00Z', 2),
  ]);
  assert.deepEqual(months.map((m) => m.id), ['dec']);
  assert.deepEqual([row.beforeRank, row.positionsGained], [4, 3]);
  assert.deepEqual(row.history.map((h) => h.rank), [4, 1]);
});

test('months follow India time; input order does not matter; at most RANK_HISTORY_AUDITS earlier months', () => {
  // 30 Nov 20:00 UTC = 1 Dec 01:30 IST → December.
  const m = monthlyHistoryAudits([audit('a', '2026-11-30T20:00:00Z', 2), audit('b', '2026-12-10T06:00:00Z', 3)], '2027-01-28T06:00:00Z');
  assert.deepEqual(m.map((x) => x.id), ['b'], 'both are December; the later one is kept');
  const many = Array.from({ length: 10 }, (_, i) => audit(`m${i}`, new Date(Date.UTC(2026, i, 15, 6)).toISOString(), 2)).reverse();
  const picked = monthlyHistoryAudits([...many].sort(() => 0.5 - Math.random()), '2026-12-20T06:00:00Z');
  assert.equal(picked.length, RANK_HISTORY_AUDITS);
  assert.deepEqual(picked.map((x) => x.id), ['m9', 'm8', 'm7', 'm6', 'm5'], 'newest months first, regardless of input order');
});

test('the audit reads only connected monthly audits and picks one per month', () => {
  const src = fs.readFileSync('src/services/audit/auditService.ts', 'utf8');
  const block = src.slice(src.indexOf('Month-on-month movement + comparable history'), src.indexOf('const changes = buildKeywordMovement'));
  assert.match(block, /auditKind: \{ \$in: \[\.\.\.RANK_HISTORY_KINDS\] \}/);
  assert.match(block, /monthlyHistoryAudits\(/);
  assert.match(src, /previousAuditId: months\[0\]\?\.id \?\? null/, 'the report states the baseline it compared with');
});
