/**
 * Worker-side ownership guard.
 *
 * The native worker must never run a function that Inngest can still run.
 * Env flags alone can't prove that: the web process might not have been
 * restarted with the same JOBS_NATIVE_FUNCTIONS. This module asks the running
 * web app (GET /api/inngest/ownership) which function ids it currently
 * serves to Inngest, and FAILS CLOSED:
 *
 *   - endpoint unreachable / non-200 / invalid JSON / wrong shape  → not ok
 *   - any owned id still served by web                             → not ok
 *   - any owned id unknown to the web registry (typo / version skew) → not ok
 *   - web's own view of ownership differs from the worker's        → not ok
 *
 * What this does NOT prove (see docs/worker-operations.md): that Inngest
 * Cloud has re-synced. The web process can serve a function list locally
 * while Inngest still holds the old registration and cron schedule until
 * `PUT /api/inngest` completes. The Inngest dashboard check stays mandatory.
 *
 * Pure except for the injected `fetchImpl`; no DB, no aliases.
 */

export interface OwnershipPayload {
  version: 1;
  /** Every function id the web app knows about (registry). */
  known: string[];
  /** Ids web currently serves to Inngest (`known` minus natively owned, minus flag-gated). */
  served: string[];
  /** Ids web believes the native worker owns. */
  native: string[];
}

export type OwnershipVerdict =
  | { ok: true; served: number; native: number }
  | { ok: false; reason: string; conflicting?: string[] };

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

export function evaluateOwnership(payload: unknown, owned: Set<string>): OwnershipVerdict {
  if (owned.size === 0) return { ok: false, reason: 'worker owns no functions' };
  const p = payload as Partial<OwnershipPayload> | null;
  if (!p || typeof p !== 'object' || p.version !== 1 || !isStringArray(p.known) || !isStringArray(p.served) || !isStringArray(p.native)) {
    return { ok: false, reason: 'invalid ownership response shape' };
  }
  const known = new Set(p.known);
  const served = new Set(p.served);
  const native = new Set(p.native);

  const unknown = [...owned].filter((id) => !known.has(id));
  if (unknown.length) return { ok: false, reason: 'owned ids unknown to web registry (version skew or typo)', conflicting: unknown };

  const conflicting = [...owned].filter((id) => served.has(id));
  if (conflicting.length) return { ok: false, reason: 'web still serves owned ids to Inngest', conflicting };

  // Ambiguity: the web process must agree it released exactly these ids.
  const notReleased = [...owned].filter((id) => !native.has(id));
  if (notReleased.length) return { ok: false, reason: 'web has not loaded the same JOBS_NATIVE_FUNCTIONS (restart web with --update-env)', conflicting: notReleased };

  return { ok: true, served: served.size, native: native.size };
}

export interface GuardOptions {
  url: string;
  token: string;
  owned: Set<string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type PayloadResult = { ok: true; payload: unknown } | { ok: false; reason: string };

/** Fetches the raw ownership payload; any transport/shape problem is a failure (never a guess). */
export async function fetchOwnershipPayload(o: Pick<GuardOptions, 'url' | 'token' | 'fetchImpl' | 'timeoutMs'>): Promise<PayloadResult> {
  const f = o.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? 5_000);
  try {
    const res = await f(o.url, { headers: { authorization: `Bearer ${o.token}`, accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) return { ok: false, reason: `ownership endpoint returned HTTP ${res.status}` };
    try {
      return { ok: true, payload: await res.json() };
    } catch {
      return { ok: false, reason: 'ownership endpoint returned invalid JSON' };
    }
  } catch (e: any) {
    return { ok: false, reason: `ownership endpoint unreachable: ${e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 120)}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkWebOwnership(o: GuardOptions): Promise<OwnershipVerdict> {
  const r = await fetchOwnershipPayload(o);
  if (!r.ok) return { ok: false, reason: r.reason };
  return evaluateOwnership(r.payload, o.owned);
}

/** Ids the web app reports as released to the native worker, or null when the payload is unusable. */
export function releasedByWeb(payload: unknown): Set<string> | null {
  const p = payload as Partial<OwnershipPayload> | null;
  if (!p || typeof p !== 'object' || p.version !== 1 || !isStringArray(p.native)) return null;
  return new Set(p.native);
}

export interface GuardConfig {
  enabled: boolean;
  url: string;
  token: string;
}

export const DEFAULT_OWNERSHIP_URL = 'http://127.0.0.1:3000/api/inngest/ownership';

/**
 * JOBS_OWNERSHIP_GUARD=off only works outside production — in production the
 * guard cannot be disabled, only satisfied.
 */
export function guardConfig(env: NodeJS.ProcessEnv = process.env): GuardConfig {
  const off = env.JOBS_OWNERSHIP_GUARD === 'off' && env.NODE_ENV !== 'production';
  return {
    enabled: !off,
    url: env.JOBS_OWNERSHIP_URL || DEFAULT_OWNERSHIP_URL,
    token: env.JOBS_GUARD_TOKEN || '',
  };
}

/** Startup gate: retries a few times (web may be mid-restart), then reports the final verdict. */
export async function waitForOwnership(
  o: GuardOptions & { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> }
): Promise<OwnershipVerdict> {
  const attempts = Math.max(1, o.attempts ?? 6);
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: OwnershipVerdict = { ok: false, reason: 'not checked' };
  for (let i = 0; i < attempts; i++) {
    last = await checkWebOwnership(o);
    if (last.ok) return last;
    if (i < attempts - 1) await sleep(o.delayMs ?? 5_000);
  }
  return last;
}
