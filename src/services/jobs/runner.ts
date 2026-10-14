/**
 * Executes ONE claimed job: builds the persisted step shim, runs the
 * handler, and translates its outcome into a queue state transition.
 *
 * Execution model (same as Inngest, so existing handlers are unchanged):
 * the handler is RE-RUN FROM THE TOP on every claim; `step.*` calls whose id
 * already has a persisted record return that record instead of executing.
 *
 *  - step.run       result persisted (JSON round-trip, exactly like Inngest's
 *                   memoisation) in the same fenced write that resets the
 *                   retry budget. A completed step is never executed again
 *                   unless the worker died between the side effect and that
 *                   write — at-least-once, NOT exactly-once.
 *  - step.sleep(Until) persisted wake time; the job is parked as 'sleeping'
 *                   with runAt=wakeAt (no process holds it). Wakes when a
 *                   worker claims it; the replay then passes the sleep.
 *  - step.sendEvent memoised like run; each event gets a deterministic id
 *                   (`<jobId>:<stepId>:<i>`) so a re-run enqueues nothing new.
 *
 * Suspension (sleep / retry / lease loss) is done by *abandoning* the handler
 * (racing it against a settle signal) rather than throwing a sentinel — a
 * handler's own try/catch cannot swallow it.
 */
import { backoffMs, parseDurationMs } from './time';
import { JobStore, MAX_STEP_RESULT_BYTES, safeJson, type JobDoc, type StepRecord } from './store';
import {
  isNonRetriable,
  NonRetriableError,
  type HandlerContext,
  type Logger,
  type NativeEvent,
  type NativeFunction,
  type StepTools,
} from './types';

export type RunOutcome =
  | { type: 'completed' }
  | { type: 'sleeping'; wakeAt: Date }
  | { type: 'retry'; error: string }
  | { type: 'dead'; error: string }
  | { type: 'lost'; reason: string };

type Signal =
  | { type: 'done'; result: unknown }
  | { type: 'error'; error: unknown }
  | { type: 'sleeping'; wakeAt: Date }
  | { type: 'stepFailed'; error: unknown }
  | { type: 'lost'; reason: string };

export interface RunnerDeps {
  store: JobStore;
  leaseMs: number;
  heartbeatMs: number;
  logger: Logger;
  /** Routes events produced by step.sendEvent (native enqueue and/or Inngest). */
  dispatch: (events: NativeEvent[]) => Promise<string[]>;
  /** Tuning for retry delay; injectable for tests. */
  backoff?: (failedAttempts: number) => number;
}

const NEVER = () => new Promise<never>(() => {});

export interface RunHandle {
  /** Resolves with the final outcome of this claim. */
  done: Promise<RunOutcome>;
  /** Stop starting new steps and settle as 'lost' (graceful-shutdown / cancel). */
  abort(reason: string): void;
}

export function runJob(fn: NativeFunction, job: JobDoc, deps: RunnerDeps): RunHandle {
  const { store, logger } = deps;
  const log: Logger = (level, msg, f) => logger(level, msg, { fnId: job.fnId, jobId: String(job._id), ...f });

  let settled = false;
  let settle!: (s: Signal) => void;
  const signal = new Promise<Signal>((res) => {
    settle = (s) => {
      if (settled) return;
      settled = true;
      res(s);
    };
  });
  const abandon = (s: Signal) => {
    settle(s);
    return NEVER();
  };
  const isOver = () => settled;

  // --- step shim -------------------------------------------------------
  const replay = new Map<string, StepRecord & { error?: string }>();
  for (const s of job.steps || []) replay.set(s.id, s as any);
  const seen = new Map<string, number>();
  const uniqueId = (id: string) => {
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return n === 0 ? id : `${id}:${n}`; // same disambiguation Inngest applies to repeated ids in loops
  };

  const encode = (value: unknown): Pick<StepRecord, 'result' | 'undef'> => {
    if (value === undefined) return { undef: true };
    const json = JSON.stringify(value);
    if (json && Buffer.byteLength(json) > MAX_STEP_RESULT_BYTES) {
      throw new NonRetriableError(`step result exceeds ${MAX_STEP_RESULT_BYTES} bytes`);
    }
    return { result: JSON.parse(json ?? 'null') };
  };
  const decode = (r: StepRecord & { error?: string }) => {
    if (r.error) throw new Error(r.error);
    return r.undef ? undefined : r.result;
  };

  /** Fenced write of a step record. If the lease was lost this never returns (handler is abandoned). */
  const persist = async (rec: StepRecord & { error?: string }): Promise<void> => {
    const ok = await store.recordStep(job, rec as StepRecord);
    if (!ok) await abandon({ type: 'lost', reason: 'lease-lost-on-step-write' });
    replay.set(rec.id, rec);
  };

  const step: StepTools = {
    async run<T>(id: string, work: () => Promise<T> | T): Promise<T> {
      const sid = uniqueId(id);
      const hit = replay.get(sid);
      if (hit) return decode(hit) as T;
      if (isOver()) return NEVER();
      let value: T;
      try {
        value = await work();
      } catch (err: any) {
        if (isOver()) return NEVER();
        const exhausted = isNonRetriable(err) || job.attempts + 1 >= job.maxAttempts;
        if (!exhausted) return abandon({ type: 'stepFailed', error: err }); // retry the job later, handler never sees it
        // Out of retries: record the failure (replays rethrow it) and surface it to the handler.
        await persist({ id: sid, kind: 'run', error: String(err?.message || err), at: store.now() });
        throw err;
      }
      if (isOver()) return NEVER();
      const enc = encode(value);
      await persist({ id: sid, kind: 'run', ...enc, at: store.now() });
      return (enc.undef ? undefined : (enc.result as T)) as T;
    },

    async sleep(id, duration) {
      return sleepUntilMs(id, (ms) => store.now().getTime() + ms, parseDurationMs(duration));
    },

    async sleepUntil(id, until) {
      const t = new Date(until as any);
      if (Number.isNaN(t.getTime())) throw new NonRetriableError(`sleepUntil: invalid date ${String(until)}`);
      return sleepUntilMs(id, () => t.getTime(), 0);
    },

    async sendEvent(id, payload) {
      const sid = uniqueId(id);
      const hit = replay.get(sid);
      if (hit) return decode(hit) as { ids: string[] };
      if (isOver()) return NEVER();
      const events = (Array.isArray(payload) ? payload : [payload]).map((e, i) => ({
        ...e,
        id: e.id ?? `${job._id}:${sid}:${i}`,
      }));
      const ids = await deps.dispatch(events);
      if (isOver()) return NEVER();
      const out = { ids };
      await persist({ id: sid, kind: 'sendEvent', result: out, at: store.now() });
      return out;
    },
  };

  async function sleepUntilMs(id: string, wake: (ms: number) => number, ms: number): Promise<void> {
    const sid = uniqueId(id);
    const hit = replay.get(sid);
    const now = store.now();
    if (hit) {
      if (!hit.wakeAt || new Date(hit.wakeAt).getTime() <= now.getTime()) return;
      return abandon({ type: 'sleeping', wakeAt: new Date(hit.wakeAt) }) as Promise<never>;
    }
    if (isOver()) return NEVER();
    const wakeAt = new Date(wake(ms));
    if (wakeAt.getTime() <= now.getTime()) {
      await persist({ id: sid, kind: 'sleep', wakeAt, at: now });
      return;
    }
    const ok = await store.suspend(job, { id: sid, kind: 'sleep', wakeAt, at: now }, wakeAt);
    if (!ok) return abandon({ type: 'lost', reason: 'lease-lost-on-sleep' }) as Promise<never>;
    return abandon({ type: 'sleeping', wakeAt }) as Promise<never>;
  }

  // --- heartbeat -------------------------------------------------------
  const hb = setInterval(() => {
    store
      .heartbeat(job, deps.leaseMs)
      .then((ok) => {
        if (!ok) {
          log('warn', 'lease lost (cancelled or reclaimed)');
          settle({ type: 'lost', reason: 'lease-lost' });
        }
      })
      .catch((err) => log('warn', 'heartbeat error', { error: String(err?.message || err) }));
  }, deps.heartbeatMs);
  hb.unref?.();

  // --- run -------------------------------------------------------------
  const eventObj = {
    id: job.eventId,
    name: job.eventName,
    data: job.data || {},
    ts: new Date(job.ts).getTime(),
  };
  const ctx: HandlerContext = {
    event: eventObj,
    events: [eventObj],
    step,
    runId: String(job._id),
    attempt: job.attempts,
    logger: log,
  };

  void (async () => {
    try {
      const result = await fn.handler(ctx);
      settle({ type: 'done', result });
    } catch (error) {
      settle({ type: 'error', error });
    }
  })();

  const done = signal.then(async (sig): Promise<RunOutcome> => {
    clearInterval(hb);
    const backoff = deps.backoff ?? ((n: number) => backoffMs(n));
    try {
      switch (sig.type) {
        case 'done': {
          const ok = await store.complete(job, safeJson(sig.result));
          return ok ? { type: 'completed' } : { type: 'lost', reason: 'lease-lost-on-complete' };
        }
        case 'sleeping':
          return { type: 'sleeping', wakeAt: sig.wakeAt };
        case 'lost':
          return { type: 'lost', reason: sig.reason };
        case 'error':
        case 'stepFailed': {
          const err: any = sig.error;
          const msg = String(err?.stack || err?.message || err).slice(0, 2000);
          const retriable = !isNonRetriable(err);
          const retryAt = new Date(store.now().getTime() + backoff(job.attempts + 1));
          const r = await store.fail(job, msg, { retriable, retryAt });
          if (r === 'lost') return { type: 'lost', reason: 'lease-lost-on-fail' };
          return { type: r === 'retry' ? 'retry' : 'dead', error: msg };
        }
      }
    } catch (err: any) {
      // Persisting the outcome failed (DB blip). Lease expiry will recover the job.
      log('error', 'failed to persist job outcome', { error: String(err?.message || err) });
      return { type: 'lost', reason: 'persist-outcome-failed' };
    }
  });

  return { done, abort: (reason) => settle({ type: 'lost', reason }) };
}
