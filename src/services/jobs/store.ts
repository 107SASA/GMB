/**
 * Native job queue — MongoDB persistence layer.
 *
 * Takes a plain driver `Db` (mongoose.connection.db in the app, a test DB in
 * staging tests) and a collection prefix, so it has no Mongoose model /
 * autoIndex dependency: production runs with autoIndex=false, so the queue
 * creates its own indexes explicitly via ensureIndexes().
 *
 * Concurrency model (mirrors the proven ScheduledAction / ProcessedWebhookEvent
 * patterns, tightened with a lease + fencing token):
 *  - enqueue idempotency : unique index on `idempotencyKey` (insert-as-lock,
 *                          same as ProcessedWebhookEvent). Duplicate → no-op.
 *  - claim               : one atomic findOneAndUpdate flips queued/sleeping→
 *                          running and stamps {claimToken, leaseExpiresAt}.
 *                          An EXPIRED running job is claimable by the same
 *                          query (stale-claim recovery; ScheduledAction used a
 *                          fixed 10-min claimedAt for the same purpose).
 *  - fencing             : every later write is filtered on
 *                          {_id, claimToken, status:'running'}; a worker that
 *                          lost its lease (paused, partitioned, cancelled)
 *                          simply matches 0 docs and can no longer change
 *                          state or record step results.
 *  - keyed concurrency   : partial unique index {fnId, concurrencyKey} where
 *                          status='running' — at most one running job per key,
 *                          enforced by the DB, not by in-process counters.
 *
 * NOTE: this gives at-least-once execution. A crash between an external side
 * effect and the step-result write re-runs that step. See the architecture doc.
 */
import mongoose from 'mongoose';
import type { Collection, Db, Document, Filter } from 'mongodb';

export type JobStatus = 'queued' | 'running' | 'sleeping' | 'completed' | 'dead' | 'cancelled';

export interface StepRecord {
  id: string;
  kind: 'run' | 'sleep' | 'sendEvent';
  /** JSON-safe result (steps are persisted exactly as Inngest memoizes them). */
  result?: unknown;
  /** True when the step returned `undefined` (JSON cannot represent it). */
  undef?: boolean;
  /** Sleep steps: absolute wake time. */
  wakeAt?: Date;
  at: Date;
}

export interface JobDoc {
  _id: any;
  fnId: string;
  eventName: string;
  eventId: string;
  data: Record<string, any>;
  ts: Date;
  /** Globally unique: `${fnId}:${key}`. */
  idempotencyKey: string;
  status: JobStatus;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  recoveries: number;
  claimToken?: string | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: Date | null;
  concurrencyKey?: string | null;
  steps: StepRecord[];
  lastError?: string;
  result?: unknown;
  startedAt?: Date;
  completedAt?: Date;
  deadAt?: Date;
  cancelledReason?: string;
  expireAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnqueueSpec {
  fnId: string;
  eventName: string;
  /** Stable per logical trigger. Re-enqueueing the same (fnId, key) is a no-op. */
  key: string;
  eventId?: string;
  data?: Record<string, any>;
  runAt?: Date;
  maxAttempts: number;
  concurrencyKey?: string | null;
  ts?: Date;
}

export type Clock = () => Date;

/** Completed/cancelled jobs are kept this long (for debugging), then TTL'd. Dead jobs are never auto-deleted. */
export const FINISHED_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
/** Guard against blowing Mongo's 16 MB document cap with step results. */
export const MAX_STEP_RESULT_BYTES = 1_000_000;
export const MAX_ERROR_LEN = 2_000;

const ACTIVE: JobStatus[] = ['queued', 'sleeping', 'running'];

const toId = (id: string | any) => (typeof id === 'string' ? new mongoose.mongo.ObjectId(id) : id);

export class JobStore {
  readonly jobs: Collection<any>;
  readonly cronState: Collection<any>;
  readonly locks: Collection<any>;
  readonly workers: Collection<any>;
  readonly control: Collection<any>;
  private indexesReady: Promise<void> | null = null;

  constructor(readonly db: Db, readonly prefix: string, readonly now: Clock = () => new Date()) {
    this.jobs = db.collection(`${prefix}jobs`);
    this.cronState = db.collection(`${prefix}job_cron_state`);
    this.locks = db.collection(`${prefix}job_locks`);
    this.workers = db.collection(`${prefix}job_workers`);
    this.control = db.collection(`${prefix}job_control`);
  }

  /** Idempotent; memoised per store. Required before any other call (autoIndex is off in prod). */
  ensureIndexes(): Promise<void> {
    if (!this.indexesReady) {
      this.indexesReady = (async () => {
        await this.jobs.createIndex({ idempotencyKey: 1 }, { unique: true, name: 'uniq_idempotency' });
        await this.jobs.createIndex({ status: 1, runAt: 1 }, { name: 'claim_due' });
        await this.jobs.createIndex({ status: 1, leaseExpiresAt: 1 }, { name: 'claim_expired_lease' });
        await this.jobs.createIndex({ fnId: 1, status: 1 }, { name: 'by_fn_status' });
        await this.jobs.createIndex(
          { fnId: 1, concurrencyKey: 1 },
          {
            unique: true,
            name: 'uniq_running_per_key',
            partialFilterExpression: { status: 'running', concurrencyKey: { $type: 'string' } },
          }
        );
        await this.jobs.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_finished' });
        await this.workers.createIndex({ seenAt: 1 }, { expireAfterSeconds: 24 * 3600, name: 'ttl_workers' });
      })().catch((e) => {
        this.indexesReady = null;
        throw e;
      });
    }
    return this.indexesReady;
  }

  // ----------------------------------------------------------- enqueue --

  async enqueue(spec: EnqueueSpec): Promise<{ created: boolean; id?: any }> {
    const now = this.now();
    const doc = {
      fnId: spec.fnId,
      eventName: spec.eventName,
      eventId: spec.eventId ?? spec.key,
      data: spec.data ?? {},
      ts: spec.ts ?? now,
      idempotencyKey: `${spec.fnId}:${spec.key}`,
      status: 'queued' as JobStatus,
      runAt: spec.runAt ?? now,
      attempts: 0,
      maxAttempts: Math.max(1, spec.maxAttempts),
      recoveries: 0,
      claimToken: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      concurrencyKey: spec.concurrencyKey ?? null,
      steps: [] as StepRecord[],
      createdAt: now,
      updatedAt: now,
    };
    try {
      const r = await this.jobs.insertOne(doc);
      return { created: true, id: r.insertedId };
    } catch (err: any) {
      if (err?.code === 11000) return { created: false }; // already enqueued — the idempotency guarantee
      throw err;
    }
  }

  // ------------------------------------------------------------- claim --

  /**
   * Atomically take ownership of the next due job for any of `fnIds`
   * (including jobs whose previous lease expired). Returns null when idle.
   * A job recovered from an expired lease consumes one attempt, so a job that
   * crashes its worker every time cannot loop forever (poison-pill bound).
   */
  async claim(owner: string, fnIds: string[], leaseMs: number): Promise<{ job: JobDoc; recovered: boolean } | null> {
    if (fnIds.length === 0) return null;
    const excluded: any[] = [];
    for (let i = 0; i < 8; i++) {
      const now = this.now();
      const token = `${owner}:${now.getTime()}:${Math.random().toString(36).slice(2, 10)}`;
      const filter: Filter<any> = {
        fnId: { $in: fnIds },
        $or: [
          { status: { $in: ['queued', 'sleeping'] }, runAt: { $lte: now } },
          { status: 'running', leaseExpiresAt: { $lte: now } },
        ],
      };
      if (excluded.length) filter._id = { $nin: excluded };
      try {
        const before = await this.jobs.findOneAndUpdate(
          filter,
          [
            {
              $set: {
                attempts: { $cond: [{ $eq: ['$status', 'running'] }, { $add: ['$attempts', 1] }, '$attempts'] },
                recoveries: { $cond: [{ $eq: ['$status', 'running'] }, { $add: ['$recoveries', 1] }, '$recoveries'] },
                status: 'running',
                claimToken: token,
                leaseOwner: owner,
                leaseExpiresAt: new Date(now.getTime() + leaseMs),
                startedAt: now,
                updatedAt: now,
              },
            },
          ],
          { sort: { runAt: 1 }, returnDocument: 'before' }
        );
        if (!before) return null;
        const recovered = before.status === 'running';
        const job: JobDoc = {
          ...(before as any),
          attempts: before.attempts + (recovered ? 1 : 0),
          recoveries: (before.recoveries || 0) + (recovered ? 1 : 0),
          status: 'running',
          claimToken: token,
          leaseOwner: owner,
          leaseExpiresAt: new Date(now.getTime() + leaseMs),
        };
        return { job, recovered };
      } catch (err: any) {
        // Another job with the same concurrencyKey is running: skip this one
        // for the round (we don't know its _id from the error, so probe it).
        if (err?.code !== 11000) throw err;
        const blocked = await this.jobs.findOne(filter, { sort: { runAt: 1 }, projection: { _id: 1 } });
        if (!blocked) return null;
        excluded.push(blocked._id);
      }
    }
    return null;
  }

  private fence(job: Pick<JobDoc, '_id' | 'claimToken'>): Filter<any> {
    return { _id: job._id, claimToken: job.claimToken, status: 'running' };
  }

  /** Extend the lease. Returns false when the lease was lost (job cancelled / reclaimed). */
  async heartbeat(job: JobDoc, leaseMs: number): Promise<boolean> {
    const now = this.now();
    const r = await this.jobs.updateOne(this.fence(job), {
      $set: { leaseExpiresAt: new Date(now.getTime() + leaseMs), updatedAt: now },
    });
    return r.matchedCount === 1;
  }

  /** Persist a completed step. attempts resets: each step has its own retry budget, like Inngest. */
  async recordStep(job: JobDoc, step: StepRecord): Promise<boolean> {
    const r = await this.jobs.updateOne(this.fence(job), {
      $push: { steps: step } as any,
      $set: { attempts: 0, updatedAt: this.now() },
    });
    return r.matchedCount === 1;
  }

  /** Park the job until `wakeAt`, recording the sleep step in the same atomic write. */
  async suspend(job: JobDoc, step: StepRecord, wakeAt: Date): Promise<boolean> {
    const r = await this.jobs.updateOne(this.fence(job), {
      $push: { steps: step } as any,
      $set: {
        status: 'sleeping',
        runAt: wakeAt,
        attempts: 0,
        claimToken: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: this.now(),
      },
    });
    return r.matchedCount === 1;
  }

  async complete(job: JobDoc, result: unknown): Promise<boolean> {
    const now = this.now();
    const r = await this.jobs.updateOne(this.fence(job), {
      $set: {
        status: 'completed',
        result: safeJson(result),
        completedAt: now,
        expireAt: new Date(now.getTime() + FINISHED_RETENTION_MS),
        claimToken: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      },
    });
    return r.matchedCount === 1;
  }

  /**
   * Record a failure. Retriable + attempts left → requeue with `retryAt`;
   * otherwise the job goes to the dead-letter state ('dead', never TTL'd).
   */
  async fail(
    job: JobDoc,
    error: string,
    opts: { retriable: boolean; retryAt?: Date }
  ): Promise<'retry' | 'dead' | 'lost'> {
    const now = this.now();
    const attempts = job.attempts + 1;
    const lastError = error.slice(0, MAX_ERROR_LEN);
    const willRetry = opts.retriable && attempts < job.maxAttempts && !!opts.retryAt;
    const update = willRetry
      ? {
          status: 'queued' as JobStatus,
          attempts,
          runAt: opts.retryAt!,
          lastError,
          claimToken: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: now,
        }
      : {
          status: 'dead' as JobStatus,
          attempts,
          lastError,
          deadAt: now,
          claimToken: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: now,
        };
    const r = await this.jobs.updateOne(this.fence(job), { $set: update });
    if (r.matchedCount !== 1) return 'lost';
    return willRetry ? 'retry' : 'dead';
  }

  /** Give a claimed job back untouched (graceful shutdown before it started a step). */
  async release(job: JobDoc, runAt: Date): Promise<boolean> {
    const r = await this.jobs.updateOne(this.fence(job), {
      $set: {
        status: 'queued',
        runAt,
        claimToken: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: this.now(),
      },
    });
    return r.matchedCount === 1;
  }

  // ------------------------------------------------- pause / control --

  /**
   * Durable pause flag (single document). Workers read it before every claim
   * and treat an unreadable control document as PAUSED (fail closed).
   */
  async getControl(): Promise<{ paused: boolean; reason?: string; by?: string; since?: Date; changedAt?: Date }> {
    const d: any = await this.control.findOne({ _id: 'control' as any });
    if (!d) return { paused: false };
    return { paused: !!d.paused, reason: d.reason, by: d.by, since: d.since, changedAt: d.changedAt };
  }

  /**
   * Idempotent: pausing an already-paused queue (or resuming a running one)
   * changes nothing and returns `changed:false`. Concurrent callers are safe —
   * the conditional update is a single atomic operation.
   */
  async setPaused(paused: boolean, by: string, reason?: string): Promise<{ changed: boolean }> {
    const now = this.now();
    if (paused) {
      const r = await this.control.updateOne(
        { _id: 'control' as any, paused: { $ne: true } },
        { $set: { paused: true, reason: (reason || '').slice(0, 300), by, since: now, changedAt: now } },
        { upsert: true }
      ).catch((e: any) => {
        if (e?.code === 11000) return { modifiedCount: 0, upsertedCount: 0 }; // lost the upsert race: already paused
        throw e;
      });
      return { changed: (r.modifiedCount ?? 0) + (r.upsertedCount ?? 0) > 0 };
    }
    const r = await this.control.updateOne(
      { _id: 'control' as any, paused: true },
      { $set: { paused: false, by, changedAt: now }, $unset: { since: '', reason: '' } }
    );
    return { changed: r.modifiedCount === 1 };
  }

  // ---------------------------------------------------- cancel / admin --

  /**
   * Cancel active jobs of `fnId` whose data[field] === value. `exceptEventId`
   * protects the job spawned by the very event that triggers the cancel
   * (scheduleSinglePostPublish cancels on the same event that starts it).
   */
  async cancelWhere(args: { fnId: string; field: string; value: unknown; exceptEventId?: string; reason: string }) {
    if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(args.field)) throw new Error(`Bad cancel field: ${args.field}`);
    const now = this.now();
    const filter: Filter<any> = {
      fnId: args.fnId,
      status: { $in: ACTIVE },
      [`data.${args.field}`]: args.value,
    };
    if (args.exceptEventId) filter.eventId = { $ne: args.exceptEventId };
    const r = await this.jobs.updateMany(filter, {
      $set: {
        status: 'cancelled',
        cancelledReason: args.reason,
        expireAt: new Date(now.getTime() + FINISHED_RETENTION_MS),
        claimToken: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      },
    });
    return r.modifiedCount;
  }

  async cancelById(id: string, reason: string): Promise<boolean> {
    const now = this.now();
    const r = await this.jobs.updateOne(
      { _id: toId(id), status: { $in: ACTIVE } },
      {
        $set: {
          status: 'cancelled',
          cancelledReason: reason,
          expireAt: new Date(now.getTime() + FINISHED_RETENTION_MS),
          claimToken: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: now,
        },
      }
    );
    return r.modifiedCount === 1;
  }

  /**
   * Requeue a dead-lettered job. Successfully completed steps are kept, so it
   * resumes rather than redoing them; steps that were memoised as FAILED are
   * dropped so the operator's retry actually re-executes them (otherwise the
   * stored error would be replayed and the job would die again at once).
   */
  async retryDead(id: string, opts: { resetSteps?: boolean } = {}): Promise<boolean> {
    const now = this.now();
    const steps = opts.resetSteps
      ? []
      : { $filter: { input: '$steps', cond: { $eq: [{ $type: '$$this.error' }, 'missing'] } } };
    const r = await this.jobs.updateOne({ _id: toId(id), status: 'dead' }, [
      { $set: { status: 'queued', attempts: 0, runAt: now, updatedAt: now, steps } },
      { $unset: ['deadAt'] },
    ]);
    return r.modifiedCount === 1;
  }

  async stats() {
    const byStatus = await this.jobs.aggregate([{ $group: { _id: { fnId: '$fnId', status: '$status' }, n: { $sum: 1 } } }]).toArray();
    const oldestDue = await this.jobs.find({ status: { $in: ['queued', 'sleeping'] }, runAt: { $lte: this.now() } }).sort({ runAt: 1 }).limit(1).project({ runAt: 1, fnId: 1 }).toArray();
    return {
      counts: byStatus.map((r: any) => ({ fnId: r._id.fnId, status: r._id.status, n: r.n })),
      oldestDueAgeMs: oldestDue[0] ? this.now().getTime() - new Date(oldestDue[0].runAt).getTime() : 0,
    };
  }
}

/** JSON round-trip, matching how Inngest hands memoized step data back to the function. */
export function safeJson<T = unknown>(v: unknown): T {
  if (v === undefined) return undefined as T;
  return JSON.parse(JSON.stringify(v)) as T;
}
