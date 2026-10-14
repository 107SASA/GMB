/**
 * Event routing core (no `@/` aliases, no env reads — pure over its inputs so
 * it is staging-testable): decides, for each event, which natively-owned
 * functions get a job, which jobs get cancelled (Inngest `cancelOn`), and
 * whether Inngest must still receive the event for functions it owns.
 *
 * Single-owner invariant: a function id is either in `owned` (native queue,
 * and deregistered from /api/inngest) or not (Inngest). Routing never sends
 * a function's trigger to both.
 */
import { randomUUID } from 'crypto';
import type { JobStore } from './store';
import type { NativeEvent, NativeFunction } from './types';

export interface RoutingContext {
  store: JobStore;
  functions: NativeFunction[];
  owned: Set<string>;
}

export interface RouteResult {
  ids: string[];
  /** Events that still need delivery to Inngest (it owns ≥1 listener, or nobody is known to listen). */
  forInngest: NativeEvent[];
  enqueued: number;
  duplicates: number;
  cancelled: number;
}

const getPath = (obj: any, path: string) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

export async function routeEvents(events: NativeEvent[], ctx: RoutingContext): Promise<RouteResult> {
  const res: RouteResult = { ids: [], forInngest: [], enqueued: 0, duplicates: 0, cancelled: 0 };
  const ownedFns = ctx.functions.filter((f) => ctx.owned.has(f.id));
  const otherFns = ctx.functions.filter((f) => !ctx.owned.has(f.id));

  for (const ev of events) {
    const eventId = ev.id ?? randomUUID();
    const withId: NativeEvent = { ...ev, id: eventId };
    res.ids.push(eventId);
    const data = ev.data ?? {};

    // 1) cancelOn — BEFORE enqueue, excluding the job this very event spawns.
    for (const fn of ownedFns) {
      for (const c of fn.cancelOn) {
        if (c.event !== ev.name) continue;
        const value = getPath({ data }, `data.${c.field}`);
        if (value === undefined) continue;
        res.cancelled += await ctx.store.cancelWhere({
          fnId: fn.id,
          field: c.field,
          value,
          exceptEventId: eventId,
          reason: `cancelOn:${ev.name}`,
        });
      }
    }

    // 2) fan-out to owned listeners.
    for (const fn of ownedFns) {
      if (!fn.events.includes(ev.name)) continue;
      const concurrencyKey = fn.concurrencyKeyPath
        ? String(getPath({ event: { data } }, fn.concurrencyKeyPath) ?? '')
        : null;
      const { created } = await ctx.store.enqueue({
        fnId: fn.id,
        eventName: ev.name,
        key: eventId,
        eventId,
        data,
        ts: ev.ts ? new Date(ev.ts) : undefined,
        maxAttempts: fn.maxAttempts,
        concurrencyKey: concurrencyKey || null,
      });
      if (created) res.enqueued++;
      else res.duplicates++;
    }

    // 3) does Inngest still need it?
    const inngestListens = otherFns.some(
      (f) => f.events.includes(ev.name) || f.cancelOn.some((c) => c.event === ev.name)
    );
    const anyListener = ctx.functions.some((f) => f.events.includes(ev.name));
    if (inngestListens || !anyListener) res.forInngest.push(withId);
  }
  return res;
}
