/**
 * Safe payment recovery + WhatsApp recovery reminders against a REAL MongoDB
 * (in-memory server, or MONGODB_TEST_URI — never MONGODB_URI), with a fake
 * Razorpay, a fake WhatsApp sender and a fake clock. Nothing is sent or charged.
 * Skipped (not passed) when no MongoDB is available.
 * Run: node --experimental-strip-types --test tests/integration/billing-recovery-mongo.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Business from '../../src/models/Business.ts';
import BillingRecoveryEpisode from '../../src/models/BillingRecoveryEpisode.ts';
import { prepareRecoveryCheckout, type RecoveryDeps, type RazorpaySubState } from '../../src/lib/billing/paymentRecovery.ts';
import {
  openEpisode,
  closeEpisodes,
  recordDelivery,
  runRecoveryReminders,
  type ReminderContext,
  type SendResult,
} from '../../src/lib/billing/recoveryReminders.ts';
import { parseReminderPolicy, type ReminderPolicy } from '../../src/lib/billing/billingPolicy.ts';

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
  await mongoose.connect(uri!, { dbName: `gm_recovery_test_${Date.now()}` });
  await Promise.all([Business.syncIndexes(), BillingRecoveryEpisode.syncIndexes()]);
});

after(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const oid = () => new mongoose.Types.ObjectId();
const T = new Date('2027-01-15T04:30:00.000Z'); // 10:00 IST
const DAY = 86_400_000;

// ── Safe recovery ─────────────────────────────────────────────────────────

async function pastDueWorkspace(kind: 'first_charge' | 'renewal', sub = 'sub_orig') {
  const b = await Business.create({
    name: `WS ${kind}`, userId: oid(), organizationId: oid(), address: 'Pune', category: 'Bakery', subscriptionStatus: 'past_due', billingSubscriptionId: sub, razorpaySubscriptionId: sub,
    paymentFailureKind: kind, paymentFailedAt: T,
  } as any);
  return String(b._id);
}

function fakeRazorpay(states: Record<string, RazorpaySubState | 'down'>, opts: { cancelTo?: string; chargeDuringCancel?: boolean; createDelayMs?: number } = {}) {
  const log: string[] = [];
  let seq = 0;
  const deps: Omit<RecoveryDeps, 'Business'> = {
    now: () => T,
    fetchSubscription: async (id) => {
      log.push(`fetch:${id}`);
      const s = states[id];
      if (!s || s === 'down') throw new Error('Razorpay unreachable');
      return { ...s };
    },
    cancelSubscription: async (id) => {
      log.push(`cancel:${id}`);
      const s = states[id];
      if (s && s !== 'down') {
        if (opts.chargeDuringCancel) states[id] = { status: 'active', paidCount: s.paidCount + 1 };
        else states[id] = { status: opts.cancelTo ?? 'cancelled', paidCount: s.paidCount };
      }
    },
    createSubscription: async (input) => {
      if (opts.createDelayMs) await new Promise((r) => setTimeout(r, opts.createDelayMs));
      const id = `sub_new_${++seq}`;
      log.push(`create:${id}:${input.cycle}:replaces=${input.replaces}`);
      states[id] = { status: 'created', paidCount: 0 };
      return { id };
    },
    reconcilePaid: async (_b, id) => { log.push(`reconcile:${id}`); },
    record: async (e) => { log.push(`record:${e.type}${e.needsReview ? ':review' : ''}`); },
  };
  return { deps: { ...deps, Business } as RecoveryDeps, log, states };
}

for (const kind of ['first_charge', 'renewal'] as const) {
  test(`${kind}: original that can still charge is cancelled and verified BEFORE the replacement`, async (t) => {
    if (skipReason) return t.skip(skipReason);
    const businessId = await pastDueWorkspace(kind);
    const rp = fakeRazorpay({ sub_orig: { status: kind === 'renewal' ? 'pending' : 'halted', paidCount: kind === 'renewal' ? 5 : 0 } });
    const r = await prepareRecoveryCheckout(rp.deps, { businessId, userId: String(oid()), cycle: kind === 'renewal' ? 'monthly' : 'yearly' });
    assert.equal(r.kind, 'checkout');
    const cancelAt = rp.log.indexOf('cancel:sub_orig');
    const createAt = rp.log.findIndex((l) => l.startsWith('create:'));
    assert.ok(cancelAt >= 0 && createAt > cancelAt, rp.log.join(' → '));
    assert.equal(rp.log.filter((l) => l === 'fetch:sub_orig').length, 2, 'fetched before and after cancelling');
    const ws: any = await Business.findById(businessId).lean();
    assert.deepEqual(ws.supersededSubscriptionIds, ['sub_orig']);
    assert.equal(ws.recoveryCheckout.subscriptionId, (r as any).subscriptionId);
    assert.equal(ws.billingSubscriptionId, 'sub_orig', 'access source unchanged until the replacement is paid');
    assert.equal(ws.recoveryLock, undefined, 'lock released');
  });
}

test('repeated clicks reuse the open replacement — no second subscription', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const businessId = await pastDueWorkspace('renewal');
  const rp = fakeRazorpay({ sub_orig: { status: 'pending', paidCount: 2 } });
  const first: any = await prepareRecoveryCheckout(rp.deps, { businessId, userId: String(oid()), cycle: 'monthly' });
  const second: any = await prepareRecoveryCheckout(rp.deps, { businessId, userId: String(oid()), cycle: 'monthly' });
  assert.equal(second.kind, 'checkout');
  assert.equal(second.reused, true);
  assert.equal(second.subscriptionId, first.subscriptionId);
  assert.equal(rp.log.filter((l) => l.startsWith('create:')).length, 1);
});

test('concurrent recovery requests create at most one replacement', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const businessId = await pastDueWorkspace('renewal');
  const rp = fakeRazorpay({ sub_orig: { status: 'pending', paidCount: 2 } }, { createDelayMs: 30 });
  const results = await Promise.all(Array.from({ length: 10 }, () => prepareRecoveryCheckout(rp.deps, { businessId, userId: String(oid()), cycle: 'monthly' })));
  assert.equal(rp.log.filter((l) => l.startsWith('create:')).length, 1, rp.log.join(' | '));
  assert.equal(results.filter((r) => r.kind === 'checkout').length, 1);
  assert.ok(results.filter((r) => r.kind !== 'checkout').every((r) => r.kind === 'busy'));
});

test('Razorpay unreachable → fail safe: nothing cancelled, nothing created, flagged for review', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const businessId = await pastDueWorkspace('renewal');
  const rp = fakeRazorpay({ sub_orig: 'down' });
  const r = await prepareRecoveryCheckout(rp.deps, { businessId, userId: String(oid()), cycle: 'monthly' });
  assert.deepEqual(r, { kind: 'unavailable', reason: 'razorpay_unreachable' });
  assert.ok(!rp.log.some((l) => l.startsWith('cancel:') || l.startsWith('create:')));
  assert.ok(rp.log.includes('record:recovery.blocked:review'));
});

test('ambiguous status → fail safe', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const businessId = await pastDueWorkspace('renewal');
  const rp = fakeRazorpay({ sub_orig: { status: 'mystery', paidCount: 1 } });
  const r = await prepareRecoveryCheckout(rp.deps, { businessId, userId: String(oid()), cycle: 'monthly' });
  assert.deepEqual(r, { kind: 'unavailable', reason: 'ambiguous_status' });
  assert.ok(!rp.log.some((l) => l.startsWith('create:')));
});

test('cancellation not confirmed → no replacement, original not marked superseded', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const businessId = await pastDueWorkspace('renewal');
  const rp = fakeRazorpay({ sub_orig: { status: 'pending', paidCount: 2 } }, { cancelTo: 'pending' });
  const r = await prepareRecoveryCheckout(rp.deps, { businessId, userId: String(oid()), cycle: 'monthly' });
  assert.deepEqual(r, { kind: 'unavailable', reason: 'cancel_unconfirmed' });
  assert.ok(!rp.log.some((l) => l.startsWith('create:')));
  const ws: any = await Business.findById(businessId).lean();
  assert.deepEqual(ws.supersededSubscriptionIds ?? [], []);
});

test('original already paid (Razorpay retry succeeded) → reconciled, never cancelled, nothing created', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const businessId = await pastDueWorkspace('renewal');
  const rp = fakeRazorpay({ sub_orig: { status: 'active', paidCount: 6 } });
  const r = await prepareRecoveryCheckout(rp.deps, { businessId, userId: String(oid()), cycle: 'monthly' });
  assert.deepEqual(r, { kind: 'already_paid' });
  assert.ok(rp.log.includes('reconcile:sub_orig'));
  assert.ok(!rp.log.some((l) => l.startsWith('cancel:') || l.startsWith('create:')));
});

test('charged while we were cancelling → no replacement (no double charge)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const businessId = await pastDueWorkspace('renewal');
  const rp = fakeRazorpay({ sub_orig: { status: 'pending', paidCount: 2 } }, { chargeDuringCancel: true });
  const r = await prepareRecoveryCheckout(rp.deps, { businessId, userId: String(oid()), cycle: 'monthly' });
  assert.deepEqual(r, { kind: 'already_paid' });
  assert.ok(!rp.log.some((l) => l.startsWith('create:')));
  assert.ok(rp.log.includes('record:recovery.original_paid:review'));
});

test('an original that can no longer charge is not cancelled again', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const businessId = await pastDueWorkspace('renewal');
  const rp = fakeRazorpay({ sub_orig: { status: 'cancelled', paidCount: 3 } });
  const r = await prepareRecoveryCheckout(rp.deps, { businessId, userId: String(oid()), cycle: 'monthly' });
  assert.equal(r.kind, 'checkout');
  assert.ok(!rp.log.includes('cancel:sub_orig'));
});

test('a paid workspace is never touched by recovery', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const b = await Business.create({ name: 'paid', userId: oid(), organizationId: oid(), address: 'Pune', category: 'Bakery', subscriptionStatus: 'active', billingSubscriptionId: 'sub_live' } as any);
  const rp = fakeRazorpay({ sub_live: { status: 'active', paidCount: 9 } });
  const r = await prepareRecoveryCheckout(rp.deps, { businessId: String(b._id), userId: String(oid()), cycle: 'monthly' });
  assert.deepEqual(r, { kind: 'not_needed' });
  assert.deepEqual(rp.log, []);
});

// ── Reminder runner ───────────────────────────────────────────────────────

const SID = 'HX' + 'b'.repeat(32);
const POLICY: ReminderPolicy = parseReminderPolicy({
  reminders: {
    enabled: true,
    steps: [{ offsetDays: 0 }, { offsetDays: 1 }, { offsetDays: 2 }, { offsetDays: 7 }],
    maxReminders: 4,
    sendingHours: { start: 9, end: 20 },
    timezone: 'Asia/Kolkata',
    retry: { maxAttempts: 3, backoffMinutes: 30 },
    template: { contentSid: SID, approved: true },
  },
});
assert.equal(POLICY.enabled, true);

function harness(opts: { policy?: ReminderPolicy; context?: (ep: any) => ReminderContext; results?: SendResult[] } = {}) {
  let clock = T;
  const sends: Array<{ phone: string; sid: string; vars: Record<string, string>; at: string }> = [];
  const queue = [...(opts.results ?? [])];
  let n = 0;
  const run = () =>
    runRecoveryReminders({
      Episode: BillingRecoveryEpisode,
      now: () => clock,
      policy: opts.policy ?? POLICY,
      loadContext: async (ep) => opts.context?.(ep) ?? { phone: '+919000000001', variables: { '1': 'Asha', '2': 'Asha Bakery' } },
      send: async (phone, sid, vars) => {
        sends.push({ phone, sid, vars, at: clock.toISOString() });
        return queue.shift() ?? { success: true, sid: `SM${++n}` };
      },
    });
  return { run, sends, setClock: (d: Date) => { clock = d; } };
}

async function newEpisode(failedAt = T) {
  const businessId = oid();
  const { episode } = await openEpisode(BillingRecoveryEpisode, { businessId, userId: oid(), razorpaySubscriptionId: 'sub_x', failureKind: 'renewal', failedAt, policy: POLICY });
  return { businessId, episodeId: episode._id };
}

test('Day 0, 1, 2 and 7 — each exactly once, at the right time', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await newEpisode();
  const h = harness();
  const at = (d: number, hours = 0) => new Date(T.getTime() + d * DAY + hours * 3_600_000);
  for (const [time, expected] of [
    [at(0), 1], [at(0, 1), 1], [at(1, -1), 1], [at(1), 2], [at(2), 3], [at(3), 3], [at(6, 9), 3], [at(7), 4], [at(8), 4], [at(30), 4],
  ] as const) {
    h.setClock(time);
    await h.run();
    assert.equal(h.sends.length, expected, `at +${(time.getTime() - T.getTime()) / 3_600_000}h`);
  }
  assert.deepEqual(h.sends.map((s) => s.at), [at(0), at(1), at(2), at(7)].map((d) => d.toISOString()));
});

test('repeated / overlapping job runs never duplicate a reminder', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await BillingRecoveryEpisode.deleteMany({});
  await newEpisode();
  const h = harness();
  await Promise.all(Array.from({ length: 8 }, () => h.run()));
  await h.run();
  assert.equal(h.sends.length, 1);
});

test('rate limited → retried with backoff, then sent once; retries capped', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await BillingRecoveryEpisode.deleteMany({});
  const { episodeId } = await newEpisode();
  const h = harness({ results: [{ success: false, errorCode: '20429', error: 'Too many requests' }] });
  await h.run();
  h.setClock(new Date(T.getTime() + 10 * 60_000));
  await h.run();
  assert.equal(h.sends.length, 1, 'no retry before the backoff');
  h.setClock(new Date(T.getTime() + 31 * 60_000));
  await h.run();
  assert.equal(h.sends.length, 2);
  const ep: any = await BillingRecoveryEpisode.findById(episodeId).lean();
  assert.equal(ep.steps[0].status, 'sent');
  assert.equal(ep.steps[0].attempts, 2);
  assert.equal(ep.steps[0].providerMessageId, 'SM1');

  await BillingRecoveryEpisode.deleteMany({});
  const second = await newEpisode();
  const always429 = harness({ results: Array.from({ length: 10 }, () => ({ success: false, errorCode: '20429', error: 'rate' })) });
  for (const mins of [0, 31, 92, 300, 900]) {
    always429.setClock(new Date(T.getTime() + mins * 60_000));
    await always429.run();
  }
  const capped: any = await BillingRecoveryEpisode.findById(second.episodeId).lean();
  assert.equal(capped.steps[0].status, 'failed');
  assert.equal(capped.steps[0].attempts, 3);
  assert.equal(always429.sends.length, 3);
});

test('timeout / crashed worker → ambiguous, flagged, never resent', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await BillingRecoveryEpisode.deleteMany({});
  const { episodeId } = await newEpisode();
  const h = harness({ results: [{ success: false, error: 'Request timed out after 15000ms' }] });
  await h.run();
  h.setClock(new Date(T.getTime() + 60 * 60_000));
  await h.run();
  assert.equal(h.sends.length, 1);
  const ep: any = await BillingRecoveryEpisode.findById(episodeId).lean();
  assert.equal(ep.steps[0].status, 'ambiguous');
  assert.equal(ep.needsReview, true);

  await BillingRecoveryEpisode.deleteMany({});
  const stale = await newEpisode();
  await BillingRecoveryEpisode.updateOne({ _id: stale.episodeId }, { $set: { 'steps.0.status': 'claimed', 'steps.0.claimedAt': new Date(T.getTime() - 11 * 60_000), 'steps.0.claimToken': 'dead-worker' } });
  const h2 = harness();
  await h2.run();
  const after: any = await BillingRecoveryEpisode.findById(stale.episodeId).lean();
  assert.equal(after.steps[0].status, 'ambiguous');
  assert.equal(h2.sends.length, 0);
});

test('permanent provider errors (invalid number, bad template) are not retried', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await BillingRecoveryEpisode.deleteMany({});
  const { episodeId } = await newEpisode();
  const h = harness({ results: [{ success: false, errorCode: '21211', error: 'Invalid To number' }] });
  await h.run();
  h.setClock(new Date(T.getTime() + 2 * 3_600_000));
  await h.run();
  const ep: any = await BillingRecoveryEpisode.findById(episodeId).lean();
  assert.equal(ep.steps[0].status, 'failed');
  assert.equal(ep.steps[0].lastErrorCode, '21211');
  assert.equal(h.sends.length, 1);
});

test('stop conditions: payment recovered, cancelled, opt-out, phone not eligible, reminders disabled', async (t) => {
  if (skipReason) return t.skip(skipReason);
  for (const [label, ctx, expectedStatus, reason] of [
    ['recovered', { close: { status: 'resolved', reason: 'payment_recovered' } }, 'resolved', 'payment_recovered'],
    ['cancelled', { close: { status: 'stopped', reason: 'subscription_cancelled' } }, 'stopped', 'subscription_cancelled'],
    ['opted out', { close: { status: 'stopped', reason: 'opted_out' } }, 'stopped', 'opted_out'],
    ['phone', { close: { status: 'stopped', reason: 'phone_not_eligible' } }, 'stopped', 'phone_not_eligible'],
  ] as const) {
    await BillingRecoveryEpisode.deleteMany({});
    const { episodeId } = await newEpisode();
    const h = harness({ context: () => ctx as ReminderContext });
    await h.run();
    const ep: any = await BillingRecoveryEpisode.findById(episodeId).lean();
    assert.equal(h.sends.length, 0, label);
    assert.equal(ep.status, expectedStatus, label);
    assert.equal(ep.stopReason, reason, label);
    assert.ok(ep.steps.every((s: any) => s.status === 'stopped'), label);
  }
  await BillingRecoveryEpisode.deleteMany({});
  const off = await newEpisode();
  const disabled = harness({ policy: parseReminderPolicy(null) });
  await disabled.run();
  const ep: any = await BillingRecoveryEpisode.findById(off.episodeId).lean();
  assert.equal(disabled.sends.length, 0);
  assert.equal(ep.stopReason, 'reminders_disabled');
});

test('no approved template → never sends (the policy cannot be enabled)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await BillingRecoveryEpisode.deleteMany({});
  await newEpisode();
  const noTemplate = parseReminderPolicy({ reminders: { ...POLICY, template: { contentSid: SID, approved: false } } });
  assert.equal(noTemplate.enabled, false);
  const h = harness({ policy: noTemplate });
  await h.run();
  assert.equal(h.sends.length, 0);
});

test('reminders resolved by payment stop immediately (closeEpisodes)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await BillingRecoveryEpisode.deleteMany({});
  const { businessId, episodeId } = await newEpisode();
  const h = harness();
  await h.run();
  await closeEpisodes(BillingRecoveryEpisode, { businessId, status: 'resolved', reason: 'payment_recovered', now: T });
  h.setClock(new Date(T.getTime() + 8 * DAY));
  await h.run();
  assert.equal(h.sends.length, 1);
  const ep: any = await BillingRecoveryEpisode.findById(episodeId).lean();
  assert.deepEqual(ep.steps.map((s: any) => s.status), ['sent', 'stopped', 'stopped', 'stopped']);
});

test('sending hours: deferred to the next window, then sent once', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await BillingRecoveryEpisode.deleteMany({});
  const night = new Date('2027-01-15T16:30:00.000Z'); // 22:00 IST
  await newEpisode(night);
  const h = harness();
  h.setClock(night);
  await h.run();
  assert.equal(h.sends.length, 0);
  h.setClock(new Date('2027-01-16T03:29:00.000Z')); // 08:59 IST
  await h.run();
  assert.equal(h.sends.length, 0);
  h.setClock(new Date('2027-01-16T03:30:00.000Z')); // 09:00 IST
  await h.run();
  assert.equal(h.sends.length, 1);
});

test('maximum reminder count is enforced', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await BillingRecoveryEpisode.deleteMany({});
  const max2 = parseReminderPolicy({ reminders: { ...POLICY, maxReminders: 2 } });
  await openEpisode(BillingRecoveryEpisode, { businessId: oid(), userId: oid(), failedAt: T, policy: max2 });
  const h = harness({ policy: max2 });
  for (const d of [0, 1, 2, 7]) {
    h.setClock(new Date(T.getTime() + d * DAY));
    await h.run();
  }
  assert.equal(h.sends.length, 2);
});

test('after an outage only the newest due reminder goes out', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await BillingRecoveryEpisode.deleteMany({});
  const { episodeId } = await newEpisode();
  const h = harness();
  h.setClock(new Date(T.getTime() + 7 * DAY + 3_600_000));
  await h.run();
  assert.equal(h.sends.length, 1);
  const ep: any = await BillingRecoveryEpisode.findById(episodeId).lean();
  assert.deepEqual(ep.steps.map((s: any) => s.status), ['skipped', 'skipped', 'skipped', 'sent']);
});

test('one open episode per workspace; delivery recorded from the provider callback', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await BillingRecoveryEpisode.deleteMany({});
  const businessId = oid();
  const a = await openEpisode(BillingRecoveryEpisode, { businessId, userId: oid(), failedAt: T, policy: POLICY });
  const b = await openEpisode(BillingRecoveryEpisode, { businessId, userId: oid(), failedAt: new Date(T.getTime() + DAY), policy: POLICY });
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(String(b.episode._id), String(a.episode._id));
  assert.equal(new Date(b.episode.failedAt).getTime(), T.getTime(), 'Day 0 not reset');
  const h = harness();
  await h.run();
  assert.equal(await recordDelivery(BillingRecoveryEpisode, 'SM1', 'delivered', T), true);
  const ep: any = await BillingRecoveryEpisode.findById(a.episode._id).lean();
  assert.equal(ep.steps[0].status, 'sent', '"sent" = accepted by the provider');
  assert.equal(ep.steps[0].deliveryStatus, 'delivered', 'delivery only from the callback');
});
