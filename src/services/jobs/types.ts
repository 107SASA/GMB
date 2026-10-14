/** Shared types for the native job queue. No imports with side effects. */

export interface NativeEvent {
  id?: string;
  name: string;
  data?: Record<string, any>;
  ts?: number;
}

/** A function the native worker can run — built from an Inngest function (registry.ts) or a test fixture. */
export interface NativeFunction {
  id: string;
  handler: (ctx: HandlerContext) => Promise<unknown>;
  /** Total attempts per step budget = retries + 1 (Inngest default retries is 4 when unspecified). */
  maxAttempts: number;
  events: string[];
  crons: string[];
  /** e.g. 'event.data.businessId' — at most one RUNNING job per distinct value (DB-enforced). */
  concurrencyKeyPath?: string;
  /** Global per-process cap for this function (in addition to the worker-wide cap). */
  concurrencyLimit?: number;
  /** Mirrors Inngest `cancelOn` for the supported `async.data.X == event.data.X` form. */
  cancelOn: Array<{ event: string; field: string }>;
  /** Inngest options this adapter cannot honour. A function with any entry here must NOT be natively owned. */
  unsupported?: string[];
}

export interface StepTools {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<T>;
  sleep(id: string, duration: string | number): Promise<void>;
  sleepUntil(id: string, until: Date | string | number): Promise<void>;
  sendEvent(id: string, payload: NativeEvent | NativeEvent[]): Promise<{ ids: string[] }>;
}

export interface HandlerContext {
  event: { id: string; name: string; data: Record<string, any>; ts: number };
  events: Array<{ id: string; name: string; data: Record<string, any>; ts: number }>;
  step: StepTools;
  runId: string;
  attempt: number;
  logger: Logger;
}

export type Logger = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>) => void;

/** Throw to skip retries and dead-letter immediately. */
export class NonRetriableError extends Error {
  readonly retriable = false;
  constructor(message: string) {
    super(message);
    this.name = 'NonRetriableError';
  }
}

export const isNonRetriable = (err: any): boolean =>
  !!err && (err.name === 'NonRetriableError' || err.retriable === false);

export const jsonLogger: Logger = (level, msg, fields) => {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
};
