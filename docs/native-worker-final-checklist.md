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
| PM2 definition (separate app, 1 instance, 900M cap, 40s kill_timeout) | `ecosystem.worker.config.cjs` |
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
