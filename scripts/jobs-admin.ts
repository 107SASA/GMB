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
 *
 * Operates on the database in MONGODB_URI (.env.local / .env). Prints ids,
 * statuses and truncated errors only — never event payloads.
 */
import fs from 'fs';
import path from 'path';

for (const file of ['.env.local', '.env']) {
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
import { workerTuning } from '../src/services/jobs/config';

async function main() {
  const [cmd, a1, a2] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
  const flags = new Set(process.argv.slice(2).filter((x) => x.startsWith('--')));
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');
  await mongoose.connect(uri, { family: 4, serverSelectionTimeoutMS: 10000 } as any);
  const store = new JobStore(mongoose.connection.db as any, workerTuning().prefix);
  const mutating = cmd === 'retry' || cmd === 'cancel';
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
    default:
      console.log('commands: stats | workers | list <status> [fnId] | show <id> | retry <id> [--reset-steps] --yes | cancel <id> --yes');
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
