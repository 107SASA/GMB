# Lead / Sales Target Architecture Gap Map

**Sources:**

- `docs/CURRENT_LEAD_SALES_ARCHITECTURE_AUDIT.md` — what the code implements.
- `docs/CURRENT_LEAD_SALES_RUNTIME_VERIFICATION.md` — what this workspace’s env actually allows. Database documents were not read. Production hosting env was not read.

**This document does not change code, data, or flags.**

**Principle:** connect, unify, and extend the current platform. Do not replace the sales agent, the extractor, scoring, objection and pain-point extraction, the booking agent, or Razorpay.

Status words used below:

| Status | Meaning |
| --- | --- |
| EXISTS — REUSE | Equivalent behavior is already in code. Do not rebuild it. |
| EXISTS — MODIFY | The component is the right one. A specific behavior must change. |
| PARTIAL | Some of the target exists under this or another name. The rest is a real gap. |
| MISSING | No equivalent in the platform sales path. |
| CONFIGURATION ONLY | Code is complete. It runs or not based on a flag, template, credential, or cohort document. |
| UNKNOWN | The deciding value is in Mongo or on the production host and was not read. |

Customer CRM (`Client Prospect`, a tenant’s own leads) is a different product. This map is the GrowwMatics **platform** funnel only.

---

# 1. Component mapping

| Target component | Existing component | Existing files | Status | Reuse? | Required change |
| --- | --- | --- | --- | --- | --- |
| Website — Free Report | `/free-report` → `POST /api/free-report/start` | `src/app/free-report/page.tsx`, `src/app/api/free-report/start/route.ts` (`fileFreeReportLead`, `provisionShadowAccount`) | EXISTS — REUSE | Yes | None to the form or audit. The later sales handoff is configuration plus one missing lead link on the WhatsApp report path (sections 7 and 17). |
| Website — Book Demo | `/book-demo` → `POST /api/leads/book-demo` | `src/app/book-demo/page.tsx`, `src/app/api/leads/book-demo/route.ts` (`fileDemoRequest`) | EXISTS — REUSE | Yes | Slot choice stays on WhatsApp. Do not add a second booking stack. |
| Create lead | Platform upsert on phone + `gmbboost-internal` | Same two routes, plus `handleCollecting` in `src/services/inngest/functions.ts` | EXISTS — REUSE | Yes | No new creator. Optionally call the same upsert from the report agent so that path is not lead-less. |
| Lead profile | `Lead` fields + unused `businessProfile` | `src/models/Lead.ts` | PARTIAL | Keep the model | Extractor does not write `businessProfile`. Name, phone, `businessType`, `budget`, `notes` are written. |
| Interests | `Lead.interest` (CRM text) and `businessProfile.interestedServices` | `Lead.ts` | PARTIAL | Do not add a second interest store | Platform extractor never writes either field. |
| Pain points | `Lead.painPoints` | `src/services/leadIntelligence/extract.ts` `applyExtraction` | EXISTS — REUSE | Yes | Already merged and used in NBA briefs. |
| Intent | `Lead.intent` | `extract.ts`; free-report sets `EXPLORING`; book-demo sets `DEMO_INTEREST` | EXISTS — REUSE | Yes | Written when extraction confidence ≥ 0.5. |
| Lead score | `Lead.leadScore` + `ScoringRuleConfig` | `extract.ts`, `src/models/ScoringRuleConfig.ts`, `computeScoreBand` in `src/services/nba/rules.ts` | EXISTS — MODIFY | Yes, keep the writer | Bands are 15/45/75 and no NBA rule reads them. Target bands are 25/50/75. `aiLeadScore` is a legacy constant. Do not build a third score. |
| Conversation history | `SalesConversation.messages`, `BookingConversation.messages` | `src/models/SalesConversation.ts`, `src/models/BookingConversation.ts` | EXISTS — REUSE | Yes | Sales conversation has no `leadId`; lookup is by phone. That is a link to keep, not a reason to replace the transcript. |
| Next best action | `decideNextAction` + `executeNextAction` | `src/services/nba/decideNextAction.ts`, `rules.ts`, `executeNextAction.ts` | EXISTS — MODIFY | Yes | Decision is stored. Eight actions can send on reply. Educate / answer / show-value do not own the reply. Proactive send is cohort-gated. |
| Stage / ownership | `currentAgent`, `currentStage`, `humanHandoff`, `nurtureStatus` | `src/services/leadOwnership/setLeadOwnership.ts` | EXISTS — MODIFY | Yes | Several target stages are on the enum and never written. Opt-out is `nurtureStatus: OPTED_OUT`, not `DO_NOT_CONTACT`. |
| Sales agent | Platform sales worker | `src/services/sales/salesAgent.ts`, Inngest `sales-nurture-requested`, `sales-nurture-consented`, `sales-agent-reply` | CONFIGURATION ONLY for “is it on?”; EXISTS — MODIFY for buying-signal persistence and which NBA actions send | Yes | Do not rewrite the composer. Enablement is `SalesAgentConfig.enabled` (database, UNKNOWN). |
| Demo agent | Booking agent | `src/services/booking/bookingAgent.ts`, `src/services/calendar/googleCalendar.ts`, Inngest `booking-agent-reply` | EXISTS — REUSE as code; CONFIGURATION ONLY for calendar credentials and `BookingAgentConfig.enabled` | Yes | This environment has no calendar env vars, so slots cannot succeed here. Production calendar env is UNKNOWN. |
| Qualification | Funnel label + NBA `ASK_QUALIFICATION` | `src/lib/admin/conversionFunnel.ts`, `rules.ts` | PARTIAL | Reuse intent and score | Nothing writes `currentStage: QUALIFYING`. `ASK_QUALIFICATION` is not in the reply executor set. |
| Demo decision | Keyword handoff + NBA `OFFER_DEMO` / `SCHEDULE_DEMO` | Webhook `BOOKING_HANDOFF_RE`, `executeNextAction.ts` | PARTIAL | Reuse both | `SCHEDULE_DEMO` nudges. Real booking is the booking agent. There is no separate policy object. |
| Demo completed / attended / no-show | `DemoBooking.status`, `runPostDemoAnalysis`, `NO_SHOW_CHECK` | `src/models/DemoBooking.ts`, `src/services/demo/postDemoAnalysis.ts` | EXISTS — REUSE | Yes | Attended is an admin `Completed` PATCH, not a Meet join callback. |
| Objections | `Lead.objections` | `extract.ts`, NBA `HANDLE_OBJECTION` | EXISTS — REUSE | Yes | Executed on the sales reply path. |
| Buying signals | Groq `buying_signals[]` dropped; intent `PURCHASE_INTEREST` / `READY_TO_BUY` kept | `extract.ts` | PARTIAL | Reuse intent | Persist signals only if a field is required. Do not add a second detector. |
| Nurture | Sales drip + consent + opt-out | `runSalesFollowUpDrip` in `functions.ts`, `optOutLead.ts` | CONFIGURATION ONLY for the master switch; EXISTS — MODIFY to use target stages | Yes | Customer Day 1/3/7 WhatsApp was removed on purpose. Do not restore it for platform leads. |
| Purchase / subscription | `/checkout`, `POST /api/billing/checkout` | `src/app/checkout/page.tsx`, `src/components/billing/useRazorpayCheckout.ts` | EXISTS — REUSE | Yes | NBA `OFFER_SUBSCRIPTION` already sends the subscribe URL. |
| Payment | Razorpay | `src/lib/billing/razorpay.ts` | EXISTS — REUSE | Yes | Local keys are test mode. Live vs test on the public site is UNKNOWN. |
| Payment verification | Webhook HMAC + reconcile | `src/app/api/webhook/razorpay/route.ts`, `src/lib/billing/razorpayReconcile.ts` | EXISTS — REUSE | Yes | Checkout alone does not unlock. |
| Invoice | Razorpay invoice list + WhatsApp template | `GET /api/billing/invoices`, `runCustomerActivationSequence` | PARTIAL | Reuse Razorpay list and the template | No local invoice document. Add one only if a PDF in this app is required. |
| Customer activated | `activatePlan` / `activateBusinessPlan` / `runCustomerActivationSequence` | `src/lib/billing/applyEntitlements.ts`, `src/services/billing/customerActivation.ts` | EXISTS — MODIFY | Yes | Workspace always activates. Lead becomes `IN_HOUSE` / `CUSTOMER` only on phone match. `PAYMENT_VERIFIED` is never written. |
| Customer success | In-house branch of the support agent | `src/services/support/supportAgent.ts` `composeInHouseAgentReply`, Inngest `support-agent-reply` | PARTIAL | Reuse for inbound query resolution | Not a proactive onboarding or account-management agent. See section 14. |
| Human handoff | `checkHandoffTriggers`, `releaseFromHuman` | `src/services/agentHandoff/`, `POST /api/admin/leads/return-to-ai` | EXISTS — MODIFY | Yes | AI stops. Return is admin-only. No assignee. |

---

# 2. Lead entry

```text
Website
 ├── Book Demo     /book-demo → POST /api/leads/book-demo
 └── Free Report   /free-report → POST /api/free-report/start
```

| Entry | UI | API | After save |
| --- | --- | --- | --- |
| Free Report | `src/app/free-report/page.tsx` | `fileFreeReportLead` | Shadow workspace, platform lead, audit dispatch. Sales WhatsApp only after the audit, and only if the sales agent document is enabled, and only a YES consent template if the phone has never messaged the platform. |
| Book Demo | `src/app/book-demo/page.tsx` | `fileDemoRequest` | Platform lead, `DemoBooking` Pending “To be scheduled”, `BookingConversation`, `booking/agent.reply`. The page also opens `wa.me`. |

Both should **keep using this implementation.** They already dedupe on `{ phone, tenantId: 'gmbboost-internal' }`, set `leadType: 'Platform Prospect'`, and set ownership (`SALES` / `NURTURING` or `DEMO` / `DEMO_REQUESTED`).

`/contact` does not create a lead. It is email plus a Book Demo button. That is outside the two target doors. Do not invent a third form as part of this architecture.

The WhatsApp “get my report” agent (`reportAgentReply`) is a third door. It can finish an audit and emit `sales/nurture.requested` **without** a `Lead`. That is a missing connection, not a reason to replace `/free-report`.

---

# 3. Create lead

Target `CREATE LEAD` is already the platform upsert. A new unified creation service is **not** required for Book Demo and Free Report.

| Question | Current fact |
| --- | --- |
| Model | `Lead` in `src/models/Lead.ts` |
| Who writes platform rows | `fileFreeReportLead`, `POST /api/leads/book-demo`, `handleCollecting` |
| `leadType` | `'Platform Prospect'` |
| `tenantId` | `'gmbboost-internal'` |
| `businessId` on the lead | Not set. The free-report **workspace** is a separate shadow `Business`, linked later from `SalesConversation.businessId`. |
| `source` | `'Website'` (free report; does not overwrite an existing `'Demo Booking'`). `'Demo Booking'` (form and WhatsApp booking). |
| Duplicate handling | `findOne({ phone, tenantId: 'gmbboost-internal' })` then update or create. Index `{ tenantId: 1, phone: 1 }`. |
| Initial score seed | `aiLeadScore` 60 (report) or 85 (demo). This is **not** `leadScore`. `leadScore` stays 0 until a WhatsApp extraction. |
| Initial ownership | Free report: `SALES` / `NURTURING` if the current agent is `NONE` or `SALES` (does not downgrade `DEMO` or `HUMAN`). Book demo: `DEMO` / `DEMO_REQUESTED`, intent `DEMO_INTEREST`. WhatsApp `handleCollecting`: creates the row, does not call `setLeadOwnership` until a slot is confirmed (`DEMO` / `DEMO_SCHEDULED`). |
| Customer CRM | `createOrUpdateCustomerLead` refuses the platform tenant. Leave it alone. |

**Sufficient as-is** for the two website entries. The only creation gap on the platform path is the report-agent conversation that never calls `fileFreeReportLead`. Fix that by calling the existing upsert, not by adding a new lead service.

---

# 4. Lead intelligence engine

The engine is `extractLeadIntelligence` / `applyExtraction` in `src/services/leadIntelligence/extract.ts`. It is not a separate agent. It already runs on the sales reply (awaited), on booking and support replies (fire-and-forget), and from `runPostDemoAnalysis`. **Reuse it. Do not add a parallel extractor.**

| Target piece | Implementation | Function | Field | Trigger | Consumer | Missing piece |
| --- | --- | --- | --- | --- | --- | --- |
| Lead profile | Partial | — | `name`, `phone`, `businessType`, `budget`, `notes`. `businessProfile` has no writer. | Form and chat | Admin detail returns `businessProfile` (usually empty). NBA brief would mention `industry` if it were set. | Teach `applyExtraction` to fill `businessProfile`, or accept the flat fields as the profile. |
| Interests | Missing on the platform path | — | `interest`, `businessProfile.interestedServices` | Not written by the extractor | CRM only, for `interest` | One write into the existing fields. No new collection. |
| Pain points | Implemented | `applyExtraction` | `painPoints[]` | Each extraction | `executeNextAction` briefs | None |
| Intent | Implemented | `applyExtraction` (confidence ≥ 0.5); forms set the first value | `intent` | Extraction and the two forms | NBA rules for `DEMO_INTEREST`, `PURCHASE_INTEREST`, `READY_TO_BUY` | None for detection. Stage `QUALIFYING` is still never set. |
| Lead score | Implemented, different bands | `applyExtraction` + `ScoringRuleConfig` | `leadScore` 0–100 | WhatsApp extraction and post-demo analysis | Stuck-hot handoff (≥ 76 by default). Funnel label “Qualified” at ≥ 15 (display). **Bands are not action policy.** | Point `computeScoreBand` at 25/50/75 and add rule rows that use `scoreBand`, or stop showing bands that do nothing. Do not replace the delta writer. |
| Conversation history | Implemented, per channel | Message append in the Inngest reply handlers | `SalesConversation.messages`, `BookingConversation.messages` | Every send and inbound | Next compose and extraction (last ~10 turns) | No single timeline document. Admin conversion detail is the reader. `SalesConversation` has no `leadId`. |
| Next best action | Implemented as a decision; partial as a send | `decideNextAction` | `nextBestAction`, `nextActionAt` | End of `applyExtraction`; proactive cron re-decides without a new LLM extract | Reply executor for 8 actions; proactive cron for 5 actions if V2 and cohort | Educate / answer / show-value fall through to `composeAgentReply`. See section 10. |
| Stage / ownership | Implemented for a subset of stages | `setLeadOwnership` | `currentAgent`, `currentStage`, `humanHandoff`, `nurtureStatus` | Free report, book demo, slot confirm, demo complete, handoff, payment, opt-out, return-to-AI | NBA rules, send blocks, funnel | Writers for qualifying, cold, unresponsive, long-term, lost, do-not-contact, conversion-pending, payment-verified. |

**AI code to reuse, not rebuild:**

- `extractLeadIntelligence` / `applyExtraction`
- `src/services/leadIntelligence/scoringIdempotency.ts` (`scoredSignalKeys`)
- `decideNextAction` and `NBA_RULES`
- `executeNextAction` for the actions it already sends
- `composeAgentReply` / `composeFirstMessage` / `composeFollowUp` in `salesAgent.ts`
- Post-demo `runPostDemoAnalysis`

**Do not revive** `extractLeadInsights` or `generateSalesResponse` in `src/services/ai.ts`. They have no production caller. `aiLeadScore` is a static 60/85 seed.

`buying_signals` are in the Groq JSON and then discarded. Intent already carries purchase and demo interest. Persist the array only as an extension of `applyExtraction`.

---

# 5. Sales agent

File: `src/services/sales/salesAgent.ts`. Workers: `salesNurtureRequested`, `salesNurtureConsented`, `salesAgentReply`, `runSalesFollowUpDrip`.

The agent is off when `SalesAgentConfig.enabled` is false (code default on first insert). That flag was not read from the database. Local `LEAD_ENGINE_V2=true` does **not** enable it.

| Target capability | Status | What already works | Reuse |
| --- | --- | --- | --- |
| Understand business | Already works, once a conversation exists | First pitch uses verified audit issues only (`extractScores`, `verifiedIssues`). Later turns get `summariseKnowledge`. | `composeFirstMessage`, `composeAgentReply`, `SalesAgentConfig.knowledge` |
| Qualify lead | Partially works | Intent and score update on each reply. NBA action `ASK_QUALIFICATION` exists. It is **not** in `NBA_OWNS_REPLY`, so the generic composer answers instead of a dedicated qualify step. `QUALIFYING` is never written. | Extractor + intent. Extend the executor set or the stage writer. Do not add a new qualifier model. |
| Identify problems | Already works for the audit | Problems on the first message come from the audit, not from a free-form diagnosis. | `extractScores` / fact guard |
| Answer questions | Already works | `composeAgentReply` answers. NBA `ANSWER_QUESTION` is stored and then ignored by the executor. | `composeAgentReply`. Optionally let the executor own that action so the stored NBA and the send match. |
| Handle objections | Already works on reply | Extractor writes `Lead.objections`. `HANDLE_OBJECTION` is in `NBA_OWNS_REPLY` and uses approved `objectionResponses` or a grounded compose. | `applyExtraction` + `executeNextAction` |
| Detect buying signals | Partially works | Intent `PURCHASE_INTEREST` / `READY_TO_BUY` is persisted and **does** change NBA (default `OFFER_SUBSCRIPTION`). The `buying_signals` array is dropped. | Intent path. Optional persist of the array inside `applyExtraction`. |

The sales agent does not create leads, does not book the calendar, and does not take payment. Booking is a keyword handoff to the booking agent. Purchase is a URL in `OFFER_SUBSCRIPTION`.

---

# 6. Demo agent

The demo agent **is** the booking agent. Do not build a second one.

| Target step | Existing behavior | Status | Missing connection |
| --- | --- | --- | --- |
| Discuss available slots | `offerRealSlots` → `getAvailableSlots` (Mon–Fri 10:00–18:00 IST, Google free/busy) | Code complete. **Calendar credentials absent in this env.** `BookingAgentConfig.enabled` UNKNOWN. | Configuration: `GOOGLE_CALENDAR_ID`, `GOOGLE_CALENDAR_CREDENTIALS_JSON`, and the enabled flag. |
| Confirm demo | `pickSlotFromReply` → `bookConfirmedSlot` → `createDemoEvent` | Code complete | Same calendar config. Website form does not pick a slot; it files Pending “To be scheduled”. That split should stay. |
| Send meeting link | WhatsApp confirmation appends `meetingLink` | Code complete | Email from `process-demo-booking` does **not** include the Meet URL. That is the only content gap. |
| Remind | `scheduleDemoReminders` → `DEMO_REMINDER` at 24h and 1h, sent by `nurture-scheduler-tick` (not behind `LEAD_ENGINE_V2`) | Code complete | Created only after a confirmed calendar event. |
| Demo completed | Admin `PATCH /api/admin/demo-bookings` status `Completed` → `runPostDemoAnalysis` → `SALES` / `DEMO_COMPLETED` | Code complete | No automatic “attended” from a Meet join. |
| Attended | Same admin `Completed` | PARTIAL | A Meet attendance callback does not exist. Manual complete is the implementation. |
| Reschedule | `handleBookedReply` | Code complete | Needs a confirmed booking and a running booking agent. |
| No-show | `NO_SHOW_CHECK` → status `No Show` → `runPostDemoAnalysis(..., 'NO_SHOW')` | Code complete | Same dependency on a confirmed booking. |

Disabled in **this** environment because calendar env vars are absent. That is configuration, not missing architecture. Whether production has the credentials is UNKNOWN.

---

# 7. Free report → sales

```text
FREE REPORT
   ↓  POST /api/free-report/start
LEAD          fileFreeReportLead — EXISTS
   ↓
REPORT        generate-audit, /free-report/result — EXISTS
   ↓
SALES         sales/nurture.requested — EXISTS, gated
```

What already exists:

1. Lead upsert, ownership `SALES` / `NURTURING`, intent `EXPLORING`, `aiLeadScore: 60`.
2. Shadow workspace and fast-mode audit.
3. Optional “report ready” WhatsApp. Template id is set in the local env.
4. Event `sales/nurture.requested` when the audit completes.
5. Consent YES before a pitch if the phone has never messaged the platform.
6. Drip and, on reply, extraction and NBA.

What blocks the journey today:

| Block | Kind |
| --- | --- |
| `SalesAgentConfig.enabled` false, or unknown | Configuration. Code default on first insert is false. Database value UNKNOWN. |
| Cold number must reply YES | Keep. It is a consent rule, not a bug. |
| `leadScore` does not move at submit (`FREE_REPORT_SUBMITTED` is never applied) | Small modification inside the existing scorer, not a new engine. |
| WhatsApp report-connect can nurture with no `Lead` | One call to the existing `fileFreeReportLead` (or the same upsert). |
| Result-page pricing does not start checkout or the agent | UI. The agent is the WhatsApp path. Do not rebuild the report page to be the sales engine. |

**Minimum missing connection:** make the post-audit nurture actually run for a website free-report lead (agent enabled in the environment you care about), and create a platform lead on the WhatsApp report path so extraction and payment matching have a row. Do not redesign free report, the audit, or the sales composer.

---

# 8. Lead states

Platform automation reads `currentStage`, `currentAgent`, and `nurtureStatus`. Customer CRM `lifeCycleStage` is a different board. Do not merge them.

| Target state | Existing representation | Written? | Used for automation? | Required work |
| --- | --- | --- | --- | --- |
| Active nurture | `currentStage: 'NURTURING'` and `currentAgent: 'SALES'` | Yes. Free report, demo cancel, return-to-AI. | Yes. Sales drip, NBA nurture rows, stuck-hot handoff requires this stage. | None for the happy path. Silent leads stay here forever; nothing moves them to unresponsive. |
| Long-term nurture | `currentStage: 'LONG_TERM_NURTURE'` | No writer. | NBA row would default to `WAIT` if the stage were set. | A transition from `NURTURING` after a defined quiet period. Reuse `setLeadOwnership`. Do not add a new field. |
| Unresponsive | `currentStage: 'UNRESPONSIVE'` | No writer. | NBA row would default to `WAIT` (`REENGAGE` is legal). | A transition when the drip finishes with no reply. The drip itself already stops on reply. |
| Lost | `currentStage: 'LOST'` | No writer. Customer “lost” is `lifeCycleStage: 'closed'` plus `lostAt`, which platform leads do not use. | NBA row exists. Funnel counts the stage. | One writer, plus a reason field only if product needs it. `Lead.lostAt` already exists for CRM. |
| Do not contact | `nurtureStatus: 'OPTED_OUT'` via `optOutLead` | Yes for nurture status. `currentStage: 'DO_NOT_CONTACT'` is **not** written. | Yes. Opt-out stops NBA (`STOP`), cancels `ScheduledAction`s, and blocks sends. `DO_NOT_CONTACT` is also checked and never set. | Either set the stage in `optOutLead`, or treat `OPTED_OUT` as the target state and stop expecting the other field. Do not build a third opt-out. |
| Human owned | `currentAgent: 'HUMAN'`, `currentStage: 'HUMAN_HANDOFF'`, `humanHandoff.active: true` | Yes. | Yes. `isHumanOwned` stops AI replies and the drip. Not behind `LEAD_ENGINE_V2`. | Assignee (`humanHandoff.assignedUserId`) is never set. Return is manual. |
| Customer | `currentStage: 'CUSTOMER'` and `currentAgent: 'IN_HOUSE'` | Yes, when payment finds a platform lead by phone. Also `Business.pipelineStage = 'Customer'` on the workspace, which is a different record. | Yes. Sales replies stop. Nurture actions are cancelled. | Self-serve payers with no matching phone never get this lead update. `PAYMENT_VERIFIED` is skipped. |

Also on the enum and unused by writers: `QUALIFYING`, `CONVERSION_PENDING`, `PAYMENT_VERIFIED`, `COLD`. `COLD` as a **score band** is separate from `currentStage: 'COLD'`.

`nurtureStatus` `PAUSED` and `STOPPED` have no setter. Human ownership is the pause.

---

# 9. Score

| | Current | Target |
| --- | --- | --- |
| Field | `Lead.leadScore` | Same field. Do not add another. |
| Range | 0–100, clamped | 0–100 |
| Writer | `applyExtraction`: one Groq `score_signal` plus a delta from `ScoringRuleConfig` or `DEFAULT_SCORING_RULES` | Keep this writer |
| When | WhatsApp extraction and post-demo analysis. Not at form submit. | Optional: apply `FREE_REPORT_SUBMITTED` (+10) and `DEMO_REQUESTED` (+20) at the existing form handlers so the score is not stuck at 0 until the first reply |
| Legacy twin | `aiLeadScore` 60 or 85, never updated, not read by NBA or handoff | Leave it. Do not wire it into decisions. |
| Bands in code | `<15 COLD`, `15–44 WARM`, `45–74 HOT`, `≥75 READY` (`computeScoreBand`) | `0–25 Cold`, `26–50 Warm`, `51–75 Hot`, `76–100 Ready to Buy` |
| Do bands affect behavior? | **No.** No `NBA_RULES` row sets `scoreBand`. | They should, if the target says heat changes the next action |
| What the number does affect | Stuck-hot handoff at `stuckLeadScoreThreshold` (schema default **76**) while stage is `NURTURING` and enough follow-ups have been sent. Admin label “Qualified” at ≥ 15. | 76 is already “ready” in the target. Today it hands to a human instead of offering a subscription. |

**Change required, still inside the current scorer:**

1. Edit the cutoffs in `computeScoreBand` to 25 / 50 / 75 if those are the product bands.
2. Add `scoreBand` conditions on the existing NBA rows (or new rows) so Warm/Hot/Ready change the default action. Until that, moving the numbers changes only a label.
3. Decide whether ≥ 76 means **offer subscription** (target) or **human handoff** (current stuck-hot rule). Those two policies conflict. The handoff should stay for “stuck after several nurtures,” not for “score just crossed 76.”
4. Call the existing delta table for `FREE_REPORT_SUBMITTED` from `fileFreeReportLead` if form submit should score. The signal already exists and is unused.
5. `INACTIVITY_DECAY` is documented as not applied. A decay job is new behavior on the same field, not a new score.

Database contents of `ScoringRuleConfig` were not read. If that document exists, it overrides `DEFAULT_SCORING_RULES`.

---

# 10. Next best action

Target labels and the current enum:

| Target | Current action | Generated? | Stored? | Shown in admin? | Sends on sales reply? | Proactive send? |
| --- | --- | --- | --- | --- | --- | --- |
| Educate | `EDUCATE` | Yes | `Lead.nextBestAction` | Yes, on conversion/lead-engine APIs | No. Generic `composeAgentReply` runs. | Only if `LEAD_ENGINE_V2` and cohort. Local V2 is true. Cohort UNKNOWN. |
| Answer questions | `ANSWER_QUESTION` | Yes | Same | Same | No (same fall-through). The generic composer does answer. | Not in the proactive set. |
| Handle objections | `HANDLE_OBJECTION` | Yes | Same | Same | **Yes** (`NBA_OWNS_REPLY`) | No |
| Share value | `SHOW_VALUE` (also `SHARE_USE_CASE`) | Yes. Default for `NURTURING` with no open objection. | Same | Same | No on the executor. The inline drip uses `composeFollowUp`, which is value-shaped but is not this enum. V2 drip schedules `SHOW_VALUE`. | Yes, if cohort. |
| Re-engage | `REENGAGE` | Yes, as the default for stage `COLD`, which is never written | Same | Same | Yes if something set the action | Yes, if cohort |
| Offer subscription | `OFFER_SUBSCRIPTION` | Yes, when intent is `PURCHASE_INTEREST` or `READY_TO_BUY` | Same | Same | **Yes** | No |

Also stored, beyond the six labels: `ASK_QUALIFICATION`, `OFFER_DEMO`, `SCHEDULE_DEMO`, `SEND_PRICING`, `FOLLOW_UP_AFTER_DEMO`, `WAIT`, `HUMAN_HANDOFF`, `STOP`.

### AI recommendation vs automated execution

| | What it is |
| --- | --- |
| AI recommendation | Groq `suggested_action`, kept only if it is legal for the stage and confidence ≥ 0.5. Otherwise the first matching rule’s `defaultAction`. Written every extraction. **This already exists.** |
| Automated execution on reply | `salesAgentReply` calls `executeNextAction` only when `nextBestAction` is in `NBA_OWNS_REPLY`. **Partial.** |
| Automated execution later | `proactive-nba-scheduler` creates `EXECUTE_NBA` for five actions, then `nurture-scheduler-tick` sends them. Requires cohort. **Not confirmed on**, because the cohort document was not read. |
| Not execution | Storing `nextBestAction` on the lead. Admin display. Booking/support extractions that decide and do not call the executor. |

**Missing to match the target engine:** let the six target actions that should send actually send (today Educate, Answer, and Share Value do not own the reply), and make proactive nurture one path (inline drip **or** V2 scheduler) so a lead is not dependent on an unread cohort for basic follow-up. The chooser, the enum, the storage, and the executor should stay.

`SCHEDULE_DEMO` does not book. Booking stays on the booking agent.

---

# 11. Nurture loop

```text
NOT READY → NURTURE → VALUE → USE CASES → CHECK-IN → RE-ENGAGE → REASSESS
```

| Target beat | What exists | Gap |
| --- | --- | --- |
| Not ready | New free-report lead is `NURTURING` / intent `EXPLORING` / `leadScore` 0 | No `QUALIFYING` or score-band gate |
| Nurture | `runSalesFollowUpDrip`: Inngest sleeps, `composeFollowUp`, `onlyIfNoReply` default true | Runs only after the sales agent is enabled and, for a cold number, after YES |
| Value content | Drip copy from audit facts and knowledge. NBA `SHOW_VALUE`. | Reply path does not execute `SHOW_VALUE` as NBA. V2 schedules it only in cohort. |
| Use cases | NBA `SHARE_USE_CASE`. Knowledge `useCases` on `SalesAgentConfig`. | Same: legal and stored, not the default reply owner |
| Check-in | Follow-up steps while they stay silent | No move to `UNRESPONSIVE` when the sequence ends |
| Re-engage | `REENGAGE` action | Stage `COLD` / `UNRESPONSIVE` never set, so the default rarely becomes `REENGAGE` |
| Reassess | The next inbound message re-runs extraction and NBA | No timed reassess job besides the drip and the proactive cron |

**Already in place (reuse):**

- Follow-up job: `runSalesFollowUpDrip` inside `src/services/inngest/functions.ts`.
- Scheduler: `nurture-scheduler-tick` (15 min) and `proactive-nba-scheduler` (30 min).
- WhatsApp: `sendOutboundMessage` / templates. Local provider is Twilio. Suppression is off.
- AI messaging: `composeFollowUp`, `composeAgentReply`, `executeNextAction`.
- Stop: reply when `onlyIfNoReply`; `salesReplyBlockedReason` (human, opt-out, customer, do-not-contact); paid workspace skipped at nurture start; `cancelScheduledActions` on convert and opt-out.
- Opt-out: inbound STOP → `optOutLeadByPhone` → `nurtureStatus: 'OPTED_OUT'`.
- Human ownership: drip returns immediately when `salesReplyBlockedReason` matches.

**Not the platform nurture loop (do not wire back in):**

- `follow-up-cron` (hourly). It queries `lastInteractionTime`, which is not on the schema. Leave it inert.
- `dispatch-crm-whatsapp` / Day 1/3/7. Removed. Customer leads stay on owner tasks.
- `generateSalesResponse`. Unused.

**Missing pieces only:**

- One enabled path from “audit done” to “drip running” (configuration of `SalesAgentConfig.enabled`, plus cohort **or** a decision to keep the inline drip as the default).
- Stage transitions so re-engage and long-term rows can match.
- Optional: execute `SHOW_VALUE` / `SHARE_USE_CASE` / `EDUCATE` on the reply path so the stored action and the message are the same component.

---

# 12. Human handoff

```text
AI
 ↓  checkHandoffTriggers OR NBA HUMAN_HANDOFF OR calendar failure
HUMAN HANDOFF
 ↓  setLeadOwnership(..., 'HUMAN', ..., 'HUMAN_HANDOFF')
    humanHandoff.active = true, reason, since
HUMAN OWNED
 ↓  isHumanOwned / salesReplyBlockedReason — AI and drip stop
    Not gated by LEAD_ENGINE_V2
HUMAN CONVERSATION
 ↓  No in-app sender that posts WhatsApp as the human.
    Super-admin push + /admin/leads read.
    assignedUserId is never set.
RETURN TO AI
    POST /api/admin/leads/return-to-ai → releaseFromHuman
    Clears humanHandoff.active
    Resumes SALES/NURTURING or IN_HOUSE/CUSTOMER
    Not automatic
```

**Reuse as-is:** `checkHandoffTriggers`, `isExplicitHumanRequest`, `isHumanOwned`, `salesReplyBlockedReason`, `setLeadOwnership`, `releaseFromHuman`, the admin route, the stuck-hot snapshot `followUpsSentAtRelease`.

**Modification, not a new handoff system:**

- Set `humanHandoff.assignedUserId` if a person must own the thread.
- Stop `observeLeadOwnershipShadow` from writing `currentAgent: SALES` while `humanHandoff.active` is true, so the admin owner and the safety check agree.
- Automatic return is absent. That is a product choice. The manual return already exists.

---

# 13. Purchase

```text
SUBSCRIPTION     /checkout → POST /api/billing/checkout → Razorpay subscription
                 NBA OFFER_SUBSCRIPTION can send the URL on WhatsApp
PAYMENT          Razorpay Checkout.js. Local keys are test mode.
PAYMENT VERIFICATION
                 POST /api/webhook/razorpay HMAC + ProcessedWebhookEvent
                 AND reconcile on GET /api/billing/status and a 10-minute cron
                 Checkout does not grant access by itself.
INVOICE          GET /api/billing/invoices reads Razorpay.
                 WhatsApp template invoiceReady (id set locally) from
                 runCustomerActivationSequence, only if a platform lead matches.
                 No invoice collection in Mongo.
CUSTOMER ACTIVATION
                 activatePlan + activateBusinessPlan always (workspace).
                 Lead → IN_HOUSE / CUSTOMER only on phone match.
                 Payment-received WhatsApp skipped locally
                 (TWILIO_TEMPLATE_PAYMENT_RECEIVED absent).
```

**Already complete:**

- Creating the Razorpay subscription.
- Signature verification and idempotency.
- Unlocking `Subscription` and `Business` (`subscriptionStatus: active`, `pipelineStage: 'Customer'`).
- Past-due on `payment.failed` / `subscription.halted`: in-app notice, owner WhatsApp, email. Does not return the lead to sales and does not set `CONVERSION_PENDING`.
- Cancelling nurture when a matching lead converts.

**Not complete relative to the diagram:**

- Lead stages `CONVERSION_PENDING` and `PAYMENT_VERIFIED` are never written. Payment jumps to `CUSTOMER`.
- A payer with no platform lead still gets a workspace and does not get in-house ownership or invoice/welcome WhatsApp.
- Invoice is not a document this app generates.
- Local payment-received template is missing (configuration).

Do not replace Razorpay, the webhook, or `applyEntitlements`.

---

# 14. Customer success

```text
CUSTOMER ACTIVATED
        ↓
IN-HOUSE AGENT          composeInHouseAgentReply — EXISTS
├── Onboarding          NOT this agent. POST /api/onboarding is signup.
├── Setup assistance    Prompt text only. No GBP/tool actions.
├── Ongoing assistance  Inbound WhatsApp only, after currentAgent is IN_HOUSE.
└── Query resolution    Yes. Groq + PRODUCT_KNOWLEDGE. Can still hand off.
```

The in-house worker **is** agentic for inbound questions: multi-turn, product knowledge, handoff checks, Inngest `support-agent-reply`. Reuse it for query resolution and for “help me use the product” replies.

It does **not**:

- start itself at payment (it waits for the next inbound message, and only if a lead was matched),
- run an onboarding checklist,
- connect Google Business Profile,
- assign an account manager,
- change billing.

**NEW COMPONENT REQUIRED** only if customer success means proactive onboarding, setup tasks, or an account owner. Do not build a second inbound WhatsApp bot beside `composeInHouseAgentReply`.

There is no flag, model, or job named customer success. A Groq string inside review campaigns is not this agent.

---

# 15. Existing code we should reuse

### Lead

- `fileFreeReportLead` — `src/app/api/free-report/start/route.ts`
- `fileDemoRequest` — `src/app/api/leads/book-demo/route.ts`
- `handleCollecting` lead upsert — `src/services/inngest/functions.ts`
- `Lead` model and the platform vs customer split — `src/models/Lead.ts`, `createOrUpdateCustomerLead` (do not point customer CRM at platform leads)
- `setLeadOwnership` — `src/services/leadOwnership/setLeadOwnership.ts`
- `logLeadEvent` — `src/services/leadEvents.ts`

### Intelligence

- `extractLeadIntelligence`, `applyExtraction` — `src/services/leadIntelligence/extract.ts`
- `scoringIdempotency.ts`
- `ScoringRuleConfig` / `DEFAULT_SCORING_RULES`
- `decideNextAction`, `NBA_RULES`, `computeScoreBand` — `src/services/nba/`
- `executeNextAction` — extend its action set; do not replace it
- `runPostDemoAnalysis` — `src/services/demo/postDemoAnalysis.ts`

### Sales

- `src/services/sales/salesAgent.ts` (`composeFirstMessage`, `composeFollowUp`, `composeAgentReply`, `extractScores`, `getSalesAgentConfig`)
- `src/lib/salesAgentDefaults.ts` and `SalesAgentConfig`
- Inngest `sales-nurture-requested`, `sales-nurture-consented`, `sales-agent-reply`, `runSalesFollowUpDrip`
- `SalesConversation`

### Demo

- `src/services/booking/bookingAgent.ts`
- `src/services/calendar/googleCalendar.ts`
- `DemoBooking`, `BookingConversation`
- `scheduleDemoReminders`, `NO_SHOW_CHECK`, `process-demo-booking`
- Inngest `booking-agent-reply`

### WhatsApp

- `processPlatformInbound` vs tenant `processInboundMessage` — `src/app/api/whatsapp/webhook/route.ts`
- `src/services/whatsapp/send.ts` and `src/services/twilio/client.ts`
- `src/lib/whatsappTemplates.ts`
- Consent helper used by `salesNurtureRequested` (`hasPhoneMessagedPlatformBefore`)

### Nurture

- `runSalesFollowUpDrip`
- `nurture-scheduler-tick`, `proactive-nba-scheduler`
- `optOutLead` — `src/services/leadOwnership/optOutLead.ts`
- `cancelScheduledActions` — `src/services/scheduler/cancelScheduledActions.ts`
- `requestOutboundMessage` — `src/services/orchestration/outboundOrchestrator.ts` (cohort gate; do not duplicate sending)
- `salesReplyBlockedReason`

### Payment

- `POST /api/billing/checkout`, `src/lib/billing/razorpay.ts`
- `POST /api/webhook/razorpay`
- `ProcessedWebhookEvent`
- `activatePlan`, `activateBusinessPlan`, `markBusinessPastDue` — `src/lib/billing/applyEntitlements.ts`
- `reconcileWorkspaceSubscription` — `src/lib/billing/razorpayReconcile.ts`
- `GET /api/billing/invoices`

### Activation

- `runCustomerActivationSequence` — `src/services/billing/customerActivation.ts`
- `sendPaymentReceivedMessage` — `src/services/billing/paymentReceivedNotice.ts`
- `composeInHouseAgentReply` — `src/services/support/supportAgent.ts`
- Inngest `support-agent-reply`

### Human handoff

- `checkHandoffTriggers`, `humanRequest.ts`, `isHumanOwned.ts`
- `releaseFromHuman`
- `POST /api/admin/leads/return-to-ai`

**Do not revive:** `follow-up-cron`, `generateSalesResponse`, `extractLeadInsights`, `n8n-workflows/workflow-2-lead-followup.json`, Day 1/3/7 `dispatch-crm-whatsapp`, admin `Business.pipelineStage` Kanban as the lead engine.

---

# 16. Genuinely new components

Only what has **no** equivalent.

| Component | Why it is new |
| --- | --- |
| Proactive customer-success workflow | Onboarding checklist, setup tasks, account owner, success plays. The in-house WhatsApp reply is not this. Build it only if those jobs are in scope. |
| Meet attendance → `Completed` | Nothing reads Meet join events. Admin PATCH is the current “attended.” |
| Local invoice document | Only if a PDF stored by this app is required. Razorpay’s invoice list and the WhatsApp template already exist. |
| Timed stage walker | A job that moves `NURTURING` → `UNRESPONSIVE` / `LONG_TERM_NURTURE` and applies `INACTIVITY_DECAY`. The enums and the delta exist. The walker does not. |
| Human assignment | `humanHandoff.assignedUserId` is on the schema and never set. A small write on the existing handoff, not a new ownership model. Listed here only if “a named rep owns the thread” is required. The handoff itself is not new. |

Not new, and easy to mislabel as new:

- Lead intelligence, sales agent, booking agent, NBA chooser, Razorpay, webhook verification, workspace activation, opt-out, return-to-AI, free-report lead create, book-demo lead create.

---

# 17. Existing components that need modification

| Component | Current behavior | Target behavior | Minimum change | Depends on |
| --- | --- | --- | --- | --- |
| `computeScoreBand` and `NBA_RULES` | Bands 15/45/75. No rule uses `scoreBand`. Score ≥ 76 can force human handoff during nurture. | Bands 0–25 / 26–50 / 51–75 / 76–100. Heat changes the next action. 76 means ready to buy, not an automatic handoff. | Change cutoffs. Add `scoreBand` on existing rules. Keep stuck-hot handoff for “many follow-ups and still unresolved,” not for crossing 76 once. | `extract.ts` writer stays. Admin funnel copy that says ≥ 15 is “Qualified.” |
| `applyExtraction` | Drops `buying_signals`. Does not fill `businessProfile` or interests. | Profile, interests, and buying signals live on the lead. | Write those fields in `applyExtraction`. | `Lead` schema already has `businessProfile`, `objections`, `painPoints`. |
| `executeNextAction` / `NBA_OWNS_REPLY` | Educate, answer, and show-value are stored then handled by the generic composer. | The stored next action is what gets sent. | Add those actions to the executor set, or stop writing them as if they executed. | `composeAgentReply` can remain the fallback when execution returns skipped. |
| `setLeadOwnership` callers | Never set qualifying, cold, unresponsive, long-term, lost, do-not-contact, conversion-pending, payment-verified. | Target states are real. | Call `setLeadOwnership` from the drip end, opt-out, and payment. Do not add a parallel stage field. | NBA rows for those stages already exist. |
| `optOutLead` | Sets `nurtureStatus: OPTED_OUT` only. | Do-not-contact is one state. | Also set `currentStage: DO_NOT_CONTACT`, or document `OPTED_OUT` as the only switch and ignore the unused stage. | Orchestrator already checks both. |
| `runCustomerActivationSequence` | Jumps to `CUSTOMER`. Skips the lead if the phone does not match. | Payment verified, then customer. Every payer is a lead or an explicit non-lead. | Optional stage `PAYMENT_VERIFIED` before `CUSTOMER`. If no lead, either create one with the existing platform upsert or accept workspace-only activation. | `activateBusinessPlan` must stay first and must not depend on a lead. |
| `fileFreeReportLead` | Does not apply `FREE_REPORT_SUBMITTED`. | Score moves at submit. | One `applyExtraction` or a direct delta using the existing signal. | Idempotency so a double submit does not add +10 twice. |
| Report agent | No `Lead` row. | Same phone is a platform lead before nurture. | Call the existing free-report upsert. | Do not create a second lead type. |
| `process-demo-booking` email | Omits the Meet link. | Confirmation email includes `meetingLink`. | Add the field the WhatsApp confirmation already has. | Calendar event must exist. |
| `observeLeadOwnershipShadow` | Can set `currentAgent` back to `SALES` while `humanHandoff.active` is true. | One owner. | Skip the sync when `humanHandoff.active` is true. | `isHumanOwned` already checks both fields. |
| Sales drip vs proactive cron | Two senders. Inline drip is the default. V2 cohort replaces a step with `SHOW_VALUE` scheduling. | One nurture loop. | Pick the inline drip as the default until the cohort is deliberately opened. Do not delete either until that choice is made. | `LEAD_ENGINE_V2`, `OrchestrationConfig`. |

---

# 18. Configuration required

These are not missing architecture. The code is already there.

| Item | Local fact (this workspace) | What must be true for the path to run | Unknown |
| --- | --- | --- | --- |
| `SalesAgentConfig.enabled` | Not read. Code default on insert is false. | `true`, or free-report leads never enter the sales chat. | Database `growwmatics_dev` and production. |
| `BookingAgentConfig.enabled` | Not read. Default false. | `true`, or booking replies are the human fallback. | Same. |
| `ReportAgentConfig.enabled` | Not read. Default false. | `true` only if the WhatsApp report bot should speak. | Same. |
| `LEAD_ENGINE_V2` | `true` in `.env` and `.env.local`. | Proactive NBA cron is not skipped for the flag. Cohort is still required. | Production host. |
| `OrchestrationConfig.rolloutPercentage` and allowlist | Not read. Schema default 0 and empty, which matches nobody. | Raise percentage or allowlist only when proactive NBA should send. | Database. |
| `GOOGLE_CALENDAR_ID` and `GOOGLE_CALENDAR_CREDENTIALS_JSON` | **Absent locally.** Slots, Meet, reminders, and no-show cannot run here. | Both set on the process that runs `booking-agent-reply`. | Production. |
| `TWILIO_TEMPLATE_PAYMENT_RECEIVED` | **Absent locally.** Payment-received WhatsApp returns without sending. | Set the template id. | Production. |
| Sales intro, report ready, invoice, welcome | **Set locally.** | Still need Twilio to accept them, and a worker to send them. | Production template ids. |
| `QA_SUPPRESS_WHATSAPP_SENDS` | `false` locally. Sends are real Twilio calls. | Keep false in any environment that should actually message people. | Production. |
| Razorpay | **Test** keys locally. | Live keys and webhook secret on the public site. | Production mode. |
| `INNGEST_DEV` | `1` locally. App URL is `localhost:3000`. | Production workers are Inngest Cloud, not this flag. | Whether cloud crons run for the public site. |
| Consent | Not a flag. Cold web-form numbers need YES. | Leave it on. | — |
| `GBP_LIVE_WRITES_ENABLED` | `false` locally. | Unrelated to sales chat. Blocks live GBP writes after payment. | Production. |

Do not call `getSalesAgentConfig()` just to inspect it. If the document is missing, that function inserts a disabled default.

---

# 19. Proposed final flow

Existing pieces are marked. “Configure” means the code exists and a flag or secret decides if it runs. “Modify” means a small change to that same code.

```text
Website
   ↓  EXISTS — /free-report and /book-demo
Book Demo / Free Report
   ↓  EXISTS — fileDemoRequest / fileFreeReportLead
Create Platform Lead
   tenant gmbboost-internal, Platform Prospect, phone dedupe
   ↓  EXISTS after the first inbound sales/booking message
      MODIFY — optional score delta at form submit
Lead Intelligence
   extractLeadIntelligence → intent, painPoints, objections, leadScore
   MODIFY — persist buying_signals and businessProfile
   ↓  EXISTS — salesAgent.ts, gated by SalesAgentConfig.enabled (CONFIGURE)
Sales Agent
   ↓  PARTIAL — intent + score; QUALIFYING stage not written
Qualification
   ↓  EXISTS — OFFER_DEMO / keyword handoff to the booking agent
Demo Decision
   ├── Demo
   │     EXISTS — booking agent + Google Calendar (CONFIGURE credentials)
   │     confirm, Meet link on WhatsApp, reminders, reschedule, no-show
   │     MODIFY — put Meet link in the email
   │     attended = admin Completed (Meet join is not built)
   └── Nurture
         EXISTS — drip + consent + opt-out
         CONFIGURE — agent enabled
         MODIFY — one send path; write UNRESPONSIVE / LONG_TERM when the drip ends
   ↓  EXISTS — same extractor on the next reply and runPostDemoAnalysis
Analyze Conversation
   ↓
Update Intelligence
   ↓  EXISTS — decideNextAction stores nextBestAction
Next Best Action
   ├── Educate            stored; MODIFY so the executor sends it
   ├── Answer             stored; generic composer already answers
   ├── Objection          EXISTS and sends
   ├── Value              drip / SHOW_VALUE; MODIFY so reply and drip agree
   ├── Re-engage          action exists; MODIFY so a stage writer can select it
   └── Offer              EXISTS — OFFER_SUBSCRIPTION sends the checkout URL
   ↓  EXISTS — /checkout, Razorpay
Purchase
   ↓
Payment
   ↓  EXISTS — webhook HMAC and reconcile
Verification
   ↓  PARTIAL — Razorpay invoice list + WhatsApp template
      local invoice file only if product requires it
Invoice
   ↓  EXISTS — activateBusinessPlan always
      MODIFY — lead link when the phone does not match; optional PAYMENT_VERIFIED
Activation
   ↓  EXISTS for inbound questions — composeInHouseAgentReply
      NEW only for proactive onboarding / account ownership
Customer Success
```

Human handoff can interrupt any AI step. That path already exists (`checkHandoffTriggers`, `releaseFromHuman`).

---

# 20. Architectural principle

```text
CURRENT EXISTING SYSTEM
        ↓
CONNECT     free report → enabled sales nurture; report-agent → existing lead upsert;
            stored NBA → the sender that already exists
        ↓
UNIFY       one stage field (currentStage), one score (leadScore),
            one nurture sender, opt-out OR do-not-contact as the same switch
        ↓
EXTEND      band cutoffs, stage writers, profile fields, in-house → proactive CS only if needed
        ↓
TARGET ARCHITECTURE
```

Do not delete the sales agent, the booking agent, `extract.ts`, the NBA module, or the Razorpay webhook and replace them with a new stack.

---

# FINAL SUMMARY

## REUSE

Platform lead create for free report and book demo. Phone dedupe. Shadow workspace and audit. Sales composer, consent gate, and drip. Booking agent, calendar integration, Meet link on WhatsApp, reminders, reschedule, no-show, post-demo analysis. Extractor for intent, objections, pain points, and `leadScore`. NBA chooser and the executor’s current sends (objection, pricing, demo nudge, subscription link, handoff, re-engage, post-demo). Human stop and admin return-to-AI. Opt-out. Razorpay checkout, signed webhook, reconcile, workspace activation, past-due notices. In-house WhatsApp support after a matched payment.

## MODIFY

Score band cutoffs, and make bands affect NBA. Separate “ready to buy” from “stuck, hand to a human.” Persist buying signals and `businessProfile` inside `applyExtraction`. Let educate / show-value use `executeNextAction` if the stored action should be what is sent. Write the unused `currentStage` values from the existing ownership function, including opt-out and the end of a silent drip. Optionally score `FREE_REPORT_SUBMITTED` at form submit. Put the Meet link in the booking email. Keep shadow ownership from undoing a human handoff. Link a payer to a platform lead when the phone does not match, without blocking workspace unlock.

## CONNECT

Free-report audit already emits `sales/nurture.requested`. That reaches a sales conversation only when the sales agent document is enabled, and a cold number only after YES. WhatsApp report-connect can fire the same event with no `Lead`; connect it to `fileFreeReportLead`. `SalesConversation` resolves the lead by phone; keep that lookup. Result-page pricing is not the sales agent. Payment activation and the lead’s `CUSTOMER` stage meet only on phone match.

## CONFIGURE

`SalesAgentConfig.enabled`, `BookingAgentConfig.enabled`, and `ReportAgentConfig.enabled` (database; unread; default false on first insert). `GOOGLE_CALENDAR_ID` and credentials (absent in this env). `TWILIO_TEMPLATE_PAYMENT_RECEIVED` (absent in this env). Cohort percentage and allowlist before proactive NBA is treated as on (`LEAD_ENGINE_V2` is already true locally and is not sufficient). Production env is not this repo’s `.env`: localhost, `growwmatics_dev`, Razorpay test, `INNGEST_DEV=1`. Live Razorpay, Inngest Cloud, and production template ids were not verified.

## BUILD

A proactive customer-success workflow only if onboarding tasks, setup actions, or an account owner are required beyond `composeInHouseAgentReply`. A Meet-join → attended update only if manual `Completed` is not enough. A local invoice file only if Razorpay’s invoice list is not enough. A timer that moves nurture stages and applies inactivity decay. Those are the pieces with no equivalent.

## DO NOT REBUILD

`fileFreeReportLead`, `fileDemoRequest`, `Lead` platform upsert, `extractLeadIntelligence`, `applyExtraction`, `ScoringRuleConfig`, `decideNextAction`, `executeNextAction`, `salesAgent.ts`, `bookingAgent.ts`, `googleCalendar.ts`, demo reminders and no-show, `runPostDemoAnalysis`, Razorpay webhook and `applyEntitlements`, `runCustomerActivationSequence`, `optOutLead`, `checkHandoffTriggers`, `releaseFromHuman`, platform WhatsApp routing, the in-house support reply.

Do not revive `aiLeadScore`, `generateSalesResponse`, `extractLeadInsights`, the hourly `follow-up-cron`, the Day 1/3/7 customer WhatsApp chain, or the `Business.pipelineStage` Kanban as the lead engine.

## OPEN QUESTIONS

1. Is `SalesAgentConfig.enabled` true in the database the public site uses? This check could not read Mongo.
2. Is `BookingAgentConfig.enabled` true, and does production have `GOOGLE_CALENDAR_ID` and credentials? This workspace does not.
3. What are `OrchestrationConfig.rolloutPercentage` and the allowlist length? Local `LEAD_ENGINE_V2=true` does not answer that.
4. Does the public site use live Razorpay and Inngest Cloud, or the same test/dev settings as `.env.local`?
5. Should a score of 76 offer a subscription, hand off to a human, or both only after repeated nurture? The code does the handoff. The target diagram says ready to buy.
6. Is `nurtureStatus: OPTED_OUT` the accepted “do not contact,” or must `currentStage` also change?
7. Is admin `Completed` enough for “attended,” or is a Meet callback required?
8. Is inbound in-house support enough for customer success, or are proactive onboarding tasks in scope?
9. Must every paying user have a platform `Lead`, including checkout with a phone that never hit free report or book demo?
10. Is a PDF invoice stored in this app required, or is Razorpay’s invoice list plus the WhatsApp note enough?
