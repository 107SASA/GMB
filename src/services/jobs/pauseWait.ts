/**
 * `pause --wait`: decides when a pause has actually taken effect.
 *
 * A pause is acknowledged only when EVERY live worker's heartbeat — written
 * AFTER the pause was recorded — reports `paused:true` and `inFlight:0`. A
 * heartbeat that predates the pause proves nothing, and a worker that has
 * stopped heart-beating is not counted (it cannot claim). Pure over its
 * inputs except `waitForPauseAck`, which polls a JobStore.
 */
import type { JobStore } from './store';

export interface WorkerBeat {
  _id: string;
  status?: string;
  paused?: boolean;
  inFlight?: number;
  seenAt?: Date | string;
}

export interface PauseAck {
  acked: boolean;
  liveWorkers: number;
  /** Live workers that have not yet reported paused + drained since `since`. */
  waitingOn: Array<{ owner: string; reason: string }>;
  noLiveWorkers: boolean;
}

export function pauseAckStatus(
  beats: WorkerBeat[],
  opts: { since: Date; now: Date; liveWithinMs: number }
): PauseAck {
  const liveCutoff = opts.now.getTime() - opts.liveWithinMs;
  const live = beats.filter((b) => b.status !== 'stopped' && b.seenAt && new Date(b.seenAt).getTime() >= liveCutoff);
  const waitingOn: PauseAck['waitingOn'] = [];
  for (const b of live) {
    const seen = new Date(b.seenAt as Date | string).getTime();
    if (seen < opts.since.getTime()) {
      waitingOn.push({ owner: String(b._id), reason: 'no heartbeat since the pause was recorded' });
    } else if (b.paused !== true) {
      waitingOn.push({ owner: String(b._id), reason: 'has not observed the pause' });
    } else if ((b.inFlight ?? 0) > 0) {
      waitingOn.push({ owner: String(b._id), reason: `${b.inFlight} job(s) still in flight` });
    }
  }
  return { acked: waitingOn.length === 0, liveWorkers: live.length, waitingOn, noLiveWorkers: live.length === 0 };
}

export interface WaitOptions {
  since: Date;
  timeoutMs: number;
  pollMs?: number;
  liveWithinMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function waitForPauseAck(store: JobStore, o: WaitOptions): Promise<PauseAck & { timedOut: boolean }> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = o.pollMs ?? 1_000;
  const liveWithinMs = o.liveWithinMs ?? 45_000;
  const deadline = store.now().getTime() + o.timeoutMs;
  for (;;) {
    const beats = (await store.workers.find({}).project({ status: 1, paused: 1, inFlight: 1, seenAt: 1 }).toArray()) as unknown as WorkerBeat[];
    const ack = pauseAckStatus(beats, { since: o.since, now: store.now(), liveWithinMs });
    if (ack.acked) return { ...ack, timedOut: false };
    if (store.now().getTime() >= deadline) return { ...ack, timedOut: true };
    await sleep(pollMs);
  }
}
