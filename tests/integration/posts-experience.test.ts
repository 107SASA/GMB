/**
 * Posts experience: mobile and web share one post model, Upcoming is every
 * scheduled post (not a 7-day slice), Recent is published posts, manual
 * create publishes or schedules through the existing scheduler routes, and
 * the old "Run New Audit" screen is not part of Posts or the Performance
 * refresh action.
 *
 * Run: node --experimental-strip-types --test tests/integration/posts-experience.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('mobile Posts does not open the manual Run New Audit screen', () => {
  const posts = read('mobile/src/components/gbp/posts-tab.tsx')
    + read('mobile/src/app/(app)/posts/index.tsx')
    + read('mobile/src/app/(app)/posts/create.tsx');
  assert.doesNotMatch(posts, /audit\/run|Run New Audit/);
  assert.doesNotMatch(read('mobile/src/components/gbp/performance-tab.tsx'), /audit\/run/);
});

test('Upcoming and Recent read the shared posts API for this business, and a failed response is not an empty list', () => {
  const tab = read('mobile/src/components/gbp/posts-tab.tsx');
  const api = read('mobile/src/api/endpoints/content.ts');
  assert.match(tab, /fetchUpcomingPosts/);
  assert.match(tab, /fetchPublishedPosts/);
  assert.match(api, /status=scheduled,publishing|scheduled,publishing/);
  assert.match(api, /status: 'published'|status=published|'published'/);
  assert.match(api, /meta: '1'/);
  assert.match(api, /businessHeaders\(businessId\)/);
  assert.match(api, /Unexpected posts response/);
  assert.doesNotMatch(api, /\.catch\(\[\]\)\s*\.parse/);
  assert.doesNotMatch(tab, /UPCOMING_WINDOW_DAYS|postsPublished/);
  assert.match(tab, /isPending/);
  assert.match(tab, /isError/);
});

test('manual create publishes or schedules through the existing scheduler routes and does not read phone GPS', () => {
  const screen = read('mobile/src/app/(app)/posts/create.tsx');
  const route = read('src/app/api/posts/route.ts');
  assert.match(screen, /publishPost\(/);
  assert.match(screen, /schedulePost\(/);
  assert.doesNotMatch(screen, /photoLocation|expo-location|device_at_capture|photoLat/);
  assert.match(route, /getVerifiedBusinessLocation/);
  assert.match(route, /geotagMedia\([\s\S]*null\)/);
  assert.doesNotMatch(route, /photoLat|device_at_capture|photoLocation/);
  assert.match(route, /aiGenerated: false/);
  assert.doesNotMatch(read('src/app/api/posts/route.ts').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /generateImage|imageGenerator|inngest\.send/);
});

test('post and audit queries are not restored from the on-device cache', () => {
  const layout = read('mobile/src/app/_layout.tsx');
  for (const key of ['published-posts', 'scheduled-posts', 'audits', 'audit-detail', 'dashboard-stats']) {
    assert.match(layout, new RegExp(key));
  }
});

test('switching businesses cancels the previous workspace queries', () => {
  assert.match(read('mobile/src/business/BusinessContext.tsx'), /cancelQueries/);
});
