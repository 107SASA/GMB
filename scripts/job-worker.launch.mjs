/**
 * Single-process launcher for the native job worker (used by PM2).
 *
 * Why this exists: launching `node_modules/tsx/dist/cli.mjs scripts/job-worker.ts` makes
 * tsx spawn the real worker as a CHILD process. PM2 then monitors the tiny launcher, so
 * `--max-old-space-size` and `max_memory_restart` never applied to the worker, and signals
 * had to be relayed. Here Node itself runs the worker in ONE process:
 *
 *   node --import tsx --max-old-space-size=384 scripts/job-worker.launch.mjs
 *
 * `--import tsx` registers the TypeScript loader in this same process, so the flags and
 * PM2's memory accounting apply to the worker. This file adds no behaviour: environment
 * loading, preflight checks, the ownership guard and SIGTERM/SIGINT handling all live in
 * scripts/job-worker.ts and are unchanged.
 */
try {
  await import('./job-worker.ts');
} catch (err) {
  const msg = String(err?.message || err);
  if (err?.code === 'ERR_UNKNOWN_FILE_EXTENSION' || /Unknown file extension/.test(msg)) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'worker launcher: TypeScript loader not registered. Run with `node --import tsx scripts/job-worker.launch.mjs` (tsx must be installed).',
      })
    );
  } else {
    console.error(JSON.stringify({ level: 'error', msg: 'worker launcher failed', error: msg }));
  }
  process.exit(1);
}
