/**
 * Super Admin → Content Monitor: business names come from Business.name, the
 * buffer lists only businesses that can post (not every free-report
 * account), and overdue scheduled posts are counted. In-memory MongoDB.
 *
 * Run: npx tsx --test tests/workflow/admin-content-monitor.test.ts
 */
import { signInAsSuperAdmin, startMemoryDb, stopMemoryDb } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let skipReason: string | null = null;
let m: any = {};

before(async () => {
  skipReason = await startMemoryDb('content_monitor');
  if (skipReason) return;
  m = {
    mongoose: (await import('mongoose')).default,
    route: await import('../../src/app/api/admin/content-monitor/route'),
    Business: (await import('../../src/models/Business')).default,
    Post: (await import('../../src/models/Post')).default,
  };
  await signInAsSuperAdmin('content-admin@example.invalid');
});
after(stopMemoryDb);

const biz = (name: string, extra: Record<string, unknown> = {}) =>
  m.Business.create({ name, category: 'Cafe', address: 'Pune', userId: new m.mongoose.Types.ObjectId(), organizationId: new m.mongoose.Types.ObjectId(), ...extra } as any);
const post = (businessId: unknown, status: string, scheduledDate?: Date) =>
  m.Post.create({ businessId, title: `Post ${status}`, content: 'Fresh bread every morning', status, scheduledDate } as any);

test('names are shown, only businesses that can post are listed, overdue posts are counted', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const DAY = 86_400_000;
  const connected = await biz('Sunrise Bakery', { googleConnected: true });
  const posting = await biz('Old Poster');
  await biz('Free Report Shop', { provisionedVia: 'free-report-form' }); // never connected, no posts
  await biz('Deleted Cafe', { googleConnected: true, isDeleted: true });
  await post(connected._id, 'scheduled', new Date(Date.now() + 2 * DAY));
  await post(connected._id, 'scheduled', new Date(Date.now() + 4 * DAY));
  await post(posting._id, 'scheduled', new Date(Date.now() - DAY)); // missed its time
  await post(posting._id, 'published');

  const json = await (await m.route.GET()).json();
  assert.equal(json.success, true);
  const names = json.data.bufferHealth.map((b: any) => b.businessName);
  assert.deepEqual(names, ['Old Poster', 'Sunrise Bakery'], 'fewest ahead first; no free-report or deleted business');
  const sunrise = json.data.bufferHealth.find((b: any) => b.businessName === 'Sunrise Bakery');
  assert.equal(sunrise.scheduledAhead, 2);
  assert.ok(sunrise.nextPostAt);
  const old = json.data.bufferHealth.find((b: any) => b.businessName === 'Old Poster');
  assert.equal(old.scheduledAhead, 0);
  assert.equal(old.overdue, 1);
  assert.equal(json.data.stats.overdueCount, 1);
  assert.ok(json.data.recentPosts.every((p: any) => p.businessName !== 'Unknown' && p.businessName), 'recent posts show the business name');
});
