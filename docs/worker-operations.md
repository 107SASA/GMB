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

---

## Migration safety controls (`feat(jobs): add migration safety controls`)

### 1. Ownership guard (worker startup + every 60 s)

The worker will not claim a single job until the **running web app** confirms it has released every
function id in `JOBS_NATIVE_FUNCTIONS`:

```
GET ${JOBS_OWNERSHIP_URL:-http://127.0.0.1:3000/api/inngest/ownership}
Authorization: Bearer ${JOBS_GUARD_TOKEN}
-> { version:1, known:[all ids], served:[ids web serves to Inngest], native:[ids web released] }
```

| Env | Where | Meaning |
|---|---|---|
| `JOBS_GUARD_TOKEN` | **web and worker** (`.env.production`) | shared secret. If unset the endpoint answers 404 and the worker refuses to start. Use a long random value; never commit it. |
| `JOBS_OWNERSHIP_URL` | worker | default `http://127.0.0.1:3000/api/inngest/ownership` (loopback) |
| `JOBS_OWNERSHIP_GUARD=off` | worker | honoured **only when `NODE_ENV` is not `production`** (local dev). In production the guard cannot be disabled. |

Fail-closed rules. The worker exits 1 at startup (PM2 backs off and retries) and, if already running, stops
claiming and stops leading crons while the condition holds:

* endpoint unreachable, non-200, invalid JSON or wrong shape;
* any owned id is still in `served` (web still gives it to Inngest);
* any owned id is unknown to web's registry (typo / version skew);
* web's `native` list differs from the worker's `JOBS_NATIVE_FUNCTIONS` (web was not restarted with `--update-env`).

**What the guard does NOT prove. These steps stay manual:**

1. **Inngest Cloud registration.** The guard reports what the web *process* serves. Inngest keeps the old
   registration and cron schedule until `PUT /api/inngest` completes. After the PUT, open the Inngest dashboard,
   Apps, and confirm the wave's functions are **gone**. Only then start the worker.
2. **Race windows that remain**
   * Between web restart and `PUT`: Inngest may still fire a cron or send an event to a function web no longer
     serves. That call fails at Inngest (no execution); it shows up as a failed run.
   * Between `PUT` and worker start: a cron slot may pass with no owner. Cleanup crons recover on the next slot;
     time-critical crons rely on catch-up (`JOBS_CRON_CATCHUP_MS`, default 1 h, coalesced into one run).
   * Inngest runs already delivered (in flight or sleeping) for a function that was just released are not migrated.
     Per-wave drain rules: `inngest-migration-plan.md`.
   * The guard is re-checked every 60 s; a web restart that re-serves an id can leave up to 60 s of native work
     running before it is noticed. Ownership only changes by a deliberate env edit + restart, so keep that ordered.
3. **Two web processes.** The guard only sees the instance it reaches.

### 2. Pause / drain (durable)

```bash
npm run jobs:admin -- status                          # control doc + workers + stats
npm run jobs:admin -- pause "deploy 2026-10-20" --yes
npm run jobs:admin -- resume --yes
```

* State is a single MongoDB document (`<prefix>job_control`), so it survives restarts and applies to every worker.
  Pause/resume are **idempotent** (`changed:false` when already in that state) and safe to run concurrently.
* Workers re-read it before every claim round (about `JOBS_POLL_MS`). **Paused means no new claims, and the cron
  leader enqueues no slots.** A claim round already in progress may still take up to `JOBS_CONCURRENCY` jobs after the
  pause is written, so treat "paused" as effective after `JOBS_POLL_MS` plus one claim round.
* **Draining**: in-flight jobs keep running and finish. Worker state is `draining` while any are in flight and
  `paused` when none are. If they outlast `JOBS_SHUTDOWN_GRACE_MS` they are aborted and their leases **released**
  (re-queued, completed steps kept) so the next worker resumes instead of waiting out the lease.
* **Fail closed**: an unreadable control document makes the worker behave as paused
  (`claimBlockedReason: control-unreadable`).
* Observability: `jobs:admin status`, `GET 127.0.0.1:3911/healthz` (`state`, `paused`, `claimBlockedReason`,
  `inFlight`) and each worker's heartbeat doc (`status`: running, draining, paused, blocked, stopping, stopped).
  A paused worker reports healthy (`ok:true`): it is doing what it was told.

### 3. Shutdown / deploy sequence

```bash
npm run jobs:admin -- pause "deploy" --yes
npm run jobs:admin -- status               # wait until every worker is "paused" (inFlight 0)
pm2 stop growwmatics-worker                # SIGTERM: drains up to JOBS_SHUTDOWN_GRACE_MS, releases the rest
# ... run scripts/deploy.sh (npm install / build / pm2 restart growwmatics / PUT /api/inngest) ...
pm2 start growwmatics-worker               # the ownership guard re-verifies web before any claim
npm run jobs:admin -- resume --yes
```

`deploy.sh` only stops `growwmatics`; the worker must be stopped by the operator **before** `npm install` / build
replace files under it.

### 4. Staging: suppress every outbound send

Set on the **staging** web and worker only (never in production env files):

```
QA_SUPPRESS_OUTBOUND_SENDS=true      # WhatsApp (Twilio + Meta), Expo push, email
QA_SUPPRESS_WHATSAPP_SENDS=true      # legacy, WhatsApp only (does NOT cover push or email)
```

The gate sits at the lowest network layer, logs only `channel / kind / count`, and returns success with a synthetic
`qa_*` id so downstream bookkeeping behaves like a real send. **Not covered:** Google Business Profile writes (leave
`GBP_LIVE_WRITES_ENABLED` unset), Razorpay, and read calls to Google/Gemini/Groq. Keep those credentials out of staging.

### 5. Replay and smoke tests

* Replay tool: see `rollback-procedure.md`.
* Real-handler smoke test (disposable DB): `npm run test:jobs:smoke`.
