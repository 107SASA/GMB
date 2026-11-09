/**
 * Review campaigns send at the daily WhatsApp limit (Nov 2026). Before,
 * launching messaged every uploaded customer at once — far past the plan —
 * and reminders that then met the limit were dropped. Now customers are
 * queued; each day starts: limit − sent today − started today − reminders due.
 * Run: npx tsx --test tests/workflow/review-campaign-queue.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};
let bizId = '';
let campaignId = '';
const customerIds: string[] = [];
const sent: any[] = [];
const send = async (events: any[]) => { sent.push(...events); };

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_review_queue_${Date.now()}`);
  delete process.env.TWILIO_TEMPLATE_REVIEW_REQUEST_UTILITY;
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    Customer: (await import('../../src/models/Customer')).default,
    Campaign: (await import('../../src/models/Campaign')).default,
    ReviewRequest: (await import('../../src/models/ReviewRequest')).default,
    SubscriptionUsage: (await import('../../src/models/SubscriptionUsage')).default,
    Item: (await import('../../src/models/CampaignQueueItem')).default,
    q: await import('../../src/services/reviews/campaignQueue'),
  };
  const userId = new m.mongoose.Types.ObjectId();
  await m.mongoose.connection.db.collection('users').insertOne({ _id: userId, fullName: 'Owner', subscriptionPlan: 'Pro' });
  const org = new m.mongoose.Types.ObjectId();
  bizId = String((await m.Business.create({ name: 'Sweet Crust', category: 'Bakery', address: 'Pune', userId, organizationId: org, placeId: 'ChIJplace' } as any))._id);
  for (let i = 0; i < 25; i++) {
    const c = await m.Customer.create({ tenantId: String(org), businessId: bizId, name: `C${i}`, phone: `+9198765432${String(i).padStart(2, '0')}` } as any);
    customerIds.push(String(c._id));
  }
  campaignId = String((await m.Campaign.create({ name: 'Upload', businessId: bizId, tenantId: String(org), status: 'ACTIVE', startedAt: new Date() } as any))._id);
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const day = (iso: string) => new Date(iso);
const usedToday = (n: number, now: Date) => m.SubscriptionUsage.updateOne(
  { businessId: bizId, month: now.toISOString().slice(0, 10) }, { $set: { whatsappMessagesUsed: n } }, { upsert: true });

test('budget: limit minus what was sent, started and reserved for reminders', (t) => {
  if (skipReason) return t.skip(skipReason);
  // 10 a day, 2 always kept free for sends by hand.
  assert.equal(m.q.planDailyBudget({ limit: 10, sentToday: 0, startedNotSent: 0, remindersDue: 0 }), 8);
  assert.equal(m.q.planDailyBudget({ limit: 10, sentToday: 1, startedNotSent: 2, remindersDue: 4 }), 1);
  assert.equal(m.q.planDailyBudget({ limit: 3, sentToday: 0, startedNotSent: 0, remindersDue: 0 }), 3, 'no reserve on a tiny limit');
  assert.equal(m.q.campaignPerDay(10), 8);
  assert.equal(m.q.planDailyBudget({ limit: 10, sentToday: 0, startedNotSent: 0, remindersDue: 12 }), 0);
  assert.equal(m.q.daysToFinish(190, 10), 19);
});

test('200-style upload: day 1 starts only 8 (2 kept for sends by hand); launching again the same day starts none', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const now = new Date();
  const { added } = await m.q.enqueueCampaignCustomers(campaignId, bizId, customerIds);
  assert.equal(added, 25);
  const r1 = await m.q.dispatchCampaignQueue(bizId, now, { send });
  assert.equal(r1.dispatched, 8);
  assert.equal(sent.length, 8);
  assert.deepEqual(sent.map((e) => e.data.customerId), customerIds.slice(0, 8), 'upload order');
  const again = await m.q.dispatchCampaignQueue(bizId, now, { send });
  assert.equal(again.dispatched, 0, 'started-but-not-sent counts against today');
  assert.equal((await m.q.enqueueCampaignCustomers(campaignId, bizId, customerIds)).added, 0, 'nobody is queued twice');
});

test('a day with reminders due starts fewer new requests', async (t) => {
  if (skipReason) return t.skip(skipReason);
  // Day 3: the first 10 got their first message two days ago and are still open.
  const day3 = new Date(Date.now() + 2 * 86_400_000);
  const firstTen = await m.Item.find({ campaignId, status: 'dispatched' }).lean();
  for (const it of firstTen.slice(0, 6)) {
    await m.q.markQueueItem(campaignId, String(it.customerId), { sent: true });
    await m.ReviewRequest.create({ tenantId: 'org', message: 'Please review us', businessId: bizId, customerId: it.customerId, status: 'Sent', automationStatus: 'Active', followUpStage: 0, sentAt: new Date(day3.getTime() - 2 * 86_400_000), token: `t${it._id}` } as any);
  }
  const r = await m.q.dispatchCampaignQueue(bizId, day3, { send });
  assert.equal(r.remindersReserved, 6);
  assert.equal(r.dispatched, 2, '10 − 2 kept for manual − 6 reminders');
});

test('messages already sent today (manual sends) count too; a full day starts nothing', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const day6 = new Date(Date.now() + 5 * 86_400_000);
  await usedToday(10, day6);
  const r = await m.q.dispatchCampaignQueue(bizId, day6, { send });
  assert.equal(r.budget, 0);
  assert.equal(r.dispatched, 0);
});

test('opted-out customers are skipped without using the budget; pause and cancel stop the queue', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const day8 = new Date(Date.now() + 7 * 86_400_000);
  const next: any = await m.Item.findOne({ campaignId, status: 'queued' }).sort({ position: 1 }).lean();
  await m.Customer.updateOne({ _id: next.customerId }, { $set: { optedOut: true } });
  const waitingBefore = await m.Item.countDocuments({ campaignId, status: 'queued' });
  const r = await m.q.dispatchCampaignQueue(bizId, day8, { send });
  assert.equal(r.skipped, 1);
  assert.equal(r.dispatched, Math.min(8, waitingBefore - 1), 'the skipped customer did not use a slot');
  assert.equal((await m.Item.findById(next._id).lean()).status, 'skipped');

  await m.Campaign.updateOne({ _id: campaignId }, { $set: { status: 'PAUSED' } });
  assert.equal((await m.q.dispatchCampaignQueue(bizId, new Date(Date.now() + 9 * 86_400_000), { send })).dispatched, 0, 'paused: nothing starts');
  const dropped = await m.q.cancelQueuedCustomers(campaignId);
  assert.ok(dropped >= 0);
  assert.equal(await m.Item.countDocuments({ campaignId, status: 'queued' }), 0);
});

test('someone asked by hand while waiting in the campaign is not asked again', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const org = String(new m.mongoose.Types.ObjectId());
  const c = await m.Customer.create({ tenantId: org, businessId: bizId, name: 'Manual', phone: '+919811100000' } as any);
  const camp = await m.Campaign.create({ name: 'Second', businessId: bizId, tenantId: org, status: 'ACTIVE', startedAt: new Date() } as any);
  await m.q.enqueueCampaignCustomers(String(camp._id), bizId, [String(c._id)]);
  // The owner pressed "Send" on this customer before the campaign reached them.
  await m.ReviewRequest.create({ tenantId: org, message: 'x', businessId: bizId, customerId: c._id, status: 'Sent', automationStatus: 'Active', followUpStage: 0, sentAt: new Date(), token: 'manual1' } as any);
  const before = sent.length;
  const r = await m.q.dispatchCampaignQueue(bizId, new Date(Date.now() + 12 * 86_400_000), { send });
  assert.equal(sent.length - before, 0);
  assert.equal(r.skipped, 1);
  assert.match(String((await m.Item.findOne({ campaignId: camp._id }).lean()).reason), /Already asked/);
});

test('a request sent by hand on a full day goes out first the next morning', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const org = String(new m.mongoose.Types.ObjectId());
  const mk = async (name: string, phone: string) => String((await m.Customer.create({ tenantId: org, businessId: bizId, name, phone } as any))._id);
  const a = await mk('Late A', '+919822200001');
  const b = await mk('Late B', '+919822200002');
  const q1 = await m.q.queueManualRequest(bizId, org, a);
  assert.equal(q1.queued, true);
  assert.match(q1.message, /tomorrow morning/);
  assert.equal((await m.q.queueManualRequest(bizId, org, a)).queued, false, 'not twice');
  await m.q.queueManualRequest(bizId, org, b);
  assert.equal(await m.q.manualWaiting(bizId), 2);

  // A fresh campaign with plenty of customers, next morning.
  const camp = await m.Campaign.create({ name: 'Big', businessId: bizId, tenantId: org, status: 'ACTIVE', startedAt: new Date() } as any);
  const many: string[] = [];
  for (let i = 0; i < 12; i++) many.push(await mk(`Big ${i}`, `+91983330${String(i).padStart(4, '0')}`));
  await m.q.enqueueCampaignCustomers(String(camp._id), bizId, many);
  const before = sent.length;
  const r = await m.q.dispatchCampaignQueue(bizId, new Date(Date.now() + 20 * 86_400_000), { send });
  const started = sent.slice(before).map((e) => e.data.customerId);
  assert.deepEqual(started.slice(0, 2), [a, b], 'hand-sent ones first');
  assert.equal(r.dispatched, 8, '2 hand-sent + 6 campaign — 2 slots stay free for today’s own sends');
  assert.equal(await m.q.manualWaiting(bizId), 0);
});

test('progress summary for the screen', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const s = (await m.q.campaignQueueSummaries([campaignId], 10))[campaignId];
  assert.equal(s.waiting, 0);
  assert.equal(s.sent, 6);
  assert.ok(s.waiting >= 0);
  assert.equal(s.perDay, 8);
});
