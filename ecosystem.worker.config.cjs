/**
 * PM2 definition for the native job worker — a SEPARATE app from `growwmatics`
 * (the Next.js server), so a web deploy/restart never kills in-flight jobs and
 * a worker crash never takes the site down.
 *
 * NOT APPLIED ANYWHERE. Nothing in scripts/deploy.sh references this file.
 * Intended future use (after the server audit + explicit approval):
 *
 *   pm2 start ecosystem.worker.config.cjs
 *   pm2 save
 *
 * The worker exits 0 on its own (and PM2 leaves it stopped) unless
 * JOBS_NATIVE_ENABLED=true and JOBS_NATIVE_FUNCTIONS is set in .env.production,
 * so starting it before cutover is harmless.
 */
module.exports = {
  apps: [
    {
      name: 'growwmatics-worker',
      script: './node_modules/tsx/dist/cli.mjs',
      args: 'scripts/job-worker.ts',
      cwd: __dirname,
      // Heap cap well below the 4 GB box; PM2 restarts it above max_memory_restart.
      node_args: '--max-old-space-size=768 --dns-result-order=ipv4first',
      max_memory_restart: '900M',
      instances: 1, // exactly one: per-function in-process caps assume a single worker
      exec_mode: 'fork',
      autorestart: true,
      stop_exit_codes: [0], // "disabled" / clean shutdown → stay stopped
      exp_backoff_restart_delay: 1000,
      min_uptime: '20s',
      max_restarts: 20,
      // Must exceed JOBS_SHUTDOWN_GRACE_MS (default 25s) so SIGTERM can drain.
      kill_timeout: 40000,
      env: { NODE_ENV: 'production' },
      time: true,
      merge_logs: true,
      out_file: './logs/worker.out.log',
      error_file: './logs/worker.err.log',
    },
  ],
};
