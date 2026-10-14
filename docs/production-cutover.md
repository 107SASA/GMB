# Production Cutover Procedure

Status: **PROCEDURE ONLY — nothing here has been executed. Do not start without explicit approval per wave.**
Sections marked **PENDING SERVER AUDIT** depend on facts not yet gathered (droplet size, PM2 layout, Atlas backup state).

## Preconditions (all must be true)

1. Verified backups exist: Atlas snapshot/PIT confirmed, DO droplet snapshot taken, env/PM2/nginx archive stored encrypted (`backup-and-recovery.md`). **PENDING**
2. Droplet resized per approved plan, or explicit decision to run the worker on the current 1.9 GB box (not recommended — build already OOMs). **PENDING**
3. Staging run of the wave's functions passes with sends suppressed (`QA_SUPPRESS_OUTBOUND_SENDS=true`; `QA_TESTING_MODE` is only the onboarding-gate bypass and is ignored when `NODE_ENV=production`), against a non-prod DB.
4. `npm run jobs:inventory` shows the wave's functions without `UNSUPPORTED`.
5. Wave reviewed for the "idempotency guard per externally visible step" table (`inngest-migration-plan.md`).
6. Maintenance window communicated; rollback owner named.

## Ownership rule

At every instant each function id has exactly one owner. The order below guarantees it:

```
1. Native OFF            (state: Inngest owns all)
2. Inngest RELEASES fn   (env set on web + resync) ──► fn deregistered from Inngest Cloud
3. Worker STARTS         ──► native owns fn
```
Never start the worker before step 2 is confirmed (a cron would run in both).

## Per-wave steps  (first wave suggestion: Wave 0, a cleanup cron)

On the droplet, in the app directory. `W` = comma list of the wave's function ids.

```bash
# 0. Snapshot current state
pm2 list; pm2 describe growwmatics | head -20
curl -s localhost:3000/api/health || true            # whatever health URL exists  (PENDING)

# 1. Put worker env in .env.production (NOT committed). Worker stays stopped.
#    JOBS_NATIVE_ENABLED=true
#    JOBS_NATIVE_FUNCTIONS=$W
#    JOBS_COLLECTION_PREFIX=native_   (JOBS_CONCURRENCY is pinned to 1 by ecosystem.worker.config.cjs for Waves 0-1)
#    JOBS_GUARD_TOKEN=<long random secret>   (same value for web AND worker; enables the
#                                             ownership guard endpoint the worker checks)
#    (never set INNGEST_DEV)

# 2. Release the functions from Inngest: restart web so /api/inngest drops them, resync
pm2 restart growwmatics --update-env
sleep 5
curl -s -X PUT https://growwmatics.com/api/inngest    # expect "Successfully registered"
#    Verify in the Inngest dashboard the wave's functions are GONE from the app.

# 2b. Manual gate (the worker's ownership guard cannot see Inngest Cloud): in the Inngest
#     dashboard confirm every id in $W is no longer registered. If not, STOP.
# 3. Create indexes + start the worker (first start creates native_* indexes).
#    The worker starts BLOCKED and verifies web via GET /api/inngest/ownership; it claims nothing
#    (and leads no cron) until every owned id is released on web, and re-blocks if that ever stops being true.
#    State: curl -s 127.0.0.1:3911/healthz  (claimBlockedReason / ownershipGuard).
pm2 start ecosystem.worker.config.cjs
pm2 logs growwmatics-worker --lines 50                # expect: worker started {functions:[...]}
curl -s 127.0.0.1:3911/healthz                        # ok:true, leader:true after ≤10 s

# 4. Smoke
npm run jobs:admin -- stats
npm run jobs:admin -- list dead                       # expect none
```

`scripts/deploy.sh` step 6 (`PUT /api/inngest`) stays as-is and is correct: after a deploy it re-registers exactly the non-owned functions because `route.ts` filters by `JOBS_NATIVE_FUNCTIONS`.

### What to watch for 30–60 minutes after each wave

| Signal | Source | Healthy |
|---|---|---|
| Worker alive, leader elected | `/healthz`, `jobs:admin workers` | exactly one `leader:true` |
| Cron slots fired | worker logs `cron fired`, `native_job_cron_state.lastSlotAt` advancing | each cron within its period |
| Backlog | `jobs:admin stats` → `oldestDueAgeMs` | < 2× `JOBS_POLL_MS` normally, < 5 min worst case |
| Dead letters | `jobs:admin list dead` | 0 (investigate every entry) |
| Duplicates | for the wave's side effect (posts published once, digest sent once) | exactly once |
| Memory/CPU | `pm2 describe growwmatics-worker`, `ps -o pid,ppid,rss,args -C node`, `/healthz` `memory`, `free -m` | ONE worker process carrying `--max-old-space-size=384`; RSS < 350 MB is a **target** (idle ~120-150 MB observed locally); PM2 restart at 450 MB is configured but its enforcement is **not yet verified**; **re-baseline after the first hour** |
| Inngest dashboard | runs for non-owned fns | unchanged |

## Wave 6 (long sleepers) — extra procedure

`process-review-campaign`, `sales-nurture-requested`: runs already sleeping in Inngest Cloud will **not** be migrated.

1. Determine the longest configured reminder delay (`reminder2AfterDays`) and nurture follow-up spacing.
2. Choose: (a) *freeze new starts* — stop sending the triggering events for the drain window while leaving the function Inngest-owned, then cut over when `Inngest → Runs → status Sleeping` is empty for that function; or (b) accept overlap, relying on the in-step guards (`followUpStillEligible` / `claimFollowUp` for reviews; `ScheduledAction.idempotencyKey` for nurture) so an old Inngest sleeper that wakes after its function was deregistered is simply dropped by Inngest and the *native* copy (created from the same event only if it was sent after cutover) is the sole sender.
3. **Known gap:** with option (b), any sleeper started before cutover and not yet woken is *lost* when Inngest deregisters the function (expected behaviour for runs of a function that is no longer registered — **unverified; test in a non-prod Inngest environment before relying on either reading**). Therefore only option (a) is acceptable for these two functions.

## Stop conditions (abort and roll back immediately)

Any dead letter you cannot explain within 15 minutes; any duplicate customer-visible message; worker restart loop (`pm2` restarts > 3 in 10 min); `oldestDueAgeMs` > 10 min and rising; DB connection errors on the web app.

See `rollback-procedure.md`.
