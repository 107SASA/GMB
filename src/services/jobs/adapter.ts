/**
 * Adapts an Inngest function object into a NativeFunction WITHOUT copying or
 * rewriting its business logic: the original handler is reused verbatim and
 * is simply handed the native `step` shim instead of Inngest's.
 *
 * Alias-free and side-effect-free so it can be unit-tested with fake objects.
 * Anything the adapter cannot honour is recorded in `unsupported`; the
 * worker/route refuse to natively own such a function (fail closed) rather
 * than silently running it with different semantics.
 */
import type { NativeFunction } from './types';

/** Inngest's default when `retries` is not set. */
export const INNGEST_DEFAULT_RETRIES = 4;

const CANCEL_IF = /^\s*async\.data\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\s*==\s*event\.data\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\s*$/;
const KEY_EXPR = /^\s*event\.data\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\s*$/;

export function isInngestFunction(v: any): boolean {
  return !!v && typeof v === 'object' && typeof v.opts === 'object' && v.opts && typeof v.opts.id === 'string' && typeof v.fn === 'function';
}

export function toNativeFunction(fn: any): NativeFunction {
  const opts = fn.opts;
  const unsupported: string[] = [];
  const events: string[] = [];
  const crons: string[] = [];

  for (const t of opts.triggers ?? []) {
    if (typeof t?.event === 'string') {
      if (t.if) unsupported.push(`trigger.if on ${t.event}`);
      events.push(t.event);
    } else if (typeof t?.cron === 'string') crons.push(t.cron);
    else unsupported.push(`trigger ${JSON.stringify(t)}`);
  }

  let concurrencyKeyPath: string | undefined;
  let concurrencyLimit: number | undefined;
  const conc = opts.concurrency;
  const entries = conc == null ? [] : Array.isArray(conc) ? conc : typeof conc === 'number' ? [{ limit: conc }] : [conc];
  for (const c of entries) {
    if (c.key) {
      const m = KEY_EXPR.exec(String(c.key));
      if (!m) unsupported.push(`concurrency.key ${c.key}`);
      else if (c.limit !== 1) unsupported.push(`keyed concurrency limit ${c.limit} (only 1 is DB-enforced)`);
      else concurrencyKeyPath = `event.data.${m[1]}`;
      if (c.scope && c.scope !== 'fn') unsupported.push(`concurrency.scope ${c.scope}`);
    } else if (typeof c.limit === 'number') {
      concurrencyLimit = c.limit;
    }
  }

  const cancelOn: Array<{ event: string; field: string }> = [];
  for (const c of opts.cancelOn ?? []) {
    const m = c.if ? CANCEL_IF.exec(String(c.if)) : null;
    if (!m || m[1] !== m[2]) unsupported.push(`cancelOn ${JSON.stringify(c)}`);
    else cancelOn.push({ event: c.event, field: m[1] });
  }

  for (const k of ['throttle', 'rateLimit', 'debounce', 'batchEvents', 'singleton', 'priority', 'idempotency', 'timeouts', 'onFailure']) {
    if (opts[k] != null) unsupported.push(`opts.${k}`);
  }

  return {
    id: opts.id,
    handler: (ctx) => fn.fn(ctx),
    maxAttempts: (typeof opts.retries === 'number' ? opts.retries : INNGEST_DEFAULT_RETRIES) + 1,
    events,
    crons,
    concurrencyKeyPath,
    concurrencyLimit,
    cancelOn,
    unsupported: unsupported.length ? unsupported : undefined,
  };
}

/**
 * WEB-PATH ownership: never throws. Ids that are unknown to the registry, or
 * that use an option the native queue cannot honour, are NOT owned natively —
 * Inngest keeps them — and are reported so the caller can log loudly. A typo in
 * JOBS_NATIVE_FUNCTIONS must never take down /api/inngest or every event send.
 * The worker still uses `assertOwnable` and refuses to start on the same input.
 */
export function resolveWebOwnership(
  functions: Pick<NativeFunction, 'id' | 'unsupported'>[],
  requested: Set<string>
): { owned: Set<string>; rejected: Array<{ id: string; reason: string }> } {
  const byId = new Map(functions.map((f) => [f.id, f]));
  const owned = new Set<string>();
  const rejected: Array<{ id: string; reason: string }> = [];
  for (const id of requested) {
    const f = byId.get(id);
    if (!f) rejected.push({ id, reason: 'unknown function id' });
    else if (f.unsupported?.length) rejected.push({ id, reason: `unsupported options: ${f.unsupported.join('; ')}` });
    else owned.add(id);
  }
  return { owned, rejected };
}

/**
 * The single rule for what the WEB app serves to Inngest. `/api/inngest` (deregistration),
 * `/api/inngest/ownership` (what the worker guard sees) and `dispatch.getRouter` (event
 * routing) all go through `resolveWebOwnership`, so the three can never disagree.
 *
 * A function is removed from the Inngest-served list ONLY when it is natively owned
 * under the same rules the router uses: known id AND no unsupported options. Anything
 * else (typo, `*`, unsupported option, or a function the adapter cannot even inspect)
 * stays with Inngest, because a function with no valid executor must never be
 * deregistered. Never throws.
 */
export function selectServedFunctions<T>(
  all: T[],
  requested: Set<string>
): { served: T[]; owned: Set<string>; rejected: Array<{ id: string; reason: string }> } {
  const views: Array<NativeFunction | null> = all.map((f) => {
    try {
      return isInngestFunction(f) ? toNativeFunction(f) : null;
    } catch {
      return null; // cannot be inspected => cannot be owned natively
    }
  });
  const { owned, rejected } = resolveWebOwnership(
    views.filter((v): v is NativeFunction => v !== null),
    requested
  );
  const served = all.filter((_, i) => !(views[i] && owned.has(views[i]!.id)));
  return { served, owned, rejected };
}

/** Payload for GET /api/inngest/ownership, built with the same rules (see selectServedFunctions). */
export function buildOwnershipPayload(
  registry: Array<Pick<NativeFunction, 'id' | 'unsupported'>>,
  requested: Set<string>,
  opts: { leadEngineV2: boolean }
): { version: 1; known: string[]; served: string[]; native: string[]; rejected: string[] } {
  const known = registry.map((f) => f.id);
  const { owned, rejected } = resolveWebOwnership(registry, requested);
  const served = known.filter(
    (id) => !owned.has(id) && (opts.leadEngineV2 || id !== 'proactive-nba-scheduler')
  );
  return { version: 1, known, served, native: known.filter((id) => owned.has(id)), rejected: rejected.map((r) => r.id) };
}

/** Throws if any natively-owned function uses an option the native queue cannot honour. */
export function assertOwnable(functions: NativeFunction[], owned: Set<string>): void {
  const known = new Set(functions.map((f) => f.id));
  for (const id of owned) {
    if (!known.has(id)) throw new Error(`JOBS_NATIVE_FUNCTIONS names unknown function id: ${id}`);
  }
  for (const f of functions) {
    if (owned.has(f.id) && f.unsupported?.length) {
      throw new Error(`Function ${f.id} cannot be natively owned: ${f.unsupported.join('; ')}`);
    }
  }
}
