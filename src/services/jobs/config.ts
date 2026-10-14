/**
 * Native job queue — configuration & ownership flags.
 *
 * EVERYTHING here defaults to OFF. With no env vars set, `isNativeEnabled()`
 * is false, no function is natively owned, `inngest.send` is untouched, the
 * Inngest serve route registers every function exactly as before, and the
 * worker process refuses to start. Nothing in this module reads the DB.
 *
 *   JOBS_NATIVE_ENABLED=true            master switch (web routing + worker)
 *   JOBS_NATIVE_FUNCTIONS=id1,id2       Inngest function ids the native queue OWNS
 *                                       (those are deregistered from /api/inngest)
 *
 * Ownership is per function id, never "*": every cutover is an explicit,
 * reviewable list.
 */

const truthy = (v: string | undefined) => v === 'true' || v === '1';

export function isNativeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return truthy(env.JOBS_NATIVE_ENABLED);
}

/**
 * Lenient parse used on WEB paths (event sends, /api/inngest): never throws.
 * A wildcard or empty token is dropped (never expanded), so a bad value can
 * only reduce native ownership, never break event delivery. The worker uses
 * `nativeFunctionIdsStrict`.
 */
export function nativeFunctionIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  if (!isNativeEnabled(env)) return new Set();
  const raw = (env.JOBS_NATIVE_FUNCTIONS || '').split(',').map((s) => s.trim()).filter((s) => s && s !== '*');
  return new Set(raw);
}

/** Strict parse used by the worker: throws on a wildcard so the process fails closed at startup. */
export function nativeFunctionIdsStrict(env: NodeJS.ProcessEnv = process.env): Set<string> {
  if (!isNativeEnabled(env)) return new Set();
  const raw = (env.JOBS_NATIVE_FUNCTIONS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (raw.includes('*')) {
    throw new Error('JOBS_NATIVE_FUNCTIONS must list explicit function ids; "*" is not allowed.');
  }
  return new Set(raw);
}

export function isNativeOwned(fnId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return nativeFunctionIds(env).has(fnId);
}

/**
 * Single source of truth for "who runs this function": every id is either
 * served by Inngest or owned by the native worker, never both and never
 * neither. `/api/inngest` registers `inngest`; the worker runs `native`.
 * Unknown ids in JOBS_NATIVE_FUNCTIONS are reported (not silently ignored) so
 * a typo cannot leave a function with no owner.
 */
export function partitionOwnership(
  allIds: string[],
  env: NodeJS.ProcessEnv = process.env
): { inngest: string[]; native: string[]; unknown: string[] } {
  const owned = nativeFunctionIds(env);
  const known = new Set(allIds);
  return {
    inngest: allIds.filter((id) => !owned.has(id)),
    native: allIds.filter((id) => owned.has(id)),
    unknown: [...owned].filter((id) => !known.has(id)),
  };
}

const int = (v: string | undefined, d: number, min: number, max: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : d;
};

export interface WorkerTuning {
  /** Collection name prefix (tests use an isolated prefix). */
  prefix: string;
  /** Max jobs executing at once in this process. */
  concurrency: number;
  /** How long a claim is valid without a heartbeat. */
  leaseMs: number;
  /** Heartbeat period (always <= leaseMs / 3). */
  heartbeatMs: number;
  /** Idle poll period. */
  pollMs: number;
  /** How long graceful shutdown waits for in-flight jobs before leaving them to lease recovery. */
  shutdownGraceMs: number;
  /** A missed cron slot older than this is skipped, not run late. */
  cronCatchupMs: number;
  /** Cron leader lock TTL. */
  leaderTtlMs: number;
  /** Largest tolerated DB-vs-local clock offset before the worker refuses to lead crons. */
  maxClockSkewMs: number;
}

export function workerTuning(env: NodeJS.ProcessEnv = process.env): WorkerTuning {
  const leaseMs = int(env.JOBS_LEASE_MS, 60_000, 5_000, 30 * 60_000);
  return {
    prefix: env.JOBS_COLLECTION_PREFIX || 'native_',
    concurrency: int(env.JOBS_CONCURRENCY, 3, 1, 20),
    leaseMs,
    heartbeatMs: Math.min(int(env.JOBS_HEARTBEAT_MS, 15_000, 1_000, 5 * 60_000), Math.floor(leaseMs / 3)),
    pollMs: int(env.JOBS_POLL_MS, 2_000, 250, 60_000),
    shutdownGraceMs: int(env.JOBS_SHUTDOWN_GRACE_MS, 25_000, 1_000, 10 * 60_000),
    cronCatchupMs: int(env.JOBS_CRON_CATCHUP_MS, 60 * 60_000, 0, 7 * 24 * 3_600_000),
    leaderTtlMs: int(env.JOBS_LEADER_TTL_MS, 30_000, 5_000, 5 * 60_000),
    maxClockSkewMs: int(env.JOBS_MAX_CLOCK_SKEW_MS, 30_000, 1_000, 10 * 60_000),
  };
}
