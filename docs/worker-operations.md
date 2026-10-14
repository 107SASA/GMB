# Worker Operations

Applies once the native queue is deployed. Until then the worker exits immediately and nothing is processed natively.
Commands assume the app directory on the droplet. **PENDING SERVER AUDIT:** exact paths, PM2 user, log locations.

## Configuration (env — all default OFF)

| Variable | Default | Meaning |
|---|---|---|
| `JOBS_NATIVE_ENABLED` | unset (off) | master switch |
| `JOBS_NATIVE_FUNCTIONS` | empty | comma list of Inngest function ids the native queue owns. `*` and unknown ids make the worker exit; the web path ignores them (Inngest keeps those functions) |
| `JOBS_CONCURRENCY` | 3 (1–20) in code; **PM2 pins 1 for Waves 0–1** | max jobs running in the worker |
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
   npm run jobs:admin -- retry <id> --yes --confirm-db <db>                 # keeps completed steps, re-runs failed step
   npm run jobs:admin -- retry <id> --reset-steps --yes --confirm-db <db>   # starts the whole job over (re-runs all steps!)
   ```
   Prefer plain `retry`. Use `--reset-steps` only if you know every step is idempotent — it will repeat sends.
4. Never retry in bulk without reading each error: a WhatsApp/billing step can repeat its side effect.

Cancel: `npm run jobs:admin -- cancel <id> --yes --confirm-db <db>` (a running job is fenced out; an in-flight step may still finish its side effect).

## Resource monitoring

```bash
pm2 monit
free -m; df -h /; uptime
ps -o pid,rss,cmd -C node
```
Targets for Waves 0–1 on the current 1.9 GiB box (see Sizing below): worker RSS < 350 MB (PM2 restarts at 450 MB; heap capped 384 MB); queue `oldestDueAgeMs` < 5 min; dead = 0.

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

Recommended triggers: worker `/healthz` non-200 or process absent > 2 min; `oldestDueAgeMs` > 10 min; any new `dead`; `retried` counter climbing without `completed`; disk > 80 %; RSS > 400 MB.

---

## Migration safety controls

### 1. Ownership guard (worker start + continuous)

The worker will not claim a single job, and will not lead the cron scheduler, until the **running web app**
confirms it has released every function id in `JOBS_NATIVE_FUNCTIONS`:

```
GET ${JOBS_OWNERSHIP_URL:-http://127.0.0.1:3000/api/inngest/ownership}
Authorization: Bearer ${JOBS_GUARD_TOKEN}
-> { version:1, known:[all ids], served:[ids web serves to Inngest], native:[ids web released] }
```

| Env | Where | Meaning |
|---|---|---|
| `JOBS_GUARD_TOKEN` | **web and worker** (`.env.production`) | shared secret. Unset: the endpoint answers 404 and the worker exits 1 (a configuration error, not a transient one). Long random value; never commit it. |
| `JOBS_OWNERSHIP_URL` | worker | default `http://127.0.0.1:3000/api/inngest/ownership` (loopback) |
| `JOBS_OWNERSHIP_GUARD=off` | worker | honoured **only when `NODE_ENV` is not `production`**. In production the guard cannot be disabled, only satisfied. |

**Startup and restart behaviour (blocked-but-alive, never a restart loop).** The worker starts in state `blocked`
(`ownership-guard: startup check pending`), serves `/healthz`, and re-checks every 10 s until the first success, then
every 60 s. Any later failure blocks it again within one interval; in-flight jobs keep running and are not released.
It never exits because the web app is down, so a long web outage cannot exhaust PM2's restart budget. Blocked
reasons (all fail closed):

* endpoint unreachable, non-200, invalid JSON or wrong shape (this is what a web restart looks like);
* any owned id is still in `served` (web still gives it to Inngest);
* any owned id is unknown to web's registry (typo / version skew);
* web's `native` list differs from the worker's `JOBS_NATIVE_FUNCTIONS` (web was restarted without the new env).

The reason is in `/healthz` (`claimBlockedReason`, `ownershipGuard`) and the worker log. A worker that stays
`blocked` for more than a few minutes after a cutover step means that step is not finished: fix the web side, do not
override the guard.

**The web path never fails on a bad id.** A typo or unsupported id in `JOBS_NATIVE_FUNCTIONS` is logged
(`[jobs] JOBS_NATIVE_FUNCTIONS id "..." ignored on the web path`) and Inngest keeps that function; `/api/inngest`
keeps serving every valid function and event sends are unaffected. `*` is dropped, never expanded. The **worker**
stays strict: unknown/unsupported ids or `*` make it exit 1 at startup. Result: a typo can only leave a function with
Inngest (safe), never take down background processing.

**What the guard does NOT prove. These stay manual, and are the residual race windows:**

1. **Inngest Cloud registration.** The guard reports what the web *process* serves. Inngest keeps the old
   registration and cron schedule until `PUT /api/inngest` completes. After the PUT, open the Inngest dashboard,
   Apps, and confirm the wave's functions are **gone** before starting the worker. This gate is manual and required.
2. **Race windows**
   * Between web restart and `PUT`: Inngest may still fire a cron or send an event to a function web no longer
     serves. That call fails at Inngest (no execution); it shows as a failed run.
   * Between `PUT` and worker start/unblock: a cron slot may pass with no owner. Cleanup crons recover on the next
     slot; others rely on catch-up (`JOBS_CRON_CATCHUP_MS`, default 1 h, coalesced into one run).
   * Inngest runs already delivered (in flight or sleeping) for a function that was just released are not migrated.
     Per-wave drain rules: `inngest-migration-plan.md`.
   * Detection latency: after an out-of-order web restart the worker notices within one guard interval (<= 60 s).
     Up to that long, work already claimed continues. Ownership only changes by a deliberate env edit + restart + PUT,
     so keep that order.
   * The guard sees the web instance it reaches; a second web process would be invisible to it.

### 2. Pause / drain (durable)

```bash
npm run jobs:admin -- status
npm run jobs:admin -- pause "deploy 2026-10-20" --wait --timeout-sec=180 --yes --confirm-db <db-name>
npm run jobs:admin -- resume --yes --confirm-db <db-name>
```

* State is one MongoDB document (`<prefix>job_control`): durable, shared by every worker. Pause/resume are
  **idempotent** (`changed:false` when already in that state) and safe to run concurrently.
* **Paused means no new claims and no cron slots.** Every worker reads the control document before the scheduler's
  first tick and **immediately before every claim** (not once per round). The only remaining window is a claim whose
  atomic database operation is already in flight when the pause is written: at most one claim per worker, never a batch.
* **`pause --wait` is the acknowledgement.** Without `--wait` the CLI only reports the pause as *recorded*. With
  `--wait` it polls worker heartbeats written after the pause and succeeds only when every live worker reports
  `paused:true` and `inFlight:0` (exit code 3 on timeout, listing who is still draining). Workers that stopped
  heart-beating are not counted. Do not stop the worker, deploy, or resume until it succeeds.
* **Draining**: in-flight jobs keep running. State is `draining` while any are in flight, `paused` when none are. If
  an *operator* pause outlasts `JOBS_SHUTDOWN_GRACE_MS` the remaining jobs are aborted and their leases **released**
  (completed steps kept). Do not resume until `inFlight` is 0: an aborted handler may still be finishing its step
  inside the old process.
* **Unreadable control document** (MongoDB error): the worker blocks NEW claims and cron leadership
  (`claimBlockedReason: control-unreadable`) but does **not** release or abort in-flight jobs; only an explicit
  operator pause can.
* Observability: `jobs:admin status`, `GET 127.0.0.1:3911/healthz` (`state`, `paused`, `claimBlockedReason`,
  `inFlight`, `ownershipGuard`, `outboundSuppression`), and each worker's heartbeat doc. A paused or blocked worker
  reports `ok:true`: it is doing what it was told.

### 3. Shutdown / deploy sequence

```bash
npm run jobs:admin -- pause "deploy" --wait --timeout-sec=180 --yes --confirm-db <db-name>   # must succeed (exit 0)
pm2 stop growwmatics-worker                # SIGTERM: drains up to JOBS_SHUTDOWN_GRACE_MS, releases the rest
# ... run scripts/deploy.sh (npm install / build / pm2 restart growwmatics / PUT /api/inngest) ...
pm2 start growwmatics-worker               # starts blocked; unblocks only after the ownership guard passes
npm run jobs:admin -- status               # worker shows state "paused" (control doc still paused)
npm run jobs:admin -- resume --yes --confirm-db <db-name>
```

`deploy.sh` only stops `growwmatics`; the worker must be stopped by the operator **before** `npm install` / build
replace files under it.

### 4. Admin target safety

Every `jobs:admin` command prints the selected database and hosts (never credentials) to stderr first and refuses:

* a `MONGODB_URI` that names **no database** (the driver would silently use `test`);
* a production-looking database name while `NODE_ENV` is not `production` (override: `ALLOW_PROD_DB=iunderstand`).

State-changing commands (`pause`, `resume`, `retry`, `cancel`, `replay-to-inngest --execute`) additionally require
`--yes` **and** the database name typed back: `--confirm-db <name>`, or an interactive prompt on a terminal. A
wrong or missing name aborts before connecting. On the droplet run with `NODE_ENV=production` so `.env.production`
is the source.

### 5. Staging: outbound suppression (hard boundary)

Set on the **staging** web and worker only, and mark the environment:

```
APP_ENV=staging                      # REQUIRED when NODE_ENV=production (a production build on a staging box)
QA_SUPPRESS_OUTBOUND_SENDS=true      # WhatsApp (Twilio + Meta), Expo push, email; Calendar/Razorpay/OAuth fail closed
QA_SUPPRESS_WHATSAPP_SENDS=true      # legacy, WhatsApp only
```

* **Never honoured in production.** With `NODE_ENV=production` and no `APP_ENV=staging|qa` the flags are ignored,
  real sends proceed, and an error is logged. A stray flag cannot swallow production OTPs, push or WhatsApp.
* **Simulated** (success with a synthetic `qa_*` id): WhatsApp, push, email.
* **Fail closed, not simulated** (throws `SuppressedExternalOperation`, code `QA_SUPPRESSED`): Google Calendar event
  create/delete (invites email real people), Razorpay create/cancel/plan-create, Google OAuth token revoke. Callers see an
  error and take their normal failure path; nothing reaches the third party even with live credentials present.
* **Credential boundary.** The worker refuses to start when suppression is active next to `RAZORPAY_KEY_ID=rzp_live_*`,
  `GBP_LIVE_WRITES_ENABLED=true` or `ACCOUNT_PURGE_MODE=live`. Keep live credentials off staging regardless; GBP writes
  are gated only by `GBP_LIVE_WRITES_ENABLED` (leave it unset).
* **Visibility.** A warning at web boot (`instrumentation.ts`) and worker start; `/healthz` carries
  `outboundSuppression` = `{ requested, active, ignoredInProduction, violations[], suppressed{channel:count} }`:
  counts and names only, never recipients, payloads or secrets.

### 6. Sizing (Waves 0-1 only)

`ecosystem.worker.config.cjs` is sized for the **current 1 vCPU / 1.9 GiB** droplet and the light early waves:
one forked process, `JOBS_CONCURRENCY=1`, `--max-old-space-size=384`, `max_memory_restart: 450M`, `kill_timeout 40 s`.
Targets: RSS < 350 MB steady, queue `oldestDueAgeMs` < 5 min, dead = 0. **Not sufficient** for Chromium
(`report-card-deliver`), AI-heavy content/review/nurture waves or `JOBS_CONCURRENCY > 1`: re-size the droplet and these
limits before those waves, and re-baseline after the first hour of real RSS data.

### 7. Replay and tests

* Replay tool and verification: `rollback-procedure.md`.
* Real-handler smoke tests (disposable loopback DB): `npm run test:jobs:smoke`. All staging/smoke tests require an
  explicit `TEST_MONGODB_URI` on a loopback host (`ALLOW_REMOTE_TEST_DB=1` to override), load no env files, and refuse
  any database name containing "prod".
