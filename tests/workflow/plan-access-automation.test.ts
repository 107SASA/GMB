/**
 * Background automation stops for a cancelled / unpaid workspace and resumes
 * when it pays: the recurring Google sync, AI review replies and scheduled
 * post / photo publishing. Real Inngest functions (runDurably), in-memory
 * MongoDB, nothing sent anywhere.
 *
 * Run: npx tsx --test tests/workflow/plan-access-automation.test.ts
 */
import { startMemoryDb, stopMemoryDb } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runDurably } from '../helpers/inngestReplay';

let skipReason: string | null = null;
let m: any = {};
const dispatched: any[] = [];
const DAY = 86_400_000;

before(async () => {
  skipReason = await startMemoryDb('plan_access');
  if (skipReason) return;
  const client = await import('../../src/services/inngest/client');
  (client.inngest as any).send = async (e: any) => { for (const x of [e].flat()) dispatched.push(x); return { ids: [] }; };
  // step.sendEvent goes through the client's internal _send.
  (client.inngest as any)._send = async ({ payload }: any) => { for (const x of [payload].flat()) dispatched.push(x); return { ids: [], status: 200 }; };
  m = {
    mongoose: (await import('mongoose')).default,
    fns: await import('../../src/services/inngest/functions'),
    planAccess: await import('../../src/services/billing/planAccess'),
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    Review: (await import('../../src/models/Review')).default,
    Post: (await import('../../src/models/Post')).default,
  };
});
after(stopMemoryDb);

let seq = 0;
async function workspace(extra: Record<string, unknown> = {}, owner: Record<string, unknown> = {}) {
  const n = ++seq;
  const user = await m.User.create({ fullName: `Owner ${n}`, email: `plan${n}@example.invalid`, phone: `+9198500${String(n).padStart(5, '0')}`, role: 'CLIENT', ...owner } as any);
  return m.Business.create({
    name: `Shop ${n}`, category: 'Cafe', address: 'Pune', userId: user._id, organizationId: new m.mongoose.Types.ObjectId(),
    googleConnected: true, googleLocationId: `locations/${n}`, ...extra,
  } as any);
}

test('who keeps automation: paid, trial, grace, legacy paid, Super Admin — not cancelled, ended trial, never paid or deleted', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const now = Date.now();
  const yes = await Promise.all([
    workspace({ subscriptionStatus: 'active' }),
    workspace({ subscriptionStatus: 'trial_active', trialEndsAt: new Date(now + 5 * DAY) }),
    workspace({ subscriptionStatus: 'past_due', paymentGraceEndsAt: new Date(now + 2 * DAY) }),
    workspace({ createdAt: new Date('2026-06-01T00:00:00Z') }, { subscriptionPlan: 'Pro' }), // before per-workspace billing
    workspace({ subscriptionStatus: 'trialing' }, { role: 'SUPER_ADMIN' }),
  ]);
  const no = await Promise.all([
    workspace({ subscriptionStatus: 'canceled' }),
    workspace({ subscriptionStatus: 'trial_active', trialEndsAt: new Date(now - 3 * DAY), trialCancelledAt: new Date(now - 5 * DAY) }),
    workspace({ subscriptionStatus: 'trialing' }),
    workspace({ subscriptionStatus: 'past_due', paymentGraceEndsAt: new Date(now - DAY) }),
    workspace({ subscriptionStatus: 'active', isDeleted: true }),
  ]);
  const allowed = await m.planAccess.businessesWithPlanAccess([...yes, ...no].map((b) => b._id));
  assert.deepEqual(yes.map((b) => allowed.has(String(b._id))), [true, true, true, true, true]);
  assert.deepEqual(no.map((b) => allowed.has(String(b._id))), [false, false, false, false, false]);
});

test('the 6-hour Google sync skips cancelled / unpaid workspaces', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await m.Business.deleteMany({});
  await workspace({ subscriptionStatus: 'active' });
  await workspace({ subscriptionStatus: 'canceled' });
  await workspace({ subscriptionStatus: 'trialing' });
  const { result } = await runDurably(m.fns.gbpNightlySyncScheduler, { data: {} });
  assert.deepEqual(result, { dispatched: 1, skippedNoPlan: 2 });
});

test('no AI review replies while unpaid; recent held reviews are queued again when it pays', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const b = await workspace({ subscriptionStatus: 'canceled' });
  const review = (extra: Record<string, unknown>) => m.Review.create({ businessId: b._id, reviewer: 'R', rating: 5, source: 'gbp_api', reviewText: 'Great', ...extra } as any);
  const recent = await review({ postedAt: new Date(Date.now() - 2 * DAY) });
  await review({ postedAt: new Date(Date.now() - 90 * DAY) }); // too old to reply to automatically
  await review({ postedAt: new Date(), response: 'Thanks!' }); // already answered on Google

  const { result } = await runDurably(m.fns.processAutoReplyBatchJob, { data: { businessId: String(b._id), reviewIds: [String(recent._id)] } });
  assert.equal((result as any).skipped, 'no-plan-access');
  assert.equal((await m.Review.findById(recent._id).lean()).replyStatus, 'PENDING', 'nothing drafted');

  dispatched.length = 0;
  const { activateBusinessPlan } = await import('../../src/lib/billing/applyEntitlements');
  await activateBusinessPlan(String(b._id), { subscriptionId: 'sub_resume_test', eventAt: new Date() });
  const queued = dispatched.filter((e) => e.name === 'reviews/auto-reply-batch' && e.data.businessId === String(b._id));
  assert.equal(queued.length, 1, 'queued once on payment');
  assert.deepEqual(queued[0].data.reviewIds, [String(recent._id)], 'only the recent unanswered review');
});

test('scheduled posts are held while unpaid and published by the hourly cron after payment', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const unpaid = await workspace({ subscriptionStatus: 'canceled' });
  const paid = await workspace({ subscriptionStatus: 'active' });
  const due = new Date(Date.now() - 60_000);
  const held = await m.Post.create({ businessId: unpaid._id, title: 'Held', content: 'Fresh bread', status: 'scheduled', scheduledDate: due } as any);
  const live = await m.Post.create({ businessId: paid._id, title: 'Live', content: 'Fresh bread', status: 'scheduled', scheduledDate: due } as any);

  await runDurably(m.fns.processPublishPostJob, { data: { postId: String(held._id) } });
  assert.equal((await m.Post.findById(held._id).lean()).status, 'scheduled', 'left as is — not published, not failed');

  const cron = async () => ((await runDurably(m.fns.publishScheduledPostsCron, { data: {} })).result as any).dispatched;
  assert.equal(await cron(), 1, 'only the paid workspace\'s post is dispatched');

  // After payment the held post is picked up by the next hourly run.
  await m.Business.updateOne({ _id: unpaid._id }, { $set: { subscriptionStatus: 'active' } });
  assert.equal(await cron(), 2);
  assert.ok(live);
});
