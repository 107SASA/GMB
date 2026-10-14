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
import { resolveLoopbackTestUri } from '../../scripts/lib/loopbackTestDb.mjs';
import { JobStore, type JobDoc } from '../../src/services/jobs/store';
import { JobWorker } from '../../src/services/jobs/worker';
import { routeEvents } from '../../src/services/jobs/routing';
import { CRON_EVENT, executeReplay, liveWorkers, planReplay, type ReplayEvent } from '../../src/services/jobs/replay';
import { waitForPauseAck } from '../../src/services/jobs/pauseWait';
import type { Logger, NativeFunction } from '../../src/services/jobs/types';
import type { WorkerTuning } from '../../src/services/jobs/config';

const PREFIX = `js${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}_`;
const quiet: Logger = () => {};
let db: any;
let store: JobStore;
const workers: JobWorker[] = [];

before(async () => {
  await mongoose.connect(resolveLoopbackTestUri({ dbName: `jobs_safety_${Date.now().toString(36)}` }), { family: 4, serverSelectionTimeoutMS: 15000 } as any);
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
  if (db?.databaseName && /^jobs_(queue|safety)_/.test(db.databaseName)) await db.dropDatabase().catch(() => undefined);
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
  await store.jobs.updateOne({ _id: oid(id) }, { $set: { cancelledReason: 'replay-pending', replayClaimedAt: new Date(Date.now() - 15 * 60000), replayClaimToken: 'dead-process' } });
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


// ===================================================== hardening regressions ==

// ---- H3: pause state is read before the scheduler's first tick -------------

test('H3: a worker started while PAUSED never enqueues a cron slot; it does after resume', async () => {
  await ensureResumed();
  let ran = 0;
  const f = fn(uid('cronp'), async ({ step }) => { await step.run('s', async () => { ran++; return 1; }); }, { crons: ['* * * * *'] });
  // Pre-existing cron state two minutes old, so the very first tick WOULD enqueue a slot.
  await store.cronState.updateOne(
    { _id: f.id as any },
    { $set: { lastSlotAt: Math.floor((Date.now() - 2 * 60_000) / 60_000) * 60_000, missed: 0, expr: '* * * * *' } },
    { upsert: true }
  );
  await store.setPaused(true, 'test');
  const w = mkWorker([f], { cron: true });
  await w.start();
  await sleep(700);
  assert.equal(await store.jobs.countDocuments({ fnId: f.id }), 0, 'no slot enqueued while paused');
  assert.equal(ran, 0);
  await store.setPaused(false, 'test');
  await waitFor(() => ran >= 1, 8000, 'cron slot after resume');
});

test('H3: control state is re-read between claims (not once per round)', async () => {
  await ensureResumed();
  const events: string[] = [];
  const realClaim = store.claim.bind(store);
  const realControl = store.getControl.bind(store);
  (store as any).claim = async (...a: any[]) => { const r = await (realClaim as any)(...a); events.push(r ? 'claim' : 'claim-empty'); return r; };
  (store as any).getControl = async () => { events.push('control'); return realControl(); };
  try {
    const f = fn(uid('rc'), async ({ step }) => { await step.run('s', async () => { await sleep(150); return 1; }); });
    for (let i = 0; i < 3; i++) await enqueue(f, { i });
    const w = mkWorker([f], { tuning: { concurrency: 3 } });
    await w.start();
    await waitFor(async () => (await store.jobs.countDocuments({ fnId: f.id, status: 'completed' })) === 3, 8000);
    const seq = events.join(',');
    const claims = events.map((e, i) => ({ e, i })).filter((x) => x.e === 'claim');
    assert.ok(claims.length >= 3);
    // a control read precedes every claim, and sits between every two consecutive claims
    for (const c of claims) {
      assert.ok(events.slice(0, c.i).includes('control'), `a control read precedes claim @${c.i}: ${seq}`);
    }
    for (let k = 1; k < claims.length; k++) {
      const between = events.slice(claims[k - 1].i + 1, claims[k].i);
      assert.ok(between.includes('control'), `no control read between claims: ${seq}`);
    }
  } finally {
    delete (store as any).claim;
    delete (store as any).getControl;
  }
});

test('H3: once a worker reports paused it claims nothing more, even with a backlog', async () => {
  await ensureResumed();
  const started: number[] = [];
  const f = fn(uid('nomore'), async ({ step, event }) => {
    await step.run('s', async () => { started.push(event.data.i); await sleep(100); return 1; });
  });
  const w = mkWorker([f], { tuning: { concurrency: 1 } });
  await w.start();
  for (let i = 0; i < 6; i++) await enqueue(f, { i });
  await waitFor(() => started.length >= 1);
  const since = store.now();
  await store.setPaused(true, 'test');
  const ack = await waitForPauseAck(store, { since, timeoutMs: 8000, pollMs: 50 });
  assert.equal(ack.acked, true, JSON.stringify(ack));
  const frozen = started.length;
  await sleep(500);
  assert.equal(started.length, frozen, 'no claims after the pause was acknowledged');
  await store.setPaused(false, 'test');
  await waitFor(() => started.length === 6, 10_000);
});

test('H3: pause --wait semantics: not acked while a job is in flight, acked when drained', async () => {
  await ensureResumed();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let running = 0;
  const f = fn(uid('pw'), async ({ step }) => { await step.run('hold', async () => { running++; await gate; return 1; }); });
  await enqueue(f);
  const w = mkWorker([f], { tuning: { shutdownGraceMs: 60_000 } });
  await w.start();
  await waitFor(() => running === 1);

  const since = store.now();
  await store.setPaused(true, 'test');
  const early = await waitForPauseAck(store, { since, timeoutMs: 600, pollMs: 40 });
  assert.equal(early.acked, false);
  assert.equal(early.timedOut, true);
  assert.ok(early.waitingOn.length >= 1, JSON.stringify(early.waitingOn));

  release();
  const done = await waitForPauseAck(store, { since, timeoutMs: 8000, pollMs: 40 });
  assert.equal(done.acked, true, JSON.stringify(done));
  assert.equal(done.timedOut, false);
  await store.setPaused(false, 'test');
});

// ---- M1: an unreadable control document must not abort in-flight work ------

test('M1: control-doc read errors block NEW claims but never release in-flight jobs', async () => {
  await ensureResumed();
  const release: Array<() => void> = [];
  const f = fn(uid('m1'), async ({ step }) => {
    await step.run('long', async () => { await new Promise<void>((r) => release.push(r)); return 1; });
  });
  const long = await enqueue(f);
  const w = mkWorker([f], { tuning: { shutdownGraceMs: 150, leaseMs: 5000, heartbeatMs: 500 } });
  await w.start();
  await waitFor(() => release.length === 1);

  (store as any).getControl = async () => { throw new Error('mongo hiccup'); };
  try {
    // Wait until the worker has OBSERVED the failure; only then is "no new claims" the contract
    // (a claim already in flight at the instant of the failure cannot be taken back).
    await waitFor(() => w.claimBlockedReason === 'control-unreadable', 3000, 'worker to observe the control error');
    const fresh = await enqueue(f);
    await sleep(900); // several multiples of shutdownGraceMs
    assert.equal(w.claimBlockedReason, 'control-unreadable');
    assert.equal(await status(long), 'running', 'in-flight job must NOT be released by a control read error');
    assert.equal(await status(fresh), 'queued', 'new work must not be claimed');
  } finally {
    delete (store as any).getControl;
  }
  release.forEach((r) => r());
  await waitFor(async () => (await status(long)) === 'completed', 6000);
});

// ---- H2: replay claims are exclusive and fenced ----------------------------

test('H2: two concurrent replayers send each event exactly once', async () => {
  const f = fn(uid('rc2'), async () => 1);
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) ids.push(await seedJob(f));
  const plan = await planReplay(store, { fnIds: [f.id] });
  assert.equal(plan.eligible.length, 5);

  const sent: string[] = [];
  const slowSend = async (ev: ReplayEvent) => { await sleep(30); sent.push(ev.id); };
  const [a, b] = await Promise.all([executeReplay(store, plan, slowSend), executeReplay(store, plan, slowSend)]);
  assert.equal(a.replayed + b.replayed, 5);
  assert.equal(sent.length, 5, 'no event sent twice');
  assert.equal(new Set(sent).size, 5);
  assert.equal(a.raced + b.raced, 5, 'every job was lost to exactly one of the two');
  for (const id of ids) assert.equal(((await getJob(id)) as any).cancelledReason, 'replayed-to-inngest');
});

test('H2: a live claim lease blocks a second replayer; an expired one is taken over and fences the old owner', async () => {
  const f = fn(uid('lease'), async () => 1);
  const id = await seedJob(f);
  const plan = await planReplay(store, { fnIds: [f.id] });

  let finishA!: () => void;
  const aGate = new Promise<void>((r) => (finishA = r));
  const sentA: string[] = [];
  const A = executeReplay(store, plan, async (ev) => { sentA.push(ev.id); await aGate; });
  await waitFor(() => sentA.length === 1, 3000, 'A to start sending');
  const claimedDoc: any = await getJob(id);
  assert.equal(claimedDoc.cancelledReason, 'replay-pending');
  assert.ok(claimedDoc.replayClaimToken && claimedDoc.replayClaimedAt);

  const planB = await planReplay(store, { fnIds: [f.id] });
  assert.equal(planB.eligible.length, 0);
  assert.equal(planB.skipped[0].reason, 'replay-in-progress');
  const forced = await executeReplay(store, plan, async () => { throw new Error('must not send'); });
  assert.equal(forced.raced, 1, 'a stale plan still cannot steal a live claim');

  // A's lease expires (process wedged): B takes over and completes.
  await store.jobs.updateOne({ _id: oid(id) }, { $set: { replayClaimedAt: new Date(Date.now() - 20 * 60_000) } });
  const planB2 = await planReplay(store, { fnIds: [f.id] });
  assert.equal(planB2.eligible.length, 1);
  assert.equal(planB2.eligible[0].interrupted, true);
  const sentB: string[] = [];
  const outB = await executeReplay(store, planB2, async (ev) => { sentB.push(ev.id); });
  assert.equal(outB.replayed, 1);
  assert.equal(sentB[0], sentA[0], 'same stable event id');

  // A finally finishes: its result write is FENCED and must not overwrite B's outcome.
  finishA();
  const outA = await A;
  assert.equal(outA.lostClaim, 1);
  assert.equal(outA.replayed, 0);
  assert.equal(((await getJob(id)) as any).cancelledReason, 'replayed-to-inngest');
});

test('H2: a late FAILURE from a stale owner cannot downgrade a completed replay', async () => {
  const f = fn(uid('late'), async () => 1);
  const id = await seedJob(f);
  const plan = await planReplay(store, { fnIds: [f.id] });
  let failA!: () => void;
  const gate = new Promise<void>((_r, rej) => (failA = () => rej(new Error('inngest 503'))));
  const A = executeReplay(store, plan, async () => { await gate; });
  await waitFor(async () => ((await getJob(id)) as any).cancelledReason === 'replay-pending', 3000);
  await store.jobs.updateOne({ _id: oid(id) }, { $set: { replayClaimedAt: new Date(Date.now() - 20 * 60_000) } });
  const out = await executeReplay(store, await planReplay(store, { fnIds: [f.id] }), async () => {});
  assert.equal(out.replayed, 1);
  failA();
  const outA = await A;
  assert.equal(outA.lostClaim, 1);
  assert.equal(outA.failed, 0);
  assert.equal(((await getJob(id)) as any).cancelledReason, 'replayed-to-inngest');
});

test('H2: interrupted/failed replays older than the dedupe window are NOT resent unless explicitly allowed', async () => {
  const f = fn(uid('win'), async () => 1);
  const id = await seedJob(f);
  const old = new Date(Date.now() - 30 * 3_600_000);
  await store.jobs.updateOne(
    { _id: oid(id) },
    { $set: { status: 'cancelled', cancelledReason: 'replay-pending', replayClaimedAt: old, replayClaimToken: 'x' } }
  );
  const plan = await planReplay(store, { fnIds: [f.id] });
  assert.equal(plan.eligible.length, 0);
  assert.equal(plan.skipped[0].reason, 'outside-dedupe-window');
  const allowed = await planReplay(store, { fnIds: [f.id], allowOutsideDedupeWindow: true });
  assert.equal(allowed.eligible.length, 1);
  await store.jobs.updateOne({ _id: oid(id) }, { $set: { cancelledReason: 'replay-failed' } });
  assert.equal((await planReplay(store, { fnIds: [f.id] })).eligible.length, 0);
});

test('H2: functions the running web app still releases are never replayed', async () => {
  const f = fn(uid('rel2'), async () => 1);
  await seedJob(f);
  const plan = await planReplay(store, { fnIds: [f.id], webReleased: new Set([f.id]) });
  assert.equal(plan.eligible.length, 0);
  assert.equal(plan.skipped[0].reason, 'released-on-web');
  const ok = await planReplay(store, { fnIds: [f.id], webReleased: new Set(['other']) });
  assert.equal(ok.eligible.length, 1);
});
