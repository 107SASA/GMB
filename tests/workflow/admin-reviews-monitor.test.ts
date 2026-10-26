/**
 * Super Admin → Review Monitor (and the tenant CRM monitor's business names):
 * names come from Business.name, dates are when the review was posted on
 * Google, a review the owner answered on Google counts as replied, and test
 * reviews are not counted. In-memory MongoDB.
 *
 * Run: npx tsx --test tests/workflow/admin-reviews-monitor.test.ts
 */
import { signInAsSuperAdmin, startMemoryDb, stopMemoryDb } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let skipReason: string | null = null;
let m: any = {};

before(async () => {
  skipReason = await startMemoryDb('reviews_monitor');
  if (skipReason) return;
  m = {
    mongoose: (await import('mongoose')).default,
    reviews: await import('../../src/app/api/admin/reviews-monitor/route'),
    Business: (await import('../../src/models/Business')).default,
    Review: (await import('../../src/models/Review')).default,
  };
  await signInAsSuperAdmin('reviews-admin@example.invalid');
});
after(stopMemoryDb);

test('names, Google posting dates, replied counts and no test reviews', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const b = await m.Business.create({ name: 'Desun Academy', category: 'School', address: 'Kolkata', userId: new m.mongoose.Types.ObjectId(), organizationId: new m.mongoose.Types.ObjectId() } as any);
  const DAY = 86_400_000;
  const review = (extra: Record<string, unknown>) => m.Review.create({ businessId: b._id, reviewer: 'R', rating: 5, source: 'gbp_api', ...extra } as any);
  await review({ reviewer: 'Old Review', postedAt: new Date(Date.now() - 300 * DAY), replyStatus: 'POSTED', response: 'Thanks!' });
  await review({ reviewer: 'Owner Replied', postedAt: new Date(Date.now() - 2 * DAY), response: 'Thank you so much' }); // answered on Google by the owner
  await review({ reviewer: 'Waiting', rating: 1, postedAt: new Date(Date.now() - DAY) });
  await review({ reviewer: 'Test Review', source: 'mock', rating: 1 });

  const json = await (await m.reviews.GET()).json();
  assert.equal(json.success, true);
  assert.equal(json.data.stats.totalReviews, 3, 'test reviews not counted');
  assert.equal(json.data.stats.repliedCount, 2);
  assert.equal(json.data.stats.unansweredCount, 1);
  assert.equal(json.data.stats.criticalCount, 1);
  const rows = json.data.recentReviews;
  assert.deepEqual(rows.map((r: any) => r.reviewer), ['Waiting', 'Owner Replied', 'Old Review'], 'newest posted on Google first');
  assert.ok(rows.every((r: any) => r.businessName === 'Desun Academy'), 'the business name, not Unknown');
  assert.equal(new Date(rows[2].postedAt).getTime() < Date.now() - 299 * DAY, true, 'the Google date, not the sync date');
  assert.equal(rows.find((r: any) => r.reviewer === 'Owner Replied').replyStatus, 'POSTED', 'an owner reply on Google counts as replied');
});
