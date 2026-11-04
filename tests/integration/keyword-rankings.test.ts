/**
 * Monthly keyword rankings for display: every keyword × location, last month
 * vs now, places moved, status and comparable history — and the one-line
 * WhatsApp summary.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKeywordRankingReport, buildMonthlyReport, composeMonthlyWhatsApp, keywordRankingSummary, type ExecutionRecords } from '../../src/services/lifecycle/monthly.ts';

const row = (keyword: string, change: string, extra: any = {}) => ({
  id: keyword, keyword, serviceId: 's', service: 'Website Development', areaId: 'area:address', area: 'Around your address',
  change, before: '#3', after: '#2', beforeRank: 3, afterRank: 2, positionsGained: 1, history: [], ...extra,
});

const tracking = {
  changes: [
    row('website development ojhar', 'improved', { beforeRank: 3, afterRank: 1, positionsGained: 2, history: [{ at: '2026-11-28T06:00:00Z', rank: 3 }, { at: '2026-12-28T06:00:00Z', rank: 2 }, { at: '2027-01-28T06:00:00Z', rank: 1 }] }),
    row('website development near me', 'declined', { beforeRank: 4.1, afterRank: 5.6, positionsGained: -1.5 }),
    row('best website development ojhar', 'stable', { beforeRank: 1.6, afterRank: 1.6, positionsGained: 0 }),
    row('ai and automation ojhar', 'improved', { before: 'not in top 20 (3 searches)', beforeRank: null, afterRank: 6, positionsGained: null, note: 'Now in the top 20' }),
    row('mvp development ojhar', 'new', { before: 'not measured', beforeRank: null, afterRank: 4, positionsGained: null }),
    row('saas development ojhar', 'not_comparable', { beforeRank: 2, afterRank: 3, positionsGained: null, note: 'Searched from a different location or grid' }),
    row('Website Development Ojhar', 'declined', { areaId: 'area:ojhar', area: 'Ojhar', beforeRank: 2, afterRank: null, after: 'not in top 20 (1 search)', positionsGained: null, note: 'No longer in the top 20' }),
  ],
};

test('rows: last month, now, places moved, status, history — address first, then by change', () => {
  const r = buildKeywordRankingReport(tracking)!;
  assert.deepEqual(r.counts, { improved: 2, declined: 2, stable: 1, new: 1, not_comparable: 1 });
  assert.deepEqual(r.rows.map((x) => [x.keyword, x.area]), [
    ['ai and automation ojhar', 'Around your address'],
    ['website development ojhar', 'Around your address'],
    ['website development near me', 'Around your address'],
    ['best website development ojhar', 'Around your address'],
    ['mvp development ojhar', 'Around your address'],
    ['saas development ojhar', 'Around your address'],
    ['Website Development Ojhar', 'Ojhar'],
  ]);
  const by = (k: string, area = 'Around your address') => r.rows.find((x) => x.keyword === k && x.area === area)!;
  assert.deepEqual([by('website development ojhar').previous, by('website development ojhar').current, by('website development ojhar').movement, by('website development ojhar').status], ['#3', '#1', '▲ 2', 'Improved']);
  assert.equal(by('website development ojhar').history, 'Nov #3 → Dec #2 → Jan #1');
  assert.deepEqual([by('website development near me').movement, by('website development near me').status], ['▼ 1.5', 'Declined']);
  assert.deepEqual([by('best website development ojhar').movement, by('best website development ojhar').status], ['', 'Unchanged']);
  assert.deepEqual([by('ai and automation ojhar').previous, by('ai and automation ojhar').movement], ['Not in top 20', 'Entered top 20']);
  assert.deepEqual([by('mvp development ojhar').previous, by('mvp development ojhar').status], ['—', 'New this month']);
  assert.equal(by('saas development ojhar').status, 'Not comparable — searched from a different location or grid');
  assert.equal(by('saas development ojhar').movement, '', 'no number for a non-comparable pair');
  assert.deepEqual([by('Website Development Ojhar', 'Ojhar').current, by('Website Development Ojhar', 'Ojhar').movement], ['Not in top 20', 'Left top 20']);
  assert.equal(by('mvp development ojhar').history, null, 'one month is not a history');
});

test('summary line and absence before tracking existed', () => {
  assert.equal(keywordRankingSummary(buildKeywordRankingReport(tracking)!), '2 up, 2 down, 1 unchanged, 1 new, 1 not comparable');
  assert.equal(buildKeywordRankingReport(null), undefined);
  assert.equal(buildKeywordRankingReport({ changes: [] }), undefined);
});

const noEx = (): ExecutionRecords => ({ profileEdits: [], photos: [], posts: [], replies: [], reviewRequests: { sent: 0, failed: 0, sentAt: [] }, newReviews: [] });

test('monthly report and WhatsApp carry the rankings line; older reports unchanged', () => {
  const m = buildMonthlyReport({
    periodStart: '2026-12-28T00:00:00Z', periodEnd: '2027-01-28T00:00:00Z', previousAuditId: 'a0', baselineAuditId: 'a0',
    prevData: {}, curData: { facts: { tracking } }, executions: noEx(), actions: [],
  });
  assert.equal(m.keywordRankings?.rows.length, 7);
  assert.match(composeMonthlyWhatsApp(m, 'Mulsetu', 'https://app.test/r'), /• Keyword rankings: 2 up, 2 down, 1 unchanged, 1 new, 1 not comparable/);
  const old = buildMonthlyReport({ periodStart: '2026-12-28T00:00:00Z', periodEnd: '2027-01-28T00:00:00Z', previousAuditId: 'a0', baselineAuditId: 'a0', prevData: {}, curData: {}, executions: noEx(), actions: [] });
  assert.equal(old.keywordRankings, undefined);
  assert.ok(!/Keyword rankings/.test(composeMonthlyWhatsApp(old, 'Mulsetu', 'https://app.test/r')));
});
