/**
 * Migration safety controls — STAGING tests against a real MongoDB.
 * Covers: durable pause/resume + drain, fail-closed claim gating, and the
 * rollback replay tool. Same DB isolation as jobs-queue.staging.test.ts
 * (scripts/lib/localTestEnv.mjs forces a non-prod test database).
 *
 * Run: TEST_MONGODB_URI=mongodb://127.0.0.1:27555/x npm run test:jobs:staging
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { resolveTestMongoUri } from '../../scripts/lib/localTestEnv.mjs';
import { JobStore, type JobDoc } from '../../src/services/jobs/store';
import { JobWorker } from '../../src/services/jobs/worker';
import { routeEvents } from '../../src/services/jobs/routing';
import { CRON_EVENT, executeReplay, liveWorkers, planReplay, type ReplayEvent } from '../../src/services/jobs/replay';
import type { Logger, NativeFunction } from '../../src/services/jobs/types';
import type { WorkerTuning } from '../../src/services/jobs/config';

const PREFIX = `js${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}_`;
const quiet: Logger = () => {};
let db: any;
let store: JobStore;
const workers: JobWorker[] = [];

before(async () => {
  await mongoose.connect(resolveTestMongoUri(), { family: 4, serverSelectionTimeoutMS: 15000 } as any);
  db = mongoose.connection.db;
  assert.ok(!/prod/i.test(db.databaseName), `refusing to run against ${db.databaseName}`);
  store = new JobStore(db, PREFIX);
  await store.ensureIndexes();
});

after(async () => {
  for (const w of workers) await w.stop().catch(() => undefined);
  for (const c of ['jobs', 'job_cron_state', 'job_locks', 'job_workers', 'job_control']) {
    await db.collection(`${PREFIX}${c}`).drop().catch(() => undefined);
  }
  await mongoose.disconnect();
});

const uid = (n: string) => `${n}-${randomUUID().slice(0, 8)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => Promise<boolean> | boolean, ms = 10_000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await sleep(40);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const tuning = (over: Partial<WorkerTuning> = {}): WorkerTuning => ({
  prefix: PREFIX,
  concurrency: 3,
  leaseMs: 600,
  heartbeatMs: 150,
  pollMs: 40,
  shutdownGraceMs: 3000,
  cronCatchupMs: 3_600_000,
  leaderTtlMs: 5000,
  maxClockSkewMs: 30_000,
  ...over,
});

function fn(id: string, handler: NativeFunction['handler'], over: Partial<NativeFunction> = {}): NativeFunction {
  return { id, handler, maxAttempts: 3, events: [`ev/${id}`], crons: [], cancelOn: [], ...over };
}

function mkWorker(
  fns: NativeFunction[],
  over: { tuning?: Partial<WorkerTuning>; owner?: string; cron?: boolean; claimBlock?: () => string | null } = {}
) {
  const owned = new Set(fns.map((f) => f.id));
  const w = new JobWorker({
    store,
    functions: fns,
    owned,
    tuning: tuning(over.tuning),
    logger: quiet,
    owner: over.owner,
    cronEnabled: over.cron ?? false,
    claimBlock: over.claimBlock,
    backoff: () => 80,
    dispatch: async (events) => (await routeEvents(events, { store, functions: fns, owned })).ids,
  });
  workers.push(w);
  return w;
}

async function enqueue(f: NativeFunction, data: Record<string, any> = {}) {
  const r = await store.enqueue({ fnId: f.id, eventName: f.events[0], key: randomUUID(), data, maxAttempts: f.maxAttempts });
  assert.ok(r.created);
  return String(r.id);
}
const oid = (id: string) => new mongoose.mongo.ObjectId(id);
const getJob = (id: string): Promise<JobDoc> => store.jobs.findOne({ _id: oid(id) }) as any;
const status = async (id: string) => (await getJob(id)).status;

/** Control is global per prefix — every test that pauses must end resumed. */
async function ensureResumed() {
  await store.setPaused(false, 'test');
}

// ------------------------------------------------------- pause / resume --

test('pause/resume are idempotent and durable', async () => {
  await ensureResumed();
  assert.deepEqual(await store.getControl(), { paused: false });
  assert.equal((await store.setPaused(true, 'tester', 'deploy')).changed, true);
  assert.equal((await store.setPaused(true, 'tester', 'again')).changed, false, 'second pause is a no-op');
  const c = await store.getControl();
  assert.equal(c.paused, true);
  assert.equal(c.reason, 'deploy', 'first pause reason is kept');
  // a fresh store object over the same DB sees it (durable, not in-memory)
  assert.equal((await new JobStore(db, PREFIX).getControl()).paused, true);
  assert.equal((await store.setPaused(false, 'tester')).changed, true);
  assert.equal((await store.setPaused(false, 'tester')).changed, false);
  assert.equal((await store.getControl()).paused, false);
});

test('concurrent pause calls: exactly one changes state, none throws', async () => {
  await ensureResumed();
  const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => store.setPaused(true, `p${i}`)));
  assert.equal(rs.filter((r) => r.changed).length, 1);
  const rs2 = await Promise.all(Array.from({ length: 12 }, () => store.setPaused(false, 'r')));
  assert.equal(rs2.filter((r) => r.changed).length, 1);
});

test('paused queue: no job is claimed; resume processes the backlog', async () => {
  await ensureResumed();
  let ran = 0;
  const f = fn(uid('pz'), async ({ step }) => { await step.run('s', async () => { ran++; return 1; }); });
  await store.setPaused(true, 'test');
  const ids = [await enqueue(f), await enqueue(f), await enqueue(f)];
  const w = mkWorker([f]);
  await w.start();
  await sleep(400);
  assert.equal(ran, 0, 'nothing claimed while paused');
  assert.equal(w.isPaused, true);
  assert.equal(w.state, 'paused');
  for (const i of ids) assert.equal(await status(i), 'queued');
  await store.setPaused(false, 'test');
  await waitFor(async () => (await store.jobs.countDocuments({ fnId: f.id, status: 'completed' })) === 3, 8000);
  assert.equal(ran, 3);
  assert.equal(w.state, 'running');
});

test('drain: pause lets the in-flight job finish, claims nothing new, reports draining→paused', async () => {
  await ensureResumed();
  const started: string[] = [];
  const f = fn(uid('drainp'), async ({ step, event }) => {
    await step.run('slow', async () => { started.push(event.data.n); await sleep(700); return 1; });
  }, {});
  const w = mkWorker([f], { tuning: { concurrency: 1, shutdownGraceMs: 5000 } });
  const first = await enqueue(f, { n: 'a' });
  await w.start();
  await waitFor(() => started.length === 1);
  await store.setPaused(true, 'test', 'drain');
  const second = await enqueue(f, { n: 'b' });
  await waitFor(() => w.state === 'draining', 3000, 'draining state');
  const doc: any = await store.workers.findOne({ _id: w.owner as any });
  assert.ok(['draining', 'running', 'paused'].includes(doc.status));
  await waitFor(async () => (await status(first)) === 'completed', 5000, 'in-flight job to finish');
  await waitFor(() => w.state === 'paused', 3000, 'paused state');
  await sleep(300);
  assert.equal(await status(second), 'queued', 'new work was not claimed during pause');
  assert.deepEqual(started, ['a']);
  await store.setPaused(false, 'test');
  await waitFor(async () => (await status(second)) === 'completed', 5000);
});

test('pause that outlasts the grace period releases in-flight work; another worker finishes it after resume', async () => {
  await ensureResumed();
  let runs = 0;
  const f = fn(uid('rel'), async ({ step }) => {
    await step.run('quick', async () => 'q');
    await step.run('slow', async () => { runs++; if (runs === 1) await sleep(3000); return 's'; });
  });
  const id = await enqueue(f);
  const w1 = mkWorker([f], { tuning: { shutdownGraceMs: 250 } });
  await w1.start();
  await waitFor(() => runs === 1);
  await store.setPaused(true, 'test');
  await waitFor(async () => (await status(id)) === 'queued', 4000, 'job released after pause grace');
  const j = await getJob(id);
  assert.equal(j.leaseOwner ?? null, null);
  assert.deepEqual(j.steps.map((s) => s.id), ['quick'], 'persisted steps kept; only the interrupted step is redone');
  await store.setPaused(false, 'test');
  const w2 = mkWorker([f]);
  await w2.start();
  await waitFor(async () => (await status(id)) === 'completed', 6000);
});

test('two workers: pause stops both; resume continues; every job runs exactly once', async () => {
  await ensureResumed();
  const seen = new Map<string, number>();
  const f = fn(uid('two'), async ({ step, event }) => {
    await step.run('s', async () => { seen.set(event.data.n, (seen.get(event.data.n) ?? 0) + 1); await sleep(20); return 1; });
  });
  const w1 = mkWorker([f], { tuning: { concurrency: 2 } });
  const w2 = mkWorker([f], { tuning: { concurrency: 2 } });
  await store.setPaused(true, 'test');
  await w1.start();
  await w2.start();
  for (let i = 0; i < 10; i++) await enqueue(f, { n: String(i) });
  await sleep(400);
  assert.equal(seen.size, 0);
  await store.setPaused(false, 'test');
  await waitFor(async () => (await store.jobs.countDocuments({ fnId: f.id, status: 'completed' })) === 10, 10_000);
  assert.equal(seen.size, 10);
  assert.ok([...seen.values()].every((n) => n === 1), 'no job ran twice');
});

test('fail closed: unreadable control document ⇒ no claims; recovers when readable', async () => {
  await ensureResumed();
  let ran = 0;
  const f = fn(uid('fc'), async ({ step }) => { await step.run('s', async () => { ran++; return 1; }); });
  const real = store.getControl.bind(store);
  let broken = true;
  (store as any).getControl = async () => { if (broken) throw new Error('mongo hiccup'); return real(); };
  try {
    await enqueue(f);
    const w = mkWorker([f]);
    await w.start();
    await sleep(400);
    assert.equal(ran, 0, 'must not claim when pause state is unknown');
    assert.equal(w.claimBlockedReason, 'control-unreadable');
    broken = false;
    await waitFor(() => ran === 1, 5000);
  } finally {
    (store as any).getControl = real;
  }
});

test('claimBlock hook (ownership guard): blocks claims AND cron leadership until cleared', async () => {
  await ensureResumed();
  let ran = 0;
  let block: string | null = 'ownership-guard: web still serves owned ids';
  const f = fn(uid('gd'), async ({ step }) => { await step.run('s', async () => { ran++; return 1; }); }, {
    crons: ['* * * * *'],
  });
  const id = await enqueue(f);
  const w = mkWorker([f], { cron: true, claimBlock: () => block, tuning: { leaderTtlMs: 5000 } });
  await w.start();
  await sleep(500);
  assert.equal(ran, 0);
  assert.equal(w.isLeader, false, 'a blocked worker must not lead the cron scheduler');
  assert.equal(w.state, 'blocked');
  assert.equal(await status(id), 'queued');
  block = null;
  await waitFor(() => ran === 1, 5000);
});

// ------------------------------------------------------- replay-to-inngest --

async function seedJob(f: NativeFunction, patch: Record<string, any> = {}) {
  const id = await enqueue(f, { postId: 'p1', secretish: 'do-not-print' });
  if (Object.keys(patch).length) await store.jobs.updateOne({ _id: oid(id) }, { $set: patch });
  return id;
}

test('replay plan: only never-started event jobs are eligible; everything uncertain is reported, not replayed', async () => {
  const f = fn(uid('rp'), async () => 1);
  const clean = await seedJob(f);
  const retried = await seedJob(f, { attempts: 1 });
  const recovered = await seedJob(f, { recoveries: 1 });
  const partial = await seedJob(f, { steps: [{ id: 'x', kind: 'run', at: new Date() }] });
  const sleeping = await seedJob(f, { status: 'sleeping' });
  const running = await seedJob(f, { status: 'running', leaseExpiresAt: new Date(Date.now() + 60000) });
  const dead = await seedJob(f, { status: 'dead' });
  const completed = await seedJob(f, { status: 'completed' });
  const cron = await seedJob(f, { eventName: CRON_EVENT });

  const plan = await planReplay(store, { fnIds: [f.id] });
  assert.deepEqual(plan.eligible.map((e) => String(e.id)), [clean]);
  const reasons = Object.fromEntries(plan.skipped.map((s) => [String(s.id), s.reason]));
  assert.equal(reasons[retried], 'retried-or-recovered');
  assert.equal(reasons[recovered], 'retried-or-recovered');
  assert.equal(reasons[partial], 'partially-executed');
  assert.equal(reasons[sleeping], 'sleeping');
  assert.equal(reasons[running], 'running');
  assert.equal(reasons[dead], 'dead');
  assert.equal(reasons[cron], 'cron-slot');
  assert.equal(reasons[completed], undefined, 'completed jobs are never considered');
  assert.equal(plan.byFunction[f.id].eligible, 1);
});

test('replay dry-run changes nothing; execute sends original id/name/payload once and retires the native job', async () => {
  const f = fn(uid('rx'), async () => 1);
  const id = await seedJob(f);
  const before = await getJob(id);

  const plan = await planReplay(store, { fnIds: [f.id] });
  assert.equal((await getJob(id)).status, 'queued', 'planning is read-only');

  const sent: ReplayEvent[] = [];
  const out = await executeReplay(store, plan, async (ev) => { sent.push(ev); });
  assert.equal(out.replayed, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, before.eventId, 'stable dedupe id preserved');
  assert.equal(sent[0].name, before.eventName);
  assert.deepEqual(sent[0].data, before.data);

  const after = await getJob(id);
  assert.equal(after.status, 'cancelled');
  assert.equal(after.cancelledReason, 'replayed-to-inngest');
  assert.ok(after.expireAt, 'cleaned up by the normal TTL, never deleted manually');

  // second run: nothing left to replay
  const again = await planReplay(store, { fnIds: [f.id] });
  assert.equal(again.eligible.length, 0);

  // and a worker owning the function never executes the retired job
  let ran = 0;
  const g = { ...f, handler: async () => { ran++; } };
  const w = mkWorker([g]);
  await w.start();
  await sleep(300);
  assert.equal(ran, 0);
});

test('replay send failure is recorded and retried on the next run; repeat after interruption reuses the same event id', async () => {
  const f = fn(uid('rf'), async () => 1);
  const id = await seedJob(f);
  const plan = await planReplay(store, { fnIds: [f.id] });
  const out = await executeReplay(store, plan, async () => { throw new Error('inngest 503'); });
  assert.equal(out.failed, 1);
  assert.equal((await getJob(id)).cancelledReason, 'replay-failed');

  // simulate a crash between the cancel and the confirmation
  await store.jobs.updateOne({ _id: oid(id) }, { $set: { cancelledReason: 'replay-pending' } });
  const plan2 = await planReplay(store, { fnIds: [f.id] });
  assert.equal(plan2.eligible.length, 1);
  assert.equal(plan2.eligible[0].interrupted, true);

  const sent: ReplayEvent[] = [];
  const out2 = await executeReplay(store, plan2, async (ev) => { sent.push(ev); });
  assert.equal(out2.replayed, 1);
  assert.equal(sent[0].id, (await getJob(id)).eventId);
  assert.equal((await getJob(id)).cancelledReason, 'replayed-to-inngest');
});

test('replay never touches natively-owned functions and loses races safely', async () => {
  const f = fn(uid('ro'), async () => 1);
  const id = await seedJob(f);
  const plan = await planReplay(store, { fnIds: [f.id], nativeOwned: new Set([f.id]) });
  assert.equal(plan.eligible.length, 0);
  assert.equal(plan.skipped[0].reason, 'natively-owned');

  // race: job is claimed by a worker between plan and execute
  const plan2 = await planReplay(store, { fnIds: [f.id] });
  await store.jobs.updateOne({ _id: oid(id) }, { $set: { status: 'running', attempts: 0 } });
  const sent: ReplayEvent[] = [];
  const out = await executeReplay(store, plan2, async (ev) => { sent.push(ev); });
  assert.equal(out.raced, 1);
  assert.equal(sent.length, 0, 'a job that started meanwhile is not replayed');
});

test('liveWorkers: a recent heartbeat blocks replay; a stopped worker does not', async () => {
  const f = fn(uid('lw'), async () => 1);
  const w = mkWorker([f]);
  await w.start();
  assert.ok((await liveWorkers(store, 5000)).some((x) => x.id === w.owner));
  await w.stop();
  assert.ok(!(await liveWorkers(store, 5000)).some((x) => x.id === w.owner));
});
