# Background Worker Architecture (native job queue)

Status: **implemented, disabled by default, not deployed, not cut over.**
Code: `src/services/jobs/`, `scripts/job-worker.ts`, `ecosystem.worker.config.cjs`.

## 1. Decision: MongoDB-backed queue, no Redis

| Option | Verdict |
|---|---|
| BullMQ + Redis | Rejected for now. New stateful service on a 2–4 GB box, persistence tuning (AOF), another failure domain, for a few thousand jobs/day. |
| **MongoDB queue** | **Chosen.** Mongo is already the system of record; `ScheduledAction` (atomic claim, stale-claim recovery, unique `idempotencyKey`) and `ProcessedWebhookEvent` (insert-as-lock) already prove the pattern in this codebase. $0 extra. |
| Keep Inngest | Still the owner of every function until each is explicitly cut over. |

Redis can be revisited if sustained throughput outgrows Mongo polling (hundreds of jobs/second) — not the case here.

## 2. Topology

```
NOW (all traffic)                      TARGET (per-function, after cutover)

Next.js (PM2 growwmatics)              Next.js (PM2 growwmatics)
  inngest.send ─► Inngest Cloud          inngest.send ─► [router: client.ts]
  /api/inngest ◄─ HTTP callbacks            owned fn ─► Mongo `native_jobs`
                                            other    ─► Inngest Cloud (unchanged)
                                         /api/inngest serves only NON-owned fns

                                       Worker (PM2 growwmatics-worker, 1 instance)
                                         poll → atomic claim → run (step shim)
                                         cron scheduler (leader-locked)
                                         heartbeat · graceful SIGTERM drain
                                         127.0.0.1:3911/healthz
```

Ownership is one list: `JOBS_NATIVE_FUNCTIONS`. A function id is either natively owned
(deregistered from `/api/inngest`, jobs only created in Mongo, only run by the worker)
or Inngest-owned. Nothing is ever dual-run.

## 3. Collections (all created explicitly by `ensureIndexes()` — prod has `autoIndex:false`)

| Collection | Purpose | Notable indexes |
|---|---|---|
| `native_jobs` | one document per function run | unique `idempotencyKey`; `{status,runAt}`; `{status,leaseExpiresAt}`; **partial unique `{fnId,concurrencyKey}` where `status:'running'`**; TTL `expireAt` (completed/cancelled 14 d; **dead never expires**) |
| `native_job_cron_state` | per-cron `lastSlotAt`, `missed` | `_id = fnId` |
| `native_job_locks` | `cron-leader` lease | `_id` |
| `native_job_workers` | worker heartbeats/counters | TTL 24 h |

> Separate index migration is **not** required: the worker/web process creates these indexes on first use (`createIndex` is idempotent). Include the collections in your next Atlas index review.

## 4. Job lifecycle

```
queued ──claim──► running ──done──► completed (TTL 14d)
  ▲                 │  │
  │   retry+backoff │  ├─ sleep ──► sleeping (runAt = wake time; no process holds it) ─claim─► running
  └─────────────────┘  ├─ lease expires (worker died) ─► re-claimable, attempts+1
                       ├─ attempts exhausted / NonRetriable ─► dead  (DLQ, kept forever, admin retry)
                       └─ cancelOn / admin cancel ─► cancelled
```

* **Atomic claim** – single `findOneAndUpdate` with an update *pipeline* flips queued/sleeping→running and stamps `{claimToken, leaseOwner, leaseExpiresAt}`. Same query also matches `running` with an expired lease (stale-claim recovery).
* **Fencing** – every later write (heartbeat, step result, complete, fail, sleep) is filtered on `{_id, claimToken, status:'running'}`. A paused/partitioned/cancelled worker matches 0 docs and cannot mutate state. (Tested.)
* **Poison pill** – recovery from an expired lease consumes an attempt; a job that kills its worker every time is dead-lettered instead of looping.
* **Retries** – per *step* budget like Inngest: `retries+1` attempts (Inngest default `retries=4` preserved), exponential backoff `30s·2^n` capped 1 h, ±20 % jitter. A step that exhausts its retries is memoised as failed and thrown into the handler (Inngest semantics); an uncaught error dead-letters the job. Completing any step resets the budget.
* **Concurrency** – worker-wide cap (`JOBS_CONCURRENCY`, default 3), per-function in-process cap (`concurrency:{limit}`), and DB-enforced *one running job per key* (`concurrency:{key:'event.data.X',limit:1}` – used by `gbp-sync-worker`). Run **one** worker instance; per-function caps are per process.
* **Idempotency** – enqueue key is `${fnId}:${eventId}`; events without an id get a UUID (same as Inngest — no dedupe, by design). `step.sendEvent` derives `${jobId}:${stepId}:${i}` ids so replays can't fan out twice. Business-level guards already in the handlers (`claimFollowUp`, `ScheduledAction.idempotencyKey`, `ProcessedWebhookEvent`) are untouched and remain the real protection for WhatsApp/billing side effects.

## 5. Step shim (what is and is NOT guaranteed)

The handler is **re-run from the top on every claim** (identical to Inngest). `step.*` results are persisted on the job document:

| API | Behaviour |
|---|---|
| `step.run(id, fn)` | result stored JSON-round-tripped (Dates come back as strings, as under Inngest); repeated ids get `:1`, `:2` suffixes; >1 MB result → non-retriable error |
| `step.sleep / sleepUntil` | wake time persisted; job parked `sleeping`; wakes on claim after `runAt`; **cannot be swallowed by a handler `try/catch`** (handler is abandoned, not thrown into) |
| `step.sendEvent` | memoised; routed native/Inngest; deterministic event ids |
| `step.waitForEvent / invoke / ai` | **not implemented** — `grep` shows none are used; adapter would fail at runtime, add before using |

**Not exactly-once.** If a worker dies between an external side effect (WhatsApp send, Razorpay call) and the step-result write, that step runs again on recovery. This is identical to Inngest's at-least-once step semantics; the protection is the idempotency/claim guards inside each step. Cutover review must confirm each externally-visible step has one (see migration plan).

Also: an *abandoned* handler (lease lost, cancelled, shutdown) may still finish an in-flight `fn()` call in memory; its result is discarded by fencing but its external side effect is not undone.

## 6. Long-running workflows

| Function | Mechanism | Preserved semantics |
|---|---|---|
| `process-review-campaign` | `step.sleep("Nd")` + `step.sleepUntil` for business hours, in-step eligibility re-checks (`followUpStillEligible`, `claimFollowUp`) | Delays captured once in `load-config` memo (policy edits don't rewrite a running campaign); days-long sleeps are DB rows, survive restarts/deploys |
| `sales-nurture-requested` | 6 durable sleeps (first-delay, quiet-hours waits, per-follow-up gaps) + `ScheduledAction` idempotency keys | Timing computed inside memoised steps; unique-key duplicate guard unchanged |
| `schedule-single-post-publish` | `sleepUntil(scheduledDate)` + `cancelOn` on re-schedule/un-schedule of same `postId` | `cancelOn` (`async.data.postId == event.data.postId`) implemented by `routing.ts`: cancels earlier active runs of that post **excluding the job the same event spawns**; the publish function's own `status !== 'scheduled'` guard and the hourly safety-net cron remain |

Timing accuracy: a sleeper wakes within `JOBS_POLL_MS` (default 2 s) of `runAt` (Inngest is similar order of magnitude).

## 7. Cron scheduler

* **Leader lock** `cron-leader`, TTL `JOBS_LEADER_TTL_MS` (30 s), renewed by the leader every ≤5 s; atomic upsert acquisition.
* **Slot idempotency** (second layer): each fire enqueues key `cron:<slotMs>` under the unique index → two simultaneous "leaders" still produce one job per slot.
* **Clock drift** – all leases/due-times/slots use a DB-corrected clock (`hello.localTime` offset, re-synced every 60 s, logged when >30 s). A worker that cannot sync for 5 min refuses to lead.
* **Missed schedules** – slots missed during downtime are *coalesced* to a single run of the latest slot iff it is within `JOBS_CRON_CATCHUP_MS` (default 1 h); otherwise skipped and counted in `missed`. First sight of a cron initialises state to "now" (no historical backfill). Rationale: a 19:00 IST digest firing at 05:00 is worse than skipping.
* Supported cron grammar: 5-field UTC (`*`, `*/n`, lists, ranges). `TZ=` rejected. All 23 production crons verified to parse.

## 8. Process management

* Separate PM2 app `growwmatics-worker` (`ecosystem.worker.config.cjs`): `instances:1`, **single process** via `scripts/job-worker.launch.mjs` with `node_args --import tsx --max-old-space-size=384`, `max_memory_restart 450M`, `JOBS_CONCURRENCY=1`, `kill_timeout 40 s` > `JOBS_SHUTDOWN_GRACE_MS` (Waves 0-1 on the 1.9 GiB box; re-size before Chromium/AI waves). See `worker-operations.md` "Verified vs not verified".
* SIGTERM: stop claiming → wait for in-flight ≤ grace → abort + **release** leftovers to `queued` (immediate pickup by the next start instead of waiting out the lease).
* Exits 0 and stays stopped (`stop_exit_codes:[0]`) when native mode is disabled.
* `scripts/deploy.sh` is **unchanged**: web deploys stop only `growwmatics`; the worker is not touched.
* **Pending (server audit):** actual PM2 install, log rotation (`pm2-logrotate`), boot persistence (`pm2 startup`/`save`), resource baselines.

## 9. Observability

* Structured JSON logs (one object per line) → PM2 logs.
* `GET 127.0.0.1:3911/healthz` – DB connected, clock fresh, in-flight, leader, counters.
* `native_job_workers` heartbeats; `npm run jobs:admin -- stats|workers|list dead|show <id>`.
* **Pending:** alerting (queue backlog age, dead count, worker silence) — requires a monitoring target decision. `stats().oldestDueAgeMs` and dead count are the intended signals.

## 10. Known limitations / non-goals (this phase)

* Not yet exercised against the **real** 50 functions (only synthetic functions in staging tests + adapter inventory: 50/50 adaptable).
* No Inngest↔native in-flight run migration: runs already sleeping in Inngest Cloud finish there (see cutover doc).
* Single worker; no horizontal scaling story beyond DB-enforced key limits and idempotent cron.
* `step.sleep` precision is the poll interval; no sub-second timers.
