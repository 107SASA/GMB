# Native job worker — final checklist

Branch: `feature/native-job-worker` (from `origin/main` @ `3eaa96e`; `dev` and `main` have identical trees). Nothing is deployed, committed to `main`, or enabled. Inngest owns all 50 functions.

## Complete

| Item | Evidence |
|---|---|
| Workflow inventory (50 functions, producers, retries, sleeps, guards) | `docs/inngest-workflow-inventory.md`, `npm run jobs:inventory` |
| Architecture, lifecycle, scheduling, idempotency, recovery | `docs/background-worker-architecture.md` |
| MongoDB queue: atomic claim, leases + heartbeat, fencing, backoff, dead-letter, poison-pill, cancelOn, durable sleep, keyed concurrency, memoised sendEvent | `src/services/jobs/*`, 21 staging tests |
| Worker entry point, health endpoint, graceful shutdown, admin CLI | `scripts/job-worker.ts`, `scripts/jobs-admin.ts` |
| Cron leader lock, no backfill on init, coalesced catch-up, stale slot skip | staging test "cron: ..." |
| Single-owner guarantee (per function: Inngest XOR native; typos fail closed) | `partitionOwnership` + 3 new unit tests; `/api/inngest` deregisters owned ids |
| All flags default OFF | unit test "everything is OFF by default" |
| PM2 definition (separate app, 1 instance, single process via `job-worker.launch.mjs`, concurrency 1, 384 MB old-space flag / 450M restart configured for Waves 0-1; restart enforcement and PM2 signal delivery NOT yet verified on Linux) | `ecosystem.worker.config.cjs` |
| Env var documentation (names only) | `.env.production.example` (JOBS_* block) |
| Runbook, cutover, rollback, operations | `docs/production-cutover.md`, `rollback-procedure.md`, `worker-operations.md`, `inngest-migration-plan.md` |

## Test results (this session, Windows dev box)

| Check | Result |
|---|---|
| `npm run test:jobs` (pure unit) | 13 pass / 0 fail |
| `npm run test:jobs:staging` (real MongoDB 7.0.14, local throwaway replica set) | 21 pass / 0 fail |
| `npx tsc --noEmit` | clean |
| eslint on `src/services/jobs`, worker scripts, `/api/inngest`, inngest client | clean |
| `npm run build` | pass (exit 0) |

## Incomplete / not verified

- **Real handlers under the shim.** Only wave 0a/0b (`cleanup-stale-pending-audits`, `data-retention-cleanup-cron`) have been run through the native runner (disposable DB). The other 48 have not; each wave needs a staging run with `QA_SUPPRESS_OUTBOUND_SENDS=true`.
- **Inventory rows marked `scan`** were derived structurally; only the publish, weekly-offer, review-campaign send path and a few claim sites were read in full. Read each before its wave.
- **Atlas**: unreachable from the dev machine (IP allow-list), so staging tests ran on local mongod, not Atlas.
- **PM2/SIGTERM/reboot on the droplet**: process death is simulated in tests, not exercised on the server.
- **Existing app test suite** beyond the job tests was not re-run here.

## Blocked on owner decisions / access

1. Server audit needs SSH access to `growwmatics-prod` (`scripts/server-audit-readonly.sh`).
2. Atlas backup verification + DO snapshot before any cutover.
3. Droplet resize decision (1 vCPU / 2 GB currently; worker budget assumes 4 GB).
4. Approval of wave order, and a drain window for wave 6 (`process-review-campaign`, `sales-nurture-requested`: sleeping Inngest runs cannot be migrated).
5. Review/merge of this branch into `main` (not done).

## Risks to keep in view

- At-least-once, not exactly-once: one duplicate reply is possible for plain reply senders after a crash between send and persist (same as Inngest today).
- Business-hours helpers use process-local time: worker and web must share a TZ.
- Web and worker must read identical `JOBS_NATIVE_*`; ownership only moves after `PUT /api/inngest` resync.

## Exact next action

Approve (or adjust) the wave plan and provide SSH access so the read-only server audit can run; no production change happens before that.

## Migration safety controls (second commit: `feat(jobs): add migration safety controls`)

| Item | Status | Evidence |
|---|---|---|
| Worker startup ownership guard (fail closed, periodic recheck, token-protected `/api/inngest/ownership`) | done | `ownershipGuard.ts`, 13 unit tests |
| Durable pause / resume / drain, observable state, fail-closed on unreadable control doc | done | `store.ts` control doc, `worker.ts`, 8 staging tests (incl. 2 concurrent workers) |
| `replay-to-inngest` (dry-run default, explicit `--execute --yes`, never replays uncertain jobs) | done | `replay.ts`, 5 staging tests |
| Router-level outbound suppression: Twilio + Meta + Expo push + email | done | `outboundSuppression.ts`, 9 tests with network recorders |
| Real-handler smoke tests for wave 0a/0b on a disposable DB | done | `jobs-wave0.smoke.test.ts`, 3 tests |

| Check (this commit) | Result |
|---|---|
| `npm run test:jobs` (unit: queue helpers + ownership guard + suppression + registry drift) | 26 pass / 0 fail |
| `npm run test:jobs:staging` (queue + pause/replay; local MongoDB 7.0.14 replica set) | 34 pass / 0 fail |
| `npm run test:jobs:smoke` (wave 0 real handlers + suppression; disposable DB) | 12 pass / 0 fail |
| `npm run typecheck` | clean |
| eslint on every changed/added source and test file | clean |
| `npm run build` | pass (exit 0; `/api/inngest/ownership` included) |

### Explicit blockers (NOT done in this commit, by instruction)

| Blocker | Must be done before |
|---|---|
| **Timezone fix.** `nextBizHourDate` and `lib/scheduleTime.ts` use server-local `getHours()/setHours()`; prod is UTC, so campaign business hours (default 9-20) are really 14:30-01:30 IST. Needs an owner-approved behaviour change using the business timezone (`Asia/Kolkata` default), with a pinned test. | wave 6 (`process-review-campaign`) and any wave that sends within "business hours" |
| **Publishing re-seed tool.** Posts already scheduled in Inngest have sleeping `schedule-single-post-publish` runs that are lost when the function is released. A one-time script must enqueue native `scheduler/post-scheduled` jobs for every future `scheduled` post with deterministic event ids (dry-run first). Without it they publish only via the hourly cron, up to an hour late. | the publishing wave (wave 2 in the revised order) |
| Real handlers for waves 1+ not yet run through the runner (only wave 0a/0b are). | each wave |
| Inventory rows marked `scan` still need a line-by-line read. | each wave |
| Staging for wave-specific flows needs `QA_SUPPRESS_OUTBOUND_SENDS=true`, `GBP_LIVE_WRITES_ENABLED` unset, and no real provider credentials. | each wave |

## Hardening (third commit: `fix(jobs): harden ownership pause and rollback safety`)

Fixes for the review of `1db6172` + `047c2a9`. Nothing here is deployed or enabled.

| Finding | Fix | Evidence |
|---|---|---|
| **H1** typo in `JOBS_NATIVE_FUNCTIONS` took down all Inngest functions and every event send | Web path never throws: unknown/unsupported ids and `*` are logged and ignored (Inngest keeps them); the worker stays strict (exit 1) | `resolveWebOwnership`, lenient `nativeFunctionIds`, `web-ownership.smoke.test.ts` (4), unit (3) |
| **H2** replay claims could be taken by a second replayer; late writes unfenced | Exclusive claim with token + timestamp (10 min lease), outcome writes fenced on the token, `released-on-web` check via the ownership endpoint, no resend outside the ~24 h dedupe window | `replay.ts`, 6 staging tests (concurrent replayers send once; takeover fences the old owner; late failure cannot downgrade) |
| **H3** pause could be missed at start and between claims; no acknowledgement | Control read before the scheduler's first tick and immediately before every claim; `pause --wait` waits for post-pause heartbeats with `paused:true` and `inFlight:0` | `worker.ts`, `pauseWait.ts`, 4 staging + 2 unit tests, CLI exercised end to end |
| **M1** unreadable control doc released in-flight jobs | Blocks new claims only; only an operator pause releases | staging test (job stays `running`, new job stays `queued`) |
| **M2** wrong-database risk | Database + hosts printed on every command; ambiguous targets refused; state changes need `--yes` AND the typed database name | `adminTarget.ts`, 4 unit tests, CLI run (refusals verified) |
| **M3** suppression gaps / production safety | Never honoured in production-like envs (needs `APP_ENV=staging`); Calendar, Razorpay, OAuth revoke FAIL CLOSED; worker refuses live credentials next to active suppression; counts in `/healthz` | `outboundSuppression.ts`, 5 unit + 5 staging tests |
| **M4** guard startup/restart | Worker starts blocked-but-alive and recovers on its own; never exits on a transient failure | `guardMonitor.ts`, 3 unit tests, real worker process run |
| **M5** tests could reach remote/prod DBs | Explicit `TEST_MONGODB_URI`, loopback only, no env files, never `MONGODB_URI` | `loopbackTestDb.mjs`, unit + 3 refusals verified live |
| **M6** sizing | One process, `JOBS_CONCURRENCY=1`, 384 MB old-space flag, restart at 450 MB (Waves 0-1 only). Flag application verified; restart enforcement NOT verified (see follow-up section) | `ecosystem.worker.config.cjs`, `job-worker.launch.mjs` |

Defects found and fixed while doing this: a Razorpay QA guard placed inside a `try` whose handler treats
"cancel" in the message as "already cancelled" (it would have marked the subscription Canceled in the DB); a
test-seed race on the unique `ScheduledAction.idempotencyKey` index; a claim-time control read that was one DB
round trip stale (now immediately before the claim).

| Check (after the final source change) | Result |
|---|---|
| `npm run test:jobs` (unit) | 44 / 44 pass |
| `npm run test:jobs:staging` (queue + safety, local mongod 7.0.14) | 44 / 44 pass |
| `npm run test:jobs:smoke` (wave 0 handlers + suppression + web ownership) | 21 / 21 pass |
| Combined staging + smoke soak, 10 consecutive loaded runs | 10 / 10 runs clean (65 / 65 tests each) |
| `npm run typecheck` | clean |
| ESLint on every changed or added `.ts/.mjs/.cjs` file (44 files) | clean |
| `npm run build` | pass (exit 0; `/api/inngest` and `/api/inngest/ownership` present) |
| Admin CLI end to end (status, refusals, `pause --wait`, idempotent pause, resume, replay dry-run) | verified on a disposable DB |
| Worker process: unreachable guard, typo id, missing token | blocked-but-alive / exit 1 / exit 1 (verified) |

### Still unresolved (explicit)

| Blocker | Must be done before |
|---|---|
| **Timezone fix**: `nextBizHourDate` / `lib/scheduleTime.ts` use server-local hours; prod is UTC, so campaign "business hours" 9-20 are 14:30-01:30 IST. Needs an owner-approved behaviour change plus a pinned test. | wave 6 (`process-review-campaign`) and any business-hours send |
| **Publishing re-seed tool**: sleeping `schedule-single-post-publish` runs are lost when the function is released; needs a dry-run-first script enqueueing native jobs for future `scheduled` posts. | the publishing wave |
| Inngest dashboard gate is manual (the guard cannot see Inngest Cloud); residual race windows are listed in `worker-operations.md`. | every wave |
| Real handlers beyond waves 0a/0b not yet run through the runner; PM2/SIGTERM/reboot not exercised on the droplet; Atlas unreachable from the dev box (tests ran on local mongod). | each wave / deployment |
| 450 MB / 384 MB sizing is for Waves 0-1 only; Chromium (`report-card-deliver`) and AI-heavy waves need the larger droplet and re-sized limits. | those waves |
| `owner-whatsapp-digest-cron` has no atomic claim (double-send risk) and `report-ready-notification` stamps after send. | wave 4 |

## Pre-push audit follow-up (fourth commit: `fix(jobs): align ownership and worker memory limits`)

Closes the two HIGH findings of the read-only audit of `78f8e60`.

| Finding | Fix | Evidence |
|---|---|---|
| **F1** `/api/inngest` and `/api/inngest/ownership` used `partitionOwnership` (id known?) while event routing used `resolveWebOwnership` (id known AND no unsupported options): an owned function with an unsupported option would have been deregistered from Inngest while nothing executed it | One shared rule, `selectServedFunctions` / `buildOwnershipPayload` over `resolveWebOwnership`, used by the route, the ownership endpoint and `dispatch.getRouter`. Unknown ids, `*`, unsupported options and uninspectable functions all stay served by Inngest; nothing throws | `adapter.ts`, 5 new unit tests (unsupported option stays served; typo/`*`/uninspectable; three call sites agree; flag-gated scheduler; guard stays blocked), 1 new smoke test hitting the real endpoint handler |
| **F2** `tsx` CLI launch ran the worker as a child, so `--max-old-space-size` and PM2's `max_memory_restart` applied to the ~42 MB launcher, not the worker | Single process: `scripts/job-worker.launch.mjs` run by `node --import tsx --max-old-space-size=384`; `/healthz` now reports `memory` (pid, rss, V8 heap limit, parsed flag) so the cap can be verified | process tree + PM2 5.4.3 (isolated `PM2_HOME`) + `/healthz`, see `worker-operations.md` "Verified vs not verified" |

| Check (after the final source change) | Result |
|---|---|
| `npm run test:jobs` (unit) | 49 / 49 pass |
| `npm run test:jobs:staging` (queue + safety, local mongod 7.0.14) | 44 / 44 pass |
| `npm run test:jobs:smoke` (wave 0 + suppression + web ownership) | 22 / 22 pass |
| Combined staging + smoke soak, 10 consecutive loaded runs | 10 / 10 clean (66 / 66 tests each) |
| `npm run typecheck` | clean |
| ESLint on every changed or added `.ts/.mjs/.cjs` file | clean |
| `npm run build` | pass (exit 0; `/api/inngest` and `/api/inngest/ownership` present) |

### Memory / launch: verified vs NOT verified

| Item | Status |
|---|---|
| Worker is one process; heap flag applied; PM2 monitors the worker's own pid | **Verified** locally (Windows, PM2 5.4.3, isolated PM2_HOME): PM2 pid == `/healthz` `memory.pid`, `maxOldSpaceFlagMb 384`, V8 `heapLimitMb 576` (= flag + 192 MB young generation) |
| `max_memory_restart: 450M` actually restarts the worker | **NOT verified**: PM2 5.4.3 on Windows reported 0 memory for the process. Needs the Linux droplet (PM2 7.0.3) or a Linux staging host |
| `pm2 stop` / `reload` delivers a signal that drains and releases jobs | **NOT verified**: on Windows PM2 terminated the process without running the handler. The drain/release logic itself is covered by the staging tests. Needs a Linux staging check |
| Real droplet behaviour (PM2 7.0.3, Linux, 1.9 GiB, real RSS under load) | **NOT verified** |

### Still unresolved (explicit, unchanged)

| Blocker | Must be done before |
|---|---|
| **Timezone fix** (`nextBizHourDate`, `lib/scheduleTime.ts` use server-local hours; prod is UTC) | wave 6 and any business-hours send |
| **Publishing re-seed tool** (sleeping `schedule-single-post-publish` runs are lost on release) | the publishing wave |
| **Manual Inngest dashboard gate** (the guard cannot see Inngest Cloud; race windows in `worker-operations.md`) | every wave |
| **Later-wave duplicate-send risks**: `owner-whatsapp-digest-cron` has no atomic claim; `report-ready-notification`, the agent repliers, `process-demo-booking`, the sales drip and the review-campaign initial send send before they record | waves 4-6 |
| Linux/PM2 verification of the 450 MB restart and of graceful SIGTERM drain (above) | Wave 0a on the droplet |
| Real handlers beyond waves 0a/0b through the runner; Atlas unreachable from the dev box | each wave |
