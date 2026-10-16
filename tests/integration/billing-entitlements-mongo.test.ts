/**
 * The crons' "paid or authorized trial" MongoDB filter, and the legacy
 * "Trialing" cleanup script, against a REAL MongoDB (in-memory server, or
 * MONGODB_TEST_URI). Never MONGODB_URI. Skipped (not passed) if neither exists.
 * Run: node --experimental-strip-types --test tests/integration/billing-entitlements-mongo.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import mongoose from 'mongoose';
import { planAccessWorkspaceFilter, workspaceHasPlanAccess } from '../../src/lib/billing/entitlements.ts';
import { TRIAL_CHARGE_PROCESSING_MS } from '../../src/lib/billing/billingPolicy.ts';
import { statusFilter, monitorStatus, MONITOR_STATUSES } from '../../src/lib/billing/monitoring.ts';

let memoryServer: any = null;
let skipReason: string | null = null;
let uri = '';
const DB = `gm_entitlements_test_${Date.now()}`;

before(async () => {
  uri = process.env.MONGODB_TEST_URI ?? '';
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
  await mongoose.connect(uri, { dbName: DB });
});

after(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const NOW = new Date('2026-12-01T00:00:00.000Z');
const H = 3_600_000;

test('cron filter selects exactly the workspaces the plan-access rule allows', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const col = mongoose.connection.db!.collection('ent_businesses');
  const docs = [
    { name: 'paid', subscriptionStatus: 'active' },
    { name: 'trial', subscriptionStatus: 'trial_active', trialEndsAt: new Date(NOW.getTime() + 40 * 24 * H) },
    { name: 'trial-processing', subscriptionStatus: 'trial_active', trialEndsAt: new Date(NOW.getTime() - 2 * H) },
    { name: 'trial-over', subscriptionStatus: 'trial_active', trialEndsAt: new Date(NOW.getTime() - TRIAL_CHARGE_PROCESSING_MS - H) },
    { name: 'cancelled-before-end', subscriptionStatus: 'trial_active', trialEndsAt: new Date(NOW.getTime() + 5 * 24 * H), trialCancelledAt: new Date(NOW.getTime() - 24 * H) },
    { name: 'cancelled-after-end', subscriptionStatus: 'trial_active', trialEndsAt: new Date(NOW.getTime() - 2 * H), trialCancelledAt: new Date(NOW.getTime() - 24 * H) },
    { name: 'trial-no-end', subscriptionStatus: 'trial_active' },
    { name: 'past-due', subscriptionStatus: 'past_due' },
    { name: 'past-due-in-grace', subscriptionStatus: 'past_due', paymentGraceEndsAt: new Date(NOW.getTime() + 24 * H) },
    { name: 'past-due-after-grace', subscriptionStatus: 'past_due', paymentGraceEndsAt: new Date(NOW.getTime() - H) },
    { name: 'paid-but-held', subscriptionStatus: 'active', paymentAccessHold: true },
    { name: 'cancelled', subscriptionStatus: 'canceled' },
    { name: 'never-paid', subscriptionStatus: 'trialing' },
  ];
  await col.insertMany(docs.map((d) => ({ ...d })));
  const selected = (await col.find(planAccessWorkspaceFilter(NOW)).toArray()).map((d) => d.name).sort();
  const expected = docs.filter((d) => workspaceHasPlanAccess(d as any, NOW)).map((d) => d.name).sort();
  assert.deepEqual(selected, expected);
  assert.deepEqual(selected, ['cancelled-before-end', 'paid', 'past-due-in-grace', 'trial', 'trial-processing']);
});

function runCleanup(args: string[]) {
  return spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/cleanup-legacy-trialing.ts', ...args], {
    env: { ...process.env, MONGODB_URI: `${uri.replace(/\/?(\?.*)?$/, '')}/${DB}` },
    encoding: 'utf8',
  });
}

test('legacy "Trialing" cleanup: dry run changes nothing; apply needs the DB name; payers and real trials untouched', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const db = mongoose.connection.db!;
  const future = new Date(Date.now() + 10 * 24 * H);
  const free = await db.collection('users').insertOne({ subscriptionPlan: 'Free' });
  const free2 = await db.collection('users').insertOne({ subscriptionPlan: 'Free' });
  const payer = await db.collection('users').insertOne({ subscriptionPlan: 'Pro' });
  const trialUser = await db.collection('users').insertOne({ subscriptionPlan: 'Free' });
  await db.collection('subscriptions').insertMany([
    { userId: free.insertedId, planType: 'Free', billingStatus: 'Trialing', trialStatus: { isActive: true, endsAt: future } },
    { userId: free2.insertedId, planType: 'Free', billingStatus: 'Trialing', trialStatus: { isActive: true, endsAt: new Date('2025-01-01') } },
    { userId: payer.insertedId, planType: 'Pro', billingStatus: 'Trialing', trialStatus: { isActive: true, endsAt: future } },
    { userId: trialUser.insertedId, planType: 'Free', billingStatus: 'Trialing', trialSource: 'offer', trialStatus: { isActive: true, endsAt: future } },
  ]);
  const snapshot = async () => (await db.collection('subscriptions').find().sort({ _id: 1 }).toArray()).map((s) => s.billingStatus);

  const dry = runCleanup([]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /without trialSource: 3/);
  assert.match(dry.stdout, /was granting paid access under the old rule : 1/);
  assert.match(dry.stdout, /already expired\s+: 1/);
  assert.match(dry.stdout, /paying customers \(left alone, review\)\s+: 1/);
  assert.deepEqual(await snapshot(), ['Trialing', 'Trialing', 'Trialing', 'Trialing']);

  const refused = runCleanup(['--apply', '--confirm-db=some_other_db']);
  assert.notEqual(refused.status, 0);
  assert.deepEqual(await snapshot(), ['Trialing', 'Trialing', 'Trialing', 'Trialing']);

  const applied = runCleanup(['--apply', `--confirm-db=${DB}`]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /Updated 2 record/);
  // Two legacy records fixed; the paying customer and the real offer trial untouched.
  assert.deepEqual(await snapshot(), ['Active', 'Active', 'Trialing', 'Trialing']);
  const fixed = await db.collection('subscriptions').findOne({ userId: free.insertedId });
  assert.equal(fixed!.trialStatus.isActive, false);
  assert.equal(fixed!.planType, 'Free');
});

test('monitoring status filters select exactly what monitorStatus says, for every state', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const col = mongoose.connection.db!.collection('monitor_businesses');
  const docs = [
    { name: 'paid', subscriptionStatus: 'active' },
    { name: 'held', subscriptionStatus: 'active', paymentAccessHold: true },
    { name: 'trial', subscriptionStatus: 'trial_active', trialEndsAt: new Date(NOW.getTime() + 9 * 24 * H) },
    { name: 'trial-cancelled', subscriptionStatus: 'trial_active', trialEndsAt: new Date(NOW.getTime() + 9 * 24 * H), trialCancelledAt: NOW },
    { name: 'grace', subscriptionStatus: 'past_due', paymentGraceEndsAt: new Date(NOW.getTime() + H) },
    { name: 'restricted', subscriptionStatus: 'past_due', paymentGraceEndsAt: new Date(NOW.getTime() - H) },
    { name: 'restricted-no-grace', subscriptionStatus: 'past_due' },
    { name: 'cancelled', subscriptionStatus: 'canceled' },
    { name: 'never-paid', subscriptionStatus: 'trialing' },
    { name: 'no-status' },
  ];
  await col.insertMany(docs.map((d) => ({ ...d })));
  for (const status of MONITOR_STATUSES) {
    const selected = (await col.find(statusFilter(status, NOW)).toArray()).map((d) => d.name).sort();
    const expected = docs.filter((d) => monitorStatus(d, NOW) === status).map((d) => d.name).sort();
    assert.deepEqual(selected, expected, status);
  }
});
