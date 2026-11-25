import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('fetchDailyMetrics asks Google for every Performance-report metric', () => {
  const src = read('src/lib/gbpClient.ts');
  for (const m of [
    'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
    'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
    'CALL_CLICKS', 'WEBSITE_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'BUSINESS_CONVERSATIONS',
    'BUSINESS_BOOKINGS', 'BUSINESS_FOOD_ORDERS', 'BUSINESS_FOOD_MENU_CLICKS',
  ]) assert.match(src, new RegExp(`'${m}'`), m);
  for (const f of ['viewsSearchMobile', 'viewsSearchDesktop', 'viewsMapsMobile', 'viewsMapsDesktop', 'bookings', 'foodOrders', 'menuClicks']) {
    assert.match(src, new RegExp(`row\\.${f} \\+= value`), `pivot fills ${f}`);
  }
});

test('nightly sync and history backfill store the same field list', () => {
  const model = read('src/models/GBPInsights.ts');
  for (const f of ['viewsSearchMobile', 'viewsMapsDesktop', 'bookings', 'foodOrders', 'menuClicks']) {
    assert.match(model, new RegExp(`${f}: \\{ type: Number`), `schema has ${f}`);
    assert.match(model, new RegExp(`'${f}'`), `INSIGHT_METRIC_FIELDS has ${f}`);
  }
  assert.match(read('src/services/gbpInsightsBackfill.ts'), /\.\.\.insightMetricValues\(/);
  assert.match(read('src/services/inngest/functions.ts'), /\.\.\.insightMetricValues\(d\)/);
});

test('backfill re-runs once for businesses backfilled before the new metrics', () => {
  const src = read('src/services/gbpInsightsBackfill.ts');
  assert.match(src, /BACKFILL_VERSION = 2/);
  assert.match(src, /historyBackfillVersion \?\? 1\) >= BACKFILL_VERSION/);
  assert.match(src, /historyBackfillVersion: BACKFILL_VERSION/);
});

test('insights API returns interactions, the view split and optional-metric flags', () => {
  const src = read('src/app/api/gbp/insights/route.ts');
  assert.match(src, /totalInteractions:/);
  assert.match(src, /viewBreakdown,/);
  assert.match(src, /available,/);
  for (const f of ["'callClicks'", "'conversations'", "'bookings'", "'directionRequests'", "'websiteClicks'", "'foodOrders'", "'menuClicks'"]) {
    assert.ok(src.split('INTERACTION_FIELDS = [')[1].split(']')[0].includes(f), `interactions include ${f}`);
  }
});
