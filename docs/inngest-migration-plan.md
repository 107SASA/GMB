# Inngest → Native Queue Migration Plan

Status: **plan + tooling only. No function is migrated. Inngest remains the owner of all 50 functions.**
Inventory source of truth: `npm run jobs:inventory` (reads the real function module; no DB).

## Result of the automated inventory

50 exported functions: 23 cron-triggered, 27 event-triggered (2 dual: `account-hard-purge`).
**50/50 are adaptable** — none use `throttle`, `rateLimit`, `debounce`, `batch`, `onFailure`, `waitForEvent`, `invoke`, or a non-simple `cancelOn`/concurrency expression. The adapter fails closed (refuses ownership at worker/route startup) if that ever changes.

Step API actually used: `step.run` (≈110), `step.sleep`/`sleepUntil` (14), `step.sendEvent` (≈10). All supported.

## Cutover groups (own events together or the chain breaks)

An event sent by an Inngest-owned function reaches a native function via a patch in `/api/inngest` (`patchInngestStepSend`) and via the wrapped `inngest.send` for API-route senders — so cross-system chains work — but each hop is still a new failure surface. Migrate in this order, each group verified before the next:

| Wave | Functions | Why this order | Idempotency / duplicate-side-effect notes |
|---|---|---|---|
| 0a | `cleanup-stale-pending-audits` | First wave: cron every 10 min, one step, deletes PENDING audits older than 5 min, no sends, repeat is a no-op. Real handler smoke-tested. | safe to repeat |
| 0b | `data-retention-cleanup-cron` | After 0a is clean for >= 1 h: daily 03:15 UTC, cutoff-based deletes/$unset, no sends. Real handler smoke-tested. | safe to repeat |
| 0c (late) | `cleanup-abandoned-signups` | **Not wave 0.** Deletes users, businesses, organizations and subscriptions. Move to the late waves and dry-run first. | per-run idempotent, destructive |
| 1 | `publish-scheduled-posts-cron`, `publish-scheduled-media-cron`, **`schedule-single-post-publish`**, `process-publish-post-job`, `process-scheduled-media-publish-job` | Exercises delayed jobs + `cancelOn`; **GBP live writes are gated off** (`GBP_LIVE_WRITES_ENABLED`) so a mistake is DB-only | `process-publish-post-job` re-checks `status==='scheduled'` |
| 2 | review pipeline: `review-sync-worker`, `process-review-sync-job`, `process-auto-reply-batch-job`, `critical-review-alert-worker`, `review-reply-drafted-worker`, `gbp-nightly-sync-scheduler`, `gbp-sync-worker` | Mostly read/sync; `gbp-sync-worker` needs keyed concurrency (supported) | per-business `limit 1` is DB-enforced |
| 3 | content: `weekly-content-*`, `process-content-job`, `manual-content-generate`, `apply-weekly-offer`, `seo-plan-weekly-summary` | AI-call heavy; duplicate run = wasted tokens, not customer harm | per-slot idempotency already in `process-content-job` |
| 4 | audit: `generate-audit`, `report-ready-notification`, `audit-autopilot-cron`, `performance-digest-15-day`, `owner-whatsapp-digest-cron` | Owner WhatsApp sends — verify digest/notification dedupe first | confirm `OwnerNotifyDigest` claim semantics |
| 5 | CRM/Lead Engine: `nurture-scheduler-tick`, `proactive-nba-scheduler`, `crm-*`, `schedule-lead-follow-ups`, `dispatch-crm-whatsapp`, `process-followup-job`, `follow-up-cron` | WhatsApp sends; already built on `ScheduledAction` claims | atomic claimedAt + unique idempotencyKey (existing) |
| 6 | **`process-review-campaign`**, **`sales-nurture-requested`**, `sales-nurture-consented`, agent replies, `process-whatsapp-message`, `process-demo-booking`, `report-card-deliver` | Longest sleeps / direct customer messaging — last, with a drain plan | see below |
| 7 | `billing-activation-reconcile-cron`, `subscription-expiry-worker`, `account-hard-purge` | Money/destructive — last, `ACCOUNT_PURGE_MODE` stays dry-run during cutover | reconcile reads Razorpay directly (self-healing) |

## Per-function table

Generated, not hand-maintained: run `npm run jobs:inventory` (columns: id, attempts, triggers, concurrency key/limit, cancelOn, unsupported). Required additional manual columns before each wave goes live — **fill in during wave review, not yet done:**

| Field | Source |
|---|---|
| Externally visible side effects per step | read the function; list sends/charges |
| Idempotency guard that makes a repeated step safe | cite code line |
| Safe worker limit | `JOBS_CONCURRENCY=1` for Waves 0-1 on the 1.9 GiB / 1 vCPU box (audit: 1.3 GiB free); raise only after a droplet resize and a measured RSS baseline |
| Validation | wave test in staging with `QA_SUPPRESS_OUTBOUND_SENDS=true` (WhatsApp Twilio+Meta, push, email; NOT Google Calendar invites or Razorpay) |
| Rollback | remove id from `JOBS_NATIVE_FUNCTIONS`, restart web, `PUT /api/inngest` (see rollback doc) |

## In-flight work at cutover (per function)

* **Short event functions** (seconds): drain naturally. After the Inngest resync deregisters the function, in-flight Inngest runs finish; new events go native.
* **Sleeping Inngest runs** (`process-review-campaign` up to days, `sales-nurture-requested` hours, `schedule-single-post-publish` until the post time): **cannot be moved**. Options, per function:
  1. *Drain* (preferred): keep the function registered with Inngest until its sleepers finish, and route only **new** events native — requires a short feature flag by event (`JOBS_NATIVE_FUNCTIONS` is per function id, so the clean way is: wait for the longest sleeper horizon, or accept a period where both exist for *different* events). Not implemented as "split ownership of one function" on purpose — that is exactly the double-run risk.
  2. *Reconcile*: for posts, the hourly `publish-scheduled-posts-cron` safety net already covers any post stuck `scheduled`; for review campaigns, `followUpStillEligible`/`claimFollowUp` guards make a late duplicate a no-op; for sales drip, `ScheduledAction.idempotencyKey` does.
  3. Do **not** cut `process-review-campaign` / `sales-nurture-requested` over until a drain window (≥ longest configured reminder delay) is agreed and communicated.
* **Cron functions**: owner flips at a minute boundary far from the slot; `nextSlot` cannot be run by both because Inngest deregisters on resync before the worker is started (order documented in cutover doc).

## Verification status

| Claim | Evidence |
|---|---|
| Queue/lease/fence/retry/DLQ/sleep/cancel/cron semantics | 21 staging tests passing on MongoDB 7.0 (local throwaway) — `tests/staging/jobs-queue.staging.test.ts` |
| Helpers, flags default off, adapter fail-closed | 10 pure unit tests — `tests/unit/jobs-pure.test.ts` |
| All 50 real functions adapt cleanly | `npm run jobs:inventory` |
| Real business handlers run correctly under the shim | **NOT verified** — needs per-wave staging with suppressed sends |
| Behaviour on Atlas | **NOT verified** — Atlas unreachable from the build machine (IP allow-list); tests ran on local mongod |
| PM2/SIGTERM/reboot on the droplet | **NOT verified** — server audit pending; process death is *simulated* in tests |
