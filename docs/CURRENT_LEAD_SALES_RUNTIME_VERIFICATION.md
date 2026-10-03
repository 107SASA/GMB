# Current Lead / Sales Runtime Verification

**Companion to:** `docs/CURRENT_LEAD_SALES_ARCHITECTURE_AUDIT.md` (static code map).

**This document answers:** what this workspace is configured to run, and what could not be confirmed.

**Date:** 2026-10-03.

**Nothing was enabled, edited, or written.** No application source was changed. No database document was updated.

---

## Inspection boundary

Three different “runtimes” must not be collapsed.

| Source | What was done | Result |
| --- | --- | --- |
| Local env files `.env` and `.env.local` | Read. Compared every sales-related flag. The two files match on every key that was compared. | Values below are **this machine’s app config**, not a hosting provider’s production env. |
| MongoDB named in `MONGODB_URI` | Read-only connection attempted (`readPreference: secondaryPreferred`). No writes. | **Failed** before any document was read: TLS alert internal error (`MongoServerSelectionError`, SSL alert 80). |
| A live Node / Inngest / Next process | IDE terminal list was empty. | **No local server was observed running** during this check. |
| Deployed production env (Vercel or similar) | No `.env.production` file with values. `.env.production.example` is empty. Hosting env was not pulled. | **UNKNOWN — runtime value unavailable** for the public site. |

Facts that fix the identity of the local config:

- `NEXT_PUBLIC_APP_URL` host is `localhost:3000`.
- Razorpay key id prefix is **test** (`rzp_test`), not live.
- Database name in the URI path is **`growwmatics_dev`** on MongoDB Atlas. The cluster was not reached.
- `INNGEST_DEV=1`.
- `NODE_ENV` is **absent** from the env files. Next.js sets it itself (`development` for `next dev`, `production` for `next start`).

A comment in `src/services/inngest/functions.ts` (sales drip, around the `LEAD_ENGINE_V2` gate) says the flag was confirmed unset in `.env.local` and `.env.production`. **That comment does not match the files on disk today.** Both `.env` and `.env.local` set `LEAD_ENGINE_V2=true`. There is no populated `.env.production` in the repo.

**Because the database did not connect, every value stored in Mongo (agent `enabled`, rollout percentage, real lead stages) is unverified.** Code defaults are not a substitute for those documents.

---

# 1. Feature flags

“Local env” means `.env` and `.env.local`, which agreed. “Production host” means the process that serves the public site. That process was not inspected.

| Flag | Code default | Local env value | Production host | Source | Effect |
| --- | --- | --- | --- | --- | --- |
| `SalesAgentConfig.enabled` | `false` on first insert (`src/lib/salesAgentDefaults.ts`) | **UNKNOWN — runtime value unavailable** (Mongo document) | **UNKNOWN — runtime value unavailable** | DB singleton `key: 'default'` | If false, `sales-nurture-requested` returns `{ skip: 'agent disabled' }` and does not open a sales chat. |
| `BookingAgentConfig.enabled` | `false` (`src/lib/bookingAgentDefaults.ts`) | **UNKNOWN — runtime value unavailable** | **UNKNOWN — runtime value unavailable** | DB singleton | If false, booking replies use the “a team member will get back to you” fallback and do not offer slots. |
| `ReportAgentConfig.enabled` | `false` (`src/lib/reportAgentDefaults.ts`) | **UNKNOWN — runtime value unavailable** | **UNKNOWN — runtime value unavailable** | DB singleton | If false, the report WhatsApp agent does not run its LLM path. |
| `LEAD_ENGINE_V2` | Off unless the string is exactly `true` | **`true`** | **UNKNOWN — runtime value unavailable** | `.env`, `.env.local` | Locally, the proactive NBA cron is **not** skipped for “flag off”. Cohort is still required (section 2). Sales drip uses the V2 schedule path only for leads in the cohort; everyone else stays on the inline send. |
| `ORCHESTRATOR_COOLDOWN_HOURS` | Absent → DB `cooldownHours` → else **4** | **ABSENT** | **UNKNOWN — runtime value unavailable** | `getCooldownHours()` in `src/services/orchestration/outboundOrchestrator.ts` | Local process would use the DB value if a doc exists, else 4 hours. DB value **not read**. |
| `OrchestrationConfig.rolloutPercentage` | Schema default **0** | **UNKNOWN — runtime value unavailable** | **UNKNOWN — runtime value unavailable** | Mongo | 0% and an empty allowlist put **no** lead in the V2 cohort. |
| `OrchestrationConfig.leadIdAllowlist` | Schema default **[]** | **UNKNOWN — runtime value unavailable** | **UNKNOWN — runtime value unavailable** | Mongo | Explicit leads bypass the percentage. |
| `stuckLeadScoreThreshold` | Schema default **76** | **UNKNOWN — runtime value unavailable** | **UNKNOWN — runtime value unavailable** | Mongo, read by `checkHandoffTriggers` | “Stuck hot” handoff. Falls back to 76 if the field is missing. |
| `stuckNurtureCyclesThreshold` | Schema default **3** | **UNKNOWN — runtime value unavailable** | **UNKNOWN — runtime value unavailable** | Same | Follow-ups after release before stuck-hot handoff. |
| `QA_TESTING_MODE` | Off | **`true`** | **UNKNOWN — runtime value unavailable** | `.env`, `.env.local`; gate in `src/lib/testingMode.ts` | QA routes (`/api/dev/simulate-payment`, `/api/dev/lead-engine`) turn on only when this is `true` **and** `NODE_ENV !== 'production'`. A production process keeps them off even if the variable is copied. |
| `QA_SUPPRESS_WHATSAPP_SENDS` | Off (sends are real) | **`false`** | **UNKNOWN — runtime value unavailable** | `src/services/twilio/client.ts` | Local sends are **not** short-circuited. A successful agent send would call Twilio. |
| `WHATSAPP_PROVIDER` | `'meta'` if unset (`src/services/whatsapp/send.ts`) | **`twilio`** | **UNKNOWN — runtime value unavailable** | Env | Forces Twilio for outbound WhatsApp. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER` | Required together or send returns null | **All SET** (values not recorded) | **UNKNOWN — runtime value unavailable** | Env | Twilio client can be constructed in this environment. |
| `TWILIO_TEMPLATE_SALES_INTRO` | `''` → consent template skipped/fails | **SET** | **UNKNOWN** | `src/lib/whatsappTemplates.ts` | Cold-number “reply YES” template id is present locally. |
| `TWILIO_TEMPLATE_REPORT_READY` | `''` | **SET** | **UNKNOWN** | Same | “Report ready” template id is present locally. |
| `TWILIO_TEMPLATE_INVOICE_READY` | `''` | **SET** | **UNKNOWN** | Same | Invoice WhatsApp can be attempted locally. |
| `TWILIO_TEMPLATE_WELCOME_CUSTOMER` | `''` | **SET** | **UNKNOWN** | Same | Welcome WhatsApp can be attempted locally. |
| `TWILIO_TEMPLATE_PAYMENT_RECEIVED` | `''` | **ABSENT** | **UNKNOWN — runtime value unavailable** | `sendPaymentReceivedMessage` | **Disabled locally.** The function logs and returns without sending, and does not stamp `paymentReceivedMessageSentAt`. |
| `TWILIO_TEMPLATE_NOTIFICATION` | `''` | **SET** | **UNKNOWN** | Templates | Generic owner/notification template id is present. |
| `GOOGLE_CALENDAR_ID` | Missing → `CalendarError` | **ABSENT** | **UNKNOWN — runtime value unavailable** | `src/services/calendar/googleCalendar.ts` | **Calendar booking cannot succeed in this environment.** |
| `GOOGLE_CALENDAR_CREDENTIALS_JSON` | Missing → `CalendarError` | **ABSENT** | **UNKNOWN — runtime value unavailable** | Same | Same. `isCalendarConfigured()` is false here. |
| `GROQ_API_KEY` | Required for agent LLM calls | **SET** | **UNKNOWN** | Env | LLM calls are configured locally. Whether Groq accepts the key was not called. |
| `RAZORPAY_KEY_ID` / `SECRET` / `WEBHOOK_SECRET` | Required for checkout and webhook | **All SET. Key mode = TEST** | **UNKNOWN — runtime value unavailable** | `src/lib/billing/razorpay.ts` | Local checkout talks to Razorpay **test** mode. Live mode was not seen. |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | Required for Inngest cloud | **Both SET** | **UNKNOWN** | Env | Keys exist locally. `INNGEST_DEV=1` means a local Inngest dev server is the intended worker, not proof that cloud crons are running. |
| `GBP_LIVE_WRITES_ENABLED` | Off unless `'true'` | **`false`** | **UNKNOWN** | `src/lib/gbpSafety.ts` | Google Business Profile writes stay blocked. Not a sales-agent flag. Post-pay autopilot still will not publish live GBP content. |
| `META_WHATSAPP_PHONE_NUMBER_ID` | — | **SET but length 3** (not a real Phone Number ID) | **UNKNOWN** | Env | Unused for sends while `WHATSAPP_PROVIDER=twilio`. |
| `META_UTILITY_TEMPLATE_NAME` | — | **EMPTY** | **UNKNOWN** | Env | Meta template fallback is not configured. Irrelevant while provider is Twilio. |
| Customer-success flag | None | **No such flag** | — | Repo search | There is no customer-success feature flag. |
| Platform nurture master flag | None besides the three `enabled` fields and `LEAD_ENGINE_V2` | — | — | — | There is no separate “nurture on/off” env var. |
| `AUDIT_BYPASS_MODE` | — | **`false`** | **UNKNOWN** | Env | Does not turn the sales agent on. |

---

# 2. Lead engine rollout

Cohort logic (code, `isLeadInCohort` in `src/services/orchestration/outboundOrchestrator.ts`):

1. Load `OrchestrationConfig` where `key: 'default'`.
2. If **no document**, return **false** (nobody is in the cohort).
3. If the lead id is on `leadIdAllowlist`, return **true**.
4. Else if `rolloutPercentage <= 0`, return **false**.
5. Else include the lead when a stable MD5 bucket of the id is `< rolloutPercentage`.

**Stored percentage, allowlist, and eligible-lead count: UNKNOWN.** The database did not connect. Schema defaults (0% and empty allowlist) apply only when a new document is created. An existing document can differ. This check did not create one.

What the **local** flag changes anyway:

| Path | With local `LEAD_ENGINE_V2=true` | Still blocked unless |
| --- | --- | --- |
| `proactive-nba-scheduler` (every 30 min) | Does **not** return “flag off” | Lead is in the cohort, `nextActionAt` is due, `nextBestAction` is one of `REENGAGE`, `FOLLOW_UP_AFTER_DEMO`, `SHOW_VALUE`, `SHARE_USE_CASE`, `EDUCATE`, `currentAgent` is `SALES` or `DEMO`, `nurtureStatus` is `ACTIVE`, not human-owned, not opted out. **Cohort unknown.** |
| Sales follow-up drip | In-cohort leads are written as `ScheduledAction` `SHOW_VALUE` instead of an inline send | Sales agent `enabled` (unknown) and the lead is in the cohort. **Not in cohort → inline WhatsApp send, same as before V2.** |
| Sales **reply** to an inbound message | Not gated by V2 | An active `SalesConversation` and the block checks in section 3. |
| Human handoff / return-to-AI | Not gated by V2 | — |

**Can a cold lead get an outbound AI message?**

Only through the sales drip / first pitch, and only when all of these are true:

1. `SalesAgentConfig.enabled` is true. **Unknown in the database.**
2. An audit completed and emitted `sales/nurture.requested`.
3. The workspace is not already paid, and this audit has not already sent nurture (`auditNurtureSentAt`).
4. If this phone has **never** messaged the platform WhatsApp number, the real pitch is **withheld**. Only the consent template (“reply YES”) is sent. The pitch and drip start after `sales/nurture.consented`.
5. Twilio credentials exist locally and `QA_SUPPRESS_WHATSAPP_SENDS` is false, so that consent/pitch would be a real Twilio call **if** the job runs in this environment.

**User reply required before the AI continues?**

- Cold web-form number: **yes.** Consent YES is required before the pitch (`SalesConversation.consentStatus`: `pending` → `granted`).
- Number that has already messaged the platform: **no** separate YES. First pitch can go out, then the drip continues while they stay silent (`onlyIfNoReply` on each follow-up step, default true in the schema).
- After they reply: the drip’s “only if no reply” steps stop, and `sales-agent-reply` handles the thread.

Proactive NBA is **not** “message every cold lead.” It only schedules leads that already have a due `nextBestAction`. Free-report create does not set `nextBestAction`.

---

# 3. Sales agent

**Enabled in the database: UNKNOWN.**

**Local process flag `LEAD_ENGINE_V2`: on.** That does not enable the sales agent. The on/off switch is `SalesAgentConfig.enabled`.

**Cohort:** restricts only the V2 **scheduling** branch of the drip and the proactive NBA cron. It does not restrict `sales-agent-reply`.

```text
Lead created (free report or, separately, a completed audit)
   ↓
Audit job finishes
   ↓
Event sales/nurture.requested
   ↓
Condition: SalesAgentConfig.enabled === true
   NO  → skip "agent disabled". Lead and report remain. No WhatsApp pitch.
   YES → (database value UNKNOWN, so this branch is UNKNOWN)
   ↓
Skip if already paid, already nurtured, no phone, human-owned, or opted out
   ↓
Phone never messaged the platform?
   YES → consent template only. Wait for YES.
   NO  → wait firstMessage.delayMinutes, send first pitch
   ↓
Follow-up sleeps (config followUps[].delayHours)
   ↓
If LEAD_ENGINE_V2 is true AND lead is in cohort
   → write ScheduledAction SHOW_VALUE (local flag is true; cohort UNKNOWN)
Else
   → send the follow-up inline
   ↓
Inbound reply on SalesConversation.status === "active"
   → sales-agent-reply (this does not check enabled again; a disabled agent
     simply never creates the conversation)
   → block if human / opted out / do-not-contact / customer
   → extract intent and score, decide next action, maybe send
```

`getSalesAgentConfig()` creates a disabled default document if none exists. This verification did **not** call it, so it did not insert that default.

---

# 4. Booking agent

| Step | Status in this environment | Why |
| --- | --- | --- |
| Demo form creates lead + pending booking + booking thread | **ACTIVE as code.** Whether a server is up to receive the form: no local server was seen. | `POST /api/leads/book-demo` does not check `BookingAgentConfig.enabled` before writing the lead. |
| Booking agent LLM / slot offer | **UNKNOWN** (enabled flag is in Mongo) and **calendar is DISABLED here** | `GOOGLE_CALENDAR_ID` and `GOOGLE_CALENDAR_CREDENTIALS_JSON` are absent. `getAvailableSlots` / `createDemoEvent` throw `CalendarError`. The booking worker turns that into human-handoff copy. |
| Google Calendar | **DISABLED** in local env | Both variables absent. Production host: **UNKNOWN**. |
| Available slots | **DISABLED** here | Same missing calendar config. |
| Meet link | **DISABLED** here | Link is created with the calendar event. |
| WhatsApp confirmation including the link | **DISABLED** here | Depends on a successful `createDemoEvent`. |
| Email on `demo/booked` | **Not reached** if the event is never created | `process-demo-booking` only runs after a real booking event. |
| Reminders (`DEMO_REMINDER`) | **DISABLED** here | Created only inside `bookConfirmedSlot`, which needs a calendar event. |
| No-show check | **DISABLED** here | Scheduled with the confirmed booking. |
| Reschedule / cancel | **UNKNOWN** for an already confirmed demo in the database; **cannot create a new confirmed demo** with this env | Needs an existing `DemoBooking` plus a running booking agent. No rows were read. |

**Booking agent enabled flag: UNKNOWN.** Even if that flag is true in `growwmatics_dev`, this environment cannot book a slot.

---

# 5. Free report flow

```text
Free Report form
   ↓
POST /api/free-report/start
   ↓
Platform Lead (tenant gmbboost-internal, source Website, aiLeadScore 60)
   ACTIVE as a code path. Not executed in this check.
   ↓
Shadow User / Business / Subscription
   ACTIVE as a code path.
   ↓
Audit job (Inngest generate-audit)
   Keys for Inngest are set locally and INNGEST_DEV=1.
   Whether a worker is consuming events: no local server was observed.
   ↓
Report page + report-ready WhatsApp template id is SET locally
   The send still needs the audit job to finish and Twilio to accept it.
   ↓
Sales agent?
   ONLY if SalesAgentConfig.enabled is true.
   DATABASE STATE NOT VERIFIED → UNKNOWN.
   ↓
WhatsApp pitch?
   Not at the moment the lead row is inserted.
   Later, only if the agent is enabled.
   Cold number: consent YES first (template id is set locally).
   Payment-received template is unrelated and is ABSENT.
   ↓
Nurture drip?
   Same gate as the sales agent, then the cohort split in section 2.
```

**A newly created free-report lead is not messaged at insert time.** Automatic contact is a later job, and that job no-ops when the sales agent document is disabled. That document was not readable. So automatic contact **right now is not confirmed**, and it is **off** whenever the stored `enabled` flag is false (the code default for a new document).

---

# 6. Book demo flow

```text
Book Demo form
   ↓
Platform Lead (source Demo Booking, aiLeadScore 85)     code path ACTIVE
   ↓
DemoBooking status Pending, date "To be scheduled"      code path ACTIVE
   ↓
BookingConversation + event booking/agent.reply         code path ACTIVE
   ↓
Booking agent
   enabled flag UNKNOWN (database)
   ↓
Calendar
   DISABLED in this env (no calendar id, no credentials)
   ↓
Meeting link / confirmation / reminders / no-show
   DISABLED here, because they run only after a calendar event is created
   ↓
Demo status that can actually be written here
   Pending (form) and, if the agent runs without a calendar, human handoff
   Confirmed / Completed / No Show require a calendar or an admin PATCH
```

The browser also opens a `wa.me` link. That does not by itself book a slot.

---

# 7. Lead score

Two numbers exist in the schema. Only one is wired to behavior. Neither was observed on live rows.

```text
Score range:     leadScore 0–100 (clamp in applyExtraction). aiLeadScore is an unconstrained number; writers only store 60 or 85.
Thresholds:      computeScoreBand: <15 COLD, 15–44 WARM, 45–74 HOT, >=75 READY.
                 Stuck-hot handoff: leadScore >= stuckLeadScoreThreshold (schema default 76) AND currentStage === NURTURING AND enough follow-ups.
                 Admin funnel label "Qualified": leadScore >= 15 OR intent other than EXPLORING. Display only.
Calculation:     Groq picks one score_signal. Delta comes from ScoringRuleConfig or DEFAULT_SCORING_RULES. Not a single 0–100 LLM grade.
Inputs:          Latest inbound WhatsApp text, recent turns, optional sales knowledge. Not the free-report form.
Writer:          applyExtraction in src/services/leadIntelligence/extract.ts.
                 aiLeadScore writers: free-report route (60), book-demo route and handleCollecting (85). Static.
Storage:         Lead.leadScore and Lead.aiLeadScore.
Update trigger:  Each sales/booking/support extraction and post-demo analysis. Not on a cron. No decay job.
UI:              Admin leads pages label leadScore as the behavioural score. aiLeadScore is still returned by some admin queries.
Automation consumers of leadScore:
                 - checkHandoffTriggers stuck-hot path (can stop AI and assign HUMAN).
                 - Nothing else sends, nurtures, or offers a plan because of the number.
Automation consumers of the 15/45/75 bands:
                 NONE. computeScoreBand() is passed into the NBA rule matcher, and no rule in NBA_RULES sets a scoreBand condition (src/services/nba/rules.ts). The band cannot change the chosen action.
Automation consumers of aiLeadScore:
                 NONE.
```

**The 15 / 45 / 75 thresholds do not drive automation.** The number **15** is only a label in `src/lib/admin/conversionFunnel.ts`. The number **76** (or whatever `stuckLeadScoreThreshold` is in the unread config doc) can force a human handoff during nurture. `FREE_REPORT_SUBMITTED` (+10) is in the default table and is not applied when the form is submitted.

`ScoringRuleConfig` document contents: **UNKNOWN** (database).

---

# 8. Next best action

It is **A + C + D in code**, and **not confirmed against data**.

| Role | Happens? |
| --- | --- |
| A. Generated and stored on `Lead.nextBestAction` / `nextActionAt` | **Yes, in code**, after `extractLeadIntelligence` → `decideNextAction`. Not run at form submit. |
| B. Shown to an admin | **Yes, in code.** `GET /api/admin/lead-engine/status` and the admin lead detail return `nextBestAction`. Those pages were not opened. |
| C. Used to trigger automation | **Partial.** Proactive cron creates `ScheduledAction` rows only for five actions, only if V2 is on **and** the lead is in the cohort. Local V2 is on. Cohort is **UNKNOWN**. |
| D. Used to send a message | **Partial, and not V2-gated on the reply path.** If the stored action is in `NBA_OWNS_REPLY` (`SEND_PRICING`, `HANDLE_OBJECTION`, `OFFER_DEMO`, `SCHEDULE_DEMO`, `HUMAN_HANDOFF`, `OFFER_SUBSCRIPTION`, `FOLLOW_UP_AFTER_DEMO`, `REENGAGE`), `sales-agent-reply` calls `executeNextAction` and can send WhatsApp. `EDUCATE`, `ANSWER_QUESTION`, `SHOW_VALUE`, `ASK_QUALIFICATION`, `SHARE_USE_CASE` are stored but the reply falls through to `composeAgentReply` instead of the executor. |

```text
Inbound WhatsApp on an active sales conversation
   ↓
extractLeadIntelligence (Groq)
   ↓
decideNextAction writes Lead.nextBestAction and nextActionAt
   ↓
Consumer 1 — same request, sales-agent-reply
   if action is in NBA_OWNS_REPLY → executeNextAction → WhatsApp or human handoff
   else → generic composeAgentReply → WhatsApp
   ↓
Consumer 2 — proactive-nba-scheduler (30 min)
   local flag LEAD_ENGINE_V2=true, so it does not exit immediately
   then skips any lead not in the cohort (cohort UNKNOWN)
   for REENGAGE / FOLLOW_UP_AFTER_DEMO / SHOW_VALUE / SHARE_USE_CASE / EDUCATE
   creates ScheduledAction EXECUTE_NBA
   ↓
Consumer 3 — nurture-scheduler-tick (15 min)
   runs due EXECUTE_NBA through executeNextAction
```

Booking and support extractions decide and store an action. They do not call `executeNextAction`. The booking agent sends its own slot messages.

No live `nextBestAction` values were counted. **DATABASE STATE NOT VERIFIED.**

---

# 9. Nurture

| Behavior | Status | Evidence |
| --- | --- | --- |
| Scheduled follow-up after a sales pitch | **PARTIAL / UNKNOWN** | Implemented in `runSalesFollowUpDrip`. Runs only after the sales agent is enabled (**unknown**) and a conversation exists. Local V2 flag routes **in-cohort** leads to `ScheduledAction`; others send inline. Cohort unknown. |
| Proactive WhatsApp from the NBA cron | **Flag on locally, cohort unknown** | `proactive-nba-scheduler` is not skipped for the flag in this env. It still requires cohort membership. With no config document, code returns false for every lead. The document’s existence was **not** verified. |
| Re-engagement (`REENGAGE`) | **Code only** | Default NBA action for `currentStage: COLD`, and that stage has **no writer**. Proactive send also needs cohort. |
| Follow-up after no response | **Code path of the sales drip** (`onlyIfNoReply`, schema default true) | Same enabled-flag unknown. Does not move the lead to `UNRESPONSIVE`. |
| Follow-up after demo | **Code path** | Admin `Completed` or no-show calls `runPostDemoAnalysis`, sets `DEMO_COMPLETED`, NBA `FOLLOW_UP_AFTER_DEMO`. No-show jobs are only created after a calendar booking, which **cannot happen in this env**. |
| Follow-up after objection | **On the next inbound reply**, not a timer | If the extractor stored an open objection and stage is `NURTURING`, NBA defaults to `HANDLE_OBJECTION`, which is in `NBA_OWNS_REPLY` and can send. |
| Follow-up after report | **Same as the sales drip** | `sales/nurture.requested` fires when the audit completes. Gated by `enabled`. |
| Follow-up after payment failure | **Not a sales nurture** | See section 12. No return to the sales agent. No `CONVERSION_PENDING`. |
| Old hourly `follow-up-cron` | **Registered in code. Match count UNKNOWN.** | Query requires `Lead.lastInteractionTime`. That field is **not on the schema**. A missing field does not satisfy `$lte`, so a normal collection returns no rows. This check did not run the query. **Do not treat “zero matches” as observed.** |
| Customer CRM Day 1/3/7 WhatsApp | **Removed in code** | `schedule-lead-follow-ups` only alerts the business owner for organic customer leads. It skips `tenantId === 'gmbboost-internal'`. |
| Email sales nurture | **Not implemented** | — |

`QA_SUPPRESS_WHATSAPP_SENDS=false` means this environment will not pretend a send succeeded. If a drip runs here, Twilio is called.

---

# 10. Human handoff

```text
AI reply handler (sales, booking, support, report)
   ↓
checkHandoffTriggers OR NBA action HUMAN_HANDOFF OR calendar failure
   ↓
Fields written:
   Lead.currentAgent = HUMAN
   Lead.currentStage = HUMAN_HANDOFF   (calendar-failure call omits the stage argument)
   Lead.humanHandoff.active = true
   Lead.humanHandoff.reason
   Lead.humanHandoff.since
   Lead.humanHandoff.assignedUserId is NOT written
   ↓
AI stops: isHumanOwned is true if currentAgent is HUMAN OR humanHandoff.active
   salesReplyBlockedReason blocks sales replies and the drip
   This check does not depend on LEAD_ENGINE_V2
   ↓
Human conversation: no in-app desk that sends WhatsApp as the human was found.
   Super-admins get a push. They read the lead in /admin/leads.
   ↓
Return to AI: POST /api/admin/leads/return-to-ai (super admin)
   releaseFromHuman clears humanHandoff.active
   sets SALES + NURTURING, or IN_HOUSE + CUSTOMER if already a customer
```

**AI does stop while the lead is human-owned**, as long as the reply path calls `salesReplyBlockedReason` / `isHumanOwned`. That is in the current sales, booking, support, report, and drip code. It was not executed against a live lead.

`observeLeadOwnershipShadow` on the webhook can set `currentAgent` back to `SALES` while `humanHandoff.active` is still true. Stopping still works because `isHumanOwned` reads either field. The admin UI can show the wrong agent if it only prints `currentAgent`.

There is no automatic “human is done, give it back to AI.”

---

# 11. Payment

```text
Lead (optional — checkout does not require a platform lead)
   ↓
/pricing or /checkout
   ↓
POST /api/billing/checkout
   creates a Razorpay subscription
   does NOT unlock the workspace
   ↓
Razorpay Checkout.js
   local keys are TEST mode
   ↓
POST /api/webhook/razorpay
   HMAC-SHA256 with RAZORPAY_WEBHOOK_SECRET (SET locally)
   ProcessedWebhookEvent idempotency
   ↓
subscription.activated or subscription.charged
   activatePlan → Subscription.billingStatus Active, User.subscriptionPlan paid
   activateBusinessPlan → Business.subscriptionStatus active
                          Business.pipelineStage = Customer
   ↓
sendPaymentReceivedMessage
   SKIPPED locally because TWILIO_TEMPLATE_PAYMENT_RECEIVED is absent
   ↓
runCustomerActivationSequence
   finds Lead by phone + tenant gmbboost-internal
   if found and not already CUSTOMER:
      currentAgent IN_HOUSE, currentStage CUSTOMER
      cancel scheduled nurture
      invoice template (id SET locally) and welcome template (id SET locally)
   if no lead: workspace is still paid; those WhatsApp messages are skipped
```

Self-heal: `GET /api/billing/status` and Inngest `billing-activation-reconcile-cron` (every 10 minutes) call the same activate functions. Reconcile does **not** call `sendPaymentReceivedMessage`.

**No payment was sent during this check.** Webhook delivery from Razorpay to this machine was not observed. Production Razorpay mode is **UNKNOWN** (this copy of the keys is test).

`currentStage` `PAYMENT_VERIFIED` and `CONVERSION_PENDING` are **not** written by this flow.

---

# 12. Payment failure

Webhook events `payment.failed` and `subscription.halted` (`src/app/api/webhook/razorpay/route.ts`):

| Question | Actual behavior |
| --- | --- |
| Notify the customer? | **Yes, if a workspace resolves.** `markBusinessPastDue` sets `Business.subscriptionStatus = 'past_due'`, in-app notification “Payment failed”, owner WhatsApp via `notifyOwner` (`billing_past_due`), and `sendPaymentFailedEmail` when an email is on file. |
| Notify sales / the platform sales agent? | **No.** |
| Retry the charge? | **Not in this app.** Razorpay may retry on its side. The app does not schedule a sales retry. |
| Create a CRM task? | **No.** |
| Return the lead to the sales agent? | **No.** `currentAgent` / `currentStage` are not changed. |
| Keep the lead in conversion-pending? | **No.** That stage is never written, including on failure. |
| Remove access immediately? | **No.** `markPastDue` sets `Subscription.billingStatus = 'PastDue'` and does not call `cancelPlan`. Entitlements stay until cancel/expiry (`subscription.cancelled` / `completed` / `expired`, or the daily expiry worker for cancel-at-period-end). |
| Do nothing? | **No.** Past-due status plus the three notifications above. |

---

# 13. Post-sale

After a **successful** webhook (entitlements already saved):

| Step | Happens? |
| --- | --- |
| Workspace activated | **Yes.** `subscriptionStatus: active`, `pipelineStage: Customer`. |
| Subscription record activated | **Yes.** `activatePlan`. |
| Platform lead marked customer | **Only if** a `gmbboost-internal` lead matches the payer’s phone. |
| Onboarding wizard | **No.** `/api/onboarding` is a separate signup flow. |
| Sales agent continues | **No.** Paid workspaces are skipped by nurture. `salesReplyBlockedReason` blocks customers. |
| WhatsApp support / in-house agent | **Starts on the next inbound message**, not at payment, and only when `currentAgent` became `IN_HOUSE`. It is `composeInHouseAgentReply` in `src/services/support/supportAgent.ts` via `support-agent-reply`. It does not change billing. |
| Customer success agent | **Does not exist.** |
| Payment-received WhatsApp | **Disabled in this env** (template env var absent). Invoice and welcome template ids **are** set, but they send only when a platform lead resolves. |
| GBP connect / live posts | **Not started by payment.** Autopilot helpers no-op until GBP is connected. `GBP_LIVE_WRITES_ENABLED=false` locally blocks live GBP writes. |
| Invoice PDF in this database | **No local invoice model.** `GET /api/billing/invoices` reads Razorpay. |

---

# 14. Database reality

**DATABASE STATE NOT VERIFIED.**

A read-only client was aimed at database `growwmatics_dev` on Atlas. The TLS handshake failed (`ssl3_read_bytes:tlsv1 alert internal error`, alert 80) before `listCollections` or any `find`. No counts were returned. No document was written.

The following were **not** observed in records. Do not treat the schema enum as evidence that any row uses them:

- cold, warm, hot, ready to buy (these are **not even `currentStage` values**; they are `computeScoreBand` labels)
- active nurture (`NURTURING` may or may not be stored)
- long-term nurture
- unresponsive
- lost
- do not contact (`DO_NOT_CONTACT` stage, or `nurtureStatus: OPTED_OUT`)
- human owned
- customer
- payment verified
- conversion pending

Also unread: `SalesAgentConfig.enabled`, `BookingAgentConfig.enabled`, `ReportAgentConfig.enabled`, rollout percentage, allowlist length, `DemoBooking` statuses, `SalesConversation` counts, `ScheduledAction` counts, and whether any lead has `lastInteractionTime`.

---

# 15. Current real flow

“Real” here means **this workspace’s env plus the code gates**, not a watched production request. Branches that depend on Mongo are marked UNKNOWN.

### FREE REPORT

```text
/free-report
   ↓
Lead + shadow workspace + audit job          (code; not executed now)
   ↓
Report page
   ↓
sales/nurture.requested
   ↓
SalesAgentConfig.enabled?                    UNKNOWN (database)
   false → stop. No sales WhatsApp.
   true  → consent YES if the number is cold, else first pitch
   ↓
Drip: inline WhatsApp, unless the lead is in the V2 cohort
      (local V2 flag is true; cohort UNKNOWN)
```

### BOOK DEMO

```text
/book-demo
   ↓
Lead + Pending demo "To be scheduled" + booking thread
   ↓
booking/agent.reply
   ↓
Agent enabled?                               UNKNOWN (database)
   ↓
Calendar                                      DISABLED in this env
   ↓
No Meet link, no reminder, no no-show job
Human-handoff copy if the agent runs and the calendar throws
```

### SALES

```text
Only if a SalesConversation is already active
   ↓
Inbound WhatsApp
   ↓
Block if human-owned, opted out, or customer
   ↓
Extract score + intent, store nextBestAction
   ↓
Executor sends for the NBA_OWNS_REPLY subset
Otherwise a generic sales reply
Twilio would be called (suppress flag is false; credentials are set)
```

### NURTURE

```text
No message at lead insert
   ↓
After a completed audit, only if sales agent enabled (UNKNOWN)
   ↓
Silent lead: drip continues while conversation stays active
   ↓
Proactive NBA cron: V2 flag ON locally, then cohort gate UNKNOWN
   ↓
Hourly legacy cron: coded to miss rows that lack lastInteractionTime
                     match count not queried
   ↓
Customer-business leads: owner reminder only, no WhatsApp to the lead
```

### DEMO

```text
Website never picks a slot
   ↓
Real slot / Meet / reminder / no-show
   DISABLED in this environment (calendar env absent)
   ↓
Admin can still PATCH a booking to Completed in code
   that path was not called
```

### PAYMENT

```text
Checkout creates a TEST-mode Razorpay subscription (local keys)
   ↓
No unlock until webhook or reconcile
   ↓
Signature check is implemented; delivery not observed
   ↓
Workspace subscriptionStatus = active
Business.pipelineStage = Customer
   ↓
Payment-received WhatsApp skipped locally (template env absent)
```

### CUSTOMER ACTIVATION

```text
Entitlements already saved
   ↓
Platform lead with the same phone?
   no  → stop. Workspace stays paid. No in-house handoff.
   yes → IN_HOUSE / CUSTOMER, cancel nurture,
         invoice + welcome WhatsApp if those sends succeed
   ↓
No customer-success agent
Next inbound WhatsApp can hit the in-house support reply
```

### HUMAN HANDOFF

```text
Trigger on an inbound agent turn (or calendar failure)
   ↓
humanHandoff.active = true, currentAgent HUMAN
   ↓
AI replies and the sales drip stop
   ↓
No assigned user
   ↓
Return only via POST /api/admin/leads/return-to-ai
```

---

# 16. Target architecture comparison

Runtime status uses only: ACTIVE, DISABLED, PARTIAL, NOT IMPLEMENTED, UNKNOWN.

ACTIVE means the local env does not block it **and** it does not depend on an unread database flag. UNKNOWN means the deciding value lives in Mongo or on the production host.

| Component | Runtime status | Evidence | Notes |
| --- | --- | --- | --- |
| Website free report → create lead | PARTIAL | Route exists. No server was observed handling a request. | Lead insert itself has no feature flag. |
| Website book demo → create lead | PARTIAL | Same. | Pending demo is written even if the booking agent is off. |
| Lead intelligence on WhatsApp replies | PARTIAL | Groq key is set. Runs only inside an agent reply. | Does not run at form submit. Agent enabled flag unknown. |
| Intent / score stored | PARTIAL | Writer is `applyExtraction`. | No rows read. Bands 15/45/75 do not select actions. |
| Sales agent | UNKNOWN | On/off is `SalesAgentConfig.enabled` in Mongo. | Local `LEAD_ENGINE_V2=true` does not turn it on. Code default for a new doc is false. |
| Demo decision / offer in chat | UNKNOWN | Needs an active sales conversation. | |
| Demo calendar, Meet, reminders, no-show | DISABLED | `GOOGLE_CALENDAR_ID` and credentials absent locally. | Production calendar env was not read. |
| Next best action decide + store | PARTIAL | Code path on inbound sales messages. | Not confirmed on data. |
| Next best action proactive send | UNKNOWN | V2 flag is true locally, so the cron is not flag-skipped. Cohort document unread. | Reply-path sends for 8 actions do not need the cohort. |
| Nurture of a silent free-report lead | UNKNOWN | Entirely behind `SalesAgentConfig.enabled`. | Consent YES required for a never-seen number. |
| Subscription checkout | PARTIAL | Razorpay **test** keys present locally. | Not live mode. No payment was placed. |
| Payment webhook verification | PARTIAL | Secret is set. HMAC code exists. | No webhook delivery observed. |
| Workspace activation | PARTIAL | `activateBusinessPlan` has no extra flag. | Runs only after webhook or reconcile. |
| Invoice | PARTIAL | Razorpay invoice API + WhatsApp template id set. | No local invoice document. Send needs a platform lead. |
| Payment-received WhatsApp | DISABLED | `TWILIO_TEMPLATE_PAYMENT_RECEIVED` absent locally. | |
| Customer activated on the lead | PARTIAL | Only when phone matches a platform lead. | |
| Customer success agent | NOT IMPLEMENTED | No service, flag, or job. | In-house support reply is the post-sale WhatsApp path. |
| Human handoff and return | PARTIAL | Code is not flag-gated. | Not executed. No assignee field is written. |
| Target stages (long-term, unresponsive, lost, DNC, conversion-pending, payment-verified) | NOT IMPLEMENTED | No writer found in the first audit; no rows could be checked. | Opt-out writes `nurtureStatus`, not `DO_NOT_CONTACT`. |
| Hourly legacy follow-up | UNKNOWN | Query cannot match the current schema. | Not executed against `growwmatics_dev`. |
| Production public site behavior | UNKNOWN | This env is localhost, test Razorpay, database name `growwmatics_dev`, `INNGEST_DEV=1`. | Do not treat this file as production. |

---

# 17. Important final questions

### Q1. If a person submits a Free Report right now, what exactly happens?

Against **this** config, if a dev server were running: the API would create or update a platform lead, create a shadow workspace, and enqueue an audit. It would **not** WhatsApp them at that moment. When the audit completes, nurture runs **only if** the sales-agent document is enabled. That flag was **not readable**. If it is the code default (`false`), nothing in the sales agent runs: no consent ask, no pitch, no drip. The report page can still load. A cold number, if nurture did run, would get a YES consent template before any pitch (`TWILIO_TEMPLATE_SALES_INTRO` is set, and WhatsApp suppression is off).

The public production site was **not** measured.

### Q2. If a person books a demo right now, what exactly happens?

The API would save a platform lead, a **Pending** demo with no time, and a booking conversation, then emit `booking/agent.reply`. The page would also open WhatsApp. A real slot, Meet link, reminder, and no-show job **cannot** be created here: calendar env vars are absent. If the booking agent document is enabled, the worker should hit the calendar error and hand the lead toward a human message. If it is disabled, the visitor gets the fallback “team will get back to you” copy. The enabled flag is **UNKNOWN**.

### Q3. If a lead replies on WhatsApp right now, what exactly happens?

Only if some process is actually receiving the Twilio/Meta webhook. None was observed.

If it is: the platform number routes by **conversation status**, not by `LEAD_ENGINE_V2`. An active sales conversation runs extraction, stores a next action, and either the NBA executor or the generic composer replies, unless the lead is human-owned, opted out, or already a customer. An active booking conversation runs the booking agent, which cannot book a calendar slot in this env. Twilio sends are not suppressed.

### Q4. Can AI proactively contact a cold lead right now?

**Not confirmed, and not at the moment of form submit.**

The only built proactive path for a brand-new free-report number is the post-audit sales job, which is off when `SalesAgentConfig.enabled` is false, and which sends only a consent template until the person replies YES. That enabled flag is unknown. The proactive NBA cron is allowed by the local V2 flag and then drops anyone outside the cohort. The cohort is unknown. There is no running worker in the IDE terminals.

### Q5. Can AI automatically nurture a lead right now?

**The mechanism exists and is not proven on.** It requires the sales agent document to be enabled, an Inngest worker, and (for a cold form phone) a YES reply. Local V2 does not replace that switch. Customer-CRM leads are not nurtured by WhatsApp.

### Q6. Can AI automatically decide the next best action right now?

**On an inbound sales reply, yes, in code** — `decideNextAction` stores it without checking `LEAD_ENGINE_V2`. **It does not decide one when the free-report or book-demo form is submitted.** Sending that decision proactively still needs the cohort. Sending a subset of decisions as the reply does not.

### Q7. Does the lead score currently affect automation?

**`leadScore` can force a human handoff** when it is at or above the stuck threshold (default 76), the stage is `NURTURING`, and enough follow-ups have been sent. **The 15 / 45 / 75 bands do not change any action.** `aiLeadScore` (60 or 85) does not change any action. No scores were read from the database.

### Q8. Can a human take ownership and return the lead to AI?

**Yes, in code, with no feature flag.** Ownership is `currentAgent: HUMAN`, `currentStage: HUMAN_HANDOFF`, `humanHandoff.active: true`. AI send paths stop. There is no assigned user id. Return is `POST /api/admin/leads/return-to-ai` → `releaseFromHuman`. It is not automatic. It was not executed.

### Q9. What exactly happens after a successful Razorpay payment?

Webhook (or reconcile) sets the subscription active and the workspace `subscriptionStatus` to `active` and `pipelineStage` to `Customer`. Access does not wait for a lead update. The payment-received WhatsApp **does not send in this env** (template variable missing). If a platform lead shares the payer’s phone, that lead becomes `IN_HOUSE` / `CUSTOMER`, nurture jobs are cancelled, and invoice/welcome templates may send. If not, the lead is left unchanged. No customer-success agent starts. No onboarding agent starts. `PAYMENT_VERIFIED` is not written.

Local keys are **test** mode. A live payment on the public site was not observed.

### Q10. What already exists and can be reused without rebuilding?

Safe to keep and extend, because the code is real and this check did not find a second hidden implementation:

- Platform vs customer lead split (`gmbboost-internal` / `Platform Prospect` vs `businessId` / `Client Prospect`).
- Free-report and book-demo lead upserts, shadow workspace, and audit job.
- Sales, booking, report, and in-house support workers and their Inngest events.
- Consent gate before pitching a never-seen web-form number.
- `extractLeadIntelligence`, `leadScore` deltas, `decideNextAction`, and `executeNextAction` for the reply subset.
- Human stop and `releaseFromHuman`.
- Opt-out (`nurtureStatus: OPTED_OUT`).
- Razorpay test-or-live checkout, webhook HMAC, idempotency, `activatePlan` / `activateBusinessPlan`, past-due notifications.
- Phone-matched customer activation into `IN_HOUSE`.

Do not rebuild those. Do not treat them as “on” for a visitor today until `SalesAgentConfig.enabled`, `BookingAgentConfig.enabled`, the cohort document, and the **production** env are read. Calendar booking in **this** env should not be reused until `GOOGLE_CALENDAR_ID` and credentials exist.

---

# FINAL VERDICT

## ACTIVE TODAY

In **this local env**, these are configured on or unblocked:

- `LEAD_ENGINE_V2=true` (removes the “flag off” skip on the proactive NBA cron and on the in-cohort drip branch).
- Twilio as the WhatsApp provider, with account sid, token, and from-number set.
- WhatsApp send suppression **off** (`QA_SUPPRESS_WHATSAPP_SENDS=false`).
- Template ids set for sales intro, report ready, invoice, welcome, notification, login OTP.
- Groq API key present.
- Razorpay **test** keys and webhook secret present.
- Inngest keys present, with `INNGEST_DEV=1`.
- Code paths that do not consult a database flag: free-report lead insert, book-demo lead insert, payment activation after a verified webhook, human-ownership **checks** on the agent reply paths, past-due notifications on `payment.failed`.

No live request was submitted, and no server process was seen. “Active” means the local configuration allows the path, not that a visitor was watched going through it.

## DISABLED TODAY

In this local env:

- Google Calendar demo booking, slots, Meet links, demo reminders, and no-show scheduling (`GOOGLE_CALENDAR_ID` and `GOOGLE_CALENDAR_CREDENTIALS_JSON` absent).
- Payment-received WhatsApp (`TWILIO_TEMPLATE_PAYMENT_RECEIVED` absent).
- Live GBP writes (`GBP_LIVE_WRITES_ENABLED=false`).
- Meta as the outbound WhatsApp provider (`WHATSAPP_PROVIDER=twilio`; Meta phone-number id is not a real id).
- Customer-CRM automatic WhatsApp to the lead (removed in code; not a flag).
- QA dev routes **when** `NODE_ENV` is `production` (local `QA_TESTING_MODE=true` does not override that).

## PARTIALLY ACTIVE

- Sales nurture and sales replies: fully coded; **master switch is an unread database field**.
- Booking agent conversation: form and thread are not flag-gated; slot booking is disabled here; agent `enabled` is unread.
- Next best action: stored and, for eight actions, able to send on a sales reply without V2. Proactive send still needs the unread cohort. Educate / answer / show-value do not own the reply.
- Lead score: can trigger stuck-hot handoff. The 15/45/75 bands do nothing automatic.
- Payment: test-mode checkout and webhook code are in place; payment-received WhatsApp is off; lead update depends on a phone match.
- Human handoff: stop and admin return exist; no assignee; not executed.
- Free report → WhatsApp: audit and templates can run; the sales handoff after the audit is the unknown `enabled` flag, plus YES consent for a cold number.

## NOT IMPLEMENTED

- Customer success agent.
- Writers for `COLD`, `UNRESPONSIVE`, `LONG_TERM_NURTURE`, `LOST`, `DO_NOT_CONTACT`, `CONVERSION_PENDING`, `PAYMENT_VERIFIED`, `QUALIFYING`.
- Score-band-driven next action.
- Automatic return from human to AI.
- Contact-form lead capture.
- Local invoice document.
- Applying `FREE_REPORT_SUBMITTED` or inactivity decay.
- Sales nurture by email.
- A running worker was not part of this session (absence of a process, not a product decision).

## UNKNOWN

- `SalesAgentConfig.enabled`, `BookingAgentConfig.enabled`, `ReportAgentConfig.enabled`.
- Rollout percentage, allowlist size, cooldown stored on `OrchestrationConfig`, stuck-score overrides.
- Every lead stage count and whether any target state exists in data.
- Whether `follow-up-cron` matches zero documents in `growwmatics_dev` (connection failed; schema says it should match none).
- The public production environment: app URL, Razorpay live vs test, `LEAD_ENGINE_V2`, calendar, templates, and which database that process uses.
- Whether Inngest Cloud, as opposed to `INNGEST_DEV`, is executing crons for the public site.

**DATABASE STATE NOT VERIFIED.**

## SAFE TO REUSE

- The platform/customer split and the three platform lead create paths.
- Audit-after-free-report and the consent-before-pitch rule.
- Sales reply loop: extract → score → decide next action → send or hand off.
- `isHumanOwned` / `releaseFromHuman`.
- Opt-out and nurture cancellation.
- Razorpay webhook verification, idempotency, and `activateBusinessPlan` (do not confuse test keys in this repo with live billing).
- In-house support reply as the only post-sale conversational worker that exists.
- Demo **data** model (`DemoBooking`, reminders, no-show) once a calendar is actually configured. It is not usable in this env.

## NEEDS ARCHITECTURAL WORK

Not a build plan. These are the gaps that are still true after the config read:

- Confirm production env and the three agent documents before assuming anyone is contacted. This repo’s local file is a **dev** setup (`localhost`, `growwmatics_dev`, Razorpay test, `INNGEST_DEV=1`).
- Calendar is not configured here, so the demo half of the target diagram cannot run in this environment even if the booking agent document is enabled.
- `LEAD_ENGINE_V2=true` locally does **not** mean proactive nurture is on. Cohort data was unreadable, and the sales agent has a separate switch.
- Target lifecycle states and the 0–25 / 26–50 / 51–75 / 76–100 policy are still not what the running rules do. 15/45/75 is display math. 76 is a handoff cutoff.
- Payment does not pass through conversion-pending or payment-verified, does not always find a lead, and does not start a customer-success agent.
- The unread database is the remaining blocker for “is the sales agent on?”. Re-run a read-only query from a network that can complete TLS to that Atlas cluster, and read only `enabled`, `rolloutPercentage`, `leadIdAllowlist` length, and platform `currentStage` / `currentAgent` counts. Do not call `getSalesAgentConfig()` to “check”, because a missing document would be inserted.
