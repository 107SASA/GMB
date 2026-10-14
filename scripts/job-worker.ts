/**
 * Native job worker process (separate from the Next.js app).
 *
 *   NODE_ENV=production node node_modules/tsx/dist/cli.mjs scripts/job-worker.ts
 *   (managed by PM2 via ecosystem.worker.config.cjs — NOT applied to any server yet)
 *
 * Exits 0 immediately (and PM2 does not restart it) unless
 * JOBS_NATIVE_ENABLED=true and JOBS_NATIVE_FUNCTIONS is non-empty, so a
 * stray start can never begin processing.
 *
 * Health: GET http://127.0.0.1:${JOBS_HEALTH_PORT:-3911}/healthz  (loopback only)
 */
import fs from 'fs';
import http from 'http';
import path from 'path';

// Env: same files the Next app uses, without overriding real process env.
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
import { isNativeEnabled, nativeFunctionIds, workerTuning } from '../src/services/jobs/config';
import { jsonLogger } from '../src/services/jobs/types';
import { checkWebOwnership, guardConfig, waitForOwnership } from '../src/services/jobs/ownershipGuard';

async function main() {
  const log = jsonLogger;
  if (!isNativeEnabled() || nativeFunctionIds().size === 0) {
    log('info', 'native job queue disabled (JOBS_NATIVE_ENABLED / JOBS_NATIVE_FUNCTIONS unset) — exiting');
    process.exit(0);
  }

  const { default: dbConnect } = await import('../src/lib/mongodb');
  const { loadRegistry } = await import('../src/services/jobs/dispatch');
  const { assertOwnable } = await import('../src/services/jobs/adapter');
  const { JobStore } = await import('../src/services/jobs/store');
  const { DbClock } = await import('../src/services/jobs/clock');
  const { JobWorker } = await import('../src/services/jobs/worker');
  const { inngest } = await import('../src/services/inngest/client');

  await dbConnect();
  const tuning = workerTuning();
  const db = mongoose.connection.db as any;
  const clock = new DbClock(db);
  const store = new JobStore(db, tuning.prefix, clock.now);

  const functions = await loadRegistry();
  const owned = nativeFunctionIds();
  assertOwnable(functions, owned); // throws (→ exit 1) on unknown ids or unsupported options

  // Ownership guard — fail closed. The worker does not claim a single job until the
  // running web app confirms it has released every owned id. See ownershipGuard.ts.
  const guard = guardConfig();
  let guardBlock: string | null = null;
  if (!guard.enabled) {
    log('warn', 'ownership guard DISABLED (JOBS_OWNERSHIP_GUARD=off, non-production only)');
  } else {
    if (!guard.token) {
      log('error', 'JOBS_GUARD_TOKEN is not set — cannot verify web ownership; refusing to start');
      process.exit(1);
    }
    const verdict = await waitForOwnership({ url: guard.url, token: guard.token, owned });
    if (!verdict.ok) {
      log('error', 'ownership guard failed — refusing to claim jobs', { reason: verdict.reason, conflicting: verdict.conflicting });
      process.exit(1);
    }
    log('info', 'ownership guard passed', { served: verdict.served, native: verdict.native });
    const recheck = setInterval(async () => {
      const v = await checkWebOwnership({ url: guard.url, token: guard.token, owned });
      const next = v.ok ? null : `ownership-guard: ${v.reason}`;
      if (next !== guardBlock) log(next ? 'error' : 'info', next ? 'ownership guard lost — claiming blocked' : 'ownership guard restored', { reason: next });
      guardBlock = next;
    }, 60_000);
    recheck.unref();
  }

  const worker = new JobWorker({
    claimBlock: () => guardBlock,
    store,
    clock,
    functions,
    owned,
    tuning,
    logger: log,
    // step.sendEvent from a native job: client.ts's patched send routes to native/Inngest.
    dispatch: async (events) => ((await (inngest as any).send(events)) as { ids: string[] }).ids,
  });
  await worker.start();

  const port = Number(process.env.JOBS_HEALTH_PORT || 3911);
  const startedAt = Date.now();
  const server = http.createServer(async (req, res) => {
    if (req.url !== '/healthz') {
      res.writeHead(404).end();
      return;
    }
    const dbOk = mongoose.connection.readyState === 1;
    const body = {
      // A paused/blocked worker is healthy (it is doing what it was told); only DB/clock health fails the probe.
      ok: dbOk && clock.isFresh(),
      owner: worker.owner,
      dbConnected: dbOk,
      clockOffsetMs: clock.offsetMs,
      inFlight: worker.inFlight,
      leader: worker.isLeader,
      state: worker.state,
      paused: worker.isPaused,
      claimBlockedReason: worker.claimBlockedReason,
      counters: worker.counters,
      functions: worker.ownedIds.length,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    };
    res.writeHead(body.ok ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  server.listen(port, '127.0.0.1');

  let shuttingDown = false;
  const shutdown = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'shutdown requested', { signal: sig });
    server.close();
    try {
      await worker.stop();
      await mongoose.disconnect();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (e: any) => log('error', 'unhandledRejection', { error: String(e?.stack || e) }));
  process.on('uncaughtException', (e: any) => {
    log('error', 'uncaughtException', { error: String(e?.stack || e) });
    void shutdown('uncaughtException');
  });
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', msg: 'worker failed to start', error: String(err?.message || err) }));
  process.exit(1);
});
