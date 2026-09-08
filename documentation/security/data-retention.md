# Data-retention policy & rollout

Implemented Sep 2026 alongside the security-hardening pass.

## What gets deleted, when, how

### Automatically cleaned — native MongoDB TTL index (deletes the whole document)

| Collection | Retention | Anchor field | Why safe to delete the doc |
| --- | --- | --- | --- |
| `ProcessedWebhookEvent` | 30 days | `createdAt` | webhook idempotency record; replays past 30d are already no-ops |
| `LoginLink` | `expiresAt` + 7 days | `expiresAt` | single-use magic link; consumed or expired |
| `AdminInvite` | `expiresAt` + 30 days | `expiresAt` | 48h invite; accept re-checks status + expiry |
| `ReportConversation` | 30 days idle | `updatedAt` | ephemeral lead-gen chat; Business/GBPToken/Audit persist separately |
| `LeadEvent` | 18 months (~548d) | `createdAt` | append-only event log; the Lead + its stage live on the Lead doc |
| `Activity` | 18 months | `createdAt` | CRM activity feed history |
| `AdminActionLog` | 18 months | `createdAt` | admin-action audit trail (compliance) |
| `AIUsageLog` | 12 months | `createdAt` | cost/usage analytics |
| `AutomationLog` | 180 days | `createdAt` | operational/debug log |
| `ReviewMonitorLog` | 180 days | `createdAt` | per-run monitor log |
| `ContentGenerationLog` | 180 days | `createdAt` | AI-generation debug trail (Posts kept separately) |
| `ProfileActivity` | 180 days | `createdAt` | per-business profile-change feed |
| `Notification` | 90 days | `createdAt` | in-app bell |
| `OwnerNotifyDigest` | 7 days | `sentAt` | pre-existing |
| `KeywordVolumeCache` | 45 days | `fetchedAt` | pre-existing (cost cache) |
| `PendingGbpConnection` | 15 minutes | `createdAt` | pre-existing (OAuth staging) |

### Automatically cleaned — `dataRetentionCleanupCron` (daily, state-conditional)

TTL can't express "only terminal states", so these run in a cron
(`services/inngest/functions.ts`):

| Collection | Deleted | Kept |
| --- | --- | --- |
| `MessageQueue` | `status: SENT` older than 30d | PENDING, FAILED |
| `JobQueue` | `status: COMPLETED` older than 30d | PENDING, PROCESSING, FAILED (retryable) |
| `ScheduledAction` | `EXECUTED` / `SKIPPED` / `CANCELLED` older than 90d | PENDING |
| `User` (OTP fields only) | `$unset` of `*OtpHash`/`*OtpExpiry` / reset fields where the expiry is already in the past — **the User document is never deleted** | everything else |
| Sales/Booking/Support/Report `Conversation.messages[]` | atomic `$slice` to the most recent 500 | the conversation doc + its 500 newest messages |

### Permanently retained — NEVER auto-deleted

`Lead`, `Customer`, `Business`, `Organization`, `User`, `Subscription`,
`SeoPlan`, completed `Audit` / `ReportShare` targets, `DemoBooking`,
`SalesConversation` / `BookingConversation` / `SupportConversation` docs
(only their message arrays are capped), `Review`, `Post`, billing records.

`cleanupAbandonedSignups` (pre-existing, unchanged) still hard-deletes
User/Business/Organization/Subscription for *never-verified, never-paid,
never-audited* freemium signups older than 24h — see the security report's
"Findings Remaining" for the recommendation to soften that to a soft-delete.

## Rollout steps (production)

1. **Deploy the code.** New Inngest functions (`dataRetentionCleanupCron`)
   register on the next `/api/inngest` sync.
2. **Build the indexes.** Prod runs with `autoIndex: false`, so:
   ```
   NODE_ENV=production MONGODB_URI=... npx tsx scripts/sync-indexes.ts --apply
   ```
   `syncIndexes()` creates the new TTL/query indexes and drops the renamed
   `AdminInvite` `token_1` unique index (replaced by `tokenHash_1`).
   - ⚠️ **The first TTL sweep (within ~60s of an index being built) bulk-deletes
     every document already past its retention window.** For `ProcessedWebhookEvent`
     (30d) and the 90-day logs this can be a large one-time delete. MongoDB's
     TTL monitor deletes in the background in batches — it will not lock the
     cluster — but expect elevated delete volume for the first few hours.
   - `AIUsageLog` gets a second `createdAt_1` index; the existing `createdAt_-1`
     is untouched.
3. **Env vars** (see `.env.production.example`):
   - `TRUSTED_PROXY_COUNT` — leave unset (defaults to 1) for the plain
     Nginx→Node topology; set `2` only if a CDN is added in front.
   - `AUTOMATION_TRIGGER_SECRET` — set a fresh random value and update the n8n
     credential for `POST /api/automation/trigger`. Until it's set the route
     falls back to `JWT_SECRET` (logs a warning).
4. **AdminInvite migration.** Any invite that is `pending` at deploy time
   becomes unusable (it has a `token`, not a `tokenHash`). Invites are rare +
   48h-lived; just re-create any that were outstanding.
5. **Verify** (see `documentation/security/index-verification.md`).
