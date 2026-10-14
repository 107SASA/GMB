/**
 * DB-authoritative clock. Leases, due-time comparisons and cron slots all
 * use `now()` = local time + measured offset to the MongoDB server's clock,
 * so a droplet whose clock drifts (NTP stopped, VM resume) cannot make a
 * worker think a lease is still valid, or fire a cron early/late relative to
 * its peers. Offset = server.localTime − midpoint(request, response).
 */
import type { Db } from 'mongodb';

export class DbClock {
  offsetMs = 0;
  rttMs = 0;
  lastSyncAt = 0;
  lastSyncOk = false;

  constructor(private readonly db: Db) {}

  now = (): Date => new Date(Date.now() + this.offsetMs);

  async sync(): Promise<void> {
    const t0 = Date.now();
    try {
      const r: any = await this.db.command({ hello: 1 });
      const t1 = Date.now();
      const server: Date | undefined = r?.localTime;
      if (!server) throw new Error('hello.localTime missing');
      this.offsetMs = server.getTime() - Math.round((t0 + t1) / 2);
      this.rttMs = t1 - t0;
      this.lastSyncAt = t1;
      this.lastSyncOk = true;
    } catch (err) {
      this.lastSyncOk = false;
      throw err;
    }
  }

  /** True when the last successful sync is recent enough to trust for leader decisions. */
  isFresh(maxAgeMs = 5 * 60_000): boolean {
    return this.lastSyncOk && Date.now() - this.lastSyncAt <= maxAgeMs;
  }
}
