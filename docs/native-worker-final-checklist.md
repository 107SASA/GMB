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

- **Real handlers under the shim.** Queue semantics are proven with synthetic functions. The 50 real handlers have **not** been executed through the native runner; each wave needs a staging run with `QA_TESTING_MODE` send suppression.
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
