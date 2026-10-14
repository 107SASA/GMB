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
| `queued` (event-triggered) | event received natively, not yet run | **Use `jobs:admin replay-to-inngest`** (dry run first; see the replay section below). It only replays never-started jobs, with the original event id. Do not hand-send events. |
| `queued` (cron) | a slot that will now be run by Inngest's own schedule | none — discard; Inngest fires its next slot |
| `sleeping` | e.g. a scheduled post waiting for its time, a review reminder waiting days | **Cannot be resumed by Inngest.** Per function: posts → the hourly `publish-scheduled-posts-cron` safety net (Inngest-owned again) picks up any post still `scheduled`; review campaigns → re-send `campaigns/review.request.start` only for customers whose `ReviewRequest` is not complete (in-step guards prevent duplicate sends); sales nurture → `ScheduledAction` rows are DB-driven and unaffected |
| `running` | worker was killed hard | will be re-claimable until the worker is stopped; after stop: treat as `queued` |
| `dead` | exhausted | triage; do not auto-retry on Inngest |

### Replaying queued native jobs back to Inngest (tool)

```bash
npm run jobs:admin -- pause "rollback" --wait --timeout-sec=180 --yes --confirm-db <db-name>
pm2 stop growwmatics-worker                       # wait for status "stopped"
# env: clear the ids from JOBS_NATIVE_FUNCTIONS, pm2 restart growwmatics --update-env, PUT /api/inngest,
#      confirm the functions are registered again in the Inngest dashboard.
npm run jobs:admin -- replay-to-inngest [fnId...]                    # DRY RUN (default): read the summary
npm run jobs:admin -- replay-to-inngest [fnId...] --execute --yes --confirm-db <db-name>
```

**What is replayed.** Only jobs that provably never started: `queued`, zero attempts, zero recoveries, no recorded
steps, event-triggered. Reported and **never replayed**: `running`, `sleeping`, `dead`, retried/recovered, partially
executed (their external side effects are uncertain), cron slots (Inngest fires its own), functions still natively
owned by this environment, and functions the running web app still reports as released
(`/api/inngest/ownership`, skip reason `released-on-web`).

**Exclusive, fenced claims.** Each replay flips a job to `cancelled / replay-pending` with a random claim token and a
timestamp. A second replayer cannot take it while the claim lease (10 min) is live (skip reason `replay-in-progress`;
the claim itself is a conditional update, so even a stale plan cannot steal it). The outcome write
(`replayed-to-inngest` / `replay-failed`) is **fenced on the token**: a slow or wedged replayer that lost its claim can
neither overwrite the owner's result nor downgrade a completed replay (counted as `lostClaim`, exit code 2). The native
worker can never run a replayed job.

**Interrupted replays.** A claim older than the lease is taken over and resent with the **same event id**, so
Inngest's event-id dedupe (about 24 h) absorbs a repeat. Interrupted or failed replays older than the dedupe window
(23 h) are NOT resent (`outside-dedupe-window`); inspect them by hand, and only then use
`--allow-outside-dedupe-window`.

**Preconditions the tool enforces.** Dry-run by default; `--execute` needs `--yes` and the typed `--confirm-db`; it
refuses while any worker heartbeat is live; it refuses unless the ownership endpoint can be reached and the function
is not listed as released (`--skip-ownership-check` only after confirming by hand); it needs a real
`INNGEST_EVENT_KEY`.

**Residual ambiguity (documented, not removable).** Duplicate suppression after an interruption depends on
Inngest's id dedupe; if a send times out after Inngest accepted it, the claim stays `replay-pending` and the next run
resends the same id inside the window (absorbed). No event today has both a native and an Inngest listener; if one is
added, the shared id would make Inngest drop the replay: check this before adding multi-listener events.

**Verify without causing duplicate customer-visible effects:**

1. Compare the dry-run `eligible` count with the execute `replayed` count; `lostClaim` and `failed` must be 0.
2. In the Inngest dashboard search the event name: each replayed event id must appear once and trigger one run.
3. `jobs:admin list cancelled <fnId>` should show `replayed-to-inngest`; none `replay-pending` or `replay-failed`.
4. Re-run the dry run: `eligible` must be 0.
5. Spot-check the customer-visible effect for 2 or 3 jobs (message sent once, post published once) before replaying a
   second function. Replay one function at a time.

Never **delete** native job documents during rollback — they are the audit trail. Mark nothing; just stop the worker.

## Rolling back the CODE (not just config)

The change is additive and inert by default. To remove the code path entirely: revert the touched existing files (`src/services/inngest/client.ts` send wrapper, `src/app/api/inngest/route.ts` filter/patch, `package.json` scripts + tsx devDependency, and the one-line outbound-suppression gates in `src/services/{email,push}.ts`, `src/services/twilio/client.ts`, `src/services/whatsapp/meta.ts`), delete `src/services/jobs/`, `src/lib/outboundSuppression.ts` and `src/app/api/inngest/ownership/`. Not needed for an operational rollback — clearing env is sufficient and faster.

## Rollback verification

- Inngest dashboard lists the functions; a manual trigger (cron "Invoke" or a test event) runs.
- `jobs:admin workers` shows no `running` worker (status `stopped`).
- No new rows entering `native_jobs` (`stats` counts stable) — if rows are still being created, the web process still has the old env: re-check `pm2 restart --update-env`.

## What rollback cannot do

- Resume native `sleeping` runs inside Inngest (see table).
- Undo external side effects already performed (messages sent, posts published).
