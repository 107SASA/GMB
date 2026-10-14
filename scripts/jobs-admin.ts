/**
 * Native job queue admin CLI. Read-only unless a state-changing command is
 * given WITH `--yes` AND the database name is typed back (`--confirm-db <name>`,
 * or interactively on a TTY). Every command prints the selected database first.
 *
 *   npx tsx scripts/jobs-admin.ts stats
 *   npx tsx scripts/jobs-admin.ts list dead [fnId]
 *   npx tsx scripts/jobs-admin.ts show <jobId>
 *   npx tsx scripts/jobs-admin.ts workers
 *   npx tsx scripts/jobs-admin.ts status                        (pause state + workers)
 *   npx tsx scripts/jobs-admin.ts pause [reason...] [--wait] [--timeout-sec=120] --yes --confirm-db <db>
 *   npx tsx scripts/jobs-admin.ts resume --yes --confirm-db <db>
 *   npx tsx scripts/jobs-admin.ts retry <jobId> [--reset-steps] --yes --confirm-db <db>
 *   npx tsx scripts/jobs-admin.ts cancel <jobId> --yes --confirm-db <db>
 *   npx tsx scripts/jobs-admin.ts replay-to-inngest [fnId...]                    (DRY RUN, default)
 *   npx tsx scripts/jobs-admin.ts replay-to-inngest [fnId...] --execute --yes --confirm-db <db>
 *        [--allow-outside-dedupe-window] [--skip-ownership-check]
 *
 * Operates on the database in MONGODB_URI (.env.production when
 * NODE_ENV=production, else .env.local / .env). Prints ids, statuses and
 * truncated errors only — never event payloads or credentials.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';

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
import { DbClock } from '../src/services/jobs/clock';
import { isNativeEnabled, nativeFunctionIds, workerTuning } from '../src/services/jobs/config';
import { executeReplay, liveWorkers, planReplay } from '../src/services/jobs/replay';
import { waitForPauseAck } from '../src/services/jobs/pauseWait';
import { confirmDatabase, evaluateAdminTarget, parseMongoTarget } from '../src/services/jobs/adminTarget';
import { DEFAULT_OWNERSHIP_URL, fetchOwnershipPayload, releasedByWeb } from '../src/services/jobs/ownershipGuard';

const VALUE_FLAGS = new Set(['--confirm-db', '--timeout-sec']);

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 0) { values.set(a.slice(0, eq), a.slice(eq + 1)); flags.add(a.slice(0, eq)); continue; }
    flags.add(a);
    if (VALUE_FLAGS.has(a) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) values.set(a, argv[++i]);
  }
  return { positional, flags, values };
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

async function main() {
  const { positional, flags, values } = parseArgs(process.argv.slice(2));
  const [cmd, a1, a2] = positional;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');

  // ---- target safety: show it, refuse ambiguity, never connect blind -------------------------
  const target = parseMongoTarget(uri);
  const verdict = evaluateAdminTarget(target);
  console.error(`[jobs-admin] database: ${target.dbName ?? '(none)'}   hosts: ${target.hosts.join(', ') || '(unparsed)'}   NODE_ENV=${process.env.NODE_ENV || '(unset)'}`);
  for (const w of verdict.warnings) console.error(`[jobs-admin] WARNING: ${w}`);
  if (!verdict.ok) throw new Error(`refusing to run against an ambiguous/unintended database: ${verdict.problems.join('; ')}`);

  const mutating =
    cmd === 'retry' || cmd === 'cancel' || cmd === 'pause' || cmd === 'resume' || (cmd === 'replay-to-inngest' && flags.has('--execute'));
  if (mutating) {
    if (!flags.has('--yes')) throw new Error(`'${cmd}' changes data — re-run with --yes`);
    const ok = await confirmDatabase({
      expected: target.dbName as string,
      flag: values.get('--confirm-db'),
      prompt: process.stdin.isTTY ? prompt : undefined,
    });
    if (!ok) {
      throw new Error(
        `typed database confirmation missing or wrong. Re-run with --confirm-db ${target.dbName} (or answer the prompt on a terminal).`
      );
    }
  }

  await mongoose.connect(uri, { family: 4, serverSelectionTimeoutMS: 10000 } as any);
  const db = mongoose.connection.db as any;
  const dbClock = new DbClock(db);
  await dbClock.sync().catch(() => undefined);
  const store = new JobStore(db, workerTuning().prefix, dbClock.now);

  switch (cmd) {
    case 'stats':
      console.log(JSON.stringify(await store.stats(), null, 2));
      break;
    case 'workers':
      console.log(
        JSON.stringify(
          await store.workers.find({}).project({ counters: 1, status: 1, paused: 1, claimBlockedReason: 1, seenAt: 1, inFlight: 1, leader: 1, host: 1, pid: 1 }).toArray(),
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
        .project({ fnId: 1, status: 1, attempts: 1, maxAttempts: 1, runAt: 1, lastError: 1, deadAt: 1, eventName: 1, cancelledReason: 1 })
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
      console.log(JSON.stringify({ database: target.dbName, control, workers, stats: await store.stats() }, null, 2));
      break;
    }
    case 'pause':
    case 'resume': {
      const by = `admin-cli:${process.env.USER || process.env.USERNAME || 'unknown'}`;
      const reason = positional.slice(1).join(' ');
      const since = store.now();
      const r = await store.setPaused(cmd === 'pause', by, reason);
      console.log(JSON.stringify({ paused: cmd === 'pause', changed: r.changed, note: r.changed ? undefined : 'already in that state (no-op)' }));
      if (cmd === 'pause') {
        if (!flags.has('--wait')) {
          console.log('Pause RECORDED, not yet acknowledged. A worker may still take a claim already in progress. Re-run with --wait, or watch `status`: every worker must show paused:true and inFlight:0.');
          break;
        }
        const timeoutMs = Math.max(5, Number(values.get('--timeout-sec') || 120)) * 1000;
        console.error(`[jobs-admin] waiting up to ${timeoutMs / 1000}s for every live worker to report paused:true and inFlight:0 ...`);
        // A pause recorded earlier is acknowledged by heartbeats written after "since" of THIS call too:
        // workers re-beat on every state change and every 10 s.
        const ack = await waitForPauseAck(store, { since, timeoutMs, pollMs: 1000 });
        console.log(JSON.stringify({ acknowledged: ack.acked, timedOut: ack.timedOut, liveWorkers: ack.liveWorkers, noLiveWorkers: ack.noLiveWorkers, waitingOn: ack.waitingOn }, null, 2));
        if (!ack.acked) process.exitCode = 3;
      }
      break;
    }
    case 'replay-to-inngest': {
      const fnIds = positional.slice(1);
      const execute = flags.has('--execute');
      const tuning = workerTuning();
      const nativeOwned = isNativeEnabled() ? nativeFunctionIds() : new Set<string>();

      // Ask the running web app which ids it still releases to the native worker. Replaying a
      // function the web app still routes natively would put new events and replays in two places.
      let webReleased: Set<string> | null = null;
      let ownershipNote = '';
      const token = process.env.JOBS_GUARD_TOKEN || '';
      if (!token) {
        ownershipNote = 'JOBS_GUARD_TOKEN not set; cannot ask the web app which ids it releases';
      } else {
        const url = process.env.JOBS_OWNERSHIP_URL || DEFAULT_OWNERSHIP_URL;
        const got = await fetchOwnershipPayload({ url, token });
        if (!got.ok) ownershipNote = got.reason;
        else {
          webReleased = releasedByWeb(got.payload);
          if (!webReleased) ownershipNote = 'ownership endpoint returned an unusable payload';
        }
      }
      const skipOwnership = flags.has('--skip-ownership-check');
      const plan = await planReplay(store, {
        fnIds,
        nativeOwned,
        webReleased: webReleased ?? undefined,
        allowOutsideDedupeWindow: flags.has('--allow-outside-dedupe-window'),
      });
      const live = await liveWorkers(store, Math.max(2 * tuning.leaseMs, 30_000));
      console.log(JSON.stringify({
        mode: execute ? 'EXECUTE' : 'DRY-RUN',
        database: target.dbName,
        eligible: plan.eligible.length,
        interruptedPreviously: plan.eligible.filter((c) => c.interrupted).length,
        skipped: plan.skipped.length,
        byFunction: plan.byFunction,
        liveWorkers: live,
        nativeStillOwnedHere: [...nativeOwned],
        webStillReleases: webReleased ? [...webReleased] : null,
        ownershipCheck: webReleased ? 'ok' : `UNAVAILABLE: ${ownershipNote}`,
      }, null, 2));
      if (!execute) { console.log('Dry run only. To execute: stop the worker, clear the ids from JOBS_NATIVE_FUNCTIONS, restart web, then re-run with --execute --yes --confirm-db <db>.'); break; }
      if (live.length) throw new Error('refusing to replay: a native worker is still alive (stop it and wait for status "stopped")');
      if (!webReleased && !skipOwnership) {
        throw new Error(`refusing to replay: cannot verify the web app has released these functions (${ownershipNote}). Fix that, or pass --skip-ownership-check after confirming by hand.`);
      }
      const key = process.env.INNGEST_EVENT_KEY;
      if (!key || key === 'local') throw new Error('INNGEST_EVENT_KEY is not set to a real key; refusing to replay');
      // Bare client on purpose: the app's wrapped client would route owned events back into the native queue.
      const { Inngest } = await import('inngest');
      const client = new Inngest({ id: 'gmb-optimization-platform', eventKey: key });
      const out = await executeReplay(store, plan, async (ev) => {
        await (client as any).send({ id: ev.id, name: ev.name, data: ev.data, ts: ev.ts });
      });
      console.log(JSON.stringify(out, null, 2));
      if (out.failed || out.lostClaim) process.exitCode = 2;
      break;
    }
    default:
      console.log('commands: status | pause [reason] [--wait] | resume | replay-to-inngest [fnId...] [--execute] | stats | workers | list <status> [fnId] | show <id> | retry <id> [--reset-steps] | cancel <id>   (state-changing: --yes --confirm-db <db>)');
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
