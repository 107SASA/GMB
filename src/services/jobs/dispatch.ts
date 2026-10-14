/**
 * App-side glue for the native queue (uses `@/` aliases, env and the shared
 * Mongoose connection). Everything here is inert unless JOBS_NATIVE_ENABLED
 * is true AND JOBS_NATIVE_FUNCTIONS is non-empty — callers check
 * `nativeRoutingActive()` first and fall through to stock Inngest otherwise.
 */
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { isNativeEnabled, nativeFunctionIds, workerTuning } from './config';
import { isInngestFunction, resolveWebOwnership, toNativeFunction } from './adapter';
import { routeEvents, type RoutingContext } from './routing';
import { JobStore } from './store';
import type { NativeEvent, NativeFunction } from './types';

export function nativeRoutingActive(): boolean {
  return isNativeEnabled() && nativeFunctionIds().size > 0;
}

/** Every exported Inngest function, adapted. Imports functions.ts lazily (it imports client.ts). */
export async function loadRegistry(): Promise<NativeFunction[]> {
  const mod: any = await import('@/services/inngest/functions');
  return Object.values(mod).filter(isInngestFunction).map(toNativeFunction);
}

let routerPromise: Promise<RoutingContext> | null = null;

export function getRouter(): Promise<RoutingContext> {
  if (!routerPromise) {
    routerPromise = (async () => {
      await dbConnect();
      const store = new JobStore(mongoose.connection.db as any, workerTuning().prefix);
      await store.ensureIndexes();
      const functions = await loadRegistry();
      // Never throw here: a bad id must not fail every event send. Rejected ids stay with Inngest.
      const { owned, rejected } = resolveWebOwnership(functions, nativeFunctionIds());
      for (const r of rejected) {
        console.error(`[jobs] JOBS_NATIVE_FUNCTIONS id "${r.id}" ignored on the web path (${r.reason}); Inngest keeps it. The native worker will refuse to start until this is fixed.`);
      }
      return { store, functions, owned };
    })().catch((err) => {
      routerPromise = null;
      throw err;
    });
  }
  return routerPromise;
}

/**
 * Replacement for `inngest.send` while native routing is active: owned
 * functions get native jobs (+ cancelOn), the rest still go to Inngest.
 */
export async function routeSend(
  payload: NativeEvent | NativeEvent[],
  originalSend: (p: any) => Promise<any>
): Promise<{ ids: string[] }> {
  const events = Array.isArray(payload) ? payload : [payload];
  const router = await getRouter();
  const r = await routeEvents(events, router);
  if (r.forInngest.length) {
    await originalSend(Array.isArray(payload) ? r.forInngest : r.forInngest[0]);
  }
  return { ids: r.ids };
}

const PATCHED = Symbol.for('growwmatics.nativeStepSendPatched');

/**
 * Inngest-owned functions that emit events with `step.sendEvent` bypass the
 * patched `inngest.send`. When such an event targets a natively-owned
 * function it would be dropped (that function is deregistered from Inngest).
 * This wraps each still-Inngest function's handler so those events are
 * routed natively inside a memoised `step.run`, and everything else is
 * forwarded to the untouched Inngest `step.sendEvent`.
 */
export function patchInngestStepSend(fns: any[]): void {
  for (const f of fns) {
    if (!isInngestFunction(f) || f[PATCHED]) continue;
    const orig = f.fn;
    f.fn = async (ctx: any) => {
      const step = Object.create(ctx.step);
      step.sendEvent = async (id: string, payload: any) => {
        const events: NativeEvent[] = Array.isArray(payload) ? payload : [payload];
        const router = await getRouter();
        const touchesNative = events.some((e) =>
          router.functions.some(
            (fn) => router.owned.has(fn.id) && (fn.events.includes(e.name) || fn.cancelOn.some((c) => c.event === e.name))
          )
        );
        if (!touchesNative) return ctx.step.sendEvent(id, payload);
        const r = await ctx.step.run(`${id}:native-route`, () => routeEvents(events, router));
        if (r.forInngest.length) await ctx.step.sendEvent(id, r.forInngest);
        return { ids: r.ids };
      };
      return orig({ ...ctx, step });
    };
    f[PATCHED] = true;
  }
}
