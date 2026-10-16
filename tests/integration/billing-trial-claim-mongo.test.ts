/**
 * One free trial per verified phone — atomic claim behaviour against a REAL
 * MongoDB (unique indexes decide every race, so this cannot be tested with
 * mocks).
 *
 * Database: MONGODB_TEST_URI if set, otherwise a throwaway in-memory server
 * (mongodb-memory-server). Never MONGODB_URI. Every run uses a fresh,
 * randomly named database that is dropped afterwards. If neither is
 * available the tests are SKIPPED (reported as skipped, not passed).
 *
 * Run: node --experimental-strip-types --test tests/integration/billing-trial-claim-mongo.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import TrialClaim from '../../src/models/TrialClaim.ts';
import {
  trialPhoneHash,
  reserveTrialClaim,
  attachSubscriptionToClaim,
  consumeTrialClaim,
  settleTrialReservation,
  TRIAL_RESERVATION_MS,
  type SettleDeps,
} from '../../src/lib/billing/trialClaims.ts';

let memoryServer: any = null;
let skipReason: string | null = null;

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
  await mongoose.connect(uri!, { dbName: `gm_trialclaim_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` });
  await TrialClaim.syncIndexes();
});

after(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const id = () => new mongoose.Types.ObjectId();
let phoneSeq = 0;
const freshPhone = () => trialPhoneHash(`+9198765${String(10000 + phoneSeq++).padStart(5, '0')}`);
const T0 = new Date('2026-10-15T10:00:00.000Z');
const after25h = new Date(T0.getTime() + TRIAL_RESERVATION_MS + 3_600_000);

function fakeRazorpay(statuses: Record<string, any>): SettleDeps & { cancelled: string[] } {
  const cancelled: string[] = [];
  return {
    cancelled,
    fetchSubscription: async (subId) => statuses[subId] ?? 'unavailable',
    cancelSubscription: async (subId) => {
      cancelled.push(subId);
      if (statuses[subId]?.status === 'created') statuses[subId] = { status: 'cancelled' };
    },
  };
}

test('first workspace on a verified phone gets the claim', { skip: false }, async (t) => {
  if (skipReason) return t.skip(skipReason);
  const r = await reserveTrialClaim(TrialClaim, { phoneHash: freshPhone(), userId: id(), businessId: id(), now: T0 });
  assert.equal(r.ok, true);
  assert.equal((r as any).claim.status, 'reserved');
});

test('second workspace, same phone: no trial', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phoneHash = freshPhone();
  const user = id();
  assert.equal((await reserveTrialClaim(TrialClaim, { phoneHash, userId: user, businessId: id(), now: T0 })).ok, true);
  const second = await reserveTrialClaim(TrialClaim, { phoneHash, userId: user, businessId: id(), now: T0 });
  assert.deepEqual(second, { ok: false, reason: 'phone_claimed' });
});

test('same phone on a separate account: no second trial', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phoneHash = freshPhone();
  await reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: id(), now: T0 });
  const other = await reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: id(), now: T0 });
  assert.deepEqual(other, { ok: false, reason: 'phone_claimed' });
});

test('different phone (team member) on a workspace that already holds a claim: no trial', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const ws = id();
  await reserveTrialClaim(TrialClaim, { phoneHash: freshPhone(), userId: id(), businessId: ws, now: T0 });
  const member = await reserveTrialClaim(TrialClaim, { phoneHash: freshPhone(), userId: id(), businessId: ws, now: T0 });
  assert.deepEqual(member, { ok: false, reason: 'workspace_claimed' });
});

test('different phone on its own new workspace follows its own claim', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await reserveTrialClaim(TrialClaim, { phoneHash: freshPhone(), userId: id(), businessId: id(), now: T0 });
  const r = await reserveTrialClaim(TrialClaim, { phoneHash: freshPhone(), userId: id(), businessId: id(), now: T0 });
  assert.equal(r.ok, true);
});

test('concurrent checkouts, one phone, 25 workspaces: exactly one claim', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phoneHash = freshPhone();
  const results = await Promise.all(
    Array.from({ length: 25 }, () => reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: id(), now: T0 }))
  );
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.ok(results.filter((r) => !r.ok).every((r: any) => r.reason === 'phone_claimed'));
  assert.equal(await TrialClaim.countDocuments({ phoneHash }), 1);
});

test('concurrent checkouts, one workspace, 25 phones: exactly one claim', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const ws = id();
  const results = await Promise.all(
    Array.from({ length: 25 }, () => reserveTrialClaim(TrialClaim, { phoneHash: freshPhone(), userId: id(), businessId: ws, now: T0 }))
  );
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(await TrialClaim.countDocuments({ holderBusinessId: ws }), 1);
});

test('two tabs of the same workspace at once share one reservation', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phoneHash = freshPhone();
  const ws = id();
  const user = id();
  const results = await Promise.all(
    Array.from({ length: 5 }, () => reserveTrialClaim(TrialClaim, { phoneHash, userId: user, businessId: ws, now: T0 }))
  );
  assert.ok(results.every((r) => r.ok), JSON.stringify(results.map((r: any) => r.reason)));
  assert.equal(new Set(results.map((r: any) => String(r.claim._id))).size, 1);
});

test('a reservation accepts exactly one Razorpay subscription, even concurrently', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const ws = id();
  const r: any = await reserveTrialClaim(TrialClaim, { phoneHash: freshPhone(), userId: id(), businessId: ws, now: T0 });
  const attaches = await Promise.all(
    ['sub_race_a', 'sub_race_b', 'sub_race_c'].map((s) => attachSubscriptionToClaim(TrialClaim, { claimId: r.claim._id, businessId: ws, razorpaySubscriptionId: s, now: T0 }))
  );
  assert.equal(attaches.filter(Boolean).length, 1);
});

test('only the attached subscription consumes the claim; replays are harmless; consumed is permanent', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phoneHash = freshPhone();
  const ws = id();
  const r: any = await reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: ws, now: T0 });
  await attachSubscriptionToClaim(TrialClaim, { claimId: r.claim._id, businessId: ws, razorpaySubscriptionId: 'sub_ok', now: T0 });

  assert.deepEqual(await consumeTrialClaim(TrialClaim, { razorpaySubscriptionId: 'sub_other', now: T0 }), { ok: false, reason: 'not_owner' });
  const first: any = await consumeTrialClaim(TrialClaim, { razorpaySubscriptionId: 'sub_ok', now: T0 });
  assert.equal(first.ok && first.alreadyConsumed, false);
  const replay: any = await consumeTrialClaim(TrialClaim, { razorpaySubscriptionId: 'sub_ok', now: T0 });
  assert.equal(replay.ok && replay.alreadyConsumed, true);

  // Offer OFF → ON again changes nothing here: the phone and the workspace stay used up.
  assert.deepEqual(await reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: id(), now: after25h }), { ok: false, reason: 'phone_claimed' });
  assert.deepEqual(await reserveTrialClaim(TrialClaim, { phoneHash: freshPhone(), userId: id(), businessId: ws, now: after25h }), { ok: false, reason: 'workspace_claimed' });

  // Settling never touches a consumed claim.
  const claim = await TrialClaim.findOne({ phoneHash }).lean();
  assert.equal(await settleTrialReservation(TrialClaim, claim, fakeRazorpay({ sub_ok: { status: 'cancelled' } }), after25h), 'keep');
  assert.equal((await TrialClaim.findOne({ phoneHash }).lean<any>())!.status, 'consumed');
});

test('abandoned checkout: released only after Razorpay confirms it cannot be authorized, then claimable once', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phoneHash = freshPhone();
  const wsA = id();
  const wsB = id();
  const r: any = await reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: wsA, now: T0 });
  await attachSubscriptionToClaim(TrialClaim, { claimId: r.claim._id, businessId: wsA, razorpaySubscriptionId: 'sub_abandoned', now: T0 });

  // Inside the window another workspace is refused.
  assert.deepEqual(await reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: wsB, now: T0 }), { ok: false, reason: 'phone_claimed' });

  // After the window: Razorpay still says 'created' → we cancel it, re-check, then release.
  const expired: any = await reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: wsB, now: after25h });
  assert.equal(expired.reason, 'reservation_expired');
  const rp = fakeRazorpay({ sub_abandoned: { status: 'created' } });
  assert.equal(await settleTrialReservation(TrialClaim, expired.claim, rp, after25h), 'release');
  assert.deepEqual(rp.cancelled, ['sub_abandoned']);

  const retry: any = await reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: wsB, now: after25h });
  assert.equal(retry.ok, true);
  await attachSubscriptionToClaim(TrialClaim, { claimId: retry.claim._id, businessId: wsB, razorpaySubscriptionId: 'sub_b', now: after25h });

  // A stale authorization for the abandoned checkout can never consume it.
  assert.deepEqual(await consumeTrialClaim(TrialClaim, { razorpaySubscriptionId: 'sub_abandoned', now: after25h }), { ok: false, reason: 'not_owner' });
  assert.equal((await consumeTrialClaim(TrialClaim, { razorpaySubscriptionId: 'sub_b', now: after25h })).ok, true);
  assert.equal(await TrialClaim.countDocuments({ phoneHash, status: 'consumed' }), 1);
});

test('expired reservation that was actually authorized (late webhook) is consumed, not released', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phoneHash = freshPhone();
  const ws = id();
  const r: any = await reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: ws, now: T0 });
  await attachSubscriptionToClaim(TrialClaim, { claimId: r.claim._id, businessId: ws, razorpaySubscriptionId: 'sub_late', now: T0 });
  const expired: any = await reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: id(), now: after25h });
  assert.equal(await settleTrialReservation(TrialClaim, expired.claim, fakeRazorpay({ sub_late: { status: 'authenticated' } }), after25h), 'consume');
  assert.deepEqual(await reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: id(), now: after25h }), { ok: false, reason: 'phone_claimed' });
});

test('doubt keeps the reservation: Razorpay unreachable, or cancelled after possible authorization', async (t) => {
  if (skipReason) return t.skip(skipReason);
  for (const [sub, facts, expected] of [
    ['sub_down', 'unavailable', 'keep'],
    ['sub_maybe', { status: 'cancelled', hasPaymentMethod: true }, 'needs_review'],
  ] as const) {
    const phoneHash = freshPhone();
    const ws = id();
    const r: any = await reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: ws, now: T0 });
    await attachSubscriptionToClaim(TrialClaim, { claimId: r.claim._id, businessId: ws, razorpaySubscriptionId: sub, now: T0 });
    const claim = await TrialClaim.findOne({ phoneHash }).lean();
    assert.equal(await settleTrialReservation(TrialClaim, claim, fakeRazorpay({ [sub]: facts }), after25h), expected);
    const stored = await TrialClaim.findOne({ phoneHash }).lean<any>();
    assert.equal(stored!.status, 'reserved');
    assert.equal(stored!.needsReview, expected === 'needs_review');
    assert.deepEqual(await reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: id(), now: after25h }), {
      ok: false,
      reason: 'reservation_expired',
      claim: (await reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: id(), now: after25h }) as any).claim,
    });
  }
});

test('a reservation with no subscription is released after its window', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phoneHash = freshPhone();
  await reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: id(), now: T0 });
  const claim = await TrialClaim.findOne({ phoneHash }).lean();
  assert.equal(await settleTrialReservation(TrialClaim, claim, fakeRazorpay({}), after25h), 'release');
  assert.equal((await reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: id(), now: after25h })).ok, true);
});

test('the checkout snapshot is written once with the subscription and never changed', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const phoneHash = freshPhone();
  const ws = id();
  const r: any = await reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: ws, now: T0 });
  const offer = {
    trialMonths: 3, trialEndsAt: new Date('2027-01-15T10:00:00Z'), razorpayPlanId: 'plan_y', amountPaise: 999_900,
    currency: 'INR', policyVersion: 7, decidedAt: T0,
  };
  assert.ok(await attachSubscriptionToClaim(TrialClaim, { claimId: r.claim._id, businessId: ws, razorpaySubscriptionId: 'sub_snap', now: T0, offer }));
  // A later attempt (e.g. after the admin changed the policy) cannot overwrite it.
  const second = await attachSubscriptionToClaim(TrialClaim, {
    claimId: r.claim._id, businessId: ws, razorpaySubscriptionId: 'sub_snap_2', now: T0,
    offer: { ...offer, trialMonths: 12, policyVersion: 8 },
  });
  assert.equal(second, null);
  const stored: any = await TrialClaim.findOne({ phoneHash }).lean();
  assert.equal(stored.razorpaySubscriptionId, 'sub_snap');
  assert.equal(stored.offer.trialMonths, 3);
  assert.equal(stored.offer.policyVersion, 7);

  // Released (never authorized) and reserved again → a clean slate, no stale snapshot.
  await settleTrialReservation(TrialClaim, stored, fakeRazorpay({ sub_snap: { status: 'expired' } }), after25h);
  const again: any = await reserveTrialClaim(TrialClaim, { phoneHash, userId: id(), businessId: id(), now: after25h });
  assert.equal(again.ok, true);
  assert.equal(again.claim.offer, undefined);
  assert.equal(again.claim.razorpaySubscriptionId, undefined);
});
