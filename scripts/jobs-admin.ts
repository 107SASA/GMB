/**
 * Native job queue admin CLI. Read-only unless a mutating command is given
 * AND `--yes` is passed.
 *
 *   npx tsx scripts/jobs-admin.ts stats
 *   npx tsx scripts/jobs-admin.ts list dead [fnId]
 *   npx tsx scripts/jobs-admin.ts show <jobId>
 *   npx tsx scripts/jobs-admin.ts workers
 *   npx tsx scripts/jobs-admin.ts retry <jobId> [--reset-steps] --yes
 *   npx tsx scripts/jobs-admin.ts cancel <jobId> --yes
 *   npx tsx scripts/jobs-admin.ts status                      (pause state + workers)
 *   npx tsx scripts/jobs-admin.ts pause [reason...] --yes     (stop NEW claims; in-flight finishes)
 *   npx tsx scripts/jobs-admin.ts resume --yes
 *   npx tsx scripts/jobs-admin.ts replay-to-inngest [fnId...]               (DRY RUN, default)
 *   npx tsx scripts/jobs-admin.ts replay-to-inngest [fnId...] --execute --yes
 *
 * Operates on the database in MONGODB_URI (.env.local / .env). Prints ids,
 * statuses and truncated errors only — never event payloads.
 */
import fs from 'fs';
import path from 'path';

for (const file of process.env.NODE_ENV === 'production' ? ['.env.production'] : ['.env.local', '.env']) {
  const p = path.resolve(file);
  if (!fs.existsSync(p)) continue;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '');
    v = v.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}

import mongoose from 'mongoose';
import { JobStore } from '../src/services/jobs/store';
import { isNativeEnabled, nativeFunctionIds, workerTuning } from '../src/services/jobs/config';
import { executeReplay, liveWorkers, planReplay } from '../src/services/jobs/replay';

async function main() {
  const positional = process.argv.slice(2).filter((x) => !x.startsWith('--'));
  const [cmd, a1, a2] = positional;
  const flags = new Set(process.argv.slice(2).filter((x) => x.startsWith('--')));
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');
  await mongoose.connect(uri, { family: 4, serverSelectionTimeoutMS: 10000 } as any);
  const store = new JobStore(mongoose.connection.db as any, workerTuning().prefix);
  const mutating =
    cmd === 'retry' || cmd === 'cancel' || cmd === 'pause' || cmd === 'resume' || (cmd === 'replay-to-inngest' && flags.has('--execute'));
  if (mutating && !flags.has('--yes')) throw new Error(`'${cmd}' changes data — re-run with --yes`);

  switch (cmd) {
    case 'stats':
      console.log(JSON.stringify(await store.stats(), null, 2));
      break;
    case 'workers':
      console.log(
        JSON.stringify(
          await store.workers.find({}).project({ counters: 1, status: 1, seenAt: 1, inFlight: 1, leader: 1, host: 1, pid: 1 }).toArray(),
          null,
          2
        )
      );
      break;
    case 'list': {
      const filter: any = { status: a1 || 'dead' };
      if (a2) filter.fnId = a2;
      const rows = await store.jobs
        .find(filter)
        .sort({ updatedAt: -1 })
        .limit(50)
        .project({ fnId: 1, status: 1, attempts: 1, maxAttempts: 1, runAt: 1, lastError: 1, deadAt: 1, eventName: 1 })
        .toArray();
      for (const r of rows) console.log(JSON.stringify({ ...r, lastError: String(r.lastError || '').slice(0, 200) }));
      break;
    }
    case 'show': {
      const j: any = await store.jobs.findOne({ _id: new mongoose.mongo.ObjectId(a1) });
      if (!j) throw new Error('not found');
      const { data, steps, ...rest } = j;
      console.log(JSON.stringify({ ...rest, dataKeys: Object.keys(data || {}), steps: (steps || []).map((s: any) => ({ id: s.id, kind: s.kind, wakeAt: s.wakeAt, error: s.error })) }, null, 2));
      break;
    }
    case 'retry':
      console.log(JSON.stringify({ requeued: await store.retryDead(a1, { resetSteps: flags.has('--reset-steps') }) }));
      break;
    case 'cancel':
      console.log(JSON.stringify({ cancelled: await store.cancelById(a1, 'admin-cli') }));
      break;
    case 'status': {
      const control = await store.getControl();
      const workers = await store.workers
        .find({}).project({ status: 1, paused: 1, claimBlockedReason: 1, inFlight: 1, leader: 1, seenAt: 1 }).toArray();
      console.log(JSON.stringify({ control, workers, stats: await store.stats() }, null, 2));
      break;
    }
    case 'pause':
    case 'resume': {
      const by = `admin-cli:${process.env.USER || process.env.USERNAME || 'unknown'}`;
      const reason = positional.slice(1).join(' ');
      const r = await store.setPaused(cmd === 'pause', by, reason);
      console.log(JSON.stringify({ paused: cmd === 'pause', changed: r.changed, note: r.changed ? undefined : 'already in that state (no-op)' }));
      if (cmd === 'pause') console.log('Workers stop claiming within ~JOBS_POLL_MS; in-flight jobs finish (or are released after JOBS_SHUTDOWN_GRACE_MS). Watch: jobs:admin status');
      break;
    }
    case 'replay-to-inngest': {
      const fnIds = positional.slice(1);
      const execute = flags.has('--execute');
      const tuning = workerTuning();
      const nativeOwned = isNativeEnabled() ? nativeFunctionIds() : new Set<string>();
      const plan = await planReplay(store, { fnIds, nativeOwned });
      const live = await liveWorkers(store, Math.max(2 * tuning.leaseMs, 30_000));
      console.log(JSON.stringify({
        mode: execute ? 'EXECUTE' : 'DRY-RUN',
        eligible: plan.eligible.length,
        interruptedPreviously: plan.eligible.filter((c) => c.interrupted).length,
        skipped: plan.skipped.length,
        byFunction: plan.byFunction,
        liveWorkers: live,
        nativeStillOwnedHere: [...nativeOwned],
      }, null, 2));
      if (!execute) { console.log('Dry run only. Re-run with --execute --yes after stopping the worker and clearing JOBS_NATIVE_FUNCTIONS.'); break; }
      if (live.length) throw new Error('refusing to replay: a native worker is still alive (stop it and wait for status "stopped")');
      const key = process.env.INNGEST_EVENT_KEY;
      if (!key || key === 'local') throw new Error('INNGEST_EVENT_KEY is not set to a real key; refusing to replay');
      // Bare client on purpose: the app's wrapped client would route owned events back into the native queue.
      const { Inngest } = await import('inngest');
      const client = new Inngest({ id: 'gmb-optimization-platform', eventKey: key });
      const out = await executeReplay(store, plan, async (ev) => {
        await (client as any).send({ id: ev.id, name: ev.name, data: ev.data, ts: ev.ts });
      });
      console.log(JSON.stringify(out, null, 2));
      if (out.failed) process.exitCode = 2;
      break;
    }
    default:
      console.log('commands: status | pause [reason] --yes | resume --yes | replay-to-inngest [fnId...] [--execute --yes] | stats | workers | list <status> [fnId] | show <id> | retry <id> [--reset-steps] --yes | cancel <id> --yes');
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
