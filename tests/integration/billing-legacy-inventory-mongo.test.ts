/**
 * Legacy billing inventory (read-only) and the test-mode verification rules,
 * against an in-memory MongoDB (or MONGODB_TEST_URI — never MONGODB_URI).
 * Razorpay is a fake. Skipped (not passed) when no MongoDB is available.
 * Run: node --experimental-strip-types --test tests/integration/billing-legacy-inventory-mongo.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  collectLegacyBillingInventory,
  readOnlyDb,
  subscriptionIdsFromInventory,
  verifyTestModeSubscriptions,
} from '../../src/lib/billing/legacyInventory.ts';

let memoryServer: any = null;
let skipReason: string | null = null;
let db: any = null;

before(async () => {
  let uri = process.env.MONGODB_TEST_URI;
  if (!uri) {
    try {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create();
      uri = memoryServer.getUri();
    } catch (err: any) {
      skipReason = `no MONGODB_TEST_URI and mongodb-memory-server unavailable (${err?.message})`;
      return;
    }
  }
  await mongoose.connect(uri!, { dbName: `gm_legacy_inventory_${Date.now()}` });
  db = mongoose.connection.db;
  const oid = () => new mongoose.Types.ObjectId();
  await db.collection('billingplans').insertOne({
    key: 'default', priceInr: 1999, razorpayPlanId: 'plan_top_legacy', razorpayPlanPriceInr: 1999,
    durations: [
      { cycle: 'monthly', priceInr: 1999, enabled: true, razorpayPlanId: 'plan_m_legacy', razorpayPlanPriceInr: 1999 },
      { cycle: 'yearly', priceInr: 9999, enabled: true, razorpayPlanId: 'plan_y_live', razorpayPlanPriceInr: 9999, razorpayPlanMode: 'live' },
    ],
  });
  await db.collection('businesses').insertMany([
    { _id: oid(), name: 'Secret Bakery', phone: '+919999999999', subscriptionStatus: 'trialing', razorpaySubscriptionId: 'sub_unfinished' },
    { _id: oid(), name: 'Recorded', subscriptionStatus: 'trialing', razorpaySubscriptionId: 'sub_recorded', razorpaySubscriptionEnv: { subscriptionId: 'sub_recorded', mode: 'test' } },
    { _id: oid(), name: 'Stale record', subscriptionStatus: 'cancelled', razorpaySubscriptionId: 'sub_newer', razorpaySubscriptionEnv: { subscriptionId: 'sub_older', mode: 'test' } },
    { _id: oid(), name: 'Paid', userId: oid(), subscriptionStatus: 'active', billingSubscriptionId: 'sub_paid', razorpaySubscriptionId: 'sub_paid', subscriptionCurrentPeriodEnd: new Date('2027-01-01') },
    { _id: oid(), name: 'Trial', subscriptionStatus: 'trial_active', billingSubscriptionId: 'sub_trial', razorpaySubscriptionId: 'sub_trial', trialEndsAt: new Date('2027-04-15') },
    { _id: oid(), name: 'Past due', subscriptionStatus: 'past_due', billingSubscriptionId: 'sub_pd', razorpaySubscriptionId: 'sub_recov', recoveryCheckout: { subscriptionId: 'sub_recov' } },
    { _id: oid(), name: 'Ended', subscriptionStatus: 'canceled', billingSubscriptionId: 'sub_ended', razorpaySubscriptionId: 'sub_ended' },
    { _id: oid(), name: 'Never checked out', subscriptionStatus: 'trialing' },
  ]);
  await db.collection('trialclaims').insertMany([
    { phoneHash: 'HASH_SHOULD_NOT_APPEAR', status: 'reserved', businessId: oid(), holderBusinessId: oid(), razorpaySubscriptionId: 'sub_claim_r', offer: { razorpayPlanId: 'plan_y' } },
    { phoneHash: 'HASH2', status: 'consumed', businessId: oid(), razorpaySubscriptionId: 'sub_trial', offer: { razorpayPlanId: 'plan_y' } },
    { phoneHash: 'HASH3', status: 'reserved', businessId: oid(), razorpaySubscriptionId: 'sub_claim_live', offer: { razorpayPlanId: 'plan_y', razorpayMode: 'live' } },
    { phoneHash: 'HASH4', status: 'released', businessId: oid() },
  ]);
  await db.collection('subscriptions').insertMany([
    { userId: oid(), planType: 'Pro', billingStatus: 'Active', razorpaySubscriptionId: 'sub_paid' },
    { userId: oid(), planType: 'Free', billingStatus: 'Active' },
  ]);
});

after(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

async function snapshot() {
  const out: Record<string, unknown> = {};
  for (const name of ['billingplans', 'businesses', 'trialclaims', 'subscriptions']) out[name] = await db.collection(name).find({}).sort({ _id: 1 }).toArray();
  return JSON.stringify(out);
}

test('inventory categorises legacy records and writes nothing', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const before = await snapshot();
  const inv = await collectLegacyBillingInventory(db, new Date('2026-10-23T00:00:00Z'));
  assert.equal(await snapshot(), before, 'database unchanged');

  assert.deepEqual(inv.billingPlan.plansWithoutMode.map((p) => p.razorpayPlanId).sort(), ['plan_m_legacy', 'plan_top_legacy']);
  assert.deepEqual(inv.workspaces.unfinishedCheckouts.map((w) => w.razorpaySubscriptionId).sort(), ['sub_newer', 'sub_unfinished'], 'recorded link excluded; stale record counts as unknown');
  assert.deepEqual(inv.workspaces.withAccess.map((w) => w.subscriptionStatus).sort(), ['active', 'past_due', 'trial_active']);
  const pastDue = inv.workspaces.withAccess.find((w) => w.subscriptionStatus === 'past_due')!;
  assert.equal(pastDue.billingSubscriptionId, 'sub_pd');
  assert.equal(pastDue.checkoutLinkId, 'sub_recov');
  assert.equal(pastDue.recoveryCheckoutSubscriptionId, 'sub_recov');
  assert.deepEqual(inv.workspaces.endedPayingLinks.map((w) => w.razorpaySubscriptionId), ['sub_ended']);
  assert.deepEqual(inv.trialClaims.map((c) => c.razorpaySubscriptionId).sort(), ['sub_claim_r', 'sub_trial'], 'claims with a recorded mode excluded');
  assert.deepEqual(inv.subscriptions.map((s) => s.razorpaySubscriptionId), ['sub_paid']);
  assert.equal(inv.counts.unfinishedCheckouts, 2);
  assert.equal(inv.counts['withAccess.active'], 1);
  assert.equal(inv.counts['trialClaims.reserved'], 1);

  // Identifiers only — no names, phones or phone hashes.
  const text = JSON.stringify(inv);
  for (const pii of ['Secret Bakery', '+919999999999', 'HASH_SHOULD_NOT_APPEAR', 'Paid', 'phoneHash']) assert.ok(!text.includes(pii), `no ${pii}`);
});

test('the read-only wrapper refuses every write method before it reaches MongoDB', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const ro = readOnlyDb(db).collection('businesses');
  for (const method of ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndUpdate', 'findOneAndDelete', 'bulkWrite', 'drop', 'createIndex']) {
    assert.throws(() => ro[method]({}), /read-only/, method);
  }
  assert.equal(typeof (await ro.countDocuments({})), 'number', 'reads still work');
});

test('verification: refuses non-test keys; only a successful TEST lookup confirms test mode', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const inv = await collectLegacyBillingInventory(db);
  const ids = subscriptionIdsFromInventory(inv);
  assert.deepEqual(ids.get('sub_paid')!.sort(), [`business:${inv.workspaces.withAccess.find((w) => w.billingSubscriptionId === 'sub_paid')!.businessId}:paying`, `subscription:user:${inv.subscriptions[0].userId}`].sort());

  const calls: string[] = [];
  const fetchSubscription = async (id: string) => {
    calls.push(id);
    if (id === 'sub_unfinished') return { status: 'created', paid_count: 0 };
    if (id === 'sub_paid') return { status: 'active', paid_count: 3 };
    if (id === 'sub_trial') throw new Error('socket hang up');
    throw Object.assign(new Error('BAD_REQUEST_ERROR'), { error: { description: 'The id provided does not exist' } });
  };
  for (const keyId of [undefined, '', 'rzp_live_x', 'rzp_x']) {
    await assert.rejects(verifyTestModeSubscriptions(ids, { keyId, fetchSubscription }), /TEST key/, String(keyId));
  }
  assert.equal(calls.length, 0, 'nothing looked up without a test key');

  const results = await verifyTestModeSubscriptions(ids, { keyId: 'rzp_test_FAKE', fetchSubscription });
  const verdict = (id: string) => results.find((r) => r.razorpaySubscriptionId === id)!.verdict;
  assert.equal(verdict('sub_unfinished'), 'confirmed_test');
  assert.equal(verdict('sub_paid'), 'confirmed_test');
  assert.equal(results.find((r) => r.razorpaySubscriptionId === 'sub_paid')!.testPaidCount, 3);
  assert.equal(verdict('sub_trial'), 'lookup_failed_unproven');
  assert.equal(verdict('sub_newer'), 'not_found_unproven', 'a failed lookup is never treated as proof');
});
