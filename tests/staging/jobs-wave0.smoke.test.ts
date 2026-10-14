/**
 * Wave 0 REAL-HANDLER smoke test.
 *
 * Runs the actual Inngest handlers for
 *   - cleanup-stale-pending-audits   (wave 0a)
 *   - data-retention-cleanup-cron    (wave 0b)
 * through the native runner (adapter → JobWorker → step shim) against a
 * DISPOSABLE MongoDB database (unique name, dropped afterwards). Eligible and
 * ineligible rows are seeded; state changes are asserted; a second run proves
 * repeat execution is a no-op. `fetch` is replaced with a function that
 * records and rejects, proving no outbound HTTP happens.
 *
 * Run: TEST_MONGODB_URI=mongodb://127.0.0.1:27556/x?directConnection=true npm run test:jobs:smoke
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const DB_NAME = `wave0_smoke_${Date.now().toString(36)}`;
// Loaded in before() (CJS output has no top-level await). Everything is set up
// before any app module (which reads MONGODB_URI at import time) is imported.
let mongoose: any, JobStore: any, JobWorker: any, loadRegistry: any, assertOwnable: any, routeEvents: any, dbConnect: any;

const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);
const oid = () => new mongoose.mongo.ObjectId();

let store: any;
let db: any;
const fetchCalls: string[] = [];
const realFetch = globalThis.fetch;
const workers: any[] = [];

before(async () => {
  assert.match(DB_NAME, /^wave0_smoke_/);
  assert.ok(!/prod/i.test(DB_NAME));
  // Fail closed: explicit loopback TEST_MONGODB_URI only (ALLOW_REMOTE_TEST_DB=1 to override);
  // no env files are loaded, so no production secrets or MONGODB_URI fallback can leak in.
  const { resolveLoopbackTestUri } = await import('../../scripts/lib/loopbackTestDb.mjs');
  process.env.MONGODB_URI = resolveLoopbackTestUri({ dbName: DB_NAME });
  (process.env as any).NODE_ENV = 'test';
  mongoose = (await import('mongoose')).default;
  ({ JobStore } = await import('../../src/services/jobs/store'));
  ({ JobWorker } = await import('../../src/services/jobs/worker'));
  ({ loadRegistry } = await import('../../src/services/jobs/dispatch'));
  ({ assertOwnable } = await import('../../src/services/jobs/adapter'));
  ({ routeEvents } = await import('../../src/services/jobs/routing'));
  dbConnect = (await import('../../src/lib/mongodb')).default;
  globalThis.fetch = (async (input: any) => {
    fetchCalls.push(String(input?.url ?? input));
    throw new Error('network disabled in smoke test');
  }) as any;
  await dbConnect();
  db = mongoose.connection.db;
  assert.equal(db.databaseName, DB_NAME, 'must be connected to the disposable database');
  store = new JobStore(db, 'smoke_');
  await store.ensureIndexes();
});

after(async () => {
  for (const w of workers) await w.stop().catch(() => undefined);
  globalThis.fetch = realFetch;
  if (db?.databaseName === DB_NAME) await db.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
});

async function runNative(fnId: string): Promise<any> {
  const functions: any[] = await loadRegistry();
  const fn = functions.find((f) => f.id === fnId);
  assert.ok(fn, `${fnId} is registered`);
  const owned = new Set([fnId]);
  assertOwnable(functions, owned);

  // Same shape the cron scheduler produces.
  const slot = `${Date.now()}-${randomUUID().slice(0, 6)}`;
  const enq = await store.enqueue({
    fnId,
    eventName: 'inngest/scheduled.timer',
    key: `cron:${slot}`,
    eventId: `cron:${fnId}:${slot}`,
    data: { cron: fn.crons[0], slot },
    maxAttempts: fn.maxAttempts,
  });
  assert.ok(enq.created);

  const worker = new JobWorker({
    store,
    functions,
    owned,
    tuning: {
      prefix: 'smoke_',
      concurrency: 1,
      leaseMs: 60_000,
      heartbeatMs: 10_000,
      pollMs: 50,
      shutdownGraceMs: 5_000,
      cronCatchupMs: 3_600_000,
      leaderTtlMs: 5_000,
      maxClockSkewMs: 30_000,
    },
    logger: () => {},
    cronEnabled: false,
    dispatch: async (events: any) => (await routeEvents(events, { store, functions, owned })).ids,
  });
  workers.push(worker);
  await worker.start();
  const deadline = Date.now() + 30_000;
  let job: any;
  while (Date.now() < deadline) {
    job = await store.jobs.findOne({ _id: enq.id });
    if (job && ['completed', 'dead'].includes(job.status)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await worker.stop();
  assert.equal(job?.status, 'completed', `job should complete; got ${job?.status} (${job?.lastError ?? ''})`);
  return job;
}

// ---------------------------------------------------------- wave 0a --

test('wave 0a cleanup-stale-pending-audits: deletes only PENDING audits older than 5 min; safe to repeat', async () => {
  const { default: Audit } = await import('../../src/models/Audit');
  const col = Audit.collection;
  const biz = oid();
  const ids = {
    stalePending10: oid(),
    stalePending6: oid(),
    freshPending1: oid(),
    oldCompleted: oid(),
    oldFailed: oid(),
  };
  const base = { businessId: biz, userId: oid() };
  await col.insertMany([
    { _id: ids.stalePending10, ...base, status: 'PENDING', createdAt: ago(10 * MIN) },
    { _id: ids.stalePending6, ...base, status: 'PENDING', createdAt: ago(6 * MIN) },
    { _id: ids.freshPending1, ...base, status: 'PENDING', createdAt: ago(1 * MIN) },
    { _id: ids.oldCompleted, ...base, status: 'COMPLETED', createdAt: ago(10 * MIN) },
    { _id: ids.oldFailed, ...base, status: 'FAILED', createdAt: ago(10 * MIN) },
  ] as any);

  const job1 = await runNative('cleanup-stale-pending-audits');
  assert.deepEqual({ ...job1.result }, { success: true, deleted: 2 });
  const left = (await col.find({ businessId: biz }).project({ _id: 1 }).toArray()).map((d: any) => String(d._id)).sort();
  assert.deepEqual(left, [ids.freshPending1, ids.oldCompleted, ids.oldFailed].map(String).sort());

  // repeat: nothing eligible remains → no-op, no further changes
  const job2 = await runNative('cleanup-stale-pending-audits');
  assert.deepEqual({ ...job2.result }, { success: true, deleted: 0 });
  assert.equal(await col.countDocuments({ businessId: biz }), 3);
  assert.equal(job1.steps.length, 1, 'single persisted step, like Inngest');
});

// ---------------------------------------------------------- wave 0b --

test('wave 0b data-retention-cleanup-cron: sweeps expired OTP fields, prunes terminal rows, trims conversations; repeat is a no-op', async () => {
  const { default: User } = await import('../../src/models/User');
  const { default: MessageQueue } = await import('../../src/models/MessageQueue');
  const { default: JobQueue } = await import('../../src/models/JobQueue');
  const { default: ScheduledAction } = await import('../../src/models/ScheduledAction');
  const { default: SalesConversation } = await import('../../src/models/SalesConversation');

  // ---- users: expired fields cleared, live ones and the user itself untouched
  const uExpired = oid();
  const uLive = oid();
  await User.collection.insertMany([
    {
      _id: uExpired, email: 'expired@example.test', phone: '+919000000001', name: 'Expired',
      emailOtpHash: 'h1', emailOtpExpiry: ago(1 * DAY),
      phoneOtpHash: 'h2', phoneOtpExpiry: ago(1 * DAY),
      passwordResetOtp: 'x', passwordResetExpiry: ago(1 * DAY), passwordResetAttempts: 2,
      passwordResetTokenHash: 't', passwordResetTokenExpiry: ago(1 * DAY),
    },
    {
      _id: uLive, email: 'live@example.test', phone: '+919000000002', name: 'Live',
      emailOtpHash: 'keep', emailOtpExpiry: new Date(Date.now() + DAY),
      passwordResetTokenHash: 'keep2', passwordResetTokenExpiry: new Date(Date.now() + DAY),
    },
  ] as any);

  // ---- terminal queue rows
  const mq = { oldSent: oid(), recentSent: oid(), oldFailed: oid(), oldPending: oid() };
  await MessageQueue.collection.insertMany([
    { _id: mq.oldSent, status: 'SENT', direction: 'OUTBOUND', updatedAt: ago(31 * DAY), createdAt: ago(31 * DAY) },
    { _id: mq.recentSent, status: 'SENT', direction: 'OUTBOUND', updatedAt: ago(5 * DAY), createdAt: ago(5 * DAY) },
    { _id: mq.oldFailed, status: 'FAILED', direction: 'OUTBOUND', updatedAt: ago(40 * DAY), createdAt: ago(40 * DAY) },
    { _id: mq.oldPending, status: 'PENDING', direction: 'OUTBOUND', updatedAt: ago(40 * DAY), createdAt: ago(40 * DAY) },
  ] as any);
  const jq = { oldDone: oid(), oldPending: oid() };
  await JobQueue.collection.insertMany([
    { _id: jq.oldDone, status: 'COMPLETED', updatedAt: ago(31 * DAY), createdAt: ago(31 * DAY) },
    { _id: jq.oldPending, status: 'PENDING', updatedAt: ago(40 * DAY), createdAt: ago(40 * DAY) },
  ] as any);
  const sa = { oldExecuted: oid(), oldSkipped: oid(), oldPending: oid(), recentExecuted: oid() };
  // idempotencyKey has a UNIQUE index (non-sparse): every seeded row needs its own value or the insert
  // races Mongoose's async index build and fails with E11000 on null.
  const key = (n: string) => `smoke-${n}-${new mongoose.mongo.ObjectId().toHexString()}`;
  await ScheduledAction.collection.insertMany([
    { _id: sa.oldExecuted, idempotencyKey: key('oldExecuted'), status: 'EXECUTED', updatedAt: ago(91 * DAY), createdAt: ago(91 * DAY) },
    { _id: sa.oldSkipped, idempotencyKey: key('oldSkipped'), status: 'SKIPPED', updatedAt: ago(91 * DAY), createdAt: ago(91 * DAY) },
    { _id: sa.oldPending, idempotencyKey: key('oldPending'), status: 'PENDING', updatedAt: ago(100 * DAY), createdAt: ago(100 * DAY) },
    { _id: sa.recentExecuted, idempotencyKey: key('recentExecuted'), status: 'EXECUTED', updatedAt: ago(10 * DAY), createdAt: ago(10 * DAY) },
  ] as any);

  // ---- conversations: 600 messages → last 500 kept; 10 untouched
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ body: `m${i}`, at: new Date(), direction: 'IN' }));
  const cBig = oid();
  const cSmall = oid();
  await SalesConversation.collection.insertMany([
    { _id: cBig, messages: mk(600) },
    { _id: cSmall, messages: mk(10) },
  ] as any);

  const job1 = await runNative('data-retention-cleanup-cron');
  const r = job1.result;
  assert.equal(r.success, true);
  assert.equal(r.otpFieldsSwept.emailOtp, 1);
  assert.equal(r.otpFieldsSwept.phoneOtp, 1);
  assert.equal(r.otpFieldsSwept.passwordResetOtp, 1);
  assert.equal(r.otpFieldsSwept.passwordResetToken, 1);
  assert.deepEqual(r.queuesPruned, { messageQueue: 1, jobQueue: 1 });
  assert.equal(r.scheduledActionsPruned, 2);
  assert.equal(r.conversationsTrimmed, 1);
  assert.equal(job1.steps.length, 4, 'four persisted steps, like Inngest');

  // user: temp auth fields gone, record kept; live user untouched
  const expired: any = await User.collection.findOne({ _id: uExpired });
  assert.ok(expired, 'the user is never deleted');
  for (const k of ['emailOtpHash', 'emailOtpExpiry', 'phoneOtpHash', 'phoneOtpExpiry', 'passwordResetOtp', 'passwordResetExpiry', 'passwordResetAttempts', 'passwordResetTokenHash', 'passwordResetTokenExpiry']) {
    assert.equal(expired[k], undefined, `${k} should be unset`);
  }
  const live: any = await User.collection.findOne({ _id: uLive });
  assert.equal(live.emailOtpHash, 'keep');
  assert.equal(live.passwordResetTokenHash, 'keep2');

  const exists = async (col: any, id: any) => (await col.countDocuments({ _id: id })) === 1;
  assert.equal(await exists(MessageQueue.collection, mq.oldSent), false);
  assert.equal(await exists(MessageQueue.collection, mq.recentSent), true);
  assert.equal(await exists(MessageQueue.collection, mq.oldFailed), true, 'FAILED rows are kept for debugging');
  assert.equal(await exists(MessageQueue.collection, mq.oldPending), true);
  assert.equal(await exists(JobQueue.collection, jq.oldDone), false);
  assert.equal(await exists(JobQueue.collection, jq.oldPending), true);
  assert.equal(await exists(ScheduledAction.collection, sa.oldExecuted), false);
  assert.equal(await exists(ScheduledAction.collection, sa.oldSkipped), false);
  assert.equal(await exists(ScheduledAction.collection, sa.oldPending), true, 'PENDING actions are never touched');
  assert.equal(await exists(ScheduledAction.collection, sa.recentExecuted), true);

  const big: any = await SalesConversation.collection.findOne({ _id: cBig });
  assert.equal(big.messages.length, 500);
  assert.equal(big.messages[0].body, 'm100', 'the most recent 500 are kept');
  assert.equal(big.messages[499].body, 'm599');
  assert.equal(((await SalesConversation.collection.findOne({ _id: cSmall })) as any).messages.length, 10);

  // ---- repeat: nothing changes
  const snapshot = async () => ({
    mq: await MessageQueue.collection.countDocuments({}),
    jq: await JobQueue.collection.countDocuments({}),
    sa: await ScheduledAction.collection.countDocuments({}),
    u: JSON.stringify(await User.collection.find({}).sort({ _id: 1 }).toArray()),
  });
  const before = await snapshot();
  const job2 = await runNative('data-retention-cleanup-cron');
  const r2 = job2.result;
  assert.deepEqual(r2.otpFieldsSwept, { emailOtp: 0, phoneOtp: 0, passwordResetOtp: 0, passwordResetToken: 0 });
  assert.deepEqual(r2.queuesPruned, { messageQueue: 0, jobQueue: 0 });
  assert.equal(r2.scheduledActionsPruned, 0);
  assert.equal(r2.conversationsTrimmed, 0);
  assert.deepEqual(await snapshot(), before, 'second run changed nothing');
});

test('no outbound HTTP was attempted by either handler', () => {
  assert.deepEqual(fetchCalls, []);
});
