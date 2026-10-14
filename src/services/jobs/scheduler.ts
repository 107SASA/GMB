/**
 * Cron scheduling for the native queue, with distributed leader election.
 *
 * Two independent safety layers keep a cron from firing twice:
 *  1. LEADER LOCK — only the holder of `cron-leader` (a TTL'd doc renewed by
 *     the leader) evaluates schedules. Acquisition is a single atomic upsert.
 *  2. SLOT IDEMPOTENCY — each fire enqueues with key `cron:<slotMs>` under the
 *     unique idempotencyKey index, so even two simultaneous "leaders" (lock
 *     expired during a GC pause, clock skew) create exactly one job per slot.
 *
 * Missed schedules: state `{lastSlotAt}` is stored per cron. After downtime
 * the missed slots are COALESCED into one run of the most recent slot — and
 * only if that slot is within `cronCatchupMs`; older ones are skipped and
 * counted in `missed` (a 19:00 digest firing at 05:00 is worse than skipped).
 * First sight of a cron initialises state to "now": no historical backfill.
 */
import type { JobStore } from './store';
import { parseCron, slotsBetween, type CronSpec } from './time';
import type { Logger, NativeFunction } from './types';

export const LEADER_ID = 'cron-leader';
const MINUTE = 60_000;

export interface CronEntry {
  fnId: string;
  expr: string;
  spec: CronSpec;
  maxAttempts: number;
}

export function buildCronEntries(fns: NativeFunction[]): CronEntry[] {
  const out: CronEntry[] = [];
  for (const fn of fns) {
    for (const expr of fn.crons) {
      out.push({ fnId: fn.id, expr, spec: parseCron(expr), maxAttempts: fn.maxAttempts });
    }
  }
  return out;
}

export interface TickResult {
  leader: boolean;
  fired: string[];
  missed: number;
}

export class CronScheduler {
  constructor(
    private readonly store: JobStore,
    private readonly owner: string,
    private readonly crons: CronEntry[],
    private readonly opts: { leaderTtlMs: number; catchupMs: number; canLead?: () => boolean },
    private readonly log: Logger
  ) {}

  /** Acquire or renew the leader lock. Returns true when this owner is leader. */
  async holdLeadership(): Promise<boolean> {
    if (this.opts.canLead && !this.opts.canLead()) return false;
    const now = this.store.now();
    try {
      const r = await this.store.locks.findOneAndUpdate(
        { _id: LEADER_ID as any, $or: [{ owner: this.owner }, { expiresAt: { $lte: now } }] },
        { $set: { owner: this.owner, renewedAt: now, expiresAt: new Date(now.getTime() + this.opts.leaderTtlMs) } },
        { upsert: true, returnDocument: 'after' }
      );
      return r?.owner === this.owner;
    } catch (err: any) {
      if (err?.code === 11000) return false; // someone else holds a live lease
      throw err;
    }
  }

  async releaseLeadership(): Promise<void> {
    await this.store.locks
      .updateOne({ _id: LEADER_ID as any, owner: this.owner }, { $set: { expiresAt: new Date(0) } })
      .catch(() => undefined);
  }

  async tick(): Promise<TickResult> {
    const res: TickResult = { leader: false, fired: [], missed: 0 };
    if (this.crons.length === 0) return res;
    res.leader = await this.holdLeadership();
    if (!res.leader) return res;

    const nowMs = this.store.now().getTime();
    for (const cron of this.crons) {
      const state = await this.store.cronState.findOne({ _id: cron.fnId as any });
      if (!state) {
        await this.store.cronState
          .updateOne(
            { _id: cron.fnId as any },
            { $setOnInsert: { lastSlotAt: Math.floor(nowMs / MINUTE) * MINUTE, missed: 0, expr: cron.expr } },
            { upsert: true }
          )
          .catch((e: any) => {
            if (e?.code !== 11000) throw e;
          });
        continue;
      }
      const slots = slotsBetween(cron.spec, state.lastSlotAt, nowMs);
      if (slots.length === 0) continue;
      const latest = slots[slots.length - 1];

      let fired = false;
      if (nowMs - latest <= this.opts.catchupMs) {
        const { created } = await this.store.enqueue({
          fnId: cron.fnId,
          eventName: 'inngest/scheduled.timer',
          key: `cron:${latest}`,
          eventId: `cron:${cron.fnId}:${new Date(latest).toISOString()}`,
          data: { cron: cron.expr, slot: new Date(latest).toISOString() },
          maxAttempts: cron.maxAttempts,
          ts: new Date(latest),
        });
        fired = true;
        if (created) res.fired.push(cron.fnId);
      }
      const missed = slots.length - (fired ? 1 : 0);
      if (missed > 0) {
        res.missed += missed;
        this.log('warn', 'cron slots skipped', { fnId: cron.fnId, missed, coalescedInto: fired ? new Date(latest).toISOString() : null });
      }
      // Advance AFTER the (idempotent) enqueue; $max keeps it monotonic under races.
      await this.store.cronState.updateOne(
        { _id: cron.fnId as any },
        { $max: { lastSlotAt: latest }, $inc: { missed } }
      );
    }
    return res;
  }
}
