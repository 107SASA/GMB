/**
 * Continuous ownership-guard monitor for the worker process.
 *
 * Replaces "exit(1) and let PM2 restart" with a blocked-but-alive worker:
 *  - starts BLOCKED (`startup check pending`), so nothing is claimed and no
 *    cron slot is enqueued until the first successful verdict;
 *  - re-checks quickly while blocked (the operator is usually mid-cutover:
 *    web restart, resync) and slowly while healthy;
 *  - flips back to blocked on ANY failure (fail closed), including a web
 *    restart, and logs only on state transitions;
 *  - never throws and never exits — so a long web outage cannot exhaust PM2's
 *    restart budget and leave the worker `errored`.
 *
 * Non-recoverable configuration errors (no token) are handled by the caller
 * before the monitor is created.
 */
import type { Logger } from './types';
import type { OwnershipVerdict } from './ownershipGuard';

export interface GuardMonitorOptions {
  check: () => Promise<OwnershipVerdict>;
  logger: Logger;
  /** Re-check period while ownership is verified. */
  okIntervalMs?: number;
  /** Re-check period while blocked. */
  blockedIntervalMs?: number;
}

export class GuardMonitor {
  private current: string | null = 'ownership-guard: startup check pending';
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private lastReason: string | null = null;
  private lastCheckAt: number | null = null;
  private checks = 0;

  private readonly o: GuardMonitorOptions;

  constructor(o: GuardMonitorOptions) {
    this.o = o;
  }

  /** Reason claims are blocked, or null when ownership is verified. */
  get block(): string | null {
    return this.current;
  }

  get state() {
    return { verified: this.current === null, reason: this.current, checks: this.checks, lastCheckAt: this.lastCheckAt };
  }

  /** Runs one check now (used by tests and as the timer body). Never throws. */
  async checkNow(): Promise<void> {
    let verdict: OwnershipVerdict;
    try {
      verdict = await this.o.check();
    } catch (e: any) {
      verdict = { ok: false, reason: `guard check threw: ${String(e?.message || e).slice(0, 120)}` };
    }
    this.checks++;
    this.lastCheckAt = Date.now();
    const next = verdict.ok ? null : `ownership-guard: ${verdict.reason}`;
    if (next !== this.current) {
      if (next === null) this.o.logger('info', 'ownership guard verified — claiming enabled', {});
      else
        this.o.logger('error', 'ownership guard NOT satisfied — claiming blocked', {
          reason: next,
          conflicting: (verdict as any).conflicting,
        });
    } else if (next !== null && next !== this.lastReason) {
      this.o.logger('error', 'ownership guard still not satisfied', { reason: next });
    }
    this.lastReason = next;
    this.current = next;
  }

  start(): void {
    if (this.timer || this.stopped) return;
    const loop = async () => {
      await this.checkNow();
      if (this.stopped) return;
      const wait = this.current === null ? (this.o.okIntervalMs ?? 60_000) : (this.o.blockedIntervalMs ?? 10_000);
      this.timer = setTimeout(loop, wait);
      this.timer.unref?.();
    };
    void loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
