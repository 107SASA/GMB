# Current Lead / Sales Architecture Audit

**Scope:** GrowwMatics internal lead, sales, nurturing, demo, payment, and post-sale paths, as implemented in this repository.

**Method:** Static code analysis only. No runtime, database, or production-config verification was performed. Where live behavior depends on a Mongo singleton or an environment variable, this report says so.

**Date of inspection:** 2026-10-03.

**Do not treat the target architecture as the current system.** The target (0–25 / 26–50 / 51–75 / 76–100 bands, Active Nurture / Long-Term Nurture / Unresponsive / Lost / Do Not Contact / Human Owned / Customer, a dedicated Customer Success agent, and so on) is a design idea. This document records what the code actually does.

---

## Current Reality

### What is already built?

Two separate lead systems share one `Lead` collection (`src/models/Lead.ts`) and are kept apart by `tenantId`, `leadType`, and `businessId`.

**A. GrowwMatics' own sales leads** (`leadType: 'Platform Prospect'`, `tenantId: 'gmbboost-internal'`, no `businessId` on create).

Production create paths:

1. `POST /api/free-report/start` — website free report.
2. `POST /api/leads/book-demo` — website book-demo form.
3. WhatsApp booking agent `handleCollecting` in `src/services/inngest/functions.ts` — creates the lead only when the booking LLM marks the conversation ready for slots.

Around those leads there is a real platform WhatsApp stack:

- Sales agent (`src/services/sales/salesAgent.ts`, Inngest `sales-nurture-requested`, `sales-nurture-consented`, `sales-agent-reply`).
- Booking / demo agent (`src/services/booking/bookingAgent.ts`, Inngest `booking-agent-reply`) with Google Calendar slot offer, Meet link, 24h/1h reminders, reschedule, cancel, and no-show check.
- Report agent (`src/services/report/reportAgent.ts`) for the WhatsApp “get my report” path. It does **not** create a `Lead`.
- Support / in-house agent (`src/services/support/supportAgent.ts`, Inngest `support-agent-reply`).
- Lead intelligence extractor (`src/services/leadIntelligence/extract.ts`) that writes `intent`, `objections`, `painPoints`, and incremental `leadScore`.
- Next-best-action chooser (`src/services/nba/decideNextAction.ts` + `src/services/nba/rules.ts`) and a partial executor (`src/services/nba/executeNextAction.ts`).
- Human handoff and return-to-AI (`src/services/agentHandoff/`, `POST /api/admin/leads/return-to-ai`).
- Razorpay checkout, webhook verification, entitlement activation, and a post-payment sequence that moves a matching platform lead to `currentAgent: 'IN_HOUSE'` / `currentStage: 'CUSTOMER'`.
- Admin conversion UI (`/admin/leads`, `/admin/pipeline`) reading platform leads via `/api/admin/conversion/*`.

**B. Leads belonging to GrowwMatics customers** (`leadType: 'Client Prospect'`, `tenantId` = the customer's organization id, `businessId` required).

Created only through `createOrUpdateCustomerLead()` in `src/services/crm/customerLeads.ts` (dashboard, mobile, CSV, campaigns, appointments, customer WhatsApp, “save call as lead”). That function refuses `organizationId === 'gmbboost-internal'`. Automatic WhatsApp to those leads was removed (October 2026). Follow-up is owner tasks, not an AI nurture engine.

### What is partially built?

- **Sales / booking / report agents exist end to end, but their config defaults are `enabled: false`** (`defaultSalesAgentConfig`, `defaultBookingAgentConfig`, `defaultReportAgentConfig`). If the stored singleton was never flipped on, free-report still creates a lead and an audit, and then nurture is skipped with `'agent disabled'`. Whether production documents are enabled is **unknown without reading the database**.
- **Next best action is chosen and stored on every extraction.** Only a subset is executed on the sales reply path. Proactive (non-reply) NBA sends require `LEAD_ENGINE_V2 === 'true'` **and** a rollout cohort. The cohort model defaults to an empty allowlist and 0% (`src/models/OrchestrationConfig.ts`). With those defaults, proactive NBA does nothing.
- **Lead score (`leadScore`, 0–100) is live** on platform WhatsApp turns. It is **not** the target 0–25 / 26–50 / 51–75 / 76–100 banding. `computeScoreBand` uses `<15 COLD`, `15–44 WARM`, `45–74 HOT`, `>=75 READY`, and **no NBA rule row filters on that band**, so the band does not change the chosen action.
- **Human handoff works** (explicit request, two low-confidence extractions, or a “stuck hot” lead). Return-to-AI works via an admin route. There is no assignment of `humanHandoff.assignedUserId`. `nurtureStatus` values `PAUSED` and `STOPPED` have no writer.
- **Payment activates the workspace** even when no platform `Lead` matches the payer's phone. In that case the IN_HOUSE handoff, invoice WhatsApp, and welcome WhatsApp are skipped.
- **Demo web form does not pick a slot.** It files a `DemoBooking` with date `"To be scheduled"` and hands the thread to WhatsApp.

### What is missing?

- No writer sets `currentStage` to `QUALIFYING`, `COLD`, `UNRESPONSIVE`, `LONG_TERM_NURTURE`, `LOST`, `DO_NOT_CONTACT`, `CONVERSION_PENDING`, or `PAYMENT_VERIFIED`. Those values exist on the enum and in the NBA rule table. Opt-out sets `nurtureStatus: 'OPTED_OUT'`, not `currentStage: 'DO_NOT_CONTACT'`. Payment jumps straight to `CUSTOMER`.
- No automatic application of scoring signals `FREE_REPORT_SUBMITTED` or `INACTIVITY_DECAY`.
- `buying_signals` are returned by the extractor prompt and **never persisted**. `Lead.businessProfile` has **no writer**.
- No dedicated Customer Success, onboarding, or account-management agent. Post-sale WhatsApp is the in-house branch of the support agent.
- No Stripe. No local invoice document. Invoice is a Razorpay API read plus an optional WhatsApp template.
- No contact-form API. `/contact` is email plus a Book Demo button.
- The WhatsApp report agent does not create a platform `Lead`.

### What is legacy?

- `Lead.aiLeadScore` — static seeds only (`60` on free report, `85` on demo). The AI function that was meant to compute it (`extractLeadInsights` in `src/services/ai.ts`) has **no production caller**. Customer CRM AI scoring was removed in October 2026.
- `Lead.pipelineStage` — comment in the schema calls it a legacy free-Kanban column. Book-demo still writes `'New Request'`. Customer CRM rules use `lifeCycleStage`.
- `Lead.lifeCycleStage` (`initial | active | closed | converted`) — customer CRM lifecycle, not the platform sales stage machine (`currentStage`).
- Admin `/api/admin/sales-leads` — Kanban over **`Business.pipelineStage`**, not `Lead`. Payment overwrites that field to `'Customer'`.
- Inngest `follow-up-cron` — registered hourly, **inert**. It queries `Lead.lastInteractionTime`, a field that does not exist, so it dispatches nothing. See the comment at `src/services/inngest/functions.ts` around the `follow-up-cron` function.
- Inngest `dispatch-crm-whatsapp` — consumes the removed Day 1 / 3 / 7 chain via `src/services/crm/legacyDispatch.ts` and does not message the lead.
- `generateSalesResponse` is imported in `functions.ts` and never called.
- `n8n-workflows/workflow-2-lead-followup.json` is a leftover workflow export, not the live sender.

### What is disconnected?

- Free-report **lead + audit** are connected. Free-report **lead → sales conversation** is connected only when `SalesAgentConfig.enabled` is true, and for web-form phones only after a YES consent reply.
- WhatsApp report-connect can complete an audit and emit `sales/nurture.requested` **without** a `Lead` row (`fileFreeReportLead` is not called on that path).
- Result-page pricing (`/free-report/result`) is UI. It does not start checkout or the sales agent by itself.
- `CONVERSION_PENDING` and `PAYMENT_VERIFIED` are funnel labels the admin analytics query, but payment never writes them.
- `SalesConversation` has **no `leadId`**. The sales agent finds the lead by phone under `gmbboost-internal`. A report-only phone with no lead still gets a sales conversation if the agent is enabled; intelligence extraction is skipped when no lead is found.
- Comments in `Lead.ts` and `decideNextAction.ts` that call ownership and NBA “shadow / decision-only, gate future reads on `LEAD_ENGINE_V2`” are **stale**. `currentAgent` and `humanHandoff` already stop AI replies with no flag. Proactive NBA scheduling is the part that still requires the flag.

### What should NOT be rebuilt?

These are live and should be treated as the current platform, not as stubs:

- The platform vs customer split (`gmbboost-internal` + `Platform Prospect` vs `businessId` + `Client Prospect`, enforced in `createOrUpdateCustomerLead`).
- Platform WhatsApp routing in `src/app/api/whatsapp/webhook/route.ts` (`processPlatformInbound` vs tenant `processInboundMessage`).
- Sales, booking, report, and support agents and their Inngest functions.
- `extractLeadIntelligence` → `applyExtraction` → `decideNextAction` on the sales reply path, including `scoredSignalKeys` idempotency.
- Google Calendar demo booking, Meet link, `DEMO_REMINDER`, and `NO_SHOW_CHECK`.
- Razorpay webhook HMAC verification, `ProcessedWebhookEvent` idempotency, `activatePlan` / `activateBusinessPlan`, and `runCustomerActivationSequence`.
- Human stop (`isHumanOwned` / `salesReplyBlockedReason`) and `releaseFromHuman`.
- Customer CRM lead CRUD and the explicit removal of automatic WhatsApp to customer leads.

### What needs to be built to reach the target architecture?

This is a gap list, not an implementation plan.

- Turn on (or replace) the gated nurture so a new platform lead reliably enters a conversation. Today that depends on an admin flag that defaults off, plus consent for cold web-form numbers.
- A stage writer for the target lifecycle (or a decision to keep `currentStage` and actually transition `QUALIFYING`, cold/unresponsive/long-term, lost, do-not-contact, conversion-pending, payment-verified). Several of those enums are read by rules and never written.
- Score bands that match the target, **and** rules that use the band. Today the band is computed and ignored.
- Persist buying signals and a lead profile (`businessProfile` / interests) if the target “Lead Profile” is required. The fields exist; the extractor does not fill `businessProfile`, and `buying_signals` are dropped.
- Apply `FREE_REPORT_SUBMITTED` (and any inactivity decay) or delete them from the scoring table so operators are not misled.
- A real “next best action drives the reply” policy for educate / answer / show-value, which today fall through to a generic `composeAgentReply` unless they are in `NBA_OWNS_REPLY`.
- Proactive nurture that is either the legacy drip (already implemented, agent-flag gated) or the V2 scheduler (implemented, flag + cohort gated) — not both left half-off.
- Payment stages between “interested” and “customer”, a guaranteed lead link for self-serve payers who never hit free-report/demo, and a real invoice artifact if WhatsApp-template-plus-Razorpay-list is not enough.
- A post-sale agent only if in-house support is not the intended customer-success owner. Today that role is `composeInHouseAgentReply`.

---

# SECTION 1 — LEAD ENTRY POINTS

Internal platform leads are created in **three** production write paths. Customer CRM leads use a fourth, separate service. Contact pages, onboarding, admin sales-leads, and the report agent do not create `Lead` documents.

## 1.1 Website — Free report

| Item | Fact |
| --- | --- |
| UI | `src/app/free-report/page.tsx`. Result: `src/app/free-report/result`. CTAs: `FreeReportButton`, navbar, footer, login. `boostProfileLink()` in `src/lib/whatsappCta.ts` falls back to `/free-report` when no sales WhatsApp number is configured. |
| API | `POST /api/free-report/start` — `src/app/api/free-report/start/route.ts`, function `fileFreeReportLead` (called from `POST`). |
| Validation | Durable rate limit (IP and phone). `normalizePhoneE164`. Business name required. Places snapshot fields accepted. |
| Fields collected | Phone, business name, Google Places snapshot (category, address, area, city, state, country, business phone, website, place id, maps URL, lat/lng, rating, review count, editorial summary, photo count, hours, types). |
| Model | `Lead` upsert on `{ phone, tenantId: 'gmbboost-internal' }`. |
| `source` | `'Website'`. An existing `'Demo Booking'` source is not overwritten. |
| `leadType` | `'Platform Prospect'`. |
| Tenant / business | `tenantId: 'gmbboost-internal'`. **No `businessId` on the Lead.** A separate shadow `User` / organization / `Business` / `Subscription` is created by `provisionShadowAccount` so the audit has a workspace. |
| Duplicate handling | Phone upsert inside the platform tenant. |
| Score seed | New rows get `aiLeadScore: 60`. This is not `leadScore`. |

**Immediately after the Lead upsert (best-effort, still inside `fileFreeReportLead`):**

- `setLeadOwnership(leadId, 'SALES', 'free-report-form', 'free-report-form', 'NURTURING')` only when `currentAgent` is `NONE` or `SALES` (does not downgrade a demo-owned lead).
- Sets `intent: 'EXPLORING'` if unset.
- `logLeadEvent('LEAD_CREATED', ...)`.
- `createPendingAuditAndDispatch` → Inngest `audit/generate.requested`.

**Not at create time:** WhatsApp, email, demo booking, `leadScore` update, `crm/lead-created`.

**Later, when the audit completes** (`generateAuditJob` in `src/services/inngest/functions.ts`):

- Event `sales/nurture.requested` with `{ auditId }`.
- Event `report/ready.requested` (WhatsApp “report ready” template when configured; fast-mode / lead-gen audits).

`sales-nurture-requested` returns `{ skip: 'agent disabled' }` when `SalesAgentConfig.enabled` is false.

## 1.2 Website — Book demo

| Item | Fact |
| --- | --- |
| UI | `src/app/book-demo/page.tsx`. CTAs: `BookDemoButton` → `/book-demo?origin=...` across marketing pages. |
| API | `POST /api/leads/book-demo` — `src/app/api/leads/book-demo/route.ts`, `POST` then `fileDemoRequest`. |
| Validation | In-memory rate limit (IP and phone). Name required. Phone normalized to E.164. |
| Fields | `name` (the page sends the business name as the person's name), `businessName`, `phone`, `budget` (radio string), `origin`. |
| Model | `Lead` upsert `{ phone, tenantId: 'gmbboost-internal' }`. |
| `source` | `'Demo Booking'` (overwrites a previous Website source on update). |
| `leadType` | `'Platform Prospect'`. |
| Tenant / business | `gmbboost-internal`. **No `businessId`.** No shadow audit account. |
| Duplicate handling | Same phone upsert. |
| Score seed | New rows get `aiLeadScore: 85`. Updates do not reset it in the update branch. Also sets `pipelineStage: 'New Request'`. |

**Immediately after save (`fileDemoRequest`, best-effort; the HTTP response still succeeds if this throws):**

- `setLeadOwnership(..., 'DEMO', 'book-demo-form', 'book-demo-form', 'DEMO_REQUESTED')`.
- `intent: 'DEMO_INTEREST'` if not already that value.
- `DemoBooking.create` with `status: 'Pending'`, `date` and `timeSlot` `'To be scheduled'`, `channel: 'form'`, unless a Pending booking already exists.
- `BookingConversation.create` (`status: 'active'`, `leadId`, `bookingId`, synthetic opening line) unless an active booking conversation exists for the phone key.
- `logLeadEvent('DEMO_REQUESTED', ...)`.
- `inngest.send({ name: 'booking/agent.reply', ... })` **only when the booking conversation was newly created**.

**Not at this step:** slot selection, Google Calendar event, Meet link, email, audit.

The page then opens a `wa.me` link (`bookDemoLink` in `src/lib/whatsappCta.ts`) so the visitor can also message WhatsApp. The Inngest event is the server-side attempt to message them first. Delivery still depends on a configured WhatsApp provider and template/session rules. The booking agent itself no-ops to a “team will get back to you” fallback when `BookingAgentConfig.enabled` is false.

## 1.3 Website — Contact and other marketing CTAs

| Surface | Creates a Lead? |
| --- | --- |
| `src/app/contact/page.tsx` | **No.** Mailto plus `BookDemoButton`. No contact-form API. |
| Navbar / footer / pricing / FAQ / services CTAs | Navigate to `/free-report` or `/book-demo`, or open WhatsApp. They do not write `Lead` themselves. |
| `POST /api/onboarding` | Creates User / organization / Business / Subscription and sends OTP WhatsApp. **Does not create a Lead.** |
| `POST /api/report-connect/*` and the WhatsApp report agent | Shadow account + audit. **Does not call `Lead.create`.** |
| `GET/PATCH /api/admin/sales-leads` | Reads and patches **`Business.pipelineStage`**. Does not create `Lead` rows. |

Direct `wa.me` traffic creates a platform lead only if it later hits the booking agent's `handleCollecting` (demo intent). A report-intent WhatsApp thread does not create a lead.

## 1.4 WhatsApp booking agent (platform number)

| Item | Fact |
| --- | --- |
| Trigger | Meta/Twilio webhook `POST /api/whatsapp/webhook` → `processPlatformInbound` when `isPlatformNumber()` matches. |
| Lead create | Not on the first inbound message. `bookingAgentReply` → `handleCollecting` creates the lead when the model sets `readyForSlots`. |
| File | `src/services/inngest/functions.ts` (`handleCollecting`). |
| Fields | `name`, `phone`, optional `email`, `businessType` from collected `details`. |
| `source` / `leadType` / tenant | `'Demo Booking'` / `'Platform Prospect'` / `gmbboost-internal`. No `businessId`. `pipelineStage: 'New Request'`. `aiLeadScore: 85`. `status: 'active'`. |
| Duplicate | `Lead.findOne({ phone, tenantId })` then create or update. |
| `logLeadEvent('LEAD_CREATED')` | **Not called** on this path. |
| `setLeadOwnership` at create | **Not called** here. Later, `bookConfirmedSlot` sets `DEMO` / `DEMO_SCHEDULED`. |
| Immediate action | Offers real calendar slots and sends WhatsApp (`offerRealSlots`). |

Sales nurture (`salesNurtureRequested`) **looks up** an existing lead by phone. It does not create one.

## 1.5 What happens immediately — summary

```text
Free report form
  → POST /api/free-report/start
  → shadow User/Business
  → Lead upsert (Platform Prospect, Website, aiLeadScore 60)
  → ownership SALES / NURTURING (if not already DEMO/HUMAN/…)
  → audit job
  → (on audit complete) sales/nurture.requested
       → SKIP if SalesAgentConfig.enabled !== true
       → else SalesConversation + consent or first pitch + drip

Book demo form
  → POST /api/leads/book-demo
  → Lead upsert (Platform Prospect, Demo Booking, aiLeadScore 85)
  → ownership DEMO / DEMO_REQUESTED
  → DemoBooking Pending "To be scheduled"
  → BookingConversation
  → booking/agent.reply (new threads only)
       → real slots only if BookingAgentConfig.enabled and calendar env are set

WhatsApp demo chat
  → webhook → BookingConversation
  → booking/agent.reply
  → handleCollecting creates Lead when ready for slots
  → slot offer (no LEAD_CREATED event)
```

---

# SECTION 2 — INTERNAL VS CUSTOMER CRM

These are one collection and two products. Mixing them is a bug the code tries to prevent.

| | GrowwMatics internal sales | Customer CRM (a tenant's own leads) |
| --- | --- | --- |
| `leadType` | `'Platform Prospect'` | `'Client Prospect'` (schema default) |
| `tenantId` | hard-coded `'gmbboost-internal'` | the customer's `organizationId` |
| `businessId` | unset on platform create | required `ObjectId` |
| Dedupe | `{ phone, tenantId: 'gmbboost-internal' }` (`LeadSchema.index({ tenantId: 1, phone: 1 })`) | `{ businessId, phone }` and email inside the workspace |
| Creator | Direct `Lead.create` / upsert in the three paths above | **Only** `createOrUpdateCustomerLead` in `src/services/crm/customerLeads.ts` |
| Guard | Customer creator throws if `organizationId === 'gmbboost-internal'` | Platform webhook does not call the customer creator for the platform number |
| Lifecycle field that matters | `currentStage` + `currentAgent` + conversation `status` | `lifeCycleStage` (`initial \| active \| closed \| converted`) and `subStage` |
| AI score | `leadScore` on WhatsApp turns; `aiLeadScore` static seed | AI scoring removed October 2026. APIs strip `aiLeadScore`. |
| Admin UI | `/admin/leads`, `/admin/pipeline` via `/api/admin/conversion/*` filtered by `PLATFORM_LEAD_MATCH = { tenantId: 'gmbboost-internal' }` (`src/lib/admin/conversionFunnel.ts`) | `/admin/crm` monitor filters `leadType: 'Client Prospect'` |
| Customer UI | none | `/dashboard/crm` → `/api/crm/leads` scoped by `requireBusinessContext` → `businessId` |
| Auto WhatsApp to the lead | Sales/booking/report agents (each default **disabled**) | **Removed.** `crm/lead-created` only alerts the **owner**, and that job returns early when `tenantId === 'gmbboost-internal'` |

`source: 'Demo Booking'` is on the Lead enum and is used by the platform. It is **not** in the customer source allow-list (`src/services/crm/sources.ts`).

Customer create entry points (all `Client Prospect`):

| Path | API | Source | Notes |
| --- | --- | --- | --- |
| Dashboard add | `POST /api/crm/leads` | `'Manual'` unless sent | `requireBusinessContext`, module `sales_agent` |
| Mobile quick-add | `POST /api/leads/quick-add` | Manual / Phone Call / Contacts Import | |
| Mobile contacts | `POST /api/leads/bulk-import` | `'Contacts Import'` | `bulk: true`, no owner alert |
| CSV | `POST /api/crm/leads/import` | column or `'CSV Import'` | bulk |
| Campaign import | `POST /api/campaigns/import` | `'Campaign Import'` | tag `Past customer`, bulk |
| Appointment | `POST /api/appointments` | `'Appointment'` | creates a lead when name/phone/email exist and no `leadId` |
| Tenant WhatsApp | webhook → `processInboundMessage` | `'WhatsApp'` | only when `tenantId !== 'gmbboost-internal'` |
| Save call | `src/services/crm/calls.ts` `saveCallAsLead` | `'Phone Call'` | owner confirms; unknown callers are not auto-created |

Shared post-create for a **new** customer lead: `Activity` type `lead_created`, then `inngest.send('crm/lead-created')` unless `skipAutomation`. That job (`schedule-lead-follow-ups`) sends an owner WhatsApp for organic sources only. It does not score, does not message the lead, and does not touch platform ownership.

---

# SECTION 3 — LEAD DATABASE MODEL

Model: `Lead` in `src/models/Lead.ts`. Interface `ILead`. Collection name `Lead`.

“Actively used” means a production writer and at least one reader that changes behavior or is shown in a live admin/CRM screen. “Legacy” means still on the schema, with writers that are static, unused, or explicitly marked legacy.

## Identity and contact

| Field | Type | Written | Read | Used? |
| --- | --- | --- | --- | --- |
| `tenantId` | string, required, indexed | Every create path | Every isolation query | **Active.** Platform value is `'gmbboost-internal'`. |
| `organizationId` | string, optional | Customer create | Customer filters | **Active for customer CRM.** Unset on platform creates. |
| `businessId` | ObjectId → Business | Customer create only | Customer lists, ROI, conversations | **Active for customer CRM.** Platform leads do not have it. The audited **workspace** for a free report lives on `Business`, linked from `SalesConversation.businessId`, not from `Lead.businessId`. |
| `assignedUserId` | ObjectId → User | Customer CRM assignment | Customer CRM | **Customer CRM owner.** Not set by platform human handoff. |
| `name` | string, required | All creates | Agents, admin, templates | **Active.** |
| `email` | string, optional | Booking `handleCollecting` when the chat collected it; customer forms | Demo emails, customer CRM | **Partial.** Free-report and book-demo web form do not require it. |
| `phone` | string | All platform creates, normalized | Dedupe, activation lookup, agents | **Active.** Platform activation finds the lead by phone + `gmbboost-internal` only. |

## Source, type, tenant

| Field | Type | Written | Read | Used? |
| --- | --- | --- | --- | --- |
| `source` | enum (see schema) | Each create path | Admin, CRM, organic-alert allow-list | **Active.** Platform values seen in code: `'Website'`, `'Demo Booking'`. |
| `leadType` | `'Client Prospect' \| 'Platform Prospect'` | Explicit on platform creates; default Client Prospect | Admin CRM monitor | **Active split key.** |
| `tags` | string[] | Customer imports (e.g. Past customer) | CRM | Customer CRM. |
| `notes` | string | Free-report and book-demo compose a notes string; CRM edits | Admin / CRM | **Active as free text.** Not an AI memory store. |
| `valuation` | number, optional | `POST /api/crm/leads`, quick-add, later edits | CRM | **Customer-entered INR estimate.** Distinct from `budget`. |

## Lifecycle — three parallel systems

| Field | Type | Written | Read | Used? |
| --- | --- | --- | --- | --- |
| `status` | `'active' \| 'inactive'` | Default `'active'`. Booking create sets `'active'`. | Legacy cron checks `'Converted'` / `'Lost'`, which are **not** in this enum, so that check never filters real rows | **Weak.** Not the platform router. |
| `lifeCycleStage` | `'initial' \| 'active' \| 'closed' \| 'converted'` | Customer CRM stage moves | Customer pipeline, ROI, growth report | **Active for customer CRM only.** |
| `subStage` / `subStageId` | string / null | Customer CRM, from `Business.leadStages` | Customer board | **Customer CRM.** |
| `pipelineStage` | string / null | Book-demo and `handleCollecting` set `'New Request'` | Old Kanban / some inbox populate | **Legacy.** Schema comment: customer rules must use `lifeCycleStage`. |
| `currentAgent` | `'NONE' \| 'SALES' \| 'DEMO' \| 'IN_HOUSE' \| 'HUMAN'`, default `NONE` | `setLeadOwnership` | `isHumanOwned`, NBA, orchestrator, admin funnel | **Active gate** for “may the AI speak?”. Webhook still picks the agent from conversation collections first. |
| `currentStage` | 16-value enum, default `'NEW'` | `setLeadOwnership` fourth stage argument. **Writers found:** `NURTURING`, `DEMO_REQUESTED`, `DEMO_SCHEDULED`, `DEMO_COMPLETED`, `HUMAN_HANDOFF`, `CUSTOMER`. | NBA rules, funnel, stuck-hot trigger (`=== 'NURTURING'`) | **Active for the values that are written.** The other enum values are **schema + rules only**. |
| `nurtureStatus` | `'ACTIVE' \| 'PAUSED' \| 'STOPPED' \| 'OPTED_OUT'`, default `ACTIVE` | `optOutLead` sets `OPTED_OUT` only | Orchestrator, NBA absolute rule, proactive scheduler filter | **`OPTED_OUT` is active.** `PAUSED` and `STOPPED` have **no setter** found. |
| `humanHandoff.active` | boolean | Set true on handoff; cleared by `releaseFromHuman` | `isHumanOwned` (either this or `currentAgent === 'HUMAN'`) | **Active.** |
| `humanHandoff.reason` | string | Handoff reason | Return-to-AI cleanup branches on `'low-confidence-streak'` and `'stuck-hot-lead'` | **Active.** |
| `humanHandoff.assignedUserId` | ObjectId | **No writer found** | — | **Unused.** |
| `humanHandoff.since` | Date | Handoff | Admin detail | Set, display-only. |

`currentStage` values with **no production writer found:** `QUALIFYING`, `CONVERSION_PENDING`, `PAYMENT_VERIFIED`, `COLD`, `UNRESPONSIVE`, `LONG_TERM_NURTURE`, `LOST`, `DO_NOT_CONTACT`. `NEW` is the schema default, not an explicit transition.

## Scores, intent, profile

| Field | Type | Written | Read | Used? |
| --- | --- | --- | --- | --- |
| `aiLeadScore` | number | Free-report `60`; book-demo and `handleCollecting` `85` | Admin lists, inbox populate | **Legacy seed.** Not an input to NBA or handoff. |
| `aiInsights` | string | Intended for `extractLeadInsights` | — | **No production writer found.** |
| `qualificationStatus` | string | Same unused extractor | — | **No production writer found.** |
| `businessType` | string | Free-report (business name), book-demo, booking chat | Display, booking details | **Active as a label**, not as structured industry. |
| `budget` | string | Book-demo radio; comment says the sales agent may also infer it | Admin / notes | **Written by the demo form.** Not the numeric `valuation`. |
| `urgency` | string | Unused extractor | — | **No production writer found.** |
| `interest` | string | CRM free text, not the platform extractor | CRM | **Not the platform “interests” engine.** |
| `leadScore` | number 0–100, default 0 | `applyExtraction` adds `ScoringRuleConfig` deltas | Admin “Behavioural score”, funnel “qualified” if `>= 15`, stuck-hot handoff if `>=` threshold (default 76) and stage is `NURTURING` | **Active.** No decay job. |
| `intent` | 8-value enum, default `EXPLORING` | Free-report sets `EXPLORING`; book-demo sets `DEMO_INTEREST`; extractor overwrites when confidence `>= 0.5` | NBA rules (`PURCHASE_INTEREST` / `READY_TO_BUY` / `DEMO_INTEREST`), funnel labels | **Active.** |
| `objections[]` | `{ type, note, detectedAt, resolved }` types `PRICE \| DECISION_MAKER \| TIMING \| TRUST \| FEATURE_GAP \| OTHER` | `applyExtraction` merge | NBA `HANDLE_OBJECTION` when an open objection exists during `NURTURING` | **Active.** |
| `painPoints` | string[] | `applyExtraction` merge | NBA briefs in `executeNextAction` | **Active.** |
| `businessProfile` | `{ industry, businessType, goals[], interestedServices[] }` | **No writer found** | Admin lead detail returns it; executor would mention `industry` if set | **Schema only.** |
| `lastMeaningfulInteractionAt` | Date | Extractor | — | Written. Not a router. |
| `lastRepliedScoreAt` | Date | Extractor, once per calendar day for `REPLIED` | Same | **Active bookkeeping.** |
| `recentExtractionConfidences` | number[] | Extractor, cap 2 | Handoff if last two are both `< 0.4`; cleared on some returns-to-AI | **Active.** |
| `scoredSignalKeys` | string[] | Extractor | Idempotency so Inngest retries do not stack score | **Active.** |
| `followUpsSentAtRelease` | number | `releaseFromHuman` when reason was `stuck-hot-lead` | Stuck-hot trigger subtracts this from `SalesConversation.followUpsSent` | **Active.** |

`buying_signals` exist only on the Groq JSON contract inside `extract.ts`. `applyExtraction` does not copy them onto the lead.

## Next action

| Field | Type | Written | Read | Used? |
| --- | --- | --- | --- | --- |
| `nextBestAction` | 15 actions or null (see Section 11) | `decideNextAction` | Sales reply (`NBA_OWNS_REPLY`), proactive scheduler | **Active as a decision.** Execution is partial. |
| `nextActionAt` | Date / null | Set to now when an action is decided, unless `advanceNextActionAt: false` | Proactive scheduler looks for due actions | **Active only if V2 scheduler runs.** |
| `lastProactiveMessageAt` | Date | `outboundOrchestrator` after a non-reply send | Cooldown (default 4 hours) | **Active on the V2 send path.** Reply sends do not set it. |

## Deal, conversion, time

| Field | Type | Written | Read | Used? |
| --- | --- | --- | --- | --- |
| `deal` | `{ value, currency, closedAt, notes, recordedBy, valueMissing }` | Customer CRM when moving to converted | ROI / growth report | **Customer CRM.** Platform payment does not fill `deal`. |
| `convertedAt` / `lostAt` | Date | Customer CRM stage transitions | CRM reports | **Customer CRM.** Platform “won” is `currentStage: 'CUSTOMER'`, not `lifeCycleStage: 'converted'`. |
| `lastContactedAt` | Date | Customer CRM contact | Stale-lead owner reminders | **Customer CRM.** |
| `followUpNudgedAt` | Date | Customer stale-lead reminder, once per quiet period | Same | **Customer CRM.** |
| `followUpDates` | Date[] | Present on schema | — | **No active platform nurture writer found in this pass.** |
| `lastActivityAt` | Date, default now | Book-demo update and general activity | Admin sort | **Active timestamp.** Not `lastInteractionTime` (that field does not exist). |
| `createdAt` / `updatedAt` | Date | Mongoose timestamps | Everywhere | **Active.** |

There is **no** appointment, demo slot, meeting link, or payment id on `Lead`. Those live on `DemoBooking` (`calendarEventId`, `meetingLink`, `status`) and on `Subscription` / Razorpay ids on `Business`.

---

# SECTION 4 — LEAD CREATION FLOW

## Who creates a platform lead

| Actor | Function | Creates Lead? | Events | AI | Score | Notify owner | WhatsApp | Email | Demo | Sales agent |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Website free report | `fileFreeReportLead` | Yes | `LEAD_CREATED`, then later `sales/nurture.requested` | Audit job, not the sales LLM, at create | `aiLeadScore = 60` only | No | No at create. Later only if sales agent enabled | No | No | Only after audit, and only if enabled |
| Website book demo | `POST` + `fileDemoRequest` | Yes | `DEMO_REQUESTED`, `booking/agent.reply` | Booking agent if enabled | `aiLeadScore = 85` on insert | No | Proactive booking reply if new conversation | No | Pending booking, no slot | No |
| WhatsApp booking | `handleCollecting` | Yes, late | No `LEAD_CREATED` | Already inside booking agent | `aiLeadScore = 85` | No | Slot offer | No until a slot is confirmed (`demo/booked`) | Slot flow | No |
| WhatsApp report | `reportAgentReply` | **No** | Report events only | Report agent | No | No | Report chat | No | No | Audit completion can still emit nurture **without** a lead |
| Sales nurture | `salesNurtureRequested` | **No** (find by phone) | Sales events | Sales compose if enabled | No new seed | No | Pitch / consent | No | Keyword handoff only after a live chat | This **is** the sales agent |
| Admin conversion APIs | — | **No** (GET) | — | — | — | — | — | — | — | — |
| Customer CRM | `createOrUpdateCustomerLead` | Yes, other tenant | `crm/lead-created` | No | No | Owner WA if organic and not platform tenant | **Never to the lead** | No | No | No |

```text
                    ┌─ /free-report ─ POST /api/free-report/start
                    │     Lead + shadow Business + Audit
                    │     ownership SALES/NURTURING
                    │     audit complete → sales/nurture.requested
                    │         └─ enabled? ─ no → STOP (lead + report still exist)
                    │                    └─ yes → consent or SalesConversation drip
                    │
Platform prospect ──┼─ /book-demo ─ POST /api/leads/book-demo
                    │     Lead + DemoBooking(Pending) + BookingConversation
                    │     ownership DEMO/DEMO_REQUESTED
                    │     booking/agent.reply → slots only if booking agent enabled
                    │
                    └─ WhatsApp on platform number
                          booking intent → handleCollecting → Lead → slots
                          report intent  → ReportConversation, NO Lead
                          sales reply    → only if SalesConversation.status === 'active'
```

---

# SECTION 5 — LEAD INTELLIGENCE

There is a real extractor. It is not a separate “Lead Intelligence agent” with tools. It is `extractLeadIntelligence` / `applyExtraction` in `src/services/leadIntelligence/extract.ts`, called from the sales reply (awaited), from booking and support replies (fire-and-forget), and from `src/services/demo/postDemoAnalysis.ts`.

Groq sees the latest inbound text, about the last 10 turns, and an optional sales-knowledge summary. It returns intent, objections, pain points, buying signals, one `score_signal`, a suggested NBA action, and a confidence.

| Capability | Status | Where |
| --- | --- | --- |
| Scoring (`leadScore`) | **IMPLEMENTED** | `applyExtraction` + `ScoringRuleConfig` / `DEFAULT_SCORING_RULES` |
| Scoring (`aiLeadScore`) | **LEGACY** | Static 60 / 85 only. `extractLeadInsights` in `src/services/ai.ts` is unused |
| Intent detection | **IMPLEMENTED** | Written when confidence `>= 0.5`. Drives NBA |
| Qualification | **PARTIALLY IMPLEMENTED** | Funnel treats `leadScore >= 15` or non-`EXPLORING` intent as “Qualified” (`src/lib/admin/conversionFunnel.ts`). Nothing writes `currentStage: 'QUALIFYING'` |
| Segmentation | **NOT IMPLEMENTED** | No segment field. Knowledge copy may mention segments; that is prompt text |
| Pain-point extraction | **IMPLEMENTED** | Merged onto `Lead.painPoints`. Used in NBA briefs |
| Interest extraction | **PARTIALLY IMPLEMENTED** | `Lead.interest` is CRM text. Platform extractor does not write it. Tenant WhatsApp summaries have their own `interestedServices` |
| Buying signals | **PARTIALLY IMPLEMENTED** | Prompt asks for `buying_signals[]`. **Not stored** |
| Objection detection | **IMPLEMENTED** | `Lead.objections`. NBA defaults to `HANDLE_OBJECTION` when `currentStage === 'NURTURING'` and an objection is open |
| Conversation summarization | **IMPLEMENTED for tenant WhatsApp only** | `refreshConversationSummary` in `src/services/whatsapp-agent/summaryService.ts` during `process-whatsapp-message`. **Not** fed to the platform sales or demo agent |
| Next best action | **IMPLEMENTED as a decision; PARTIALLY as an action** | Section 11 |
| Lead profile generation | **PARTIALLY IMPLEMENTED** | `businessProfile` is on the schema and returned by `GET /api/admin/conversion/leads/[id]`. **No writer** |
| AI context for platform sales | **PARTIALLY IMPLEMENTED** | `leadFacts()` style bits inside the NBA executor (name, intent, pain points). Tenant inbox has `customerContextService` — that is the customer product, not this funnel |

Idempotency: `src/services/leadIntelligence/scoringIdempotency.ts` and `scoredSignalKeys`. A retried Inngest step does not add the same signal delta twice. `REPLIED` is capped once per calendar day via `lastRepliedScoreAt`.

---

# SECTION 6 — LEAD SCORING

Two stored numbers. One is live. One is a leftover constant.

## 6.1 `leadScore` — active behavioural score

| Question | Answer |
| --- | --- |
| Is there a score? | Yes. `Lead.leadScore`, default 0, schema `min: 0`, `max: 100`. |
| Range | 0–100, clamped in `applyExtraction`. |
| How calculated? | **Rules, not a single LLM score.** Groq picks one `score_signal`. The delta comes from `ScoringRuleConfig` (singleton `key: 'default'`) or `DEFAULT_SCORING_RULES` in `src/models/ScoringRuleConfig.ts`. |
| Inputs | Latest message + recent turns + optional knowledge summary. |
| When calculated? | Each successful `extractLeadIntelligence` (sales reply awaited; booking/support not blocking; post-demo analysis). |
| When updated? | Same. No nightly decay. |
| Where stored? | `Lead.leadScore`. |
| Where displayed? | `src/app/admin/leads/page.tsx` and `src/app/admin/leads/[id]/page.tsx` (“Behavioural score”). Pipeline API returns it. |
| Used for decisions? | **Partially.** Stuck-hot handoff uses `>= stuckLeadScoreThreshold` (default **76**) while `currentStage === 'NURTURING'`. Funnel “Qualified” uses `>= 15`. `computeScoreBand` is passed into NBA but **no `NBA_RULES` row sets `scoreBand`**, so the band does not change legal actions. |

Default deltas (`DEFAULT_SCORING_RULES`):

| Signal | Delta | Applied automatically? |
| --- | --- | --- |
| `FREE_REPORT_SUBMITTED` | +10 | **No.** Free-report never calls `applyExtraction` with this signal. It only sets `aiLeadScore: 60`. |
| `REPLIED` | +3 | Yes, once per calendar day, if Groq returns it |
| `BUSINESS_INFO_PROVIDED` | +8 | Only if Groq returns it |
| `PRODUCT_QUESTION` | +5 | Only if Groq returns it |
| `PRICING_QUESTION` | +15 | Only if Groq returns it |
| `IMPLEMENTATION_QUESTION` | +15 | Only if Groq returns it |
| `DEMO_REQUESTED` | +20 | Only if Groq returns it (the book-demo form does **not** apply this delta; it sets intent and stage directly) |
| `DEMO_BOOKED` | +20 | Only if a later extraction or post-demo path returns it |
| `DEMO_ATTENDED` | +15 | Post-demo analysis can drive a signal; there is no Meet-join attendance feed |
| `PURCHASE_INTENT` | +25 | Only if Groq returns it |
| `EXPLICIT_REJECTION` | −30 | Only if Groq returns it |
| `INACTIVITY_DECAY` | −2 | **Never.** Comment in `ScoringRuleConfig.ts`: no idle-day job |

### Bands in code vs target

`computeScoreBand` in `src/services/nba/rules.ts`:

| Code band | `leadScore` | Target band (not implemented) |
| --- | --- | --- |
| `COLD` | 0–14 | Cold was specified as 0–25 |
| `WARM` | 15–44 | Warm was 26–50 |
| `HOT` | 45–74 | Hot was 51–75 |
| `READY` | 75–100 | Ready to buy was 76–100 |

The code bands are **not used to pick an action**. The 76 threshold is a **human handoff** trigger, not a “ready to buy → offer subscription” trigger. Purchase offering is driven by `intent` of `PURCHASE_INTEREST` or `READY_TO_BUY`, or by stage rows that are never written (`CONVERSION_PENDING`).

## 6.2 `aiLeadScore` — legacy

| Question | Answer |
| --- | --- |
| Range | Loosely 0–100. Only the constants 60 and 85 are written. |
| AI or rules? | Neither, in production. `extractLeadInsights` would return `intentScore` / `qualificationStatus` and has **no callers**. |
| Customer CRM | Removed October 2026. `schedule-lead-follow-ups` comment states this. Customer APIs omit the field. |
| Decisions? | **No.** |

## 6.3 Staleness

`leadScore` stays at the last message’s total until another message. There is no decay, so a hot lead who goes silent stays hot. `aiLeadScore` never moves after insert, so it is stale by design.

## 6.4 Which score is “the” score?

**`leadScore` is the one the new engine reads.** `aiLeadScore` is a display leftover from before that engine. Admin pipeline sort allows both (`leadScore`, `aiLeadScore`) in `src/app/api/admin/conversion/pipeline/route.ts`.

---

# SECTION 7 — SALES AGENT

This is the GrowwMatics-sells-GrowwMatics agent, not the tenant inbox bot.

## Files

| Piece | Path |
| --- | --- |
| Compose | `src/services/sales/salesAgent.ts` — `getSalesAgentConfig`, `extractScores`, `composeFirstMessage`, `composeFollowUp`, `composeAgentReply` |
| Defaults | `src/lib/salesAgentDefaults.ts` — `defaultSalesAgentConfig`, **`enabled: false`** |
| Model | `src/models/SalesAgentConfig.ts` — singleton, schema default `enabled: false` |
| Transcript | `src/models/SalesConversation.ts` — `status`, `consentStatus`, `scores`, `messages`, `followUpsSent`. **No `leadId`.** |
| Admin | `src/app/admin/sales-agent/page.tsx`, `GET/PUT /api/admin/sales-agent` |
| Workers | Inngest ids `sales-nurture-requested`, `sales-nurture-consented`, `sales-agent-reply`, plus `runSalesFollowUpDrip` in `src/services/inngest/functions.ts` |
| Inbound router | `handleActiveSalesConversation` in `src/app/api/whatsapp/webhook/route.ts` |

There is **no tool/function-calling registry**. Side effects are: Groq text, WhatsApp send (`sendOutboundMessage` or the orchestrator), NBA executor, keyword booking handoff, and lead-field writes done by the extractor (not by the sales composer itself).

## Trigger

```text
Audit status COMPLETED (free report OR WhatsApp report-connect)
  → event sales/nurture.requested { auditId }
  → salesNurtureRequested
       getSalesAgentConfig()
       if !enabled → { skip: 'agent disabled' }
       if no business / audit not completed / auditNurtureSentAt already set → skip
       if workspace already unlocked (paid) → skip
       if phone missing / human-owned / opted out → skip
       else create SalesConversation
       if phone has never messaged the platform → consent template only (consentStatus 'pending')
       else sleep firstMessage.delayMinutes → composeFirstMessage → send
       → runSalesFollowUpDrip (Inngest step.sleep per followUps[].delayHours)

Inbound on SalesConversation.status === 'active'
  → event sales/agent.reply
  → salesAgentReply
       salesReplyBlockedReason(lead)  // HUMAN, opt-out, DO_NOT_CONTACT, customer
       checkHandoffTriggers
       extractLeadIntelligence (awaited)
       if nextBestAction in NBA_OWNS_REPLY → executeNextAction(trigger: 'reply')
       else composeAgentReply → sendOutboundMessage
```

YES on a pending consent conversation emits `sales/nurture.consented`.

`LEAD_ENGINE_V2` does **not** gate this reply path. It gates an alternate drip implementation inside `runSalesFollowUpDrip`: when the flag is on **and** the lead is in the cohort, the drip schedules a `SHOW_VALUE` `ScheduledAction` instead of sending inline. Otherwise it sends inline.

## Inputs

- Audit score card from `extractScores(audit, business)` stored on `SalesConversation.scores` (rank, profile, SEO, reviews, verified issue titles, competitor, missing keywords).
- `SalesAgentConfig` knowledge and approved snippets (`objectionResponses`, pricing, subscribe URL).
- Last ~10 `messages` on the sales conversation.
- Lead resolved by phone under `gmbboost-internal` at reply time. If none, extraction is skipped and the generic reply still runs.

## Outputs

WhatsApp text or template. `SalesConversation.status` becomes `active`, `subscribed`, `stopped`, `completed`, or `handed_off`. `Lead` fields change only through extraction, NBA execution, handoff, or opt-out — the composer does not patch the lead itself.

## Capability checklist

| Capability | What the code does |
| --- | --- |
| Understand the business | Puts verified audit issues and knowledge summary into the prompt. Refuses to invent issues (`FACT_GUARD` / `verifiedIssues` on the first message). |
| Qualify | NBA action `ASK_QUALIFICATION` exists. It is **not** in `NBA_OWNS_REPLY`, so a live reply falls through to `composeAgentReply`. |
| Identify problems | First pitch is built from audit findings, not from a free-form diagnosis. |
| Answer questions | `composeAgentReply`, or NBA `ANSWER_QUESTION` which is also **outside** `NBA_OWNS_REPLY` (generic composer). |
| Handle objections | Extractor stores them. If `nextBestAction === 'HANDLE_OBJECTION'`, the executor sends approved `objectionResponses` or a grounded compose. |
| Detect buying signals | Extractor returns them and **drops them**. Intent `PURCHASE_INTEREST` / `READY_TO_BUY` is the persisted stand-in, and it does change NBA. |
| Recommend demo | `OFFER_DEMO` / `SCHEDULE_DEMO` are in `NBA_OWNS_REPLY`. `SCHEDULE_DEMO` **nudges**; it does not book. A regex `BOOKING_HANDOFF_RE` in the webhook moves the thread to `BookingConversation` and emits `booking/agent.reply`. |
| Recommend nurture | The drip (`composeFollowUp`, `onlyIfNoReply`) is the nurture. Proactive NBA is a second path behind V2. |
| Recommend purchase | `OFFER_SUBSCRIPTION` is in `NBA_OWNS_REPLY` and can send the configured subscribe/shop URL. |
| Create or update lead fields | **Does not create leads.** Extraction updates score/intent/objections/pain points. Ownership updates go through `setLeadOwnership`. |
| Schedule follow-ups | Yes: config `followUps[].delayHours` inside `runSalesFollowUpDrip`. Stops when status is no longer `active`, the lead replied (`onlyIfNoReply`), or `salesReplyBlockedReason` matches. |
| Hand off to human | `checkHandoffTriggers` and NBA `HUMAN_HANDOFF` → `setLeadOwnership(..., 'HUMAN', ..., 'HUMAN_HANDOFF')` plus a super-admin push. |
| Return to AI | Not self-serve. Admin `POST /api/admin/leads/return-to-ai` → `releaseFromHuman`. |

**Cannot:** book a calendar slot itself, take payment, create an invoice, assign a human user, write `businessProfile`, or speak when `SalesAgentConfig.enabled` is false (nurture never starts, so there is no active conversation to reply to unless one was created while the flag was on).

---

# SECTION 8 — DEMO AGENT

“Demo agent” in this codebase is the **booking agent**, not a separate post-demo analyst. Post-demo analysis is `runPostDemoAnalysis` in `src/services/demo/postDemoAnalysis.ts`.

## Trace

```text
BOOK DEMO (website)
  → Lead + DemoBooking Pending "To be scheduled" + BookingConversation
  → booking/agent.reply
       if BookingAgentConfig.enabled === false
         → fallback copy ("a team member will get back to you")
       else handleCollecting / offerRealSlots
         → getAvailableSlots (Google free/busy, Mon–Fri 10:00–18:00 IST)
         → if calendar env missing: human-handoff copy, setLeadOwnership HUMAN
PICK SLOT
  → pickSlotFromReply (deterministic parse, not a second LLM guess)
CONFIRM
  → bookConfirmedSlot
  → createDemoEvent (src/services/calendar/googleCalendar.ts)
  → DemoBooking status Confirmed, calendarEventId, meetingLink
  → setLeadOwnership DEMO / DEMO_SCHEDULED
  → WhatsApp confirmation includes the Meet link
  → event demo/booked → process-demo-booking emails (admin + customer)
REMINDERS
  → scheduleDemoReminders creates ScheduledAction DEMO_REMINDER (24h and 1h)
  → nurture-scheduler-tick sends them directly (NOT behind LEAD_ENGINE_V2)
RESCHEDULE / CANCEL
  → handleBookedReply + classifyBookedReplyIntent
  → cancel path returns ownership to SALES / NURTURING
NO-SHOW
  → ScheduledAction NO_SHOW_CHECK → runNoShowCheck
  → DemoBooking status 'No Show'
  → runPostDemoAnalysis(..., 'NO_SHOW')
ATTENDED / COMPLETED
  → NOT inferred from Google Meet joins
  → Admin PATCH /api/admin/demo-bookings status 'Completed'
  → runPostDemoAnalysis → ownership SALES / DEMO_COMPLETED
```

## What exists

| Step | Status |
| --- | --- |
| Web form capture | **Implemented.** No slot picker on the page. |
| Availability | **Implemented** when `GOOGLE_CALENDAR_CREDENTIALS_JSON` and `GOOGLE_CALENDAR_ID` are set (`src/services/calendar/googleCalendar.ts`). Otherwise handoff copy. Runtime presence of those env vars: **unknown**. |
| Slot selection | **Implemented** in WhatsApp, not on the website. |
| Confirmation + Meet link on WhatsApp | **Implemented** in `renderConfirmation`. |
| Meeting link in the customer **email** | **Weak.** `process-demo-booking` tells them the team will confirm a link. It does not put the Meet URL in the email. |
| Reminders | **Implemented** as `DEMO_REMINDER` rows, sent by `nurture-scheduler-tick`. |
| Reschedule / cancel | **Implemented** in `handleBookedReply`. |
| No-show | **Implemented** via `NO_SHOW_CHECK`, not via calendar attendance. |
| Mark attended | **Manual** admin status `Completed`. |
| Demo model | `src/models/DemoBooking.ts`. Status enum: `Pending`, `Confirmed`, `Completed`, `Cancelled`, `No Show`, `Rescheduled`. |

`BookingAgentConfig` default `enabled: false` (`src/lib/bookingAgentDefaults.ts`). A disabled agent does not offer slots.

Customer businesses have a **different** appointment bot: `src/services/whatsapp-agent/appointmentAgent.ts`. That books the tenant's own appointments. It is not the GrowwMatics demo calendar.

---

# SECTION 9 — FREE REPORT → SALES FLOW

```text
Visitor → /free-report
  → POST /api/free-report/start
  → provisionShadowAccount (User, org, Business, Subscription)
  → fileFreeReportLead
       Lead (Website, Platform Prospect, aiLeadScore 60)
       currentAgent SALES, currentStage NURTURING   [unless already DEMO/HUMAN/…]
       intent EXPLORING
  → createPendingAuditAndDispatch (fastMode)
  → Inngest generate-audit
       on COMPLETED:
         sales/nurture.requested
         report/ready.requested     (template, if configured)
  → browser polls → /free-report/result (FreeReportView, pricing CTA is UI)

sales/nurture.requested
  → if SalesAgentConfig.enabled is false: STOP
  → if phone never inbound to the platform: WhatsApp "reply YES" only
  → on YES: sales/nurture.consented → first pitch → follow-up sleeps
  → on reply: sales/agent.reply → extract → NBA or generic compose

Qualification / demo / purchase
  → only inside that WhatsApp thread
  → no automatic calendar booking from the free-report form
  → no leadScore bump for FREE_REPORT_SUBMITTED
```

| Question | Answer |
| --- | --- |
| Lead created? | **Yes**, on the website form. |
| Report generated? | **Yes**, Inngest audit (`fastMode`). |
| Report available? | **Yes**, `/free-report/result?auditId=...`. Optional WhatsApp “ready” template. |
| Sales agent triggered? | **Only if the sales agent singleton is enabled.** Code default is off. |
| Follow-up? | Configured drip after the first pitch, if the agent ran. |
| Conversation? | `SalesConversation`, keyed by phone, not by `leadId`. |
| Scoring? | Static `aiLeadScore: 60` at create. Behavioural `leadScore` only after inbound sales messages. |
| Demo offer? | Not from the form. Later, via chat, NBA, or booking-keyword handoff. |
| Human? | Not automatically at submit. Handoff triggers run on later inbound messages. Consent is required before pitching a number that has never messaged the platform, because the form can contain someone else's phone (`salesNurtureRequested` comment). |

**WhatsApp “get my free report” is a different door.** It creates a `ReportConversation` and can complete an audit and emit the same nurture event. It does **not** call `fileFreeReportLead`. If that phone has no platform lead, nurture may still open a `SalesConversation`, but extraction, NBA, handoff, and payment matching have no `Lead` to update.

**If the sales agent is disabled, free report and the sales system are disconnected after the lead row and the audit.** The result page can still show pricing. That page does not start the agent.

---

# SECTION 10 — NURTURING ENGINE

## What is actually automatic

| Mechanism | Automatic? | Channel | Gated by |
| --- | --- | --- | --- |
| Platform sales first pitch + drip | Yes, **if the agent is enabled** | WhatsApp | `SalesAgentConfig.enabled` (default false). Consent YES if the phone never messaged first. |
| Platform booking conversation | Yes, **if the booking agent is enabled** | WhatsApp | `BookingAgentConfig.enabled` (default false) |
| Demo reminders and no-show check | Yes, **after a real booking** | WhatsApp | Created in `bookConfirmedSlot`. Not V2-gated |
| Proactive NBA (`proactive-nba-scheduler`, every 30 min) | Only when the flag and cohort allow | WhatsApp | `LEAD_ENGINE_V2 === 'true'` and `isLeadInCohort` (default 0%) |
| V2 orchestrator cooldown | 4 hours default on proactive sends | — | `ORCHESTRATOR_COOLDOWN_HOURS` or `OrchestrationConfig.cooldownHours` |
| Legacy `follow-up-cron` (hourly) | **Registered but inert** | Would have been WhatsApp | Query cannot match: no `lastInteractionTime` field |
| Customer Day 1 / 3 / 7 | **Removed** | — | `schedule-lead-follow-ups` owner alert only. `dispatch-crm-whatsapp` is a no-op consumer |
| Customer stale-lead cron | Reminds the **owner**, never the lead | In-app / owner WA | `crm-stale-lead-reminders` |
| Email nurture | **Not implemented** for sales | Email exists for demo booked, payment failure, cancellation | — |

AI-generated vs rules:

- First pitch and drip copy: LLM (`composeFirstMessage` / `composeFollowUp`) constrained by audit facts and config.
- NBA reply subset: LLM or approved snippets inside `executeNextAction`.
- Opt-out, handoff, and “do not message customers” are rules, not model judgment.

Quiet period: the 4-hour proactive cooldown applies to orchestrator sends. The legacy inline drip uses its own `delayHours` and does not consult `lastProactiveMessageAt`.

Opt-out: inbound STOP / UNSUBSCRIBE / CANCEL on the platform webhook calls `optOutLeadByPhone` (`src/services/leadOwnership/optOutLead.ts`). That sets `nurtureStatus: 'OPTED_OUT'`, cancels `ScheduledAction`s, and logs `OPT_OUT`. It does **not** set `currentStage: 'DO_NOT_CONTACT'`. Conversation status is also set to `stopped` by the webhook. NBA absolute rule “Opted out” then returns `STOP`.

## Behaviour by situation (platform lead)

| Situation | Current behaviour |
| --- | --- |
| New free-report lead | Row + `SALES`/`NURTURING` + audit. WhatsApp nurture **only if sales agent enabled**, and only a consent ask if the number is cold. |
| New book-demo lead | Row + `DEMO`/`DEMO_REQUESTED` + pending booking. Booking agent speaks **only if enabled**. |
| Imported **customer** lead | No platform message. No `crm` automation beyond skipping the owner alert (`bulk: true`). |
| Silent platform lead (no reply) | Drip continues while `SalesConversation.status === 'active'` and `onlyIfNoReply` is set. Nothing moves them to `UNRESPONSIVE` or `COLD`. |
| Contacted (they replied) | `onlyIfNoReply` drip stops. `sales-agent-reply` runs extraction and maybe NBA. |
| Won / customer | `runCustomerActivationSequence` sets `IN_HOUSE` / `CUSTOMER` and `cancelScheduledActions(..., 'converted')`. `salesReplyBlockedReason` blocks further sales replies. |
| Lost | **No writer** sets `currentStage: 'LOST'` or `lifeCycleStage` on platform leads. NBA has a LOST row that would WAIT, but it never matches unless something else set the stage. Customer CRM uses `lifeCycleStage: 'closed'` and `lostAt`. |
| Do not contact | STOP sets `nurtureStatus: 'OPTED_OUT'`. `currentStage: 'DO_NOT_CONTACT'` is checked by the orchestrator and NBA but **never assigned**. |
| Human-owned | `salesReplyBlockedReason` / `isHumanOwned` block sales, booking, support, report, and the drip. Admin return-to-AI clears `humanHandoff.active` and sets `SALES`/`NURTURING` or `IN_HOUSE`/`CUSTOMER`. |

**Automatic WhatsApp to platform prospects is implemented and default-off** (agent `enabled: false` at first insert). **Automatic WhatsApp to customer-CRM leads is implemented as removed.** Whether a given environment has flipped the three agent flags on is a database fact, not a code fact.

---

# SECTION 11 — NEXT BEST ACTION

**Status: IMPLEMENTED as a chooser. PARTIALLY IMPLEMENTED as a sender. Not the six-label target list verbatim.**

Chooser: `decideNextAction` in `src/services/nba/decideNextAction.ts`.

Order:

1. Absolute: `nurtureStatus === 'OPTED_OUT'` or `currentStage === 'DO_NOT_CONTACT'` → `STOP`. `currentAgent === 'HUMAN'` → `WAIT`.
2. Hard rule: `isExplicitHumanRequest(text)` → `HUMAN_HANDOFF` (while an AI agent still owns the lead).
3. LLM `suggested_action` if it is in the legal set and confidence `>= 0.5`.
4. Else the first matching rule's `defaultAction`.

Writes `Lead.nextBestAction` and usually `nextActionAt = now`.

Enum (`NBA_ACTIONS` / `Lead.nextBestAction`):

`ASK_QUALIFICATION`, `EDUCATE`, `SHARE_USE_CASE`, `ANSWER_QUESTION`, `HANDLE_OBJECTION`, `SHOW_VALUE`, `OFFER_DEMO`, `SCHEDULE_DEMO`, `SEND_PRICING`, `FOLLOW_UP_AFTER_DEMO`, `OFFER_SUBSCRIPTION`, `REENGAGE`, `WAIT`, `HUMAN_HANDOFF`, `STOP`.

### Target examples vs code

| Target example | Code action | Chosen? | Sent on the sales reply path? |
| --- | --- | --- | --- |
| Educate | `EDUCATE` | Yes, legal in nurture/new rules | **No.** Not in `NBA_OWNS_REPLY`. Generic `composeAgentReply` runs instead. Proactive send only via V2 scheduler. |
| Answer questions | `ANSWER_QUESTION` | Yes | **No** on the executor path (same fall-through). The generic composer does answer. |
| Handle objections | `HANDLE_OBJECTION` | Yes, default when nurturing with an open objection | **Yes** (`NBA_OWNS_REPLY`) |
| Share value | `SHOW_VALUE` (also `SHARE_USE_CASE`) | Yes, default for `NURTURING` with no objection | **Not** on the reply executor. The drip's V2 branch schedules `SHOW_VALUE`. Inline drip uses `composeFollowUp`, which is value-shaped but is not this enum. |
| Re-engage | `REENGAGE` | Yes, default for `COLD` — and `COLD` is never written | Reply executor can send it **if** something set `nextBestAction` to it. Stage default will not. |
| Offer subscription | `OFFER_SUBSCRIPTION` | Yes, default when intent is `PURCHASE_INTEREST` or `READY_TO_BUY` | **Yes** |

`NBA_OWNS_REPLY` (sales reply actually calls `executeNextAction`):

`SEND_PRICING`, `HANDLE_OBJECTION`, `OFFER_DEMO`, `SCHEDULE_DEMO`, `HUMAN_HANDOFF`, `OFFER_SUBSCRIPTION`, `FOLLOW_UP_AFTER_DEMO`, `REENGAGE`.

`SCHEDULE_DEMO` does not create a calendar event. It nudges. Real booking is the booking agent after a keyword handoff or the book-demo form.

Proactive executor: `proactive-nba-scheduler` creates `ScheduledAction` `EXECUTE_NBA` for `REENGAGE`, `FOLLOW_UP_AFTER_DEMO`, `SHOW_VALUE`, `SHARE_USE_CASE`, `EDUCATE`. `nurture-scheduler-tick` (every 15 minutes) runs `decideNextAction` again (rules only, no new LLM extract) and `executeNextAction({ trigger: 'proactive' })`. **This scheduler returns immediately when `LEAD_ENGINE_V2 !== 'true'`.**

Comments at the top of `decideNextAction.ts` that say the phase does not send are **out of date**. `executeNextAction.ts` sends.

---

# SECTION 12 — LEAD STATES

## Target vs what the code can store

| Target state | Current state | Implemented? | Actual field / value | Notes |
| --- | --- | --- | --- | --- |
| Active Nurture | `currentStage: 'NURTURING'` + `currentAgent: 'SALES'` | **Yes, as the free-report entry stage** | Written by free-report, demo-cancel, and return-to-AI | Not the same as customer `lifeCycleStage: 'active'` |
| Long-Term Nurture | `currentStage: 'LONG_TERM_NURTURE'` | **Enum + NBA row only** | Never assigned | Would default NBA to `WAIT` |
| Unresponsive | `currentStage: 'UNRESPONSIVE'` | **Enum + NBA row only** | Never assigned | Silent leads stay `NURTURING` while the drip runs |
| Lost | `currentStage: 'LOST'` | **Enum + funnel query only** | Never assigned | Customer CRM “lost” is `lifeCycleStage: 'closed'` + `lostAt` |
| Do Not Contact | `nurtureStatus: 'OPTED_OUT'` | **Partial** | STOP sets nurture status, not `currentStage: 'DO_NOT_CONTACT'` | Both are checked. Only one is written |
| Human Owned | `currentAgent: 'HUMAN'` and `currentStage: 'HUMAN_HANDOFF'` and `humanHandoff.active` | **Yes** | `setLeadOwnership` from handoff triggers and NBA | `assignedUserId` on the handoff object is never set |
| Customer | `currentStage: 'CUSTOMER'` and `currentAgent: 'IN_HOUSE'` | **Yes, when a platform lead matches the payer's phone** | `runCustomerActivationSequence` | Also `Business.pipelineStage = 'Customer'` on the **workspace**, which is a different record |

## Other stage systems (do not collapse these)

| System | Values | Who it routes |
| --- | --- | --- |
| `Lead.currentStage` | 16 values, default `NEW` | NBA, funnel, some send blocks |
| `Lead.currentAgent` | `NONE`, `SALES`, `DEMO`, `IN_HOUSE`, `HUMAN` | “May AI speak?” and orchestrator agent match |
| `Lead.lifeCycleStage` | `initial`, `active`, `closed`, `converted` | Customer CRM board and ROI |
| `Lead.pipelineStage` | free string | Legacy. Book-demo writes `New Request` |
| `Lead.status` | `active`, `inactive` | Not a sales stage. Legacy cron looks for `Converted` / `Lost` and therefore never filters correctly |
| `SalesConversation.status` | `active`, `subscribed`, `stopped`, `completed`, `handed_off` | **Primary switch for “run the sales agent on this inbound”** |
| `BookingConversation.status` | `active`, `awaiting_slot_selection`, `booked`, `stopped` | Demo router |
| `Business.pipelineStage` | free string, set to `Customer` on payment | Legacy admin Kanban `/api/admin/sales-leads` |
| `DemoBooking.status` | `Pending`, `Confirmed`, `Completed`, `Cancelled`, `No Show`, `Rescheduled` | Demo operations, not the lead stage |

`QUALIFYING` is in the funnel definition (`src/lib/admin/conversionFunnel.ts`) and in an NBA row. No caller passes it to `setLeadOwnership`.

---

# SECTION 13 — HUMAN HANDOFF

## AI → human — implemented, not behind `LEAD_ENGINE_V2`

`checkHandoffTriggers` in `src/services/agentHandoff/checkHandoffTriggers.ts` runs inside agent reply handlers **before** the LLM reply:

1. `isExplicitHumanRequest` (regex in `src/services/agentHandoff/humanRequest.ts`).
2. Last two `recentExtractionConfidences` both `< 0.4`.
3. `leadScore >= stuckLeadScoreThreshold` (default 76) **and** `currentStage === 'NURTURING'` **and** follow-ups since release `>= stuckNurtureCyclesThreshold` (default 3).

Effect: `setLeadOwnership(leadId, 'HUMAN', reason, agentName, 'HUMAN_HANDOFF')`, `humanHandoff.active = true`, push notification to super-admins.

Also: NBA action `HUMAN_HANDOFF` via `executeNextAction`; booking calendar failure calls `setLeadOwnership(..., 'HUMAN', 'calendar-api-failure', 'demo-agent')` **without** a stage argument (stage stays whatever it was unless the function defaults it — the call found in `functions.ts` omits `newStage`).

`isHumanOwned` (`src/services/agentHandoff/isHumanOwned.ts`) is true when `currentAgent === 'HUMAN'` **or** `humanHandoff.active`. `salesReplyBlockedReason` also blocks opted-out, `DO_NOT_CONTACT`, and customers. These checks are **not** flag-gated.

`setLeadOwnership(HUMAN)` does **not** flip `SalesConversation.status` off `active`. The conversation can stay `active` while replies are blocked by the lead-level check. That is intentional in the ownership service comments, and it is also a split-brain risk: `observeLeadOwnershipShadow` in the webhook re-derives `currentAgent` from whichever conversation is active and can write `SALES` again while `humanHandoff.active` is still true. Safety holds only because `isHumanOwned` reads **either** field.

## Human handles the conversation

There is no separate human inbox sender audited as a full desk workflow in this pass. Admin can read the lead (`GET /api/admin/conversion/leads/[id]`). Platform WhatsApp replies from AI stop. A human answering from the Meta/Twilio inbox is outside this repository. `humanHandoff.assignedUserId` is never populated, so “take ownership” is “AI stopped,” not “this user owns the thread.”

Customer businesses have a parallel switch: `ConversationThread.aiEnabled = false` on the tenant inbox. That does not set `currentAgent`.

## Return to AI — implemented

`POST /api/admin/leads/return-to-ai` → `releaseFromHuman` (`src/services/leadOwnership/releaseFromHuman.ts`):

- Clears `humanHandoff.active`.
- If the reason was `low-confidence-streak`, clears `recentExtractionConfidences`.
- If the reason was `stuck-hot-lead`, snapshots `SalesConversation.followUpsSent` into `followUpsSentAtRelease` (does not zero the real counter).
- `setLeadOwnership` to the caller’s target. The admin route resumes sales leads at `SALES` / `NURTURING` and customers at `IN_HOUSE` / `CUSTOMER`.

There is **no** automatic “human finished, give it back” detector. A human must call that route (or the demo-bookings admin equivalent).

`nurtureStatus: 'PAUSED'` is not how pause works. Pause is human ownership.

---

# SECTION 14 — SUBSCRIPTION / PURCHASE

Provider: **Razorpay only.** No Stripe usage found.

```text
/pricing or /checkout
  → useRazorpayCheckout.subscribe()
  → POST /api/billing/checkout
       creates a Razorpay subscription
       writes razorpaySubscriptionId on Business / Subscription
       DOES NOT grant entitlements
  → Razorpay Checkout widget
  → browser polls GET /api/billing/status
       may call reconcileWorkspaceSubscription() if Razorpay already shows paid

Activation (source of truth):
  Razorpay → POST /api/webhook/razorpay
    HMAC-SHA256 (RAZORPAY_WEBHOOK_SECRET)
    ProcessedWebhookEvent insert (idempotency; claim released if apply throws)
    subscription.activated | subscription.charged:
      activatePlan(userId)                 // Subscription.billingStatus Active, User.subscriptionPlan
      activateBusinessPlan(businessId)     // Business.subscriptionStatus active
                                           // Business.pipelineStage = 'Customer'
                                           // maybeStartContentAutopilot / maybeStartAuditAutopilot
                                           // (no-op until GBP is connected)
      sendPaymentReceivedMessage           // WhatsApp, once, paymentReceivedMessageSentAt
      runCustomerActivationSequence        // Lead ownership + invoice WA + welcome WA

Self-heal:
  GET /api/billing/status and Inngest billing-activation-reconcile-cron (every 10 min)
    → reconcileWorkspaceSubscription
    → activatePlan + activateBusinessPlan + runCustomerActivationSequence
    → does NOT call sendPaymentReceivedMessage
```

| Step | Exists? |
| --- | --- |
| Plan catalog | `GET /api/billing/plans`, `src/lib/billing/planCatalog.ts` |
| Checkout UI | `src/app/checkout/page.tsx`, `src/app/pricing/page.tsx` |
| Server-side payment verification | **Yes, on the webhook** (signature) and **yes, on reconcile** (Razorpay API subscription status). The browser never marks the plan active by itself. |
| Invoice document in Mongo | **No.** `GET /api/billing/invoices` lists Razorpay invoices for the subscription id. Activation sends WhatsApp template `invoiceReady` if `WA_TEMPLATES.invoiceReady` is configured. The template tells the customer the invoice is in the account. It does not attach a PDF. |
| Lead stage `CONVERSION_PENDING` / `PAYMENT_VERIFIED` | **Not written.** Analytics still count those stages. Payment goes to `CUSTOMER`. |

Cancel: `POST /api/billing/cancel` sets cancel-at-period-end. Daily `subscription-expiry-worker` calls `cancelBusinessPlan` when the period ends.

Dev-only: `POST /api/dev/simulate-payment` (QA flag) runs the same activation helpers.

---

# SECTION 15 — CUSTOMER ACTIVATION

`runCustomerActivationSequence` in `src/services/billing/customerActivation.ts` runs **after** entitlements are already committed. It never creates a User or Business. Those already exist from signup, onboarding, or the free-report shadow account.

Lead resolution: owner `User.phone`, else `Business.phone`, normalized, then `Lead.findOne({ phone, tenantId: 'gmbboost-internal' })`. **If no lead, the function returns.** Entitlements stay applied. No IN_HOUSE transition, no invoice WhatsApp, no welcome WhatsApp.

If a lead exists and `currentStage !== 'CUSTOMER'`:

1. `setLeadOwnership(leadId, 'IN_HOUSE', 'payment-verified', 'system', 'CUSTOMER')`.
2. `cancelScheduledActions(leadId, 'converted')`.
3. Invoice template once (`Subscription.invoiceMessageSentAt`).
4. Welcome template once (`Subscription.welcomeMessageSentAt`).
5. `logLeadEvent('CUSTOMER_ACTIVATED', { paymentId, amount, currency })`.

| Question | Answer |
| --- | --- |
| Create customer user? | **No.** User already exists. |
| Activate subscription? | **Yes**, `activatePlan`. |
| Activate business? | **Yes**, `subscriptionStatus: 'active'`, `pipelineStage: 'Customer'`. |
| Create workspace? | **Not at payment.** Workspace was created at signup or free-report. |
| Start onboarding wizard? | **No.** `POST /api/onboarding` and `POST /api/onboarding/intake` are separate. |
| Email? | Payment-received path is WhatsApp + in-app. Failure and cancellation emails exist (`sendPaymentFailedEmail`, `sendCancellationEmail`). |
| WhatsApp? | Payment-received (webhook path), invoice, welcome — each template-gated. Reconcile-only heals can miss the payment-received template. |
| Assign an account manager? | **No.** |
| Start agents? | Sales nurture is skipped for unlocked workspaces. Inbound support uses IN_HOUSE when `currentAgent === 'IN_HOUSE'`. |
| Start GBP connection? | **No.** `maybeStartContentAutopilot` / `maybeStartAuditAutopilot` no-op until GBP is already connected (`src/lib/gbpConnect.ts` is a different flow). |
| Create audit? | Only via autopilot if GBP and category are ready, or the user already had a free-report audit. |
| Create tasks? | Not in this sequence. |

---

# SECTION 16 — POST-SALE / IN-HOUSE AGENT

| Name | Exists? | What it actually is |
| --- | --- | --- |
| In-house agent | **Yes** | `composeInHouseAgentReply` in `src/services/support/supportAgent.ts`. Inngest `support-agent-reply`. Multi-turn after `currentAgent === 'IN_HOUSE'`. Prompt covers setup and product questions. It does not mutate billing. |
| Support agent (pre-sale) | **Yes** | Same Inngest function. Pre-sale is a shorter `composeSupportReply` ack, not the in-house persona. |
| Customer Success agent | **No** | The phrase appears inside review-campaign copy generation, not as a lead owner. |
| Onboarding agent | **No separate service** | The in-house prompt includes walkthrough language. Onboarding HTTP routes are forms, not an agent. |
| Setup assistant | **No separate service** | Same in-house reply. |
| Query-resolution agent | **The in-house reply** | Answers from `PRODUCT_KNOWLEDGE`. Handoff checks still run. |
| Account-management agent | **No** | No plan changes, invoices, or GBP actions from this agent. |

Trigger: platform webhook routes an inbound message to `support/agent.reply` when the support/in-house conversation is the active one (including the exception that an `IN_HOUSE` lead is not left on the sales agent). Exact branch order is in `processPlatformInbound`.

---

# SECTION 17 — BACKGROUND JOBS / AUTOMATION

There is **no** `src/app/api/cron` tree. Jobs are Inngest functions in `src/services/inngest/functions.ts`, served at `src/app/api/inngest/route.ts`.

Sales-relevant jobs:

| Job id | Trigger | Input | Action | Lead impact |
| --- | --- | --- | --- | --- |
| `generate-audit` | `audit/generate.requested` | `auditId` | Runs the audit; emits nurture + report-ready | Indirect: starts sales nurture |
| `report-ready-notification` | `report/ready.requested` | `auditId` | WhatsApp “report ready” for fast-mode audits | Message, not a stage change |
| `sales-nurture-requested` | `sales/nurture.requested` | `auditId` | Consent or first pitch | Creates `SalesConversation` or skips |
| `sales-nurture-consented` | `sales/nurture.consented` | `conversationId` | First pitch + drip after YES | Platform nurture |
| `sales-agent-reply` | `sales/agent.reply` | `conversationId`, `body` | Extract, NBA or compose, send | Updates lead intelligence |
| `booking-agent-reply` | `booking/agent.reply` | `conversationId`, `body` | Collect, slots, book, cancel | Creates lead in `handleCollecting`; sets `DEMO_SCHEDULED` |
| `support-agent-reply` | `support/agent.reply` | conversation + body | Pre-sale ack or in-house help | May hand off |
| `report-agent-reply` | `report/agent.reply` | conversation + body | Connect-link chat | Does not create a lead |
| `report-card-deliver` | `report/deliver.requested` | delivery payload | WhatsApp report card | Lead-gen delivery |
| `process-demo-booking` | `demo/booked` | `bookingId` | Admin + customer email | No stage write |
| `nurture-scheduler-tick` | cron `*/15 * * * *` | due `ScheduledAction` | `DEMO_REMINDER`, `NO_SHOW_CHECK`, `EXECUTE_NBA`, other nurture rows | Sends or analyses |
| `proactive-nba-scheduler` | cron `*/30 * * * *` | platform leads with a due NBA | Inserts `EXECUTE_NBA` | **No-op unless `LEAD_ENGINE_V2 === 'true'`** |
| `follow-up-cron` | cron `0 * * * *` | query on missing `lastInteractionTime` | Would dispatch `scheduler/follow-up` | **Dispatches nothing** |
| `process-followup-job` | `scheduler/follow-up` | `leadId` | Legacy WA send for `gmbboost-internal` only | **Unreachable** while the cron query matches zero rows. Contains a guard for human/opt-out if it ever ran. Also writes `status: 'Lost'`, which is **not** a valid `Lead.status` enum. |
| `schedule-lead-follow-ups` | `crm/lead-created` | `leadId` | Owner WA for organic customer leads | Skips platform tenant. Does not message the lead. |
| `dispatch-crm-whatsapp` | `crm/dispatch-whatsapp` | legacy payload | `handleLegacyCrmDispatch` | No lead message |
| `crm-follow-up-reminders` | cron `*/15` | due owner tasks | Notify owner | Customer CRM |
| `crm-stale-lead-reminders` | cron `30 4 * * *` | quiet customer leads | Owner reminder, sets `followUpNudgedAt` | Never contacts the lead |
| `crm-growth-report-ready` | cron `45 4 * * *` | monthly report | In-app + push | Customer CRM |
| `process-whatsapp-message` | `whatsapp/incoming` | **tenant** inbound | Tenant AI + appointment agent + summary | Customer leads only |
| `billing-activation-reconcile-cron` | cron `*/10` | recent unpaid businesses with a Razorpay id | `reconcileWorkspaceSubscription` | May run activation sequence |
| `subscription-expiry-worker` | cron `0 6 * * *` | cancel-at-period-end | Locks the workspace | Does not edit `Lead` |
| `cleanup-stale-pending-audits` | cron every minute | stuck `PENDING` audits | Marks failed | Free-report UX |
| `audit-autopilot-cron` | hourly | eligible paying businesses | Starts audits | Customers, not prospects |

`ScheduledAction` (`src/models/ScheduledAction.ts`) action types include the NBA set plus `DEMO_REMINDER`, `NO_SHOW_CHECK`, and `EXECUTE_NBA`.

---

# SECTION 18 — AI AGENTS INVENTORY

“Agent” here means a named conversational worker with its own config, conversation collection, and Inngest function. A single Groq call is not listed as an agent.

| Agent | Exists? | Trigger | Input | Tools / side effects | Output | Can take action? |
| --- | --- | --- | --- | --- | --- | --- |
| Sales | Yes. `salesAgent.ts`. Default **disabled**. | Post-audit event; inbound on active `SalesConversation` | Audit scores, knowledge, transcript, lead-by-phone | Groq, WhatsApp, extractor, NBA executor, booking keyword handoff | WA messages, conversation status | Messages and field updates. Does not book or charge. |
| Demo / Booking | Yes. `bookingAgent.ts`. Default **disabled**. | `booking/agent.reply`; book-demo proactive send | `BookingConversation`, calendar | Groq, Google Calendar, `DemoBooking`, reminders | Slot list, Meet link, status | **Yes:** book, reschedule, cancel. |
| Report | Yes. `reportAgent.ts`. Default **disabled**. | `report/agent.reply`, report delivery | `ReportConversation`, audit | Groq, connect links, report card | WA | Messages. Does not create `Lead`. |
| Support / In-house | Yes. `supportAgent.ts` | `support/agent.reply` | `SupportConversation`, product knowledge, lead | Groq, handoff checks | WA | Advises. No billing writes. |
| Lead intelligence | **Not an agent.** Library `extract.ts` | Called by sales (awaited), booking/support (async), post-demo | Message + history | Groq JSON, score table, `decideNextAction` | Lead fields | Writes. Does not send. |
| NBA executor | **Not an agent.** `executeNextAction.ts` | After a chosen action on the reply path, or from the scheduler | Lead + action + history | WhatsApp, handoff, pricing snippets | Message or handoff | Sends for executable actions. |
| Nurture | **Not a separate agent.** It is the sales drip + scheduler | See Section 10 | Config delays or `ScheduledAction` | WhatsApp | Follow-ups | Yes, under the flags above. |
| Tenant WhatsApp agent | Yes, different product. `process-whatsapp-message` | Customer business number | `ConversationThread`, customer lead | Groq, `appointmentAgent` | WA + CRM activity | Yes, for that tenant's customers. |
| Customer Success | **No** | — | — | — | — | — |

---

# SECTION 19 — API / ROUTE INVENTORY

Auth shorthand: **SA** = `requireSuperAdmin`, **BC** = `requireBusinessContext`, **CL** = `requireClient`, **Public** = no session (rate limit or provider signature).

## Lead

| Path | Method | Purpose | Caller | Service | DB writes | AI | Side effects |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/api/free-report/start` | POST | Free-report intake | Website | `fileFreeReportLead`, `provisionShadowAccount`, `createPendingAuditAndDispatch` | Lead, User, Business, Audit | Audit later | Inngest audit |
| `/api/leads/book-demo` | POST | Demo form | Website | `fileDemoRequest` | Lead, DemoBooking, BookingConversation | Booking agent later | `booking/agent.reply` |
| `/api/crm/leads` | GET, POST | Customer list/create | Dashboard | `createOrUpdateCustomerLead` | Lead, Activity | No | `crm/lead-created` |
| `/api/crm/leads/[id]` | PATCH | Customer stage/edit | Dashboard | CRM update | Lead | No | Stage side effects in CRM service |
| `/api/crm/leads/[id]/activity` | POST | Note/activity | Dashboard | CRM | Activity | No | |
| `/api/crm/leads/[id]/timeline` | GET | Timeline | Dashboard | CRM | No | No | |
| `/api/crm/leads/import` | POST | CSV | Dashboard | customer leads, bulk | Lead | No | No owner alert |
| `/api/leads` | GET | List by business | Dashboard/mobile | Lead query | No | No | `businessId` scoped |
| `/api/leads/quick-add` | POST | Mobile add | Mobile | customer leads | Lead | No | `crm/lead-created` |
| `/api/leads/bulk-import` | POST | Contacts | Mobile | customer leads | Lead | No | bulk, no alert |
| `/api/customers/import-leads` | POST | Import variant | Customer tools | customer leads | Lead | No | bulk |
| `/api/admin/conversion/pipeline` | GET | Platform lead list | `/admin/leads` | `PLATFORM_LEAD_MATCH` | No | No | |
| `/api/admin/conversion/leads/[id]` | GET | Platform lead detail | Admin detail page | conversion query | No | No | 404 if tenant is not platform |
| `/api/admin/conversion/overview` | GET | Funnel counts | Admin | `conversionFunnel.ts` | No | No | |
| `/api/admin/conversion/analytics` | GET | Analytics | Admin | counts on `currentStage` | No | No | Includes stages nothing writes |
| `/api/admin/sales-leads` | GET | **Legacy** workspace Kanban | Old admin | `Business.pipelineStage` | No | No | Not the Lead engine |
| `/api/admin/sales-leads/[id]` | PATCH | Move workspace column | Old admin | Business update | `Business.pipelineStage` | No | Payment later overwrites to Customer |
| `/api/admin/sales-leads/columns` | GET, PATCH | Kanban columns | Old admin | column config | columns | No | |

## Sales

| Path | Method | Purpose | Auth | Writes | AI |
| --- | --- | --- | --- | --- | --- |
| `/api/admin/sales-agent` | GET, PUT | Sales persona, knowledge, `enabled`, follow-up delays | SA | `SalesAgentConfig` | Config only |
| `/api/admin/lead-engine/status` | GET | Flag + sample lead ownership | SA | No | No |
| `/api/dev/lead-engine` | * | QA helper for the engine | Dev/QA | Can mutate leads | Yes when exercised |

## Nurture

No public “nurture” REST route. Nurture is Inngest (`sales/nurture.requested`, scheduler crons) plus:

| Path | Method | Purpose |
| --- | --- | --- |
| `/api/followups`, `/api/followups/[id]` | CRUD | **Customer CRM owner tasks**, not platform drip |

## Demo

| Path | Method | Purpose | Auth | Writes | AI |
| --- | --- | --- | --- | --- | --- |
| `/api/leads/book-demo` | POST | See Lead | Public | Lead, booking, conversation | Dispatches agent |
| `/api/admin/demo-bookings` | GET, PATCH | List, complete, cancel, return-to-AI | SA | `DemoBooking`, ownership | Post-demo analysis on Completed |
| `/api/admin/booking-agent` | GET, PUT | Booking config including `enabled` | SA | `BookingAgentConfig` | Config |
| `/api/admin/conversion/demos` | GET | Demo funnel | SA | No | No |

## Conversation

| Path | Method | Purpose | Auth | Notes |
| --- | --- | --- | --- | --- |
| `/api/whatsapp/webhook` | GET, POST | Inbound router | Provider signature | Platform vs tenant split |
| `/api/conversations/[leadId]` | GET | Tenant thread | BC | Lead must match `businessId` |
| `/api/whatsapp/chat-history/[leadId]` | GET | History | BC | Tenant |
| `/api/whatsapp/summary/[leadId]` | GET | Summary | BC | Tenant |
| `/api/whatsapp/customer-context/[leadId]` | GET | Context | BC | Tenant |
| `/api/inbox/*` | various | Tenant inbox + SSE | BC | `aiEnabled` pause |

Platform sales transcripts are on `SalesConversation`, read through admin conversion detail, not through `/api/conversations/[leadId]` (that route is business-scoped and platform leads have no `businessId`).

## AI

| Path | Method | Purpose |
| --- | --- | --- |
| `/api/admin/sales-agent` | GET, PUT | Sales |
| `/api/admin/booking-agent` | GET, PUT | Booking |
| `/api/admin/report-agent` | GET, PUT | Report |
| `/api/inngest` | GET, POST, PUT | Inngest serve |

## Conversion

`/api/admin/conversion/overview`, `/pipeline`, `/analytics`, `/demos`, `/leads/[id]` — all GET, all SA, all `tenantId: 'gmbboost-internal'`.

`/api/admin/leads/return-to-ai` POST — SA — `releaseFromHuman`.

## Payment

| Path | Method | Purpose | Auth | Writes | Side effects |
| --- | --- | --- | --- | --- | --- |
| `/api/billing/checkout` | POST | Create Razorpay subscription | BC | ids on Business/Subscription | Razorpay API. No entitlements |
| `/api/billing/status` | GET | Gate + reconcile | CL | Maybe activate | May run activation sequence |
| `/api/billing/invoices` | GET | List Razorpay invoices | BC | No | Razorpay read |
| `/api/billing/cancel` | POST | Cancel at period end | CL | cancel flag | Razorpay |
| `/api/billing/plans` | GET | Public prices | Public | No | |
| `/api/webhook/razorpay` | POST | Activation | HMAC | Subscription, User, Business, maybe Lead | WA, autopilot, activation sequence |
| `/api/dev/simulate-payment` | POST | QA payment | QA flag | Same helpers | |

## Customer activation

No dedicated REST route. It is `runCustomerActivationSequence`, called from the webhook and from reconcile.

## Admin (related)

`/api/admin/crm-monitor`, `/api/admin/whatsapp-monitor` — SA read models. CRM monitor is customer leads (`Client Prospect`), not the platform funnel.

---

# SECTION 20 — CURRENT END-TO-END FLOW

Only steps confirmed in code. Gates that default off are shown as gates, not as guaranteed sends.

### Flow A — Free Report

```text
WEBSITE /free-report
   ↓
POST /api/free-report/start
   ↓
Shadow User + Business + Subscription
   ↓
Lead upsert (Platform Prospect, Website, aiLeadScore 60)
   ↓
currentAgent SALES, currentStage NURTURING, intent EXPLORING
   ↓
Audit job (fastMode)
   ↓
Report page + optional "report ready" WhatsApp
   ↓
sales/nurture.requested
   ↓
SalesAgentConfig.enabled ? 
   NO → stop (lead and report exist, no sales chat)
   YES → consent YES if number is cold, else first pitch
   ↓
Follow-up drip while they stay silent and status stays active
   ↓
Reply → extract → leadScore/intent → NBA or generic reply
```

### Flow B — Book Demo

```text
WEBSITE /book-demo
   ↓
POST /api/leads/book-demo
   ↓
Lead upsert (Demo Booking, aiLeadScore 85, pipelineStage New Request)
   ↓
DEMO / DEMO_REQUESTED, intent DEMO_INTEREST
   ↓
DemoBooking Pending "To be scheduled"
   ↓
BookingConversation + booking/agent.reply
   ↓
Browser also opens wa.me
   ↓
BookingAgentConfig.enabled ?
   NO → fallback "team will reply"
   YES → collect details (Lead created here only if it did not exist)
        → Google slots or human handoff if calendar missing
        → confirmed Meet link + DEMO_SCHEDULED
        → reminders + no-show job
```

### Flow C — Sales Conversation

```text
Active SalesConversation + inbound WhatsApp
   ↓
sales/agent.reply
   ↓
Blocked if human / opted out / do-not-contact / customer
   ↓
Handoff triggers (explicit human, low confidence ×2, stuck hot)
   ↓
extractLeadIntelligence → decideNextAction
   ↓
If nextBestAction in NBA_OWNS_REPLY → executeNextAction (may send or hand off)
   Else composeAgentReply → WhatsApp
```

### Flow D — Nurture

```text
Enabled sales agent
   ↓
Inline drip (Inngest sleeps)  — default path
   OR, only if LEAD_ENGINE_V2 and cohort:
        ScheduledAction SHOW_VALUE → nurture-scheduler-tick

Proactive NBA cron → no-op unless LEAD_ENGINE_V2

Legacy hourly follow-up cron → matches zero leads

Customer CRM → owner tasks only
```

### Flow E — Demo

```text
Pending website booking OR WhatsApp slot confirm
   ↓
Google event + meetingLink on DemoBooking
   ↓
WhatsApp confirmation (link included)
   ↓
Email (link not included)
   ↓
DEMO_REMINDER at 24h and 1h
   ↓
NO_SHOW_CHECK OR admin marks Completed
   ↓
runPostDemoAnalysis → SALES / DEMO_COMPLETED → NBA follow-up-after-demo
```

### Flow F — Conversion

```text
There is no currentStage CONVERSION_PENDING writer.

Purchase intent (intent PURCHASE_INTEREST or READY_TO_BUY)
   ↓
NBA OFFER_SUBSCRIPTION (subscribe URL in the WhatsApp message)
   ↓
Human checkout on /checkout
```

The funnel UI will also label a lead “Purchase intent” when `currentStage === 'CONVERSION_PENDING'`, which nothing sets.

### Flow G — Payment

```text
POST /api/billing/checkout  (no unlock)
   ↓
Razorpay widget
   ↓
Webhook signature + idempotency
   OR reconcile cron / billing status
   ↓
activatePlan + activateBusinessPlan
   Business.pipelineStage = Customer
   Business.subscriptionStatus = active
```

### Flow H — Customer Activation

```text
Entitlements already saved
   ↓
Find Lead by payer phone + gmbboost-internal
   ↓
No lead → stop (workspace is still paid)
   ↓
IN_HOUSE / CUSTOMER
   ↓
Cancel scheduled nurture
   ↓
Invoice WhatsApp template (if configured)
   ↓
Welcome WhatsApp template (if configured)
   ↓
LeadEvent CUSTOMER_ACTIVATED
   ↓
Later inbound WhatsApp → support-agent-reply → in-house compose
```

### Flow I — Human Handoff

```text
Inbound message
   ↓
checkHandoffTriggers OR NBA HUMAN_HANDOFF OR calendar failure
   ↓
currentAgent HUMAN, currentStage HUMAN_HANDOFF, humanHandoff.active true
   ↓
AI replies stop (sales, booking, support, report, drip)
   ↓
No assigned user id
   ↓
Admin POST /api/admin/leads/return-to-ai
   ↓
humanHandoff.active false
   ↓
SALES/NURTURING or IN_HOUSE/CUSTOMER
```

---

# SECTION 21 — TARGET ARCHITECTURE GAP ANALYSIS

| Target capability | Current status | Existing implementation | Missing | Relevant files |
| --- | --- | --- | --- | --- |
| Lead entry — free report | ✅ IMPLEMENTED | Form, lead upsert, shadow workspace, audit | Sales chat is flag-gated after this | `src/app/api/free-report/start/route.ts` |
| Lead entry — book demo | ✅ IMPLEMENTED | Form, lead, pending booking, WA kickoff | Slot is not on the website. Agent default off | `src/app/api/leads/book-demo/route.ts` |
| Lead entry — contact form | 🔴 NOT IMPLEMENTED | Mailto + Book Demo button | No lead API | `src/app/contact/page.tsx` |
| Create lead (platform) | ✅ IMPLEMENTED | Three write paths, phone dedupe | Report-agent path does not create one | `Lead.ts`, free-report, book-demo, `handleCollecting` |
| Separate customer CRM | ✅ IMPLEMENTED | `createOrUpdateCustomerLead` refuses platform tenant | — | `src/services/crm/customerLeads.ts` |
| Lead intelligence — intent, objections, pain | ✅ IMPLEMENTED | Groq extract on WhatsApp turns | Not run at form submit | `src/services/leadIntelligence/extract.ts` |
| Lead profile (`businessProfile`, interests) | 🔴 NOT IMPLEMENTED | Schema + admin JSON echo | No writer. `buying_signals` dropped | `Lead.ts`, `extract.ts` |
| Lead score 0–100 | ⚠️ IMPLEMENTED DIFFERENTLY | Incremental rule deltas on `leadScore` | Bands are 15/45/75, not 25/50/75. Band unused by rules. `aiLeadScore` is a stale twin | `ScoringRuleConfig.ts`, `rules.ts` `computeScoreBand` |
| Score drives action | 🟡 PARTIALLY IMPLEMENTED | `>= 76` can force human handoff; `>= 15` labels “Qualified” in the funnel | Does not select educate vs buy | `checkHandoffTriggers.ts`, `conversionFunnel.ts` |
| Sales agent | 🟡 PARTIALLY IMPLEMENTED | Full WA worker | Default `enabled: false`. No tools for booking or payment | `salesAgent.ts`, `functions.ts` |
| Demo agent | 🟡 PARTIALLY IMPLEMENTED | Calendar, Meet, reminders, no-show | Default off. Website does not pick a slot. Attendance is manual | `bookingAgent.ts`, `googleCalendar.ts` |
| Qualification stage | 🟡 PARTIALLY IMPLEMENTED | Funnel label from score/intent | `QUALIFYING` never written | `conversionFunnel.ts` |
| Demo decision | 🟡 PARTIALLY IMPLEMENTED | Keyword handoff + NBA `OFFER_DEMO` | No explicit “demo vs nurture” policy object | webhook handoff, `rules.ts` |
| Demo completed analysis | ✅ IMPLEMENTED | `runPostDemoAnalysis` on admin Completed and on no-show | No automatic “attended” from Meet | `src/services/demo/postDemoAnalysis.ts` |
| Next best action | ⚠️ IMPLEMENTED DIFFERENTLY | 15-action table, stored on the lead | Educate / answer / show-value do not own the live reply. Proactive send needs V2 | `decideNextAction.ts`, `executeNextAction.ts` |
| Nurture loop | 🟡 PARTIALLY IMPLEMENTED | Sales drip + consent + opt-out | Default off. No long-term/unresponsive stages. Customer auto-WA removed | `functions.ts` `salesNurtureRequested` |
| Avoid spam | 🟡 PARTIALLY IMPLEMENTED | Consent gate, opt-out, `onlyIfNoReply`, human block, 4h V2 cooldown | Inline drip does not use the cooldown. Legacy cron is inert rather than smart | `optOutLead.ts`, `outboundOrchestrator.ts` |
| Human handoff any stage | 🟡 PARTIALLY IMPLEMENTED | Triggers + return-to-AI admin route | No assignee. No pause enum. Shadow sync can rewrite `currentAgent` | `checkHandoffTriggers.ts`, `releaseFromHuman.ts` |
| Subscription offer | 🟡 PARTIALLY IMPLEMENTED | `OFFER_SUBSCRIPTION` WA + `/checkout` | Not tied to score band | `executeNextAction.ts`, checkout routes |
| Payment | ✅ IMPLEMENTED | Razorpay checkout, webhook HMAC, reconcile | No Stripe | `src/app/api/webhook/razorpay/route.ts` |
| Payment verification | ✅ IMPLEMENTED | Signature + Razorpay API reconcile | Client poll does not grant access by itself | `razorpayReconcile.ts` |
| Invoice | ⚠️ IMPLEMENTED DIFFERENTLY | Razorpay invoice list + WA template | No local invoice model or PDF generator | `customerActivation.ts`, `/api/billing/invoices` |
| Customer activation | 🟡 PARTIALLY IMPLEMENTED | Plan + business unlock always; lead → IN_HOUSE only if phone matches | Skips `PAYMENT_VERIFIED`. No onboarding agent | `applyEntitlements.ts`, `customerActivation.ts` |
| Customer success agent | 🔴 NOT IMPLEMENTED | In-house support reply covers questions | No CS owner, no success playbooks, no account manager | `supportAgent.ts` |
| States: Active / Long-term / Unresponsive / Lost / DNC | ⚠️ IMPLEMENTED DIFFERENTLY | `NURTURING`, `OPTED_OUT`, `HUMAN_HANDOFF`, `CUSTOMER` are real | Long-term, unresponsive, lost, DNC stage, qualifying, conversion-pending, payment-verified are unused enums | `Lead.ts`, `setLeadOwnership.ts` |

---

# SECTION 22 — DUPLICATE / CONFLICTING SYSTEMS

### 1. `currentStage` vs `lifeCycleStage` vs `pipelineStage` vs `Business.pipelineStage`

1. Four stage fields.
2. **Active for platform routing/NBA:** `currentStage` + `currentAgent`, with the conversation `status` deciding which agent runs.
3. **Active for customer CRM:** `lifeCycleStage`. **Legacy Kanban:** `Lead.pipelineStage` (still set to `New Request` on demo). **Legacy admin sales board:** `Business.pipelineStage`.
4. A paid free-report user can be `Lead.currentStage = CUSTOMER` and `Business.pipelineStage = Customer` while `lifeCycleStage` is still the default `initial`. Reports that read the wrong field disagree.

### 2. `leadScore` vs `aiLeadScore`

1. Behavioural incremental score vs one-shot constant.
2. **Active:** `leadScore`.
3. `aiLeadScore` is written only at insert (60 or 85) and still returned by some admin queries.
4. Sorting or filtering on `aiLeadScore` will not match behavioural heat. A demo lead looks “85” forever even if they opt out.

### 3. Score bands vs stuck-hot threshold

1. `computeScoreBand` (15/45/75) and `stuckLeadScoreThreshold` (76).
2. The threshold is active for handoff. The band is not active for NBA.
3. Operators reading “READY” in code comments are not looking at the same cut as “ready to buy” in the target doc, and neither cut offers a subscription by itself.

### 4. Platform CRM vs customer CRM

1. Same `Lead` model, opposite create services.
2. Both are active.
3. Platform: `tenantId === 'gmbboost-internal'`. Customer: `businessId` + non-platform tenant.
4. A bug that queries `Lead.find({ phone })` without tenant or business will merge a prospect with a tenant's customer. The hot path uses the compound index. Not every script was re-checked in this audit.

### 5. Old follow-up vs sales drip vs V2 scheduler

1. Three senders: inert `follow-up-cron`, live `runSalesFollowUpDrip`, V2 `proactive-nba-scheduler` + `nurture-scheduler-tick`.
2. **Live when the sales agent is on:** inline drip. **Live when V2 and cohort match:** scheduler path instead of (or in addition to — the drip branches) inline sends. **Never live:** hourly cron.
3. Files: `functions.ts` (`followUpCron`, `runSalesFollowUpDrip`, `proactiveNbaScheduler`, `nurtureSchedulerTick`).
4. Turning `LEAD_ENGINE_V2` on without understanding the drip branch can change copy from `composeFollowUp` to `SHOW_VALUE` actions. Leaving it off means proactive NBA never fires. The hourly cron is safe only while `lastInteractionTime` stays absent; “fixing” that query would wake an untested sender that can set an invalid `status: 'Lost'`.

### 6. Multiple lead create paths

Website free report, website demo, and WhatsApp `handleCollecting` all upsert the same phone key. That is consistent. The report agent’s refusal to create a lead is the inconsistent one: nurture can run with no `Lead`.

### 7. Multiple “sales” AIs

1. Platform `salesAgent.ts` vs tenant `process-whatsapp-message` vs unused `generateSalesResponse`.
2. Platform agent is the internal funnel. Tenant worker is the customer product. `generateSalesResponse` is dead.
3. They do not share transcripts (`SalesConversation` vs `ConversationThread`).

### 8. Ownership comments vs ownership reads

`Lead.ts` still says nothing reads `currentAgent` to decide replies and that future reads must check `LEAD_ENGINE_V2`. `isHumanOwned`, NBA, the orchestrator, and the stuck-hot trigger already read those fields with no flag. Trust the call sites, not that comment.

### 9. `observeLeadOwnershipShadow` vs human handoff

The webhook shadow sync writes `currentAgent` from the active conversation after routing. It can set `SALES` while `humanHandoff.active` is true. Reply blocking uses both fields, so the AI still stops, but admin UI that displays only `currentAgent` can show the wrong owner.

### 10. `n8n-workflows/workflow-2-lead-followup.json`

Exported legacy automation. The running sender is Inngest. Do not assume n8n is in the request path.

### 11. Admin “sales leads” vs admin “conversion leads”

`/api/admin/sales-leads` is businesses. `/api/admin/conversion/*` is platform `Lead`s. The sidebar treats conversion as the platform pipeline. Both UIs can still be opened. Payment updates the business column, not the lead’s `lifeCycleStage`.

---

# SECTION 23 — SECURITY / DATA ISOLATION

Static review of route filters. Not a penetration test.

| Control | What the code does |
| --- | --- |
| Platform vs customer rows | Platform writes hard-code `tenantId: 'gmbboost-internal'` and `leadType: 'Platform Prospect'`. Customer writes go through `createOrUpdateCustomerLead`, which throws if the organization id is the platform tenant or if `businessId` is missing. |
| Admin conversion read | `requireSuperAdmin` (`User.role === 'SUPER_ADMIN'`) and `tenantId: 'gmbboost-internal'`. Detail route 404s other tenants (`src/app/api/admin/conversion/leads/[id]/route.ts`). |
| Admin agent config | `requireSuperAdmin` on sales, booking, and report agent routes. |
| Customer CRM | `requireBusinessContext` and `Lead` queries with `businessId: ctx.businessId`. Conversation fetch checks the lead’s `businessId`. |
| WhatsApp platform inbound | Lead lookup uses `tenantId: 'gmbboost-internal'`. It does not call `createOrUpdateCustomerLead`. |
| WhatsApp tenant inbound | Creates/updates a customer lead for that business only. |
| Activation lead lookup | Phone + platform tenant only. Cannot attach a customer’s CRM lead. |
| Legacy follow-up job | Returns immediately when `tenantId !== 'gmbboost-internal'`. |
| Public intake | `/api/free-report/start` and `/api/leads/book-demo` are unauthenticated and rate-limited. They can only write the platform tenant, not an arbitrary `businessId`. |
| Payment webhook | HMAC with `RAZORPAY_WEBHOOK_SECRET`. Idempotency via `ProcessedWebhookEvent`. |
| Payment data | Invoice list is `requireBusinessContext` and reads that workspace’s Razorpay subscription. Platform lead admin APIs do not return Razorpay secrets. Payment ids land on `LeadEvent` metadata when activation runs. |
| Opt-out | `optOutLeadByPhone` only updates a platform-tenant lead. |

**Gaps (code-level, not exploited here):**

- Free-report accepts any phone. The sales consent gate exists specifically because that number may not belong to the submitter. Consent only runs if the sales agent is enabled.
- `humanHandoff.assignedUserId` is unused, so there is no per-rep authorization on a platform thread beyond “is super admin.”
- Shadow ownership sync can disagree with `humanHandoff.active` (Section 22). Blocking still checks both.
- Reconcile can activate a workspace without the payment-received WhatsApp. That is a product gap, not an auth bypass.
- Page-level middleware for `/admin/*` was not line-audited in this pass. **API handlers above are confirmed.** UI gate: **UNKNOWN — requires runtime verification** if a non-admin can open the page shell. Data still depends on the SA APIs.

---

# SECTION 24 — RUNTIME VERIFICATION

`STATIC CODE ANALYSIS ONLY`

`package.json` has `test:integration` (`node --test tests/integration/**/*.test.ts`). Those tests were **not executed** for this audit. They would not show whether production `SalesAgentConfig.enabled`, `BookingAgentConfig.enabled`, `ReportAgentConfig.enabled`, or `LEAD_ENGINE_V2` are on.

Not verified at runtime:

- The stored agent `enabled` flags (code defaults apply only when the singleton is first created).
- `process.env.LEAD_ENGINE_V2` in any deployed environment.
- `OrchestrationConfig.rolloutPercentage` and allowlist in the database (schema default 0 and empty).
- Google Calendar credentials.
- WhatsApp template approval (`invoiceReady`, `welcomeCustomer`, report-ready, consent).
- Whether `follow-up-cron` truly returns zero rows against the live collection (the query cannot match the current schema; a hand-edited document with `lastInteractionTime` could).
- End-to-end Razorpay webhook delivery.

Scripts that exist and were **not** run: `scripts/lead-engine-e2e.mjs`, `scripts/lead-engine-trace.mjs`, `scripts/check-lead-events.mjs`, `scripts/whatsapp-agent-tests/test-lead-intelligence-golden-set.ts`. They are QA harnesses, not proof of production behaviour.

---

# SECTION 25 — FINAL EXECUTIVE SUMMARY

The concise current-reality summary is at the top of this document (What is already built / partially built / missing / legacy / disconnected / what not to rebuild / what the target still needs).

The one-sentence version: **platform leads, a WhatsApp sales and booking stack, behavioural scoring, a next-best-action table, human handoff, and Razorpay activation are in the repo; the agents default to off, several target stages and the target score bands are never applied, proactive NBA waits on a flag that defaults off, and customer-CRM leads are a different product whose automatic WhatsApp was removed.**

---

# FINAL VERDICT

## Already Implemented

- Platform vs customer lead split, with a hard refusal so customer CRM cannot write `gmbboost-internal` leads.
- Website free-report lead + shadow workspace + audit.
- Website book-demo lead + pending `DemoBooking` + booking conversation.
- WhatsApp booking that can create the lead, offer Google Calendar slots, write a Meet link, remind, reschedule, cancel, and mark no-show.
- Sales conversation, consent gate for cold form numbers, fact-constrained first pitch, and delayed follow-ups — **when the sales agent flag is on**.
- Lead extraction of intent, objections, pain points, and incremental `leadScore`.
- Next-best-action decision stored on the lead, with a subset executed on sales replies (pricing, objection, demo nudge, subscription link, handoff, re-engage, post-demo).
- Human stop and admin return-to-AI.
- Opt-out on STOP that sets `nurtureStatus: 'OPTED_OUT'` and cancels scheduled actions.
- Razorpay checkout, signed webhook, idempotency, reconcile cron, workspace unlock, `Business.pipelineStage = 'Customer'`.
- Post-payment IN_HOUSE ownership and in-house WhatsApp replies **when the payer's phone matches a platform lead**.
- Admin conversion read APIs scoped to the platform tenant.

## Partially Implemented

- Sales, booking, and report agents: complete code, **default `enabled: false`**.
- NBA execution: reply path covers 8 of 15 actions; educate / answer / show-value fall through to a generic composer; proactive sends need `LEAD_ENGINE_V2` and a non-empty cohort.
- Score: live 0–100 delta score, different bands from the target, band not used to choose actions, no decay, free-report signal never applied.
- Stages: `NURTURING`, demo stages, `HUMAN_HANDOFF`, and `CUSTOMER` are written. Qualifying, cold, unresponsive, long-term, lost, do-not-contact, conversion-pending, and payment-verified are not.
- Handoff: AI stops and can be returned. No human assignee. `PAUSED` is not a real nurture state.
- Activation: workspace always; lead sequence only on phone match; invoice is a template plus Razorpay’s invoice API.
- Demo attendance: manual `Completed`, not a Meet callback.
- Free-report → sales chat: wired, then skipped when the agent is disabled or consent is pending.

## Implemented Differently

- “Lead score bands” are `computeScoreBand` at 15/45/75 and are not action policy. The number 76 is a handoff threshold.
- “Do not contact” is `nurtureStatus: 'OPTED_OUT'`, not `currentStage: 'DO_NOT_CONTACT'`.
- “Customer” on the workspace is `Business.pipelineStage`. “Customer” on the prospect is `Lead.currentStage` plus `currentAgent: 'IN_HOUSE'`. Customer-CRM won deals are `lifeCycleStage: 'converted'` and `deal`.
- “Nurture” for platform prospects is a sales drip. “Nurture” for customer leads is owner reminders. The old Day 1/3/7 WhatsApp chain is gone.
- “Invoice” is not a generated document in this app.
- “Next best action” includes a wider enum than the six target labels, and choosing an action is not the same as sending it.
- The in-house support persona is the post-sale agent. There is no Customer Success agent.

## Not Implemented

- Contact-form lead capture.
- Automatic `QUALIFYING` → decision → demo as a state machine (demo is a parallel booking agent and a keyword handoff).
- Writers for `COLD`, `UNRESPONSIVE`, `LONG_TERM_NURTURE`, `LOST`, `DO_NOT_CONTACT`, `CONVERSION_PENDING`, `PAYMENT_VERIFIED`.
- `FREE_REPORT_SUBMITTED` and `INACTIVITY_DECAY` application.
- Persistence of `buying_signals` and `businessProfile`.
- Score-band-driven educate / re-engage / offer-subscription policy.
- A lead row for every WhatsApp report-connect audit.
- Linking every paying user to a platform lead (self-serve checkout with a different phone skips IN_HOUSE).
- Stripe.
- A dedicated onboarding, customer-success, or account-management agent.
- Assignment of a human owner on handoff, and automatic return from human to AI.
- Email nurture.

## Legacy / Conflicting Systems

- `aiLeadScore`, `aiInsights`, `qualificationStatus`, `urgency` (unused AI extractor `extractLeadInsights` / `generateSalesResponse`).
- `Lead.pipelineStage` and `Lead.status` values the old cron still mentions (`Converted`, `Lost`).
- `Business.pipelineStage` admin Kanban (`/api/admin/sales-leads`) beside the conversion lead engine.
- `lifeCycleStage` (customer) beside `currentStage` (platform).
- Inert `follow-up-cron` / `process-followup-job` beside the sales drip.
- Removed Day 1/3/7 consumer `dispatch-crm-whatsapp`.
- Stale “shadow mode / decision-only / gate on LEAD_ENGINE_V2” comments in `Lead.ts`, `decideNextAction.ts`, and the webhook shadow-sync comment.
- `n8n-workflows/workflow-2-lead-followup.json`.
- `observeLeadOwnershipShadow` rewriting `currentAgent` after a human handoff.

## Requires Runtime Verification

- Whether `SalesAgentConfig`, `BookingAgentConfig`, and `ReportAgentConfig` documents in the target database have `enabled: true`.
- Whether `LEAD_ENGINE_V2` is set, and whether `OrchestrationConfig` rollout is still 0%.
- Google Calendar env and WhatsApp template configuration (consent, report ready, invoice, welcome, payment received).
- That `follow-up-cron` matches zero documents in production.
- Admin page shell authorization (APIs are super-admin; middleware was not fully traced).
- A real free-report and a real book-demo against a non-production stack, to see which of the gates above actually fire.

## Recommended Next Investigation

Before any implementation, inspect runtime configuration rather than more filenames:

1. Read the `SalesAgentConfig`, `BookingAgentConfig`, `ReportAgentConfig`, and `OrchestrationConfig` documents (enabled, follow-up delays, rollout percentage, allowlist). Do not change them.
2. Read `LEAD_ENGINE_V2` and the calendar/template env flags in the environment that is considered production. Do not print secrets into tickets.
3. Sample a handful of `Lead` rows with `tenantId: 'gmbboost-internal'` and record `currentAgent`, `currentStage`, `nurtureStatus`, `leadScore`, `aiLeadScore`, `nextBestAction`, and whether a `SalesConversation` or `DemoBooking` exists for the same phone. That shows which of the unused enum values are actually present in data (they should be absent if this audit is right).
4. Sample one completed free-report audit and see whether `sales/nurture.requested` produced a conversation or a skip reason `agent disabled`.
5. Sample one paid `Business` and see whether a platform `Lead` with the same phone reached `CUSTOMER` / `IN_HOUSE`, or whether activation stopped at “no platform-side Lead”.
6. Confirm `follow-up-cron` run history in Inngest shows `dispatched: 0`.
7. Only after those reads, decide whether the target design should extend `currentStage` or replace it. The enum is already close to the target and mostly unwired; building a third stage field would add another conflict to Section 22.

No implementation proposal belongs in this pass.
