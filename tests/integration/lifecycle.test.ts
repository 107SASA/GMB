/**
 * Monthly optimization / ROI / notification engine — pure rules.
 * Run: node --experimental-strip-types --test tests/integration/lifecycle.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthlyReport, comparePerformance, composeMonthlyWhatsApp, diffGbpSnapshots, type ExecutionRecords } from '../../src/services/lifecycle/monthly.ts';
import { deriveActionStatus } from '../../src/services/lifecycle/actions.ts';
import { buildWeeklySummary, isoWeekKey, type WeeklyInput } from '../../src/services/lifecycle/weekly.ts';
import { lifecycleOf, monthKey } from '../../src/services/lifecycle/period.ts';
import { compareAudits } from '../../src/services/audit/optimizationPlan.ts';

const noEx = (): ExecutionRecords => ({ profileEdits: [], photos: [], posts: [], replies: [], reviewRequests: { sent: 0, failed: 0, sentAt: [] }, newReviews: [] });

// ── Idempotency keys ───────────────────────────────────────────────────────

test('lifecycle: one baseline per business, one monthly per calendar month (IST)', () => {
  assert.deepEqual(lifecycleOf(true), { auditKind: 'free_report' });
  assert.deepEqual(lifecycleOf(false, 'audit-autopilot-first-run'), { auditKind: 'connected_baseline', period: 'baseline' });
  assert.deepEqual(lifecycleOf(false, 'audit-autopilot-monthly', new Date('2026-09-15T10:00:00Z')), { auditKind: 'monthly', period: '2026-09' });
  assert.equal(monthKey(new Date('2026-09-30T19:00:00Z')), '2026-10', 'IST month boundary (00:30 IST on 1 Oct)');
  assert.deepEqual(lifecycleOf(false, 'report-live-check'), { auditKind: 'dashboard' }, 'dashboard audits never take a monthly slot');
});

// ── GBP changes with actor attribution ─────────────────────────────────────

test('changes: actor only from an execution record whose live write applied', () => {
  const prev = { description: 'Old text', primaryPhone: '', website: 'https://a.test' };
  const cur = { description: 'New text', primaryPhone: '+91 98765 43210', website: 'https://a.test' };
  const edits: ExecutionRecords['profileEdits'] = [
    { at: '2026-09-10T00:00:00Z', fields: ['description'], liveWriteApplied: true, actor: 'owner', by: 'Asha' },
    { at: '2026-09-11T00:00:00Z', fields: ['primaryPhone'], liveWriteApplied: false, actor: 'owner' },
  ];
  const ch = diffGbpSnapshots(prev, cur, edits, '2026-09-30T00:00:00Z');
  assert.equal(ch.length, 2);
  const desc = ch.find((c) => c.what === 'Description')!;
  assert.equal(desc.actor, 'Owner');
  assert.equal(desc.previous, 'Old text');
  const phone = ch.find((c) => c.what === 'Phone')!;
  assert.equal(phone.actor, 'Unknown', 'a dry-run edit (live write off) is not an execution');
  assert.equal(phone.previous, '(empty)');
  assert.deepEqual(diffGbpSnapshots(null, cur, edits, null), [], 'no previous GBP read → no claimed changes');
});

// ── Performance / ROI ───────────────────────────────────────────────────────

test('performance: compared only when both periods were measured; never revenue', () => {
  assert.equal(comparePerformance(null, { status: 'unavailable' }).status, 'unavailable');
  const cur = { status: 'verified', periodStart: '2026-09-01', periodEnd: '2026-09-28', calls: 18, websiteClicks: 31, directionRequests: 11, profileViews: 900 };
  const first = comparePerformance({ status: 'unavailable' }, cur);
  assert.equal(first.status, 'current_only');
  assert.ok(first.rows.every((r) => r.previous === null && r.pctChange === null), 'no fake previous period');
  const cmp = comparePerformance({ ...cur, periodStart: '2026-08-01', periodEnd: '2026-08-28', calls: 12, websiteClicks: 20, directionRequests: 7, profileViews: 900 }, cur);
  assert.equal(cmp.status, 'compared');
  assert.deepEqual(cmp.rows.find((r) => r.metric === 'Calls'), { metric: 'Calls', previous: 12, current: 18, change: 6, pctChange: 50 });
  assert.equal(cmp.rows.find((r) => r.metric === 'Website clicks')!.pctChange, 55);
  const zeroBase = comparePerformance({ ...cur, calls: 0 }, cur);
  assert.equal(zeroBase.rows.find((r) => r.metric === 'Calls')!.pctChange, null, 'no % from a zero baseline');
});

// ── Monthly report ─────────────────────────────────────────────────────────

const auditData = (o: any = {}) => ({
  facts: { reviews: { lifetime: { status: 'verified', totalCount: 3, rating: 5 } }, gbpProfile: { fields: { description: 'A' }, readAt: '2026-09-01T00:00:00Z' }, ...o.facts },
  profileCompletion: { completionPercentage: 67, completionScope: 'full', checklist: [{ field: 'Phone', status: 'Missing' }, { field: 'Name', status: 'Complete' }, { field: 'Videos', status: 'Unknown' }] },
  performanceBaseline: o.perf ?? { status: 'unavailable' },
  comparison: o.comparison ?? { rows: [] },
  findings: o.findings ?? [{ id: 'profile.phone.missing', category: 'profile', title: 'No phone number on the Google listing' }, { id: 'website.x', category: 'website', title: 'Check X', verificationOnly: true }],
});

test('monthly report: GrowwMatics credit only with execution records; ranking only when comparable', () => {
  const ex = noEx();
  ex.posts = [{ at: '2026-09-05T00:00:00Z', autopilot: true }, { at: '2026-09-06T00:00:00Z', autopilot: false }];
  ex.replies = [{ at: '2026-09-07T00:00:00Z', by: 'growwmatics_auto' }, { at: '2026-09-08T00:00:00Z', by: 'external' }];
  ex.newReviews = [{ at: '2026-09-07T00:00:00Z', rating: 5, replied: true }, { at: '2026-09-09T00:00:00Z', rating: 4, replied: false }];
  const cur = auditData({
    facts: { reviews: { lifetime: { status: 'verified', totalCount: 5, rating: 4.8 } }, gbpProfile: { fields: { description: 'B' }, readAt: '2026-10-01T00:00:00Z' } },
    comparison: { rows: [
      { metric: 'Searches where you appear in the top 20', before: '6 of 45', after: '9 of 45', change: 'better' },
      { metric: 'Average position where found', before: '#4', after: '#6', change: 'not_comparable', note: 'Different searches were measured' },
    ] },
  });
  const m = buildMonthlyReport({ periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-10-01T00:00:00Z', previousAuditId: 'a1', baselineAuditId: 'a0', prevData: auditData(), curData: cur, executions: ex, actions: [
    { findingId: 'f1', action: 'Add phone', status: 'EXECUTED', executor: 'growwmatics:update_phone' },
    { findingId: 'f2', action: 'Confirm services', status: 'PLANNED', executor: 'owner' },
  ] });
  assert.deepEqual(m.growwmaticsOptimized.map((x) => [x.what, x.count]), [['Google posts published automatically', 1], ['Review replies posted automatically', 1]]);
  assert.deepEqual(m.ownerOptimized.map((x) => x.count), [1]);
  assert.equal(m.changes.find((c) => c.what === 'Description')!.actor, 'Unknown', 'no edit record → not attributed to anyone');
  assert.equal(m.reviews.newReviews, 2);
  assert.equal(m.reviews.unanswered, 1);
  assert.equal(m.reviews.repliedOnGoogleDirectly, 1);
  assert.equal(m.ranking.find((r) => r.metric.startsWith('Average'))!.change, 'Not directly comparable');
  assert.ok(m.improved.some((l) => l.startsWith('Searches where you appear')), 'a comparable improvement is reported');
  assert.ok(!m.improved.concat(m.declined).some((l) => l.startsWith('Average')), 'no trend from non-comparable searches');
  assert.deepEqual(m.remainingIssues, ['No phone number on the Google listing'], 'verification steps are not remaining issues');
  assert.equal(m.performance.status, 'unavailable');
  assert.deepEqual(m.planCompleted.map((a) => a.findingId), ['f1']);
  assert.deepEqual(m.planPending.map((a) => a.findingId), ['f2']);
});

test('monthly WhatsApp: verified values only, unavailable stated, no revenue', () => {
  const m = buildMonthlyReport({ periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-10-01T00:00:00Z', previousAuditId: 'a1', baselineAuditId: 'a0', prevData: auditData(), curData: auditData(), executions: noEx(), actions: [] });
  const text = composeMonthlyWhatsApp(m, 'Mulsetu', 'https://app.test/r/1');
  assert.match(text, /Google performance data: unavailable for this period/);
  assert.match(text, /New Google reviews: 0/);
  assert.ok(!/₹|revenue|\bleads?\b|more calls/i.test(text), 'no ROI/revenue language');
  assert.match(text, /https:\/\/app\.test\/r\/1/);
});

// ── Action lifecycle ───────────────────────────────────────────────────────

const ex0 = { posts: 0, repliesByGrowwMatics: 0, reviewRequestsSent: 0, photos: 0, appliedEdits: [] as Array<{ at: string; fields: string[] }> };
const base = { gbpConnected: true, liveWritesEnabled: true, executions: ex0, findingStillPresent: null as boolean | null, remeasuredAt: null as string | null };

test('actions: PLANNED → READY → EXECUTED → VERIFIED only with evidence', () => {
  const a = { findingId: 'profile.description.missing', capability: 'update_description', requiresGbpConnection: true, plannedAt: '2026-09-01T00:00:00Z' };
  assert.equal(deriveActionStatus(a, base).status, 'READY');
  assert.equal(deriveActionStatus(a, { ...base, gbpConnected: false }).status, 'BLOCKED');
  assert.match(deriveActionStatus(a, { ...base, liveWritesEnabled: false }).statusReason, /turned off/);
  const executed = deriveActionStatus(a, { ...base, executions: { ...ex0, appliedEdits: [{ at: '2026-09-03T00:00:00Z', fields: ['description'] }] } });
  assert.equal(executed.status, 'EXECUTED', 'an applied write is executed, not verified');
  assert.equal(executed.executedAt, '2026-09-03T00:00:00Z');
  const verified = deriveActionStatus(a, { ...base, executions: { ...ex0, appliedEdits: [{ at: '2026-09-03T00:00:00Z', fields: ['description'] }] }, findingStillPresent: false, remeasuredAt: '2026-10-01T00:00:00Z' });
  assert.equal(verified.status, 'VERIFIED');
  assert.match(verified.verificationResult!, /re-read/);
  const stillThere = deriveActionStatus(a, { ...base, executions: { ...ex0, appliedEdits: [{ at: '2026-09-03T00:00:00Z', fields: ['description'] }] }, findingStillPresent: true, remeasuredAt: '2026-10-01T00:00:00Z' });
  assert.equal(stillThere.status, 'EXECUTED');
  const wrongField = deriveActionStatus(a, { ...base, executions: { ...ex0, appliedEdits: [{ at: '2026-09-03T00:00:00Z', fields: ['website'] }] } });
  assert.equal(wrongField.status, 'READY', 'an edit to a different field is not this action');
});

test('actions: owner-only actions are never claimed by GrowwMatics', () => {
  const a = { findingId: 'profile.categories', capability: null, requiresGbpConnection: false, plannedAt: '2026-09-01T00:00:00Z' };
  assert.equal(deriveActionStatus(a, base).status, 'PLANNED');
  const done = deriveActionStatus(a, { ...base, findingStillPresent: false, remeasuredAt: '2026-10-01T00:00:00Z' });
  assert.equal(done.status, 'VERIFIED');
  assert.match(done.verificationResult!, /outside GrowwMatics/);
  assert.equal(done.executedAt, undefined);
  const posts = deriveActionStatus({ ...a, capability: 'google_posts', requiresGbpConnection: true }, { ...base, executions: { ...ex0, posts: 3 } });
  assert.equal(posts.status, 'EXECUTED');
  assert.match(posts.executionResult!, /3 Google post/);
});

// ── Weekly monitoring ──────────────────────────────────────────────────────

const week = (o: Partial<WeeklyInput> = {}): WeeklyInput => ({
  weekKey: '2026-W40',
  reviews: { newCount: 0, newAverageRating: null, unanswered: 0, ratingNow: 4.5, ratingWeekAgo: 4.5, syncedThisWeek: true, requestsSent: null, ...(o.reviews || {}) },
  activity: { postsPublished: 0, photosPublished: 0, profileEditsApplied: 0, repliesPosted: 0, ...(o.activity || {}) },
  ranking: o.ranking ?? null,
  plan: { blocked: 0, awaitingOwner: 0, overdue: 0, ...(o.plan || {}) },
  performance: o.performance === undefined ? null : o.performance,
});

test('weekly: new reviews notify; zero reviews is stated, not blamed', () => {
  const s = buildWeeklySummary(week({ reviews: { newCount: 3, newAverageRating: 4.7 } as any }));
  assert.ok(s.meaningful);
  assert.equal(s.notifications[0].body, '3 new Google reviews were detected this week.');
  const zero = buildWeeklySummary(week());
  assert.ok(zero.lines.some((l) => /no new Google reviews were detected this week/.test(l)));
  assert.ok(!zero.lines.some((l) => /fail|didn.t request|did not request/i.test(l)), 'never blames the owner without a record');
  assert.equal(zero.meaningful, false, 'nothing new → no WhatsApp');
  // Content spec §16/§17: the in-app notice states the stored fact, nothing more.
  assert.deepEqual(zero.notifications.map((n) => [n.type, n.body]), [['weekly_no_new_reviews', 'No new Google reviews were detected this week.']]);
  const noRequests = buildWeeklySummary(week({ reviews: { requestsSent: 0 } as any }));
  assert.ok(noRequests.lines.some((l) => /No review requests were sent through GrowwMatics/.test(l)), 'only stated when the record shows 0');
});

test('weekly: unanswered reviews, action required, unavailable data', () => {
  const s = buildWeeklySummary(week({ reviews: { unanswered: 2 } as any, plan: { awaitingOwner: 1, blocked: 0, overdue: 0 } }));
  assert.ok(s.notifications.some((n) => n.body === '2 Google reviews are still waiting for a response.'));
  assert.ok(s.notifications.some((n) => /needs your confirmation or action/.test(n.body)));
  const notSynced = buildWeeklySummary(week({ reviews: { syncedThisWeek: false, unanswered: 5 } as any }));
  assert.ok(notSynced.lines[0].includes('not checked this week'));
  assert.equal(notSynced.notifications.length, 0, 'no review claims from a sync that did not run');
  assert.ok(buildWeeklySummary(week()).lines.includes('Google performance: unavailable for this week.'));
});

test('weekly: performance and comparable ranking only', () => {
  const s = buildWeeklySummary(week({ performance: { calls: [12, 18], websiteClicks: [20, 31], directionRequests: [7, 7] }, ranking: { improved: 3, declined: 0, comparable: 5 } }));
  assert.ok(s.notifications.some((n) => n.body === 'Your Google Business Profile received 18 calls this week, up from 12.'));
  assert.ok(s.notifications.some((n) => n.body === 'Your visibility improved for 3 tracked searches.'));
  assert.match(s.whatsappText, /^GrowwMatics Weekly Update/);
  assert.equal(buildWeeklySummary(week({ ranking: { improved: 0, declined: 0, comparable: 0 } })).lines.some((l) => l.startsWith('Ranking')), false);
});

test('weekly: ISO week key', () => {
  assert.equal(isoWeekKey(new Date('2026-09-29T00:00:00Z')), '2026-W40');
  assert.equal(isoWeekKey(new Date('2027-01-01T00:00:00Z')), '2026-W53');
});

test('comparison: ranking improvement only on identical searches', () => {
  const b = { auditId: 'a', kind: 'connected_baseline' as const, at: '2026-09-01', keywords: ['k1', 'k2'], searches: 45, foundCount: 20, top3Count: 5, averageObservedRank: 6, reviewCount: 3, rating: 5, completionPercentage: 67, completionScope: 'full' };
  const better = compareAudits(b, { ...b, auditId: 'b', kind: 'monthly', foundCount: 30, top3Count: 9, averageObservedRank: 4 });
  assert.deepEqual(better.rows.slice(0, 3).map((r) => r.change), ['better', 'better', 'better']);
  const changed = compareAudits(b, { ...b, auditId: 'c', kind: 'monthly', keywords: ['k1', 'k3'] });
  assert.ok(changed.rows.slice(0, 3).every((r) => r.change === 'not_comparable'));
});
