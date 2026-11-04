/**
 * Monthly proof, issue by issue: fixed since last report, new this month,
 * still open (with why), and the one-line WhatsApp summary.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIssueProgress, buildMonthlyReport, composeMonthlyWhatsApp, type ExecutionRecords } from '../../src/services/lifecycle/monthly.ts';

const f = (id: string, title: string, extra: any = {}) => ({ id, title, category: 'profile', severity: 'medium', actionability: 'directly_fixable', growwmaticsCapability: null, ...extra });

// Mulsetu: October baseline → November monthly.
const october = [
  f('website.services.missing_on_gbp', 'Your website lists 6 services; your Google profile lists none', { growwmaticsCapability: 'update_services', severity: 'high' }),
  f('gbp.change.description', 'Google changed your description'),
  f('gbp.attributes.none', 'No attributes are set on the Google profile', { growwmaticsCapability: 'update_attributes', severity: 'low' }),
  f('website.gbp_services_not_on_site', 'Add website pages for these services'),
  f('competitors.ahead', '9 businesses appeared above you', { actionability: 'monitor_only', growwmaticsCapability: 'rank_tracking' }),
  f('data_quality.ranking_unavailable', 'Some searches failed', { category: 'data_quality' }),
];
const november = [
  f('gbp.attributes.none', 'No attributes are set on the Google profile', { growwmaticsCapability: 'update_attributes', severity: 'low' }),
  f('website.gbp_services_not_on_site', 'Add website pages for these services'),
  f('profile.business_hours.missing', 'Opening hours are not set on the Google listing', { growwmaticsCapability: 'update_hours' }),
  f('competitors.ahead', '7 businesses appeared above you', { actionability: 'monitor_only', growwmaticsCapability: 'rank_tracking' }),
];
const actions = [
  { findingId: 'website.services.missing_on_gbp', action: 'a', status: 'VERIFIED', executor: 'growwmatics:update_services', capability: 'update_services', executedAt: '2026-11-05T00:00:00Z' },
  { findingId: 'gbp.change.description', action: 'a', status: 'VERIFIED', executor: 'owner', capability: null },
  { findingId: 'gbp.attributes.none', action: 'a', status: 'READY', executor: 'growwmatics:update_attributes', capability: 'update_attributes' },
  { findingId: 'website.gbp_services_not_on_site', action: 'a', status: 'PLANNED', executor: 'owner', capability: null },
];

test('fixed, new and still open — watch-only facts and data coverage are left out', () => {
  const p = buildIssueProgress(october, november, actions);
  assert.deepEqual(p.fixed, [
    { findingId: 'website.services.missing_on_gbp', title: 'Your website lists 6 services; your Google profile lists none', how: 'Applied through GrowwMatics' },
    { findingId: 'gbp.change.description', title: 'Google changed your description', how: 'No longer found in this report' },
  ]);
  assert.deepEqual(p.added.map((x) => x.findingId), ['profile.business_hours.missing']);
  // Most important first: the medium-severity website work before the low-severity attributes.
  assert.deepEqual(p.stillOpen.map((x) => [x.findingId, x.reason, x.waitingForOwner]), [
    ['website.gbp_services_not_on_site', 'Needs you', true],
    ['gbp.attributes.none', 'Waiting for your approval', true],
  ]);
  const ids = [...p.fixed, ...p.added, ...p.stillOpen].map((x) => x.findingId);
  assert.ok(!ids.includes('competitors.ahead'), 'rankings are measured, not a fix');
  assert.ok(!ids.some((x) => x.startsWith('data_quality.')));
});

test('still-open reasons: applied but not showing yet, blocked, GrowwMatics working on it', () => {
  const cur = [f('a', 'A', { growwmaticsCapability: 'update_hours' }), f('b', 'B', { growwmaticsCapability: 'update_services' }), f('c', 'C', { growwmaticsCapability: 'google_posts' })];
  const p = buildIssueProgress(cur, cur, [
    { findingId: 'a', action: 'a', status: 'EXECUTED', executor: 'x', capability: 'update_hours', executedAt: '2026-11-02T00:00:00Z' },
    { findingId: 'b', action: 'b', status: 'BLOCKED', executor: 'x', capability: 'update_services', statusReason: 'Live Google profile writes are turned off' },
  ]);
  assert.deepEqual(p.stillOpen.map((x) => x.reason), [
    'Applied — Google can take a while to show it',
    'Live Google profile writes are turned off',
    'GrowwMatics is working on it',
  ]);
  assert.ok(p.stillOpen.every((x) => !x.waitingForOwner));
});

test('no previous findings: everything is new; nothing fixed', () => {
  const p = buildIssueProgress(null, november, []);
  assert.equal(p.fixed.length, 0);
  assert.equal(p.stillOpen.length, 0);
  assert.equal(p.added.length, 3);
});

const noEx = (): ExecutionRecords => ({ profileEdits: [], photos: [], posts: [], replies: [], reviewRequests: { sent: 0, failed: 0, sentAt: [] }, newReviews: [] });

test('monthly report carries the progress; WhatsApp says it in one line', () => {
  const m = buildMonthlyReport({
    periodStart: '2026-10-28T00:00:00Z', periodEnd: '2026-11-28T00:00:00Z', previousAuditId: 'a0', baselineAuditId: 'a0',
    prevData: { findings: october }, curData: { findings: november }, executions: noEx(), actions: actions as any,
  });
  assert.equal(m.issueProgress?.fixed.length, 2);
  const text = composeMonthlyWhatsApp(m, 'Mulsetu', 'https://app.test/r/1');
  assert.match(text, /• Issues: 2 fixed, 1 new, 2 still open \(2 waiting for you\)/);
  assert.ok(!/Plan actions:/.test(text), 'the issue line replaces the plan-action count');
});
