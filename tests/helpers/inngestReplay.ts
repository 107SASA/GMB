/**
 * Drives a REAL Inngest function through the SDK's own execution engine
 * (InngestFunction.createExecution → engine.start), the same code path the
 * `serve()` handler runs in production. This test plays the Inngest server's
 * part:
 *
 *  - Each call re-executes the handler FROM THE TOP with the step state
 *    memoized so far (JSON round-tripped, as Inngest stores it), so code
 *    outside step.run re-runs and every completed step returns its stored
 *    result — exactly what happens after a durable sleep wakes up.
 *  - A step.run found by the engine is executed by the engine ('step-ran');
 *    a planned step is requested by id; a sleep ('Sleep' op) completes only
 *    after `onSleep` (the test's "time passes") has run.
 *
 * Nothing is sent to Inngest: async step mode, no internal function id, so
 * the engine never checkpoints.
 */

export interface ReplayResult {
  result: unknown;
  /** Ops in completion order: 'run:<step id>' / 'sleep:<step id>'. */
  timeline: string[];
  /** How many times the handler body was (re)entered. */
  invocations: number;
}

const clone = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

export async function runDurably(
  fn: any,
  event: { name?: string; id?: string; data: Record<string, unknown> },
  opts: { onSleep?: (stepId: string, op: any) => unknown | Promise<unknown>; maxInvocations?: number } = {}
): Promise<ReplayResult> {
  const stepState: Record<string, { id: string; data?: unknown; error?: unknown }> = {};
  const order: string[] = [];
  const timeline: string[] = [];
  // The engine validates the event against the function's triggers, as in production.
  const trigger = (fn.opts?.triggers || []).find((t: any) => t.event || t.cron);
  const name = event.name || trigger?.event || 'inngest/scheduled.timer';
  const evt = { name, id: event.id || 'evt-test', ts: Date.now(), data: event.data };
  const max = opts.maxInvocations ?? 200;
  let requested: string | undefined;

  for (let invocations = 1; invocations <= max; invocations++) {
    const execution = fn.createExecution({
      partialOptions: {
        client: fn.client,
        fn,
        runId: 'run-test',
        data: { event: evt, events: [evt], runId: 'run-test', attempt: 0 },
        reqArgs: [],
        headers: {},
        stepState: JSON.parse(JSON.stringify(stepState)),
        stepCompletionOrder: [...order],
        stepMode: 'async',
        requestedRunStep: requested,
      },
    });
    requested = undefined;
    const res: any = await execution.start();
    const label = (op: any) => op.displayName || op.name || op.id;

    if (res.type === 'function-resolved') return { result: res.data, timeline, invocations };
    if (res.type === 'function-rejected') throw res.error instanceof Error ? res.error : new Error(JSON.stringify(res.error));
    if (res.type === 'step-ran') {
      const op = res.step;
      if (op.error && res.retriable !== false) throw new Error(`step ${label(op)} failed: ${JSON.stringify(op.error)}`);
      stepState[op.id] = { id: op.id, ...(op.error ? { error: op.error } : { data: clone(op.data) }) };
      order.push(op.id);
      timeline.push(`run:${label(op)}`);
      continue;
    }
    if (res.type === 'steps-found') {
      const op = res.steps[0];
      if (op.op === 'Sleep') {
        await opts.onSleep?.(label(op), op);
        stepState[op.id] = { id: op.id, data: null };
        order.push(op.id);
        timeline.push(`sleep:${label(op)}`);
      } else {
        requested = op.id; // a planned step.run — ask the engine to execute it
      }
      continue;
    }
    throw new Error(`unexpected execution result: ${res.type}`);
  }
  throw new Error(`function did not finish within ${max} invocations`);
}
