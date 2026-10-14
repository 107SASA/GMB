/**
 * Native job queue — STAGING tests against a real MongoDB.
 *
 *   node --import tsx --test tests/staging/jobs-queue.staging.test.ts
 *
 * SAFETY
 *  - The DB is chosen by scripts/lib/localTestEnv.mjs: the cluster in
 *    .env.local with the database FORCED to `growwmatics_local_test`
 *    (override TEST_DB_NAME); it throws if the name contains "prod".
 *  - Every collection uses a unique random prefix and is dropped afterwards;
 *    no application collection is read or written.
 *  - All functions here are synthetic. No Twilio / Meta / Razorpay / Groq /
 *    Google code is imported, so no customer message or billing operation
 *    is possible. `JOBS_NATIVE_*` env flags are irrelevant to these tests.
 *
 * What is NOT proven here: behaviour of the real 53 business functions,
 * Inngest co-existence, PM2 signal handling on the server, an actual OS
 * reboot. See docs/inngest-migration-plan.md "Verification status".
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { resolveTestMongoUri } from '../../scripts/lib/localTestEnv.mjs';
import { JobStore, type JobDoc } from '../../src/services/jobs/store';
import { JobWorker } from '../../src/services/jobs/worker';
import { routeEvents } from '../../src/services/jobs/routing';
import { buildCronEntries, CronScheduler, LEADER_ID } from '../../src/services/jobs/scheduler';
import { NonRetriableError, type Logger, type NativeFunction } from '../../src/services/jobs/types';
import type { WorkerTuning } from '../../src/services/jobs/config';

const PREFIX = `jt${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}_`;
const quiet: Logger = () => {};
let db: any;
let store: JobStore;
const workers: JobWorker[] = [];

before(async () => {
  const uri = resolveTestMongoUri();
  await mongoose.connect(uri, { family: 4, serverSelectionTimeoutMS: 15000 } as any);
  db = mongoose.connection.db;
  assert.ok(!/prod/i.test(db.databaseName), `refusing to run against ${db.databaseName}`);
  store = new JobStore(db, PREFIX);
  await store.ensureIndexes();
});

after(async () => {
  for (const w of workers) await w.stop().catch(() => undefined);
  for (const c of ['jobs', 'job_cron_state', 'job_locks', 'job_workers']) {
    await db.collection(`${PREFIX}${c}`).drop().catch(() => undefined);
  }
  await mongoose.disconnect();
});

// ------------------------------------------------------------- helpers --

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

function mkWorker(fns: NativeFunction[], over: { tuning?: Partial<WorkerTuning>; owner?: string } = {}) {
  const owned = new Set(fns.map((f) => f.id));
  const w = new JobWorker({
    store,
    functions: fns,
    owned,
    tuning: tuning(over.tuning),
    logger: quiet,
    owner: over.owner,
    cronEnabled: false,
    backoff: () => 80,
    dispatch: async (events) => (await routeEvents(events, { store, functions: fns, owned })).ids,
  });
  workers.push(w);
  return w;
}

async function enqueue(f: NativeFunction, data: Record<string, any> = {}, key = randomUUID()) {
  const r = await store.enqueue({ fnId: f.id, eventName: f.events[0], key, data, maxAttempts: f.maxAttempts });
  assert.ok(r.created);
  return String(r.id);
}

const getJob = (id: string): Promise<JobDoc> =>
  store.jobs.findOne({ _id: new mongoose.mongo.ObjectId(id) }) as any;
const status = async (id: string) => (await getJob(id)).status;

// ---------------------------------------------------------------- tests --

test('duplicate events: same event id enqueues exactly one job', async () => {
  const f = fn(uid('dup'), async () => 'ok');
  const ctx = { store, functions: [f], owned: new Set([f.id]) };
  const ev = { id: 'evt-1', name: f.events[0], data: { a: 1 } };
  const a = await routeEvents([ev], ctx);
  const b = await routeEvents([ev], ctx);
  assert.equal(a.enqueued, 1);
  assert.equal(b.enqueued, 0);
  assert.equal(b.duplicates, 1);
  assert.equal(await store.jobs.countDocuments({ fnId: f.id }), 1);
});

test('runs a job; each step executes once; results are JSON round-tripped like Inngest', async () => {
  const calls = { a: 0, b: 0 };
  const f = fn(uid('basic'), async ({ step, event }) => {
    const a = await step.run('a', async () => {
      calls.a++;
      return { when: new Date(0), n: event.data.n };
    });
    const u = await step.run('undef', async () => undefined);
    const b = await step.run('b', async () => {
      calls.b++;
      return typeof a.when;
    });
    return { b, u: u === undefined };
  });
  const id = await enqueue(f, { n: 7 });
  const w = mkWorker([f]);
  await w.start();
  await waitFor(async () => (await status(id)) === 'completed');
  const j = await getJob(id);
  assert.deepEqual(calls, { a: 1, b: 1 });
  assert.deepEqual(j.result, { b: 'string', u: true }); // Date came back as a string, undefined preserved
  assert.equal(j.steps.length, 3);
  assert.ok(j.expireAt, 'completed jobs get a TTL');
});

test('retries with backoff, resumes after the failed step, resets budget per step', async () => {
  let n = 0;
  let a = 0;
  const f = fn(uid('retry'), async ({ step }) => {
    await step.run('first', async () => { a++; return 1; });
    return step.run('flaky', async () => {
      n++;
      if (n < 3) throw new Error('boom');
      return n;
    });
  }, { maxAttempts: 4 });
  const id = await enqueue(f);
  await mkWorker([f]).start();
  await waitFor(async () => (await status(id)) === 'completed');
  assert.equal(n, 3);
  assert.equal(a, 1, 'a completed step is not repeated by a later step failing');
  const j = await getJob(id);
  assert.equal(j.attempts, 0);
});

test('step that exhausts retries is thrown into the handler (Inngest semantics) and memoised as failed', async () => {
  let n = 0;
  const f = fn(uid('exhaust'), async ({ step }) => {
    try {
      await step.run('always', async () => { n++; throw new Error('nope'); });
    } catch (e: any) {
      return `handled:${e.message}`;
    }
    return 'unreachable';
  }, { maxAttempts: 2 });
  const id = await enqueue(f);
  await mkWorker([f]).start();
  await waitFor(async () => (await status(id)) === 'completed');
  const j = await getJob(id);
  assert.equal(j.result, 'handled:nope');
  assert.equal(n, 2);
});

test('dead-letter after max attempts; retryDead resumes it', async () => {
  let fail = true;
  const f = fn(uid('dead'), async ({ step }) =>
    step.run('s', async () => {
      if (fail) throw new Error('always-fails');
      return 'fixed';
    }), { maxAttempts: 3 });
  const id = await enqueue(f);
  await mkWorker([f]).start();
  await waitFor(async () => (await status(id)) === 'dead');
  const dead = await getJob(id);
  assert.equal(dead.attempts, 3);
  assert.match(String(dead.lastError), /always-fails|nope|Error/);
  assert.ok(dead.deadAt);
  assert.equal(dead.expireAt, undefined, 'dead jobs are never auto-deleted');

  fail = false;
  assert.equal(await store.retryDead(id), true);
  await waitFor(async () => (await status(id)) === 'completed');
});

test('NonRetriableError dead-letters immediately', async () => {
  const f = fn(uid('nonret'), async ({ step }) =>
    step.run('s', async () => { throw new NonRetriableError('bad input'); }), { maxAttempts: 5 });
  const id = await enqueue(f);
  await mkWorker([f]).start();
  await waitFor(async () => (await status(id)) === 'dead');
  assert.equal((await getJob(id)).attempts, 1);
});

test('worker crash: lease expires, job is recovered and resumes WITHOUT repeating persisted steps', async () => {
  const calls = { a: 0, b: 0 };
  const f = fn(uid('crash'), async ({ step }) => {
    const a = await step.run('a', async () => { calls.a++; return { v: 1 }; });
    const b = await step.run('b', async () => { calls.b++; return a.v + 1; });
    return b;
  });
  const id = await enqueue(f);
  // A "worker" claims, persists step a, then dies silently (no heartbeat, no release).
  const claim = await store.claim('dead-worker', [f.id], 300);
  assert.ok(claim && !claim.recovered);
  assert.equal(await store.recordStep(claim!.job, { id: 'a', kind: 'run', result: { v: 1 }, at: new Date() }), true);

  const w = mkWorker([f]);
  await w.start();
  await waitFor(async () => (await status(id)) === 'completed');
  const j = await getJob(id);
  assert.equal(calls.a, 0, 'step a was memoised from the dead worker');
  assert.equal(calls.b, 1);
  assert.equal(j.result, 2);
  assert.equal(j.recoveries, 1);
  assert.equal(w.counters.recovered, 1);
});

test('stale lease: the old owner is fenced out and cannot write step results or complete', async () => {
  const f = fn(uid('fence'), async () => 'x');
  const id = await enqueue(f);
  const c1 = await store.claim('w1', [f.id], 100);
  assert.ok(c1);
  await sleep(250); // lease expires
  const c2 = await store.claim('w2', [f.id], 5000);
  assert.ok(c2?.recovered, 'second claim recovers the expired lease');
  // w1 wakes up from a long GC pause and tries to proceed:
  assert.equal(await store.recordStep(c1!.job, { id: 's', kind: 'run', result: 1, at: new Date() }), false);
  assert.equal(await store.complete(c1!.job, 'late'), false);
  assert.equal(await store.heartbeat(c1!.job, 5000), false);
  // the rightful owner is unaffected
  assert.equal(await store.complete(c2!.job, 'ok'), true);
  assert.equal(await status(id), 'completed');
});

test('poison pill: a job that keeps killing workers is dead-lettered, not looped forever', async () => {
  let ran = 0;
  const f = fn(uid('poison'), async () => { ran++; return 1; }, { maxAttempts: 2 });
  const id = await enqueue(f);
  await store.claim('crasher-1', [f.id], 60);
  await sleep(150);
  const second = await store.claim('crasher-2', [f.id], 60); // attempts → 1
  assert.equal(second?.job.attempts, 1);
  await sleep(150);
  const w = mkWorker([f]);
  await w.start();
  await waitFor(async () => (await status(id)) === 'dead');
  assert.equal(ran, 0, 'handler never ran again');
  assert.match(String((await getJob(id)).lastError), /lease expired/);
});

test('cancellation: a cancelled running job is fenced out; its late step result is discarded', async () => {
  let bRan = 0;
  const f = fn(uid('cancel'), async ({ step }) => {
    await step.run('a', async () => 1);
    await step.run('b', async () => { bRan++; await sleep(500); return 2; });
    await step.run('c', async () => 3);
  });
  const id = await enqueue(f);
  const w = mkWorker([f]);
  await w.start();
  await waitFor(() => bRan === 1, 5000, 'step b to start');
  assert.equal(await store.cancelById(id, 'test'), true);
  await sleep(900);
  const j = await getJob(id);
  assert.equal(j.status, 'cancelled');
  assert.deepEqual(j.steps.map((s) => s.id), ['a'], 'b result discarded, c never started');
  assert.equal(w.counters.lost, 1);
});

test('durable sleep: parks as sleeping, survives handler try/catch, resumes after wake without redoing steps', async () => {
  const calls = { before: 0, after: 0 };
  const f = fn(uid('sleep'), async ({ step }) => {
    await step.run('before', async () => { calls.before++; });
    try {
      await step.sleep('nap', 900);
    } catch {
      /* a handler that swallows errors must not be able to swallow suspension */
    }
    await step.run('after', async () => { calls.after++; });
    return 'done';
  });
  const id = await enqueue(f);
  const w = mkWorker([f]);
  await w.start();
  await waitFor(async () => (await status(id)) === 'sleeping');
  const sleeping = await getJob(id);
  assert.ok(sleeping.runAt.getTime() > Date.now(), 'wake time is in the future');
  assert.equal(sleeping.leaseOwner, null, 'no process holds a sleeping job');
  assert.equal(calls.after, 0);
  await waitFor(async () => (await status(id)) === 'completed', 6000);
  assert.deepEqual(calls, { before: 1, after: 1 });
});

test('long workflow survives a crash while sleeping (sleep is in the DB, not in a process)', async () => {
  const calls = { pre: 0, post: 0 };
  const f = fn(uid('sleepcrash'), async ({ step }) => {
    await step.run('pre', async () => { calls.pre++; });
    await step.sleep('nap', 800);
    await step.run('post', async () => { calls.post++; });
  });
  const id = await enqueue(f);
  const w1 = mkWorker([f]);
  await w1.start();
  await waitFor(async () => (await status(id)) === 'sleeping');
  w1.simulateCrash(); // process dies while the job sleeps
  const w2 = mkWorker([f]); // "after reboot"
  await w2.start();
  await waitFor(async () => (await status(id)) === 'completed', 6000);
  assert.deepEqual(calls, { pre: 1, post: 1 });
});

test('cancelOn: reschedule and unschedule cancel the sleeping run; exactly one publish happens', async () => {
  const published: Record<string, number> = {};
  const id = uid('post');
  const f = fn(id, async ({ event, step }) => {
    await step.sleepUntil('wait', event.data.at);
    await step.run('publish', async () => { published[event.data.postId] = (published[event.data.postId] || 0) + 1; });
  }, {
    events: [`sched/${id}`],
    cancelOn: [
      { event: `sched/${id}`, field: 'postId' },
      { event: `unsched/${id}`, field: 'postId' },
    ],
  });
  const ctx = { store, functions: [f], owned: new Set([f.id]) };
  const w = mkWorker([f]);
  await w.start();
  const at = (ms: number) => new Date(Date.now() + ms).toISOString();

  await routeEvents([{ name: `sched/${id}`, data: { postId: 'p1', at: at(2500) } }], ctx);
  await waitFor(async () => (await store.jobs.countDocuments({ fnId: id, status: 'sleeping' })) === 1);
  // reschedule p1 earlier — must cancel the old sleeper but NOT the job this event just created
  const r = await routeEvents([{ name: `sched/${id}`, data: { postId: 'p1', at: at(500) } }], ctx);
  assert.equal(r.cancelled, 1);
  assert.equal(r.enqueued, 1);
  // p2 scheduled then unscheduled
  await routeEvents([{ name: `sched/${id}`, data: { postId: 'p2', at: at(800) } }], ctx);
  const u = await routeEvents([{ name: `unsched/${id}`, data: { postId: 'p2' } }], ctx);
  assert.equal(u.cancelled, 1);

  await sleep(3500);
  assert.equal(published.p1, 1, 'p1 published exactly once, at the NEW time');
  assert.equal(published.p2, undefined, 'p2 never published');
  assert.equal(await store.jobs.countDocuments({ fnId: id, status: 'cancelled' }), 2);
  assert.equal(await store.jobs.countDocuments({ fnId: id, status: 'completed' }), 1);
});

test('keyed concurrency: at most one running job per key (DB-enforced); other keys run in parallel', async () => {
  const active: Record<string, number> = {};
  let maxPerKey = 0;
  let totalActive = 0;
  let maxTotal = 0;
  const id = uid('keyed');
  const f = fn(id, async ({ event, step }) => {
    const k = event.data.biz as string;
    await step.run('work', async () => {
      active[k] = (active[k] || 0) + 1;
      totalActive++;
      maxPerKey = Math.max(maxPerKey, active[k]);
      maxTotal = Math.max(maxTotal, totalActive);
      await sleep(250);
      active[k]--;
      totalActive--;
    });
  }, { concurrencyKeyPath: 'event.data.biz' });
  const ctx = { store, functions: [f], owned: new Set([f.id]) };
  for (const biz of ['A', 'A', 'A', 'B', 'B']) await routeEvents([{ name: f.events[0], data: { biz } }], ctx);
  const w = mkWorker([f], { tuning: { concurrency: 5 } });
  await w.start();
  await waitFor(async () => (await store.jobs.countDocuments({ fnId: id, status: 'completed' })) === 5, 15000);
  assert.equal(maxPerKey, 1);
  assert.ok(maxTotal >= 2, `different keys should overlap (saw ${maxTotal})`);
});

test('worker-wide concurrency cap and per-function cap are respected', async () => {
  let active = 0;
  let max = 0;
  const f = fn(uid('cap'), async ({ step }) => {
    await step.run('w', async () => {
      active++;
      max = Math.max(max, active);
      await sleep(150);
      active--;
    });
  }, { concurrencyLimit: 2 });
  for (let i = 0; i < 6; i++) await enqueue(f);
  await mkWorker([f], { tuning: { concurrency: 5 } }).start();
  await waitFor(async () => (await store.jobs.countDocuments({ fnId: f.id, status: 'completed' })) === 6, 15000);
  assert.equal(max, 2);
});

test('step.sendEvent is memoised: a retry after it does not enqueue the child again', async () => {
  const child = fn(uid('child'), async () => 'c');
  let flaky = 0;
  const parent = fn(uid('parent'), async ({ step }) => {
    await step.sendEvent('fanout', { name: child.events[0], data: { x: 1 } });
    await step.run('then-fails-once', async () => {
      flaky++;
      if (flaky === 1) throw new Error('transient');
    });
  }, { maxAttempts: 3 });
  const id = await enqueue(parent);
  const fns = [parent, child];
  await mkWorker(fns).start();
  await waitFor(async () => (await status(id)) === 'completed');
  assert.equal(await store.jobs.countDocuments({ fnId: child.id }), 1);
});

test('graceful shutdown drains in-flight work within the grace period', async () => {
  let started = 0;
  const f = fn(uid('drain'), async ({ step }) => {
    await step.run('slow', async () => { started++; await sleep(500); return 1; });
  });
  const id = await enqueue(f);
  const w = mkWorker([f], { tuning: { shutdownGraceMs: 3000 } });
  await w.start();
  await waitFor(() => started === 1);
  const r = await w.stop();
  assert.equal(r.released, 0);
  assert.equal(await status(id), 'completed');
});

test('deployment interruption: grace expires → job released immediately, another worker finishes it', async () => {
  let runs = 0;
  const f = fn(uid('deploy'), async ({ step }) => {
    await step.run('quick', async () => 'q');
    await step.run('slow', async () => { runs++; if (runs === 1) await sleep(2500); return 's'; });
  });
  const id = await enqueue(f);
  const w1 = mkWorker([f], { tuning: { shutdownGraceMs: 200 } });
  await w1.start();
  await waitFor(() => runs === 1);
  const r = await w1.stop();
  assert.equal(r.released, 1);
  assert.equal(await status(id), 'queued', 'released for immediate pickup, not waiting out the lease');
  const w2 = mkWorker([f]);
  await w2.start();
  await waitFor(async () => (await status(id)) === 'completed', 6000);
  assert.equal(runs, 2, 'the interrupted step re-ran (at-least-once), quick step did not');
  const j = await getJob(id);
  assert.deepEqual(j.steps.map((s) => s.id), ['quick', 'slow']);
});

test('server reboot: all processes die abruptly; after restart every job completes, persisted steps intact', async () => {
  const gate = { open: false };
  const calls = { a: 0, b: 0 };
  const f = fn(uid('reboot'), async ({ step }) => {
    await step.run('a', async () => { calls.a++; });
    await step.run('b', async () => {
      calls.b++;
      while (!gate.open) await sleep(20);
    });
  });
  const ids = [await enqueue(f), await enqueue(f), await enqueue(f)];
  const w1 = mkWorker([f]);
  await w1.start();
  await waitFor(async () => (await store.jobs.countDocuments({ fnId: f.id, 'steps.0.id': 'a', status: 'running' })) === 3);
  w1.simulateCrash(); // SIGKILL-equivalent: nothing written
  gate.open = true;
  const w2 = mkWorker([f]);
  await w2.start();
  await waitFor(async () => (await store.jobs.countDocuments({ fnId: f.id, status: 'completed' })) === 3, 12000);
  assert.equal(calls.a, 3, 'step a ran once per job — never repeated after the crash');
  for (const id of ids) assert.equal((await getJob(id)).recoveries, 1);
});

// ------------------------------------------------------------ cron --

test('cron: init without backfill, single fire per slot, leader failover, coalesced catch-up, stale slot skipped', async () => {
  await store.locks.deleteOne({ _id: LEADER_ID as any });
  let nowMs = Date.parse('2026-10-13T10:00:30Z');
  const cs = new JobStore(db, PREFIX, () => new Date(nowMs));
  const quarter = fn(uid('quarter'), async () => 1, { crons: ['*/15 * * * *'] });
  const daily = fn(uid('daily'), async () => 1, { crons: ['15 3 * * *'] });
  const entries = buildCronEntries([quarter, daily]);
  const opts = { leaderTtlMs: 10_000, catchupMs: 60 * 60_000 };
  const A = new CronScheduler(cs, 'A', entries, opts, quiet);
  const B = new CronScheduler(cs, 'B', entries, opts, quiet);
  const count = (f: NativeFunction) => store.jobs.countDocuments({ fnId: f.id });

  // first sight: initialise state, fire nothing
  let r = await A.tick();
  assert.equal(r.leader, true);
  assert.deepEqual(r.fired, []);
  assert.equal(await count(quarter), 0);
  assert.equal((await B.tick()).leader, false, 'only one leader at a time');

  // slot 10:15 → exactly one job
  nowMs = Date.parse('2026-10-13T10:15:05Z');
  await Promise.all([A.tick(), B.tick()]);
  assert.equal(await count(quarter), 1);
  // same slot again from either scheduler → still one
  await A.tick();
  await B.tick();
  assert.equal(await count(quarter), 1);
  // even bypassing state, the slot key is idempotent
  const dup = await cs.enqueue({ fnId: quarter.id, eventName: 'x', key: `cron:${Date.parse('2026-10-13T10:15:00Z')}`, maxAttempts: 1 });
  assert.equal(dup.created, false);

  // leader failover: A stops ticking, lock expires, B takes over and fires the next slot
  nowMs = Date.parse('2026-10-13T10:30:20Z');
  r = await B.tick();
  assert.equal(r.leader, true);
  assert.equal(r.fired.length, 1);
  assert.equal(await count(quarter), 2);

  // downtime: 2.5h of missed slots coalesce into ONE run (latest slot within catch-up window)
  nowMs = Date.parse('2026-10-13T13:00:10Z');
  r = await B.tick();
  assert.equal(await count(quarter), 3);
  assert.ok(r.missed >= 9, `expected ≥9 skipped slots, got ${r.missed}`);

  // daily 03:15 slot passed 6h45m ago (> 1h catch-up): skipped, not run late
  nowMs = Date.parse('2026-10-14T10:00:00Z');
  await B.tick();
  assert.equal(await count(daily), 0, 'stale daily slot is skipped');
  const st = await cs.cronState.findOne({ _id: daily.id as any });
  assert.ok(st.missed >= 1);
});

test('stats() reports counts and oldest due age', async () => {
  const s = await store.stats();
  assert.ok(Array.isArray(s.counts) && s.counts.length > 0);
  assert.equal(typeof s.oldestDueAgeMs, 'number');
});
