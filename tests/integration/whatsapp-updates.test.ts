/**
 * WhatsApp owner updates — pure message rules.
 * Run: node --experimental-strip-types --test tests/integration/whatsapp-updates.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPerformanceDigest, composePerformanceDigest, DIGEST_DAYS } from '../../src/services/lifecycle/performanceDigest.ts';
import { reviewReminderText } from '../../src/services/lifecycle/weekly.ts';

const NOW = new Date('2026-10-01T05:00:00Z');
const DAY = 86_400_000;
/** One row per day, `days` back from the data-lag edge (3 days before NOW). */
function series(days: number, f: (i: number) => Partial<Record<string, number>>) {
  const edge = Date.UTC(2026, 9, 1) - 3 * DAY;
  return Array.from({ length: days }, (_, i) => ({ date: new Date(edge - (i + 1) * DAY), ...f(i) }));
}

test('15-day digest: current vs previous 15 days, % only when the previous value is above zero', () => {
  // i < 15 = current window, i >= 15 = previous window.
  const rows = series(30, (i) => (i < 15
    ? { views: 3, viewsSearch: 2, viewsMaps: 1, callClicks: 0, websiteClicks: 0, directionRequests: 2, conversations: 0 }
    : { views: 2, viewsSearch: 2, viewsMaps: 0, callClicks: 0, websiteClicks: 1, directionRequests: 0, conversations: 0 }));
  const d = buildPerformanceDigest(rows, NOW);
  const by = Object.fromEntries(d.rows!.map((r) => [r.label, r]));
  assert.equal(by['Total views'].current, 45);
  assert.equal(by['Total views'].previous, 30);
  assert.equal(by['Total views'].pctChange, 50);
  assert.equal(by['Search views'].pctChange, 0);
  assert.equal(by['Maps views'].pctChange, null, 'no % from a zero base');
  assert.equal(by['Website clicks'].pctChange, -100);
  const text = composePerformanceDigest(d, 'Mulsetu', 'https://app.example/dashboard/insights')!;
  assert.match(text, /Total views: 45 \(\+50% vs previous 15 days\)/);
  assert.match(text, /Maps views: 15 \(up from 0\)/);
  assert.match(text, /Direction requests: 30 \(up from 0\)/);
  assert.match(text, /Website clicks: 0 \(-100% vs previous 15 days\)/);
  assert.doesNotMatch(text, /Calls:|Chats:/, 'zero now and zero before is left out');
  assert.doesNotMatch(text, /revenue|₹|customers|sales|ROI/i, 'engagement only — never revenue');
  assert.match(text, /Measured by Google/);
});

test('15-day digest: not enough measured days → nothing is sent (no partial or invented numbers)', () => {
  assert.equal(buildPerformanceDigest(series(5, () => ({ views: 9 })), NOW).rows, null);
  assert.equal(composePerformanceDigest(buildPerformanceDigest([], NOW), 'X', 'l'), null);
});

test('15-day digest: first period → no comparison claimed', () => {
  const d = buildPerformanceDigest(series(DIGEST_DAYS, () => ({ views: 2, callClicks: 1 })), NOW);
  assert.equal(d.previousMeasured, false);
  assert.ok(d.rows!.every((r) => r.previous === null && r.pctChange === null));
  const text = composePerformanceDigest(d, 'X', 'l')!;
  assert.match(text, /First full period measured/);
  assert.doesNotMatch(text, /vs previous/);
});

test('weekly review reminder: states only what the records show, includes the real review link', () => {
  const t0 = reviewReminderText('Mulsetu', 'ChIJabc', 0);
  assert.match(t0, /No new Google reviews for Mulsetu this week/);
  assert.match(t0, /No review requests were sent through GrowwMatics this week/);
  assert.match(t0, /writereview\?placeid=ChIJabc/);
  const t3 = reviewReminderText('Mulsetu', null, 3);
  assert.match(t3, /3 review requests were sent this week — no new reviews yet/);
  assert.doesNotMatch(t3, /writereview/, 'no link invented without a place id');
  assert.doesNotMatch(t3, /unhappy|losing|ranking will/i, 'no blame, no invented consequence');
});
