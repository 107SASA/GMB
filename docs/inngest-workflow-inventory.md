# Inngest workflow inventory and migration matrix

Generated 2026-10-14 from `src/services/inngest/functions.ts` (50 functions) by `npm run jobs:inventory` plus a structural scan. Rows marked **read** had their handler inspected line by line; rows marked **scan** were derived from structure/keywords only and **must be read during their wave review** before cutover.

**Timezone note (applies to every row).** Cron expressions are evaluated in **UTC** in both Inngest and the native scheduler (`time.ts` rejects `TZ=`), so `0 13 * * *` is 18:30 IST in both. Business-hour logic inside handlers (`nextBizHourDate`, review campaigns) uses the process-local clock (`Date#getHours`), so the worker must run in the **same TZ as the web app**. It does when both start under the same PM2 daemon; verify with `date` and `pm2 env` before cutover. This latent behaviour is preserved, not changed, by the migration.

| # | Function id | Trigger | Producers | Attempts | Concurrency / cancelOn | Sleeps | Emits | Guards and side-effect notes | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `process-whatsapp-message` | event:whatsapp/incoming | whatsapp/webhook | 4 | - | - | - | Inbound dedupe by twilioSid (functions.ts:59). Outbound replies are not individually idempotent: crash after send and before step persist can duplicate one reply (same exposure as under Inngest). | read |
| 2 | `follow-up-cron` | cron:0 * * * * | scheduler (cron) | 5 | - | - | - | scan: no guard keywords detected | scan |
| 3 | `process-followup-job` | event:scheduler/follow-up | - | 4 | - | - | - | scan: status==='Converted', status==='Lost', isOptedOut | scan |
| 4 | `buffer-monitor-worker` | cron:0 8 * * * | scheduler (cron) | 5 | - | - | - | scan: no guard keywords detected | scan |
| 5 | `weekly-content-reminder` | cron:0 13 * * 0 | scheduler (cron) | 5 | - | - | - | scan: GBP_LIVE_WRITES_ENABLED | scan |
| 6 | `weekly-content-autopilot` | cron:0 * * * * | scheduler (cron) | 5 | - | - | - | Atomic claim (findOneAndUpdate) per business/week. | read |
| 7 | `billing-activation-reconcile-cron` | cron:*/30 * * * * | scheduler (cron) | 5 | - | - | - | Reads Razorpay directly; self-healing and idempotent by construction. | read |
| 8 | `subscription-expiry-worker` | cron:0 6 * * * | scheduler (cron) | 5 | - | - | - | updateOne status transitions; verify reminder dedupe flag before wave 7. | read |
| 9 | `manual-content-generate` | event:scheduler/manual-generate | scheduler/generate, n8n/generate-content, admin trigger | 5 | - | - | scheduler/generate | scan: no guard keywords detected | scan |
| 10 | `process-content-job` | event:scheduler/generate | lib/contentAutopilot, manual-content-generate | 4 | - | - | - | scan: idempotency, status==='scheduled', status==='draft' | scan |
| 11 | `apply-weekly-offer` | event:content/weekly-offer.answered | api/content/weekly-offer | 3 | - | - | scheduler/post-scheduled | applyWeeklyOffer keyed by (businessId, weekKey); only `created` schedules a post. incrementUsage is a separate step (can double count on a crash between steps; cosmetic). | read |
| 12 | `process-review-campaign` | event:campaigns/review.request.start | campaigns/send, campaigns/[id]/launch, customers/quick-add | 4 | - | 5 | - | Longest sleeps (reminder days). Guards: claimFollowUp (atomic findOneAndUpdate), alreadySent, status checks, opt-out. Residual: crash between send and persisting alreadySent can re-send the initial message once. Business hours use server-local getHours (see TZ note). | read |
| 13 | `process-review-autopoll-job` | event:scheduler/review-autopoll | - | 4 | - | - | - | scan: status!=="scheduled" | scan |
| 14 | `schedule-single-post-publish` | event:scheduler/post-scheduled | content/schedule(+batch, auto-schedule), scheduler/schedule, posts/[id], apply-weekly-offer | 5 | cancelOn=scheduler/post-scheduled~postId,scheduler/post-unscheduled~postId | 1 | scheduler/publish-post | sleepUntil scheduled time then sendEvent publish-post. cancelOn post-scheduled/unscheduled by postId (native: tested, exactly one publish). Hourly publish-scheduled-posts-cron is the safety net. | read |
| 15 | `publish-scheduled-posts-cron` | cron:0 * * * * | scheduler (cron) | 5 | - | - | - | scan: no guard keywords detected | scan |
| 16 | `process-publish-post-job` | event:scheduler/publish-post | schedule-single-post-publish, admin/automations/trigger | 4 | - | - | - | Atomic claim scheduled->publishing (publishPost.ts:29) = at-most-once Google write; a crash leaves `publishing`, swept to `failed` after 30 min ("outcome unknown"), never auto-republished. GBP_LIVE_WRITES_ENABLED gate. Re-run returns `skipped`, so post-publish notifications do not repeat. | read |
| 17 | `publish-scheduled-media-cron` | cron:*/15 * * * * | scheduler (cron) | 5 | - | - | - | scan: no guard keywords detected | scan |
| 18 | `process-scheduled-media-publish-job` | event:gbp-media/publish-scheduled | - | 4 | - | - | - | scan: updateOne; side-effect calls: publishAsset | scan |
| 19 | `generate-audit` | event:audit/generate.requested | api/audit, lib/startAudit | 5 | - | 1 | sales/nurture.requested, report/ready.requested | scan: updateOne, status!=='COMPLETED' | scan |
| 20 | `report-ready-notification` | event:report/ready.requested | generate-audit | 5 | - | - | - | scan: status!=='COMPLETED', updateOne; side-effect calls: sendTemplateMessage | scan |
| 21 | `cleanup-stale-pending-audits` | cron:*/10 * * * * | scheduler (cron) | 5 | - | - | - | scan: no guard keywords detected | scan |
| 22 | `audit-autopilot-cron` | cron:0 * * * * | scheduler (cron) | 5 | - | - | - | claimAndDispatch atomic claim per business. | read |
| 23 | `owner-whatsapp-digest-cron` | cron:30 13 * * * | scheduler (cron) | 5 | - | - | - | Digest claim semantics: verify OwnerNotifyDigest claim before wave 4. | read |
| 24 | `performance-digest-15-day` | cron:30 4 * * * | scheduler (cron) | 5 | - | - | - | scan: no guard keywords detected | scan |
| 25 | `seo-plan-weekly-summary` | cron:0 12 * * 1 | scheduler (cron) | 5 | - | 3 | - | scan: status!=='active', idempotencyKey | scan |
| 26 | `sales-nurture-requested` | event:sales/nurture.requested | generate-audit | 5 | - | 2 | - | scan: status!=='COMPLETED', isOptedOut, updateOne, status!=='active'; side-effect calls: sendTemplateMessage | scan |
| 27 | `sales-nurture-consented` | event:sales/nurture.consented | whatsapp/webhook | 5 | - | - | - | scan: status!=='active', isOptedOut | scan |
| 28 | `sales-agent-reply` | event:sales/agent.reply | whatsapp/webhook | 3 | - | - | - | scan: status!=='active', dedupes | scan |
| 29 | `booking-agent-reply` | event:booking/agent.reply | whatsapp/webhook, leads/book-demo | 3 | - | - | demo/booked | claimAndSend / claimDemoConfirmationSend (atomic claim) + idempotencyKey on confirmation: strongest guards in the codebase. | read |
| 30 | `support-agent-reply` | event:support/agent.reply | whatsapp/webhook | 3 | - | - | - | scan: status!=='active' | scan |
| 31 | `report-agent-reply` | event:report/agent.reply | whatsapp/webhook | 3 | - | - | - | scan: status==='stopped', status!=='awaiting_connection', status==='connected' | scan |
| 32 | `report-card-deliver` | event:report/deliver.requested | lib/reportConnect | 2 | - | - | - | scan: status!=='connected', isOptedOut, status==='COMPLETED', status==='FAILED', status!=='COMPLETED' | scan |
| 33 | `review-sync-worker` | cron:0 2 * * * | scheduler (cron) | 5 | - | - | - | scan: no guard keywords detected | scan |
| 34 | `process-review-sync-job` | event:reviews/sync | admin trigger | 4 | - | - | - | scan: no guard keywords detected | scan |
| 35 | `process-auto-reply-batch-job` | event:reviews/auto-reply-batch | reviews/reply-settings, services/reviews/syncReviews | 3 | - | - | reviews/reply-drafted | scan: no guard keywords detected | scan |
| 36 | `critical-review-alert-worker` | event:reviews/critical-alert | services/reviews, syncReviews | 5 | - | - | - | scan: no guard keywords detected | scan |
| 37 | `review-reply-drafted-worker` | event:reviews/reply-drafted | services/reviews, process-auto-reply-batch-job | 5 | - | - | - | scan: no guard keywords detected | scan |
| 38 | `schedule-lead-follow-ups` | event:crm/lead-created | services/crm/customerLeads | 5 | - | - | - | scan: no guard keywords detected | scan |
| 39 | `dispatch-crm-whatsapp` | event:crm/dispatch-whatsapp | - | 5 | - | - | - | scan: no guard keywords detected | scan |
| 40 | `crm-follow-up-reminders` | cron:*/15 * * * * | scheduler (cron) | 5 | - | - | - | scan: no guard keywords detected | scan |
| 41 | `crm-stale-lead-reminders` | cron:30 4 * * * | scheduler (cron) | 5 | - | - | - | scan: no guard keywords detected | scan |
| 42 | `crm-growth-report-ready` | cron:45 4 * * * | scheduler (cron) | 5 | - | - | - | scan: no guard keywords detected | scan |
| 43 | `process-demo-booking` | event:demo/booked | leads/book-demo, booking-agent-reply | 4 | - | - | - | scan: no guard keywords detected | scan |
| 44 | `gbp-nightly-sync-scheduler` | cron:0 */6 * * * | scheduler (cron) | 5 | - | - | - | scan: no guard keywords detected | scan |
| 45 | `gbp-sync-worker` | event:gbp/sync.requested | api/gbp/sync, lib/gbpConnect | 3 | key=event.data.businessId limit=5 | - | - | Keyed concurrency (businessId, limit 5 = Inngest plan cap). Native: DB-enforced one-per-key. | read |
| 46 | `cleanup-abandoned-signups` | cron:0 4 * * * | scheduler (cron) | 5 | - | - | - | scan: no guard keywords detected | scan |
| 47 | `nurture-scheduler-tick` | cron:*/15 * * * * | scheduler (cron) | 5 | - | - | - | ScheduledAction atomic claimedAt + unique idempotencyKey; status EXECUTED check; opt-out recheck. | read |
| 48 | `proactive-nba-scheduler` | cron:*/30 * * * * | scheduler (cron) | 5 | - | - | - | Registered only when LEAD_ENGINE_V2=true (independent of JOBS_NATIVE_*). idempotencyKey + opt-out. | read |
| 49 | `data-retention-cleanup-cron` | cron:15 3 * * * | scheduler (cron) | 5 | - | - | - | scan: no guard keywords detected | scan |
| 50 | `account-hard-purge` | event:account/purge.requested | cron:45 3 * * * | scheduler (cron) | 2 | - | - | - | Destructive; ACCOUNT_PURGE_MODE must stay dry-run during cutover. | read |

## Reading the table

- **Attempts** = Inngest attempts (initial + retries) the adapter reproduces; native backs off exponentially with jitter, capped, then dead-letters (`npm run jobs:admin` lists dead jobs).
- **Sleeps** = count of durable `step.sleep/sleepUntil` call sites in the surrounding block (the extractor's block boundaries include helper code between functions, so treat counts as an upper bound). Native sleeps live in the job document (tests: "durable sleep", "long workflow survives a crash while sleeping").
- **Emits** = events sent via `step.sendEvent`; routed to whichever system owns the target and memoised so a retry does not re-enqueue.
- Wave order, drain rules for sleeping Inngest runs and cutover conditions: `docs/inngest-migration-plan.md`.

## Residual duplicate windows (exist under Inngest today; not introduced by migration)

1. **External send, then crash before the step result is persisted** re-runs that step on retry. Handlers with an atomic claim before the send (booking agent, nurture ticks, review-campaign follow-ups, publish) are protected; plain reply senders (`process-whatsapp-message`, `sales-agent-reply`, `support-agent-reply`) can emit one duplicate reply in that window.
2. **Usage counters** incremented in a separate step from the action can drift by one.
3. **Inbound webhook retries** from Twilio/Meta are deduped by message SID before processing (`twilioSid`), so they do not multiply jobs.
