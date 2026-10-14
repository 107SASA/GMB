/**
 * Native job worker: poll → atomic claim → run → heartbeat, plus cron ticks.
 *
 * - Runs only functions in `owned` (JOBS_NATIVE_FUNCTIONS) — it can never
 *   pick up a job for a function Inngest still owns.
 * - Concurrency: a worker-wide cap, an optional per-function in-process cap,
 *   and DB-enforced one-running-per-key (see store.ensureIndexes).
 * - Graceful shutdown: stop claiming, let in-flight jobs finish for up to
 *   `shutdownGraceMs`, then abort + release whatever is left so another
 *   worker (or this one after restart) resumes immediately instead of waiting
 *   out the lease. Completed steps are persisted, so work resumes mid-way.
 */
import { randomUUID } from 'crypto';
import os from 'os';
import { runJob, type RunHandle } from './runner';
import { buildCronEntries, CronScheduler } from './scheduler';
import type { DbClock } from './clock';
import type { WorkerTuning } from './config';
import type { JobStore } from './store';
import type { Logger, NativeEvent, NativeFunction } from './types';

export interface WorkerOptions {
  store: JobStore;
  clock?: DbClock;
  functions: NativeFunction[];
  /** Ids this worker is allowed to run (subset of functions). */
  owned: Set<string>;
  tuning: WorkerTuning;
  logger: Logger;
  dispatch: (events: NativeEvent[]) => Promise<string[]>;
  /** Override for tests (default: random uuid + host/pid). */
  owner?: string;
  /** Disable the cron scheduler (tests that only exercise the queue). */
  cronEnabled?: boolean;
  /** Retry delay override (tests). Default: exponential backoff from time.ts. */
  backoff?: (failedAttempts: number) => number;
  /**
   * External claim gate (e.g. the web-ownership guard). When it returns a
   * string the worker neither claims jobs nor leads the cron scheduler, and
   * reports that string as its block reason. Returning null/undefined = ok.
   */
  claimBlock?: () => string | null | undefined;
}

interface Running {
  handle: RunHandle;
  job: any;
  fnId: string;
}

export class JobWorker {
  readonly owner: string;
  private readonly fns: Map<string, NativeFunction>;
  private readonly running = new Map<string, Running>();
  private readonly perFn = new Map<string, number>();
  private stopping = false;
  private loopPromise: Promise<void> | null = null;
  private timers: NodeJS.Timeout[] = [];
  private wake: (() => void) | null = null;
  private scheduler: CronScheduler | null = null;
  private leader = false;
  private paused = false;
  private pausedObservedAt = 0;
  private controlError = false;
  private lastBlock: string | null = null;
  readonly counters = { claimed: 0, completed: 0, retried: 0, dead: 0, sleeping: 0, lost: 0, recovered: 0, cronFired: 0 };

  constructor(private readonly o: WorkerOptions) {
    this.owner = o.owner ?? `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
    this.fns = new Map(o.functions.filter((f) => o.owned.has(f.id)).map((f) => [f.id, f]));
  }

  get ownedIds() {
    return [...this.fns.keys()];
  }
  get inFlight() {
    return this.running.size;
  }
  get isLeader() {
    return this.leader;
  }
  /** Durable pause observed (or control doc unreadable → fail closed). */
  get isPaused() {
    return this.paused;
  }
  /** Why this worker is not claiming right now, or null. */
  get claimBlockedReason(): string | null {
    if (this.paused) return this.controlError ? 'control-unreadable' : 'paused';
    return this.o.claimBlock?.() ?? null;
  }
  /** running | draining (paused, jobs still finishing) | paused | stopping | stopped */
  get state(): 'running' | 'draining' | 'paused' | 'blocked' | 'stopping' {
    if (this.stopping) return 'stopping';
    if (this.paused) return this.running.size > 0 ? 'draining' : 'paused';
    return this.o.claimBlock?.() ? 'blocked' : 'running';
  }

  async start(): Promise<void> {
    const { store, tuning, clock } = this.o;
    await store.ensureIndexes();
    if (clock) {
      await clock.sync();
      if (Math.abs(clock.offsetMs) > tuning.maxClockSkewMs) {
        this.o.logger('warn', 'local clock differs from MongoDB clock; using DB time', { offsetMs: clock.offsetMs });
      }
      this.timers.push(setInterval(() => clock.sync().catch((e) => this.o.logger('warn', 'clock sync failed', { error: String(e?.message || e) })), 60_000));
    }

    // Read the durable pause state BEFORE the scheduler's first tick, so a worker that
    // starts while the queue is paused (or with an unreadable control doc) never enqueues
    // a cron slot or claims anything.
    await this.refreshControl();

    if (this.o.cronEnabled !== false) {
      const crons = buildCronEntries([...this.fns.values()]);
      this.scheduler = new CronScheduler(
        store,
        this.owner,
        crons,
        {
          leaderTtlMs: tuning.leaderTtlMs,
          catchupMs: tuning.cronCatchupMs,
          // A paused / blocked worker must not enqueue cron slots either.
          canLead: () => (clock ? clock.isFresh() : true) && this.claimBlockedReason === null,
        },
        this.o.logger
      );
      const tick = () =>
        this.scheduler!
          .tick()
          .then((r) => {
            this.leader = r.leader;
            this.counters.cronFired += r.fired.length;
            if (r.fired.length) this.o.logger('info', 'cron fired', { fnIds: r.fired });
            if (r.fired.length) this.wake?.();
          })
          .catch((e) => this.o.logger('error', 'cron tick failed', { error: String(e?.message || e) }));
      this.timers.push(setInterval(tick, Math.min(5_000, Math.floor(tuning.leaderTtlMs / 3))));
      void tick();
    }

    this.timers.push(setInterval(() => void this.beat(), 10_000));
    await this.beat();
    this.o.logger('info', 'worker started', { owner: this.owner, functions: this.ownedIds, concurrency: tuning.concurrency });
    this.loopPromise = this.loop();
  }

  private async beat(status: string = this.state) {
    await this.o.store.workers
      .updateOne(
        { _id: this.owner as any },
        {
          $set: {
            seenAt: this.o.store.now(),
            status,
            paused: this.paused,
            claimBlockedReason: this.claimBlockedReason,
            pid: process.pid,
            host: os.hostname(),
            inFlight: this.running.size,
            leader: this.leader,
            functions: this.ownedIds,
            counters: this.counters,
            clockOffsetMs: this.o.clock?.offsetMs ?? 0,
          },
        },
        { upsert: true }
      )
      .catch(() => undefined);
  }

  private eligibleFnIds(): string[] {
    const out: string[] = [];
    for (const f of this.fns.values()) {
      if (f.concurrencyLimit && (this.perFn.get(f.id) ?? 0) >= f.concurrencyLimit) continue;
      out.push(f.id);
    }
    return out;
  }

  /** Read the durable control doc. Unreadable ⇒ treated as paused (fail closed). */
  private async refreshControl(): Promise<void> {
    let paused: boolean;
    try {
      paused = (await this.o.store.getControl()).paused;
      this.controlError = false;
    } catch (e: any) {
      paused = true;
      if (!this.controlError) this.o.logger('error', 'control document unreadable — not claiming', { error: String(e?.message || e) });
      this.controlError = true;
    }
    if (paused !== this.paused) {
      this.paused = paused;
      this.pausedObservedAt = paused ? Date.now() : 0;
      this.o.logger('warn', paused ? 'queue paused — no new claims; draining in-flight jobs' : 'queue resumed', { inFlight: this.running.size });
      void this.beat();
      if (!paused) this.wake?.();
    }
  }

  /** Give in-flight jobs back (abort + release lease) — used when a pause outlasts the shutdown grace. */
  private async releaseInFlight(reason: string): Promise<number> {
    let released = 0;
    for (const r of [...this.running.values()]) {
      r.handle.abort(reason);
      const ok = await this.o.store.release(r.job, this.o.store.now()).catch(() => false);
      if (ok) released++;
    }
    if (released) this.o.logger('warn', 'released in-flight jobs after pause grace', { released });
    return released;
  }

  private async loop(): Promise<void> {
    const { tuning, store } = this.o;
    while (!this.stopping) {
      let claimedAny = false;
      try {
        await this.refreshControl();
        const block = this.claimBlockedReason;
        if (block !== this.lastBlock) {
          this.lastBlock = block;
          if (block && block !== 'paused') this.o.logger('warn', 'claiming blocked', { reason: block });
          void this.beat();
        }
        // Release in-flight work only for an OPERATOR pause that outlasted the grace
        // period. An unreadable control document (controlError) blocks new claims but
        // must never abort healthy in-flight jobs: that would manufacture duplicate
        // side effects out of a transient MongoDB blip.
        if (block && this.paused && !this.controlError && this.running.size > 0 && Date.now() - this.pausedObservedAt > tuning.shutdownGraceMs) {
          await this.releaseInFlight('paused');
        }
        while (!this.stopping && this.running.size < tuning.concurrency) {
          // Read the pause state IMMEDIATELY before every claim (not once per round) and honour
          // the external ownership block, so no claim starts after a pause has been observed.
          // The only remaining window is a claim whose atomic DB operation is already in
          // flight when the pause is written (one claim per worker, never a batch).
          await this.refreshControl();
          if (this.claimBlockedReason !== null) break;
          const claim = await store.claim(this.owner, this.eligibleFnIds(), tuning.leaseMs);
          if (!claim) break;
          claimedAny = true;
          await this.begin(claim.job, claim.recovered);
        }
      } catch (err: any) {
        this.o.logger('error', 'claim loop error', { error: String(err?.message || err) });
      }
      if (this.stopping) break;
      if (!claimedAny || this.running.size >= tuning.concurrency) {
        await new Promise<void>((res) => {
          const t = setTimeout(res, tuning.pollMs);
          t.unref?.();
          this.wake = () => {
            clearTimeout(t);
            res();
          };
        });
        this.wake = null;
      }
    }
  }

  private async begin(job: any, recovered: boolean): Promise<void> {
    const { store, logger } = this.o;
    const id = String(job._id);
    this.counters.claimed++;
    if (recovered) {
      this.counters.recovered++;
      logger('warn', 'recovered job with expired lease', { jobId: id, fnId: job.fnId, attempts: job.attempts });
    }
    const fn = this.fns.get(job.fnId);
    if (!fn) {
      await store.fail(job, `no native handler registered for ${job.fnId}`, { retriable: false });
      this.counters.dead++;
      return;
    }
    if (recovered && job.attempts >= job.maxAttempts) {
      await store.fail(job, 'lease expired repeatedly (worker crash / hang) — attempts exhausted', { retriable: false });
      this.counters.dead++;
      logger('error', 'job dead-lettered after repeated lease expiry', { jobId: id, fnId: job.fnId });
      return;
    }
    this.perFn.set(job.fnId, (this.perFn.get(job.fnId) ?? 0) + 1);
    const handle = runJob(fn, job, {
      store,
      leaseMs: this.o.tuning.leaseMs,
      heartbeatMs: this.o.tuning.heartbeatMs,
      logger,
      dispatch: this.o.dispatch,
      backoff: this.o.backoff,
    });
    this.running.set(id, { handle, job, fnId: job.fnId });
    void handle.done.then((out) => {
      this.running.delete(id);
      this.perFn.set(job.fnId, Math.max(0, (this.perFn.get(job.fnId) ?? 1) - 1));
      switch (out.type) {
        case 'completed': this.counters.completed++; break;
        case 'sleeping': this.counters.sleeping++; break;
        case 'retry': this.counters.retried++; break;
        case 'dead': this.counters.dead++; break;
        case 'lost': this.counters.lost++; break;
      }
      logger(out.type === 'dead' ? 'error' : 'info', `job ${out.type}`, {
        jobId: id,
        fnId: job.fnId,
        ...(out.type === 'retry' || out.type === 'dead' ? { error: out.error.slice(0, 300) } : {}),
        ...(out.type === 'lost' ? { reason: out.reason } : {}),
        ...(out.type === 'sleeping' ? { wakeAt: out.wakeAt.toISOString() } : {}),
      });
      // While paused, report the drained state promptly so `pause --wait` does not
      // have to wait for the 10 s heartbeat.
      if (this.paused) void this.beat();
      this.wake?.();
    });
  }

  /**
   * TEST ONLY — emulates abrupt process death (SIGKILL / power loss / reboot):
   * stops every timer and handler and writes NOTHING, leaving leases to
   * expire exactly as they would for a dead process.
   */
  simulateCrash(): void {
    this.stopping = true;
    this.timers.forEach(clearInterval);
    this.timers = [];
    for (const r of this.running.values()) r.handle.abort('simulated-crash');
    this.running.clear();
    this.wake?.();
  }

  /** Graceful stop. Safe to call more than once. */
  async stop(): Promise<{ drained: number; released: number }> {
    if (this.stopping && !this.loopPromise) return { drained: 0, released: 0 };
    this.stopping = true;
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.wake?.();
    await this.beat('stopping');
    const startedWith = this.running.size;

    const deadline = Date.now() + this.o.tuning.shutdownGraceMs;
    while (this.running.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    let released = 0;
    for (const r of [...this.running.values()]) {
      r.handle.abort('shutdown');
      const ok = await this.o.store.release(r.job, this.o.store.now()).catch(() => false);
      if (ok) released++;
    }
    await this.loopPromise?.catch(() => undefined);
    this.loopPromise = null;
    await this.scheduler?.releaseLeadership();
    await this.beat('stopped');
    this.o.logger('info', 'worker stopped', { drained: startedWith - this.running.size, released });
    return { drained: Math.max(0, startedWith - released), released };
  }
}
