# Rollback Procedure

Status: procedure only. Nothing has been cut over, so there is **nothing to roll back today**: with no `JOBS_NATIVE_*` env vars set, production behaves exactly as before this change.

## Principle

Rollback = give ownership back to Inngest in the reverse order of cutover, then deal with whatever the native queue still holds.

```
1. Worker STOPS        (native stops claiming; in-flight drained/released)
2. Env cleared         (JOBS_NATIVE_FUNCTIONS) + web restart
3. Inngest REGISTERS fn (resync)   ──► Inngest owns again
4. Reconcile pending native jobs
```

## Steps

```bash
# 1. Stop the worker gracefully (SIGTERM → drain ≤25 s → release leftovers)
pm2 stop growwmatics-worker            # wait for "worker stopped" in logs

# 2. Capture what native still holds BEFORE changing anything
npm run jobs:admin -- stats > /tmp/native-stats.txt
npm run jobs:admin -- list queued   > /tmp/native-queued.txt
npm run jobs:admin -- list sleeping > /tmp/native-sleeping.txt
npm run jobs:admin -- list dead     > /tmp/native-dead.txt

# 3. Hand back ownership
#    Edit .env.production: remove the wave's ids from JOBS_NATIVE_FUNCTIONS
#    (or set JOBS_NATIVE_ENABLED=false to return everything)
pm2 restart growwmatics --update-env
curl -s -X PUT https://growwmatics.com/api/inngest     # "Successfully registered"
#    Confirm in the Inngest dashboard the functions are registered again.
```

## Reconciling the native queue (per state)

| Native state | Meaning | Action |
|---|---|---|
| `completed` / `cancelled` | done | none (TTL cleans up) |
| `queued` (event-triggered) | event received natively, not yet run | **Re-send the event to Inngest** if the work is still wanted: the event name is `eventName`, payload `data`. Read via `jobs:admin show <id>` (payload keys only) / direct DB read. Idempotent handlers make a late run safe. |
| `queued` (cron) | a slot that will now be run by Inngest's own schedule | none — discard; Inngest fires its next slot |
| `sleeping` | e.g. a scheduled post waiting for its time, a review reminder waiting days | **Cannot be resumed by Inngest.** Per function: posts → the hourly `publish-scheduled-posts-cron` safety net (Inngest-owned again) picks up any post still `scheduled`; review campaigns → re-send `campaigns/review.request.start` only for customers whose `ReviewRequest` is not complete (in-step guards prevent duplicate sends); sales nurture → `ScheduledAction` rows are DB-driven and unaffected |
| `running` | worker was killed hard | will be re-claimable until the worker is stopped; after stop: treat as `queued` |
| `dead` | exhausted | triage; do not auto-retry on Inngest |

Never **delete** native job documents during rollback — they are the audit trail. Mark nothing; just stop the worker.

## Rolling back the CODE (not just config)

The change is additive and inert by default. To remove the code path entirely: revert the three touched existing files (`src/services/inngest/client.ts` send wrapper, `src/app/api/inngest/route.ts` filter/patch, `package.json` tsx devDependency) and delete `src/services/jobs/`. Not needed for an operational rollback — clearing env is sufficient and faster.

## Rollback verification

- Inngest dashboard lists the functions; a manual trigger (cron "Invoke" or a test event) runs.
- `jobs:admin workers` shows no `running` worker (status `stopped`).
- No new rows entering `native_jobs` (`stats` counts stable) — if rows are still being created, the web process still has the old env: re-check `pm2 restart --update-env`.

## What rollback cannot do

- Resume native `sleeping` runs inside Inngest (see table).
- Undo external side effects already performed (messages sent, posts published).
