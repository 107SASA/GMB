# Worker Operations

Applies once the native queue is deployed. Until then the worker exits immediately and nothing is processed natively.
Commands assume the app directory on the droplet. **PENDING SERVER AUDIT:** exact paths, PM2 user, log locations.

## Configuration (env — all default OFF)

| Variable | Default | Meaning |
|---|---|---|
| `JOBS_NATIVE_ENABLED` | unset (off) | master switch |
| `JOBS_NATIVE_FUNCTIONS` | empty | comma list of Inngest function ids the native queue owns. `*` is rejected |
| `JOBS_CONCURRENCY` | 3 (1–20) | max jobs running in the worker |
| `JOBS_LEASE_MS` | 60000 | claim validity without heartbeat |
| `JOBS_HEARTBEAT_MS` | 15000 | capped at lease/3 |
| `JOBS_POLL_MS` | 2000 | idle poll → also max sleep/cron wake latency |
| `JOBS_SHUTDOWN_GRACE_MS` | 25000 | drain time on SIGTERM (PM2 `kill_timeout` must exceed it) |
| `JOBS_CRON_CATCHUP_MS` | 3600000 | oldest missed cron slot still run late |
| `JOBS_LEADER_TTL_MS` | 30000 | cron leader lease |
| `JOBS_COLLECTION_PREFIX` | `native_` | collection prefix (tests use a random one) |
| `JOBS_HEALTH_PORT` | 3911 | loopback health port |

Web app and worker must read the **same** `JOBS_NATIVE_*` values (both load `.env.production`).

## Deploy / restart

```bash
# Web deploy: unchanged. scripts/deploy.sh stops/restarts ONLY `growwmatics`.
./scripts/deploy.sh

# Worker code changed? (it runs the same source tree)
pm2 reload growwmatics-worker          # graceful: drains in-flight (≤25 s), releases the rest
# or
pm2 restart growwmatics-worker

# first start / after `pm2 delete`
pm2 start ecosystem.worker.config.cjs && pm2 save
```
Deployment while jobs run is safe by design: in-flight jobs finish or are **released with persisted steps intact** and resumed by the new process; sleeping jobs are only DB rows. Expect at most one *step* to re-run (at-least-once).

> Do **not** deploy the web build while the worker is mid-`npm install`/`rm -rf .next` on a shared tree without a reload afterwards: the worker imports source files at start; reload it after a deploy that changed job code.

## Inspect

```bash
curl -s 127.0.0.1:3911/healthz
pm2 logs growwmatics-worker --lines 100          # JSON lines
npm run jobs:admin -- stats                       # counts by fn/status + oldestDueAgeMs
npm run jobs:admin -- workers
npm run jobs:admin -- list dead [fnId]
npm run jobs:admin -- list sleeping [fnId]
npm run jobs:admin -- show <jobId>                # state, steps (ids only), error — never payload values
```

## Failed jobs (dead letters)

1. `list dead` → `show <id>`; read `lastError` and which step failed.
2. Fix the cause (data, config, upstream outage).
3. Retry safely:
   ```bash
   npm run jobs:admin -- retry <id> --yes                 # keeps completed steps, re-runs failed step
   npm run jobs:admin -- retry <id> --reset-steps --yes   # starts the whole job over (re-runs all steps!)
   ```
   Prefer plain `retry`. Use `--reset-steps` only if you know every step is idempotent — it will repeat sends.
4. Never retry in bulk without reading each error: a WhatsApp/billing step can repeat its side effect.

Cancel: `npm run jobs:admin -- cancel <id> --yes` (a running job is fenced out; an in-flight step may still finish its side effect).

## Resource monitoring

```bash
pm2 monit
free -m; df -h /; uptime
ps -o pid,rss,cmd -C node
```
Targets (provisional, **re-baseline after the server audit**): worker RSS < 600 MB (PM2 restarts at 900 MB; heap capped 768 MB); queue `oldestDueAgeMs` < 5 min; dead = 0.

## Server crash / reboot recovery

No manual job recovery is needed: leases expire and the worker re-claims `running` jobs; `sleeping` jobs are untouched DB rows; cron state resumes from `lastSlotAt` (slots missed beyond `JOBS_CRON_CATCHUP_MS` are skipped, counted in `native_job_cron_state.missed`).

```bash
pm2 resurrect || pm2 start ecosystem.worker.config.cjs      # PM2 normally does this via `pm2 startup` (PENDING)
curl -s 127.0.0.1:3911/healthz
npm run jobs:admin -- stats
```
Then check `list dead`, and for crons missed during the outage read `native_job_cron_state.missed`.

## Switching back to Inngest

See `rollback-procedure.md`.

## Alerts (PENDING — need an alert destination)

Recommended triggers: worker `/healthz` non-200 or process absent > 2 min; `oldestDueAgeMs` > 10 min; any new `dead`; `retried` counter climbing without `completed`; disk > 80 %; RSS > 800 MB.
