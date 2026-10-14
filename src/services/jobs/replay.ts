/**
 * Rollback replay: hand queued-but-never-started native jobs back to Inngest.
 *
 * Safety model
 *  - Only jobs that provably have not begun are eligible: status `queued`,
 *    zero attempts, zero recoveries, zero recorded steps, event-triggered.
 *    Anything that ran (or may have run) is reported, never replayed:
 *    running / sleeping / dead / retried / partially executed.
 *  - Cron slots are skipped on purpose — Inngest fires its own next slot.
 *  - EXCLUSIVE CLAIM: each replay flips the job to `cancelled/replay-pending`
 *    with a random claim token and a timestamp. A second replayer cannot take
 *    it until the claim lease (default 10 min) has expired. The final status
 *    write is FENCED on that token, so a slow or stale replayer can never
 *    overwrite the outcome recorded by the process that owns the claim.
 *  - The send uses the original event id, so Inngest's own event-id dedupe
 *    absorbs a repeat. That dedupe lasts ~24 h: an interrupted or failed
 *    replay whose claim is older than the dedupe window is NOT resent unless
 *    the operator explicitly allows it.
 *  - Never replays a function this environment still natively owns, nor one
 *    the running web app reports as released (`webReleased`).
 *  - Dry-run is the default; execution is an explicit option.
 *
 * No Mongoose models, no aliases: runs against a plain JobStore.
 */
import { randomUUID } from 'crypto';
import type { JobStore } from './store';
import { FINISHED_RETENTION_MS } from './store';

export const CRON_EVENT = 'inngest/scheduled.timer';
/** A replay claim is exclusive for this long. */
export const REPLAY_CLAIM_LEASE_MS = 10 * 60_000;
/** Inngest de-duplicates event ids for ~24 h; stay inside it with a margin. */
export const INNGEST_DEDUPE_WINDOW_MS = 23 * 60 * 60_000;

export type SkipReason =
  | 'cron-slot'
  | 'running'
  | 'sleeping'
  | 'dead'
  | 'retried-or-recovered'
  | 'partially-executed'
  | 'natively-owned'
  | 'released-on-web'
  | 'replay-in-progress'
  | 'outside-dedupe-window'
  | 'payload-invalid';

export interface ReplayCandidate {
  id: any;
  fnId: string;
  eventId: string;
  eventName: string;
  /** True when a previous replay was interrupted after the claim but before it was confirmed. */
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
  /** Ids the running web app reports as released to the native worker — never replayed. */
  webReleased?: Set<string>;
  limit?: number;
  claimLeaseMs?: number;
  dedupeWindowMs?: number;
  /** Operator override: resend interrupted/failed replays older than the dedupe window. */
  allowOutsideDedupeWindow?: boolean;
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
    .project({
      fnId: 1, status: 1, attempts: 1, recoveries: 1, eventId: 1, eventName: 1, cancelledReason: 1,
      steps: { $slice: 1 }, data: 1, replayClaimedAt: 1, updatedAt: 1,
    })
    .toArray();

  const lease = opts.claimLeaseMs ?? REPLAY_CLAIM_LEASE_MS;
  const window = opts.dedupeWindowMs ?? INNGEST_DEDUPE_WINDOW_MS;
  const now = store.now().getTime();

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
    if (opts.webReleased?.has(r.fnId)) { skip(r, 'released-on-web'); continue; }
    if (r.status === 'running') { skip(r, 'running'); continue; }
    if (r.status === 'sleeping') { skip(r, 'sleeping'); continue; }
    if (r.status === 'dead') { skip(r, 'dead'); continue; }
    if (r.status === 'queued') {
      if ((r.steps?.length ?? 0) > 0) { skip(r, 'partially-executed'); continue; }
      if ((r.attempts ?? 0) > 0 || (r.recoveries ?? 0) > 0) { skip(r, 'retried-or-recovered'); continue; }
    }
    if (!r.eventId || !r.eventName || typeof r.data !== 'object' || r.data === null) { skip(r, 'payload-invalid'); continue; }

    let interrupted = false;
    if (r.status === 'cancelled') {
      // A previous replay claimed this job. Honour its lease; refuse to resend past the dedupe window.
      const claimedAt = new Date(r.replayClaimedAt ?? r.updatedAt ?? 0).getTime();
      const age = now - claimedAt;
      if (r.cancelledReason === 'replay-pending' && age < lease) { skip(r, 'replay-in-progress'); continue; }
      if (age > window && !opts.allowOutsideDedupeWindow) { skip(r, 'outside-dedupe-window'); continue; }
      interrupted = r.cancelledReason === 'replay-pending';
    }
    plan.eligible.push({ id: r._id, fnId: r.fnId, eventId: r.eventId, eventName: r.eventName, interrupted });
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
  /** Not claimable any more (started meanwhile, or another replayer holds a live claim). */
  raced: number;
  /** Our claim expired and another process took over before we could record the outcome. */
  lostClaim: number;
  errors: Array<{ id: string; error: string }>;
}

export interface ExecuteOptions {
  claimLeaseMs?: number;
}

export async function executeReplay(
  store: JobStore,
  plan: ReplayPlan,
  send: (event: ReplayEvent) => Promise<void>,
  opts: ExecuteOptions = {}
): Promise<ExecuteResult> {
  const lease = opts.claimLeaseMs ?? REPLAY_CLAIM_LEASE_MS;
  const res: ExecuteResult = { replayed: 0, failed: 0, raced: 0, lostClaim: 0, errors: [] };
  for (const c of plan.eligible) {
    const now = store.now();
    const token = randomUUID();
    // Exclusive claim: a pristine queued job, a failed replay, or a pending replay whose lease expired.
    const claimed: any = await store.jobs.findOneAndUpdate(
      {
        _id: c.id,
        $or: [
          { status: 'queued', attempts: 0, recoveries: 0, 'steps.0': { $exists: false } },
          { status: 'cancelled', cancelledReason: 'replay-failed' },
          { status: 'cancelled', cancelledReason: 'replay-pending', replayClaimedAt: { $lt: new Date(now.getTime() - lease) } },
        ],
      },
      {
        $set: {
          status: 'cancelled',
          cancelledReason: 'replay-pending',
          replayClaimToken: token,
          replayClaimedAt: now,
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

    // Every later write is fenced on our token: it only lands while we still own the claim.
    const mine = { _id: c.id, replayClaimToken: token, cancelledReason: 'replay-pending' };
    try {
      await send({ id: claimed.eventId, name: claimed.eventName, data: claimed.data ?? {}, ts: new Date(claimed.ts ?? now).getTime() });
      const u = await store.jobs.updateOne(mine, { $set: { cancelledReason: 'replayed-to-inngest', replayedAt: store.now(), updatedAt: store.now() } });
      if (u.matchedCount === 1) res.replayed++;
      else res.lostClaim++;
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 300);
      const u = await store.jobs.updateOne(mine, { $set: { cancelledReason: 'replay-failed', lastError: msg, updatedAt: store.now() } });
      if (u.matchedCount === 1) {
        res.failed++;
        res.errors.push({ id: String(c.id), error: msg });
      } else {
        res.lostClaim++;
      }
    }
  }
  return res;
}
