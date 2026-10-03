# CRM — how it works (web dashboard + mobile app)

_Last updated: 2 Oct 2026. This describes the Customer CRM after the "Logic & ROI" rework. The super-admin CRM (section 10) was not changed._

GrowwMatics has **two separate CRMs**:

| | Customer CRM | Super-admin CRM |
|---|---|---|
| Who uses it | Business owners (our customers) | GrowwMatics team |
| Where | Web `/dashboard/crm`, mobile app **CRM** (Leads) | Web `/admin/crm`, `/admin/leads`, `/admin/pipeline` |
| Whose leads | Each business's own customers and prospects | GrowwMatics' own sales prospects (free report, demo bookings) |
| Stored as | `Lead` with the business's `businessId`, `leadType: 'Client Prospect'` | `Lead` with `tenantId: 'gmbboost-internal'`, `leadType: 'Platform Prospect'` |

The two never mix. Customer CRM queries filter by `businessId`, and the customer service refuses the platform tenant outright.

---

## 1. Principles

- **The CRM never messages a lead automatically.** The old Day 1/3/7 WhatsApp chain (sent from GrowwMatics' number) has been removed. Any event still queued from it is dropped (`services/crm/legacyDispatch.ts`). Follow-ups are now **tasks for the owner**.
- **No invented numbers.** Revenue and ROI come only from deal values the owner enters. ROI % appears only when the owner sets a monthly investment; otherwise it says "ROI unavailable — investment/cost not configured."
- **No AI lead scoring.** The Customer CRM has no score, no Hot/Warm/Cold label and no AI insight, and makes **no AI call** when a lead is created, imported or updated. Leads are judged by their stage, activity, follow-ups, appointments and deal value.
- **One logic layer.** Every lead-creation path goes through `createOrUpdateCustomerLead()`, and every stage move goes through `changeCustomerLeadStage()` (`services/crm/customerLeads.ts`).
- **Workspace security.** Every route uses `requireBusinessContext()` and filters by the active `businessId`. A lead, task, call or ROI figure from another workspace returns 404 or an empty result.

## 2. Access

- Every customer CRM API uses `requireBusinessContext()` (the user's active workspace) and `requireModule(userId, 'sales_agent')`.

## 3. Where leads come from (all through `createOrUpdateCustomerLead`)

| Source (`Lead.source`) | How | Surface | Route |
|---|---|---|---|
| `WhatsApp` | A person messages the business's own WhatsApp number | automatic | `api/whatsapp/webhook` |
| `Phone Call` | A caller to the Twilio tracking number whom the owner chooses to **save** (see section 8) | owner decides | `api/crm/calls/[id]` |
| `Manual` | Add Lead form (name, phone, value, notes) | Web | `POST api/crm/leads` |
| `Manual` / `Phone Call` | Add lead / Log a call | App | `POST api/leads/quick-add` |
| `CSV Import` (or a recognised source column) | Import CSV/XLSX, up to 1,000 rows and 5 MB | Web | `POST api/crm/leads/import` |
| `Contacts Import` | The owner picks phone contacts (up to 200 per call) | App | `POST api/leads/bulk-import` |
| `Campaign Import` | Campaigns → Upload customers (tagged "Past customer") | Web | `POST api/campaigns/import` |
| `Appointment` | Booking an appointment for a new person | Web | `POST api/appointments` |

What the central service does:
- It normalizes the phone to E.164 and the email to lowercase.
- It **dedupes within the workspace** by phone (format-insensitive `phoneDedupeKey`) or email. An existing lead is returned and only its empty fields are filled.
- New leads start in `lifeCycleStage: 'initial'`. They get a `lead_created` timeline entry and a `crm/lead-created` event whose only job is the owner's new-lead alert.
- An imported row marked "converted" lands in Open, because a Won lead needs a real deal value.
- The owner gets a WhatsApp alert only for **organic** sources (WhatsApp, Google Business Profile, Phone Call, Website, Instagram, Facebook). Bulk paths (CSV, contacts, campaign) never alert, even when a row's source column says WhatsApp.

## 4. AI lead scoring — removed (Oct 2026)

The Customer CRM no longer scores leads, so there is no score service, prompt, rescore job, `crm/lead-rescore` event or score UI on web or mobile. Creating or importing a lead makes **zero** AI calls.

The Lead fields `aiLeadScore`, `aiInsights`, `qualificationStatus` and `urgency` stay in the schema because the platform/super-admin CRM (free report, demo bookings, admin pages) still writes and reads them. The Customer CRM neither reads nor writes them. Values stored on old customer leads are left in place (no destructive migration) and are not shown anywhere in the Customer CRM.

## 5. Stages — one model on web and app

`lifeCycleStage` (fixed: `initial` / `active` / `converted` / `closed`) + a sub-stage with a **stable id** (`subStageId`, plus `subStage` as the display name).

| Group | Default sub-stages (id) |
|---|---|
| Open (`initial`) | — |
| Active | New (`active-new`), Exploring, Interested, Follow Up, Prospect |
| Converted (Won) | Sales Closed (`converted-sales-closed`) |
| Closed (Lost) | Lost (`closed-lost`), No Need, Budget Issues |

- Owners edit sub-stages under **CRM → Lead Stages**. The ids are stored on `Business.leadStages[group][].id`.
- A **rename or reorder keeps the id**, and the leads in a renamed sub-stage get the new name.
- A newly added stage can never take a renamed one's id.
- **Deleting a sub-stage** never moves or rewrites its leads. They keep their group, sub-stage name and id, show in the group's "unsorted" Kanban column, and stay in every list. Re-adding a stage with the same name restores the same id, so they re-attach.
- The web Kanban, the web drawer and the app all send `{ lifeCycleStage, subStageId }`.
- **Moving to Converted asks for the deal value.** The fields are amount, currency, closed date and notes. Without a value the API returns **422 `DEAL_VALUE_REQUIRED`**, and the Kanban card snaps back.
- Converted sets `convertedAt` plus a `deal_won` entry; Closed sets `lostAt` plus `deal_lost`; every move adds `status_change`.
- **Older app builds** that still send only `pipelineStage` are mapped through a compatibility shim. A legacy "Converted" is stored with `deal.valueMissing: true`, which is excluded from revenue, and the owner is shown "Add value".

## 6. Follow-up tasks (`services/crm/followUps.ts`)

- A task has: lead, due date and time, type (Call / WhatsApp / Email / Meeting / Other), note, assigned user, created by, status (pending / completed / cancelled) and completedAt.
- When it's due, the owner and team get **one** in-app notification plus a push (`crmLeadId` opens the lead). This runs from a cron every 15 minutes and is claimed atomically, so it is never repeated. Nothing is sent to the lead.
- The assigned user must belong to this workspace or its organization; anyone else is rejected with 400.
- Completing a task sets the lead's `lastContactedAt` and adds a timeline entry. Cancel sets `cancelled`; reschedule sets a new due date and re-arms the reminder.

**Overdue follow-up reminder** (`sendStaleLeadReminders`, cron `30 4 * * *`; Inngest evaluates crons in UTC, so this is 10:00 Asia/Kolkata all year). This uses CRM data only, with no AI.
- **Which leads:** Open or Active leads whose last contact (or creation date, if never contacted) is **5+ days** ago, with no pending follow-up task and no booked appointment. Won and Lost leads are never included.
- **What the owner gets:** one in-app notification plus a push per business, never per lead:
  - One lead: "Follow-up overdue — You haven't followed up with Rahul Sharma for 5 days. Tap to open lead." (opens the lead).
  - Several leads: "You haven't followed up with Rahul Sharma and 3 other leads for 5+ days."
- **How often:** each lead is included once per quiet spell (`Lead.followUpNudgedAt`).
- **What counts as contact** (sets `lastContactedAt` and starts a new quiet spell): logging a call, WhatsApp, email or meeting; completing a follow-up task; a Twilio call linked to or saved as the lead; an inbound WhatsApp message from the lead. Editing the lead, changing its stage, or adding a note does **not** count. Messaging the lead from your own phone (e.g. the app's WhatsApp button) only counts once you log it.
- **Nothing is sent to the lead.**
- Routes: `GET/POST api/followups` and `PATCH api/followups/[id]`, scoped by `businessId`.

## 7. Revenue and ROI (`services/crm/roi.ts`, `GET api/crm/roi?days=30`)

| Metric | Definition |
|---|---|
| Total leads | Leads **created** in the period (the cohort) |
| Converted | Cohort leads with `lifeCycleStage = converted` |
| Won revenue | Sum of recorded `deal.value` (converted leads without a value are counted separately and excluded) |
| Conversion rate | converted ÷ total leads |
| Average deal | revenue ÷ converted leads **with** a value |
| Revenue per lead | revenue ÷ total leads |
| ROI % | (revenue − investment) ÷ investment, **only** if a monthly investment is set (`PATCH api/crm/roi/investment`), prorated to the period |

- **By source:** leads, converted, rate, revenue and average deal.
- **Phone performance:** calls received, unique callers, missed, from existing leads, saved as leads, not saved, call leads won and call lead revenue.
- **Missed opportunities** are counts only ("3 calls were not saved as a lead"), never an amount of money.

## 7b. Monthly Growth Report (`/dashboard/crm/growth-report`, app: CRM → Monthly Growth)

One calculation for web and app: `GET /api/crm/growth-report?month=YYYY-MM|current`, built in `services/crm/growthReport.ts`. It is calculated on request from CRM records, with no stored copies and **no AI**. The workspace is resolved on the server; a `businessId` in the URL is ignored.

- **Period:** a calendar month in the business's timezone (`Business.timezone`, default Asia/Kolkata). With no month, it shows the latest **completed** month. `current` shows month to date, clearly labelled and compared with the same days of the previous month.
- **Leads received** = customer leads created in the month. **Won** = leads now Won whose `convertedAt` is in the month. **Conversion** = Won ÷ leads received × 100 (shown as "—" with no leads; can exceed 100% when earlier leads were won, which the report flags).
- **Recorded revenue** = recorded deal values of those Won leads only. A Won lead without a value is counted as "no value recorded"; nothing is estimated.
- **ROI** uses the shared rule (`computeRoiFigures` in `roi.ts`): investment = monthly × days ÷ 30.44. With no investment (or 0), it shows "ROI unavailable — investment/cost not configured."
- **Sources:** per actual source, leads / won / revenue / conversion; ₹0 where nothing was recorded.
- **Follow-ups:** tasks due in the month (cancelled ones excluded): completed, missed (past due and not done), and completion rate = completed ÷ (completed + missed). For the current month, the rest of the month shows as "still upcoming".
- **Right now** (not historical): overdue tasks, leads not contacted for 5+ days (same rule as the reminder), and the open pipeline (Open + Active, excluding Won, Lost and Inactive).
- **Calls:** from `CallEvent` (received, known/unknown callers, saved, linked, dismissed, missed, leads, wins and revenue from `Phone Call` leads). With no telephony, it shows "Not measured".
- **Month over month:** relative % for counts and money, **percentage points** for rates. There is no % change from 0 ("up from 0" instead). With no previous-month activity it says "No previous-month data available."
- **Summary:** "What happened" (data) and "What the numbers suggest" (cautious, never causal), plus highlights only where the data supports them (ties shown as ties). There are no rupee "missed opportunity" figures.
- **Report ready:** the daily job `crmGrowthReportReadyCron` (04:45 UTC = 10:15 IST) handles each business once its month has completed in its own timezone. Businesses with CRM activity that month and the CRM on their plan get **one** in-app notification plus a push ("Your September Growth Report is ready…"). The push opens the report in the app, and the in-app link opens it on the web. `Business.crmGrowthReportNotifiedFor` stores the month already handled. There is no WhatsApp and nothing goes to leads.
- **Not frozen:** past months are recalculated from current data, so later edits (e.g. moving a September win back to Active) change that month's report. A stored month-end snapshot would freeze it; this is not implemented.

## 8. Calls (telephony provider abstraction)

- **Adapters** (`services/telephony/normalize.ts`) turn provider webhooks into normalized events: `incoming_call`, `outgoing_call`, `call_answered`, `call_missed`, `call_ended`. Twilio is the only adapter today; another provider means adding one adapter.
- `api/twilio/voice` (signature-validated) → `recordCallEvent()` → a `CallEvent` for the business that owns the called number. There is one record per call, and status callbacks update its outcome.
- **A known caller** (matched by normalized phone) is linked automatically: it gets a timeline entry and `lastContactedAt`, and no duplicate lead is created.
- **An unknown caller is *not* auto-created as a lead.** The owner gets an in-app notification and a push, and chooses **Save as Lead / Existing Lead / Dismiss**:
  - On the web, a banner on the CRM page.
  - In the app, the **Calls** screen.
  - For a missed call, saving can also create a "call back" task. **No WhatsApp is ever sent to the caller.**
- There is **no automatic capture of ordinary SIM calls** — see the platform status below.

### Call capture — what works today, per platform

| | Status |
|---|---|
| **Twilio tracking number** (calls to the number on the Google profile) | ✅ Works on web and app: known callers are linked; unknown callers get a "Save as lead?" prompt (in-app notification plus push, then the web banner or the app Calls screen) |
| **Normal SIM calls — Android** | ❌ Not captured. The app has **no** `READ_CALL_LOG` / `READ_PHONE_STATE` permission and no call-state listener; its only phone-data permission is `READ_CONTACTS` / `WRITE_CONTACTS`, for the owner-picked contacts import. Post-call detection would need a native module (not possible in Expo Go; it needs a dev-client/EAS build) plus the `READ_CALL_LOG` / `READ_PHONE_STATE` permissions. Google Play allows those only for default dialer, caller-ID and spam apps, through its Permissions Declaration Form, so approval is not guaranteed. |
| **Normal SIM calls — iOS** | ❌ Not possible. iOS gives third-party apps no call-log access and no post-call trigger. CallKit's call directory only labels callers; it can't read calls or prompt after them. |
| **Truecaller-style "Was this a lead?" popup after a normal call** | ❌ Not implemented on either platform. A drawn-over-other-apps popup would also need `SYSTEM_ALERT_WINDOW` on Android, and it doesn't exist on iOS. |
| What the owner can do today for calls from their own phone | **Log a call** (adds a lead by number), and the after-call prompt when a call is started from a lead's **Call** button inside the app |

Contacts: the app never uploads the address book. The owner picks individual contacts (at most 200 per import), and only those are sent.

## 9. Screens

**Web `/dashboard/crm`:**
- Stats: Total Leads, Follow-ups Due (pending tasks due today or overdue), Won, and Revenue (recorded Won deal values only).
- The unsaved-calls banner.
- List view (stage, sub-stage and deal columns).
- Kanban with the deal-value prompt.
- Analytics: period selector, revenue and ROI, investment setting, by-source table, phone performance, missed opportunities and pipeline distribution.
- Lead Stages editor.
- Lead drawer: stage and sub-stage, deal value (add or edit), follow-up tasks, timeline (new entry types), chat.

**App `mobile/src/app/(app)/leads/`:**
- **List:** a last-30-days revenue card, an unsaved-calls banner, and stage filter chips (groups, then sub-stages).
- **Lead detail:** stage and sub-stage chips, the deal-value sheet on Won, the deal card, follow-up tasks (with date picker), notes, log call and timeline.
- **Calls:** provider calls with Save / Existing / Dismiss.
- **Push taps:** `callEventId` opens Calls; `crmLeadId` opens the lead.

## 10. Super-admin CRM (GrowwMatics' own leads) — unchanged

- **Leads:** free report and demo bookings. All `tenantId: 'gmbboost-internal'`, `leadType: 'Platform Prospect'`.
- **Own flow:** sales agent, nurture, booking and report agents, conversion funnel, pipeline, lead-engine status, "return to AI".
- The customer CRM service refuses that tenant, and the overdue-reminder job never includes it.
- **CRM Monitor** (`api/admin/crm-monitor`) only counts users' leads.

## 11. Migration (existing data) — `scripts/migrate-customer-crm.ts`

The migration covers customer leads only; it never reads or writes platform (`gmbboost-internal`) data. It never deletes or creates documents, and it never touches notes, activities, phones, owners, workspaces or `updatedAt`.

| What | Change |
|---|---|
| Indexes (production has `autoIndex` off) | Creates only the 6 CRM indexes that are missing: CallEvent unique `{provider, callId}` and `{businessId, startedAt}`; FollowUp `{businessId, status, scheduledFor}`; Lead `{businessId, createdAt}`, `{businessId, lifeCycleStage}`, `{businessId, phone}`. It never drops one. |
| `Business.leadStages` | Stores stable ids, for stored configs only (businesses on the defaults store nothing). Custom stages get `group-slug`; duplicate names get `-2`, `-3`. |
| Legacy `pipelineStage` (lead still `initial`) | An exact sub-stage name match gives that group and id; otherwise a keyword match picks the group (won/converted → Won, lost/dead → Lost, new/inbound → Open, else Active, no sub-stage). `pipelineStage` itself is kept. |
| Name-only sub-stage | Gets its id. A lead on a deleted or unknown stage keeps its group and name. |
| Won/converted without a deal | Stays Won, with `deal = {value: null, valueMissing: true}` and `convertedAt` set. The estimated `valuation` is **not** used as revenue. |
| Closed without `lostAt` | `lostAt` is set. |
| Old AI score values on customer leads | **Left untouched** (not deleted). The Customer CRM no longer reads them. |
| Source outside the schema enum (e.g. `Import`) | Becomes its canonical value (`Import` → `CSV Import`, else `Manual`). Otherwise the lead would fail validation on its next save. |
| Pending legacy auto-WhatsApp `FollowUp` | Becomes `cancelled`. Completed history and owner tasks are untouched. |
| `CallEvent` | A new collection, so there is nothing to migrate. |
| Customer leads with no `businessId` | Counted and reported only. They aren't shown in any workspace today, before or after. |

Runbook:

1. **Preview** (read only): `npx tsx scripts/migrate-customer-crm.ts`
   Prints a sample of changes, then the counts: `indexesToCreate`, `stageConfigsGettingIds`, `leadsUpdated`, `legacyPipelineStageMapped`, `subStageIdAdded`, `convertedMarkedValueMissing`, `invalidSourceFixed`, `legacyFollowUpsCancelled`, `customerLeadsWithoutBusinessId`.
2. **Apply**: `npx tsx scripts/migrate-customer-crm.ts --apply`
   It first writes `crm-migration-backup-<timestamp>.jsonl` with the previous value of every field it changes (git-ignored; it holds lead data, so keep it private).
3. **Verify**: `npx tsx scripts/migrate-customer-crm.ts --verify`
   Prints "VERIFY OK — nothing left to migrate" and exits 0; exits 1 if anything remains. A second `--apply` changes nothing.
4. **Rollback**: `npx tsx scripts/migrate-customer-crm.ts --rollback=<backup file>`
   Restores every changed field exactly. Indexes stay; they're harmless.
   Also take an Atlas snapshot or backup before applying to production.

Tested end to end on in-memory data (`scripts/customer-crm-migration-check.ts`, 23 checks).

## 12. Key files

| Area | Files |
|---|---|
| Models | `src/models/Lead.ts` (deal, subStageId, convertedAt/lostAt, lastContactedAt, followUpNudgedAt), `Activity.ts`, `FollowUp.ts` (tasks), `CallEvent.ts`, `Business.ts` (`crmInvestment`) |
| Logic | `src/services/crm/{customerLeads,followUps,calls,roi,sources,access,legacyDispatch,stageMigration}.ts`, `src/services/telephony/normalize.ts`, `src/lib/leadStages.ts` |
| APIs | `api/crm/leads/*`, `api/crm/calls/*`, `api/crm/roi/*`, `api/followups/*`, `api/business/lead-stages`, `api/leads/{quick-add,bulk-import}`, `api/campaigns/import`, `api/appointments`, `api/twilio/voice`, `api/whatsapp/webhook` |
| Jobs | `services/inngest/functions.ts`: `scheduleLeadFollowUpsJob` (owner new-lead alert only), `crmFollowUpReminderCron` (due tasks, every 15 min), `crmStaleLeadReminderCron` (overdue leads, daily), `dispatchWhatsappFollowUpJob` (legacy, no-op) |
| Web UI | `src/app/dashboard/crm/page.tsx`, `src/components/crm/*` (`DealValueModal`, `FollowUpTasks`, `PendingCallsBanner`, `CRMAnalytics`…) |
| App | `mobile/src/app/(app)/leads/*`, `mobile/src/api/endpoints/{leads,crm}.ts`, `mobile/src/components/{deal-value-sheet,follow-up-tasks}.tsx` |
| Tests | `tests/integration/customer-crm-pure.test.ts`, `scripts/customer-crm-check.ts` (in-memory end-to-end), `scripts/customer-crm-migration-check.ts` (migration) |
| Migration | `scripts/migrate-customer-crm.ts`, `src/services/crm/stageMigration.ts` |
