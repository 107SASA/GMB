/**
 * Rollback replay: hand queued-but-never-started native jobs back to Inngest.
 *
 * Safety model
 *  - Only jobs that provably have not begun are eligible: status `queued`,
 *    zero attempts, zero recoveries, zero recorded steps, event-triggered.
 *    Anything that ran (or may have run) is reported, never replayed:
 *    running / sleeping / dead / retried / partially executed.
 *  - Cron slots are skipped on purpose — Inngest fires its own next slot.
 *  - Each job is flipped queued→cancelled('replay-pending') atomically BEFORE
 *    the send, so the native worker can never also run it. The send uses the
 *    original event id, so Inngest's own event-id dedupe (24 h window) makes
 *    a repeat of an interrupted replay a no-op. A failed send is recorded as
 *    `replay-failed` and is eligible for the next run.
 *  - Never replays a function this environment still natively owns, and
 *    refuses to run at all while a native worker is alive.
 *  - Dry-run is the default; execution is an explicit option.
 *
 * No Mongoose models, no aliases: runs against a plain JobStore.
 */
import type { JobStore } from './store';
import { FINISHED_RETENTION_MS } from './store';

export const CRON_EVENT = 'inngest/scheduled.timer';

export type SkipReason =
  | 'cron-slot'
  | 'running'
  | 'sleeping'
  | 'dead'
  | 'retried-or-recovered'
  | 'partially-executed'
  | 'natively-owned'
  | 'payload-invalid';

export interface ReplayCandidate {
  id: any;
  fnId: string;
  eventId: string;
  eventName: string;
  /** True when a previous replay was interrupted after the cancel but before it was confirmed. */
  interrupted: boolean;
}

export interface ReplayPlan {
  eligible: ReplayCandidate[];
  skipped: Array<{ id: any; fnId: string; reason: SkipReason }>;
  byFunction: Record<string, { eligible: number; skipped: Partial<Record<SkipReason, number>> }>;
}

export interface PlanOptions {
  fnIds?: string[];
  /** Ids still owned natively by this environment — never replayed. */
  nativeOwned?: Set<string>;
  limit?: number;
}

export async function planReplay(store: JobStore, opts: PlanOptions = {}): Promise<ReplayPlan> {
  const filter: any = {
    $or: [
      { status: { $in: ['queued', 'sleeping', 'running', 'dead'] } },
      { status: 'cancelled', cancelledReason: { $in: ['replay-failed', 'replay-pending'] } },
    ],
  };
  if (opts.fnIds?.length) filter.fnId = { $in: opts.fnIds };
  const rows: any[] = await store.jobs
    .find(filter)
    .sort({ createdAt: 1 })
    .limit(opts.limit ?? 5000)
    .project({ fnId: 1, status: 1, attempts: 1, recoveries: 1, eventId: 1, eventName: 1, cancelledReason: 1, steps: { $slice: 1 }, data: 1 })
    .toArray();

  const plan: ReplayPlan = { eligible: [], skipped: [], byFunction: {} };
  const fn = (id: string) => (plan.byFunction[id] ??= { eligible: 0, skipped: {} });
  const skip = (r: any, reason: SkipReason) => {
    plan.skipped.push({ id: r._id, fnId: r.fnId, reason });
    const s = fn(r.fnId).skipped;
    s[reason] = (s[reason] ?? 0) + 1;
  };

  for (const r of rows) {
    if (r.eventName === CRON_EVENT) { skip(r, 'cron-slot'); continue; }
    if (opts.nativeOwned?.has(r.fnId)) { skip(r, 'natively-owned'); continue; }
    if (r.status === 'running') { skip(r, 'running'); continue; }
    if (r.status === 'sleeping') { skip(r, 'sleeping'); continue; }
    if (r.status === 'dead') { skip(r, 'dead'); continue; }
    if (r.status === 'queued') {
      if ((r.steps?.length ?? 0) > 0) { skip(r, 'partially-executed'); continue; }
      if ((r.attempts ?? 0) > 0 || (r.recoveries ?? 0) > 0) { skip(r, 'retried-or-recovered'); continue; }
    }
    if (!r.eventId || !r.eventName || typeof r.data !== 'object' || r.data === null) { skip(r, 'payload-invalid'); continue; }
    plan.eligible.push({ id: r._id, fnId: r.fnId, eventId: r.eventId, eventName: r.eventName, interrupted: r.status === 'cancelled' && r.cancelledReason === 'replay-pending' });
    fn(r.fnId).eligible++;
  }
  return plan;
}

/** Workers that wrote a heartbeat recently and have not reported `stopped`. */
export async function liveWorkers(store: JobStore, withinMs: number): Promise<Array<{ id: string; status: string; seenAt: Date }>> {
  const since = new Date(store.now().getTime() - withinMs);
  const rows: any[] = await store.workers.find({ seenAt: { $gte: since }, status: { $ne: 'stopped' } }).project({ status: 1, seenAt: 1 }).toArray();
  return rows.map((r) => ({ id: String(r._id), status: r.status, seenAt: r.seenAt }));
}

export interface ReplayEvent {
  id: string;
  name: string;
  data: Record<string, any>;
  ts: number;
}

export interface ExecuteResult {
  replayed: number;
  failed: number;
  raced: number;
  errors: Array<{ id: string; error: string }>;
}

export async function executeReplay(
  store: JobStore,
  plan: ReplayPlan,
  send: (event: ReplayEvent) => Promise<void>
): Promise<ExecuteResult> {
  const res: ExecuteResult = { replayed: 0, failed: 0, raced: 0, errors: [] };
  for (const c of plan.eligible) {
    const now = store.now();
    // Atomic claim: only a still-pristine queued job (or a prior replay-failed/pending) may be taken.
    const claimed: any = await store.jobs.findOneAndUpdate(
      {
        _id: c.id,
        $or: [
          { status: 'queued', attempts: 0, recoveries: 0, 'steps.0': { $exists: false } },
          { status: 'cancelled', cancelledReason: { $in: ['replay-failed', 'replay-pending'] } },
        ],
      },
      {
        $set: {
          status: 'cancelled',
          cancelledReason: 'replay-pending',
          claimToken: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          expireAt: new Date(now.getTime() + FINISHED_RETENTION_MS),
          updatedAt: now,
        },
      },
      { returnDocument: 'after' }
    );
    if (!claimed) { res.raced++; continue; }
    try {
      await send({ id: claimed.eventId, name: claimed.eventName, data: claimed.data ?? {}, ts: new Date(claimed.ts ?? now).getTime() });
      await store.jobs.updateOne({ _id: c.id }, { $set: { cancelledReason: 'replayed-to-inngest', replayedAt: store.now(), updatedAt: store.now() } });
      res.replayed++;
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 300);
      await store.jobs.updateOne({ _id: c.id }, { $set: { cancelledReason: 'replay-failed', lastError: msg, updatedAt: store.now() } });
      res.failed++;
      res.errors.push({ id: String(c.id), error: msg });
    }
  }
  return res;
}
