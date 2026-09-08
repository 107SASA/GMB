# Index verification (post data-retention pass)

## New / changed indexes

| Collection | Index | Kind | Serves |
| --- | --- | --- | --- |
| `ProcessedWebhookEvent` | `{createdAt: 1}` | TTL 30d | cleanup only |
| `LoginLink` | `{expiresAt: 1}` | TTL 7d | cleanup only |
| `AdminInvite` | `{tokenHash: 1}` unique | unique | `accept` lookup by hash |
| `AdminInvite` | `{expiresAt: 1}` | TTL 30d | cleanup only |
| `AdminInvite` | ~~`{token: 1}` unique~~ | **DROPPED** (field renamed) | — |
| `ReportConversation` | `{updatedAt: 1}` | TTL 30d idle | cleanup only |
| `LeadEvent` | `{createdAt: 1}` | TTL 548d | cleanup only |
| `Activity` | `{createdAt: 1}` | TTL 548d | cleanup only |
| `AdminActionLog` (new model) | `{adminUserId:1}`, `{action:1}`, `{targetBusinessId:1}`, `{createdAt:1}` TTL 548d | — | admin-action queries + cleanup |
| `AIUsageLog` | `{createdAt: 1}` | TTL 365d | cleanup only (existing `{createdAt:-1}` kept for sorts) |
| `AutomationLog` / `ReviewMonitorLog` / `ContentGenerationLog` / `ProfileActivity` | `{createdAt: 1}` | TTL 180d | cleanup only |
| `Notification` | `{createdAt: 1}` | TTL 90d | cleanup only |
| `Lead` | `{tenantId: 1, phone: 1}` | compound | dedup `findOne({phone, tenantId})` |
| `DemoBooking` | `{leadId: 1, status: 1}` | compound | admin Demos + `fileDemoRequest` |

## Static review notes

- **No two indexes share a key pattern.** All TTL indexes are single-field
  ascending `{field: 1}` — the canonical, universally-supported TTL shape.
- **`Lead`**: `tenantId` keeps its standalone inline `index: true`. The new
  `{tenantId, phone}` compound makes `{tenantId}` a redundant *prefix*, but
  the standalone is smaller for the pure-`tenantId` admin filters and MongoDB
  keeps both without conflict. Not worth a field-level schema change to remove.
- **`AIUsageLog`**: intentionally carries both `{createdAt: 1}` (TTL) and
  `{createdAt: -1}` (existing, descending analytics sort). Two small
  single-field indexes; acceptable.

## Verify on the cluster after `scripts/sync-indexes.ts --apply`

```js
// In mongosh against the prod DB:
db.processedwebhookevents.getIndexes()   // expect createdAt_1 { expireAfterSeconds: 2592000 }
db.loginlinks.getIndexes()               // expect expiresAt_1 { expireAfterSeconds: 604800 }
db.admininvites.getIndexes()             // expect tokenHash_1 { unique: true }, expiresAt_1 TTL; NO token_1
db.leadevents.getIndexes()               // expect createdAt_1 TTL ~47.3M s
db.leads.getIndexes()                    // expect tenantId_1_phone_1
db.demobookings.getIndexes()             // expect leadId_1_status_1

// Confirm the dedup query uses the new index (not a COLLSCAN):
db.leads.find({ phone: "+15551234567", tenantId: "gmbboost-internal" }).explain("queryPlanner")
//   winningPlan.inputStage.indexName === "tenantId_1_phone_1"

// Confirm TTL is actually running (server-wide):
db.serverStatus().metrics.ttl        // passes + deletedDocuments should climb
```

## One-time bulk delete warning

Creating a TTL index on a collection that already holds data past the window
makes MongoDB's TTL monitor start deleting on its next pass (~60s). For
`ProcessedWebhookEvent` (30d) and the 90/180-day logs this is a large one-time
delete. It runs in the background in batches and does not lock the cluster,
but schedule the `sync-indexes` run for a low-traffic window and watch
`db.serverStatus().metrics.ttl.deletedDocuments` + disk/oplog.
