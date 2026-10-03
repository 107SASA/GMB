# Lead / Sales Implementation Plan

**Status:** approved and in implementation. Clarifications below were accepted before coding.

**Sources read before this plan:**

- `docs/CURRENT_LEAD_SALES_ARCHITECTURE_AUDIT.md`
- `docs/CURRENT_LEAD_SALES_RUNTIME_VERIFICATION.md`
- `docs/LEAD_SALES_TARGET_ARCHITECTURE_GAP_MAP.md`

**Strategy:** reuse the platform lead, extractor, sales agent, booking agent, NBA module, WhatsApp sender, Razorpay webhook, and human handoff. Connect the gaps. Extend fields only where nothing equivalent is stored.

**Not in scope:** customer CRM (`Client Prospect`), free-report evidence/UI, audit scoring of Google profiles, a second sales or booking agent, Stripe, rebuilding checkout.

**Approved clarifications (hard requirements):**

1. **Two optional Lead fields,** not one: `buyingSignals` and `auditId`. Both stay. `auditId` is the explicit Free Report / Audit → Platform Lead link.
2. **Free Report creates/upserts the Platform Lead at submit time.** Flow: FREE REPORT SUBMITTED → CREATE/UPSERT PLATFORM LEAD → apply `FREE_REPORT_SUBMITTED` signal → Lead Intelligence → audit continues asynchronously → attach `auditId` when the audit is available → Sales/Nurture according to existing flags. Lead creation is never delayed until a nurture event.
3. **`leadScore` is temperature, not a sales decision.** Score alone must **never** cause `OFFER_SUBSCRIPTION`. The decision combines score band, intent, buying signals, objections, conversation context, demo state, lifecycle stage, and ownership. Example: 84 + `EXPLORING` + no buying signal → do not offer. 68 + pricing question + purchase intent → subscription may be allowed.

**Canonical decisions (do not reopen during coding unless a file contradicts them):**

| Decision | Choice | Why |
| --- | --- | --- |
| Lifecycle field | `Lead.currentStage` plus `Lead.currentAgent` | Already the platform state machine. `lifeCycleStage` stays customer-CRM only. `pipelineStage` stays legacy. `Business.pipelineStage` stays the workspace Kanban. |
| Score field | `Lead.leadScore` only | `aiLeadScore` stays a static 60/85 seed and is not a decision input. |
| Score invariant | Score alone never selects `OFFER_SUBSCRIPTION` | Band widens what is *legal* when intent/signals also support it. Stuck-hot handoff stays, but only after `stuckNurtureCyclesThreshold` (default **3**) follow-ups, not the moment the score crosses 76. |
| Schema fields added | `buyingSignals` and `auditId` | Both optional. See clarifications. |
| Free-report lead timing | Upsert immediately in `POST /api/free-report/start` | Audit and `auditId` attach later. Nurture never creates the lead. |
| Do-not-contact | Write **both** `nurtureStatus: 'OPTED_OUT'` and `currentStage: 'DO_NOT_CONTACT'` | Sends already stop on either. Today only the nurture status is written. |
| Human owned | Keep `currentAgent: 'HUMAN'` + `currentStage: 'HUMAN_HANDOFF'` + `humanHandoff.active` | Do not add an `AI` / `HUMAN` / `CUSTOMER` enum. Customer ownership is `currentAgent: 'IN_HOUSE'` + `currentStage: 'CUSTOMER'`. |
| Cold / warm / hot / ready | `computeScoreBand` only | Do not also set `currentStage: 'COLD'`. That stage duplicates the band and is unused. |
| Payment pending | Reuse `CONVERSION_PENDING` | Do not add `PAYMENT_PENDING`. `PAYMENT_VERIFIED` already exists and is unused; activation will write it before `CUSTOMER`. |
| Silence clock | Existing sales follow-up config | First pitch delay **2 minutes**. Follow-ups **24h** then **72h**, `onlyIfNoReply: true` (`DEFAULT_FOLLOWUPS` in `src/lib/salesAgentDefaults.ts`). Proactive cooldown **4 hours**. No new day-count invented. |
| Rollout | Do not flip `SalesAgentConfig.enabled` or raise `rolloutPercentage` in code or in the database as part of this work. | New behavior that sends WhatsApp stays behind the existing agent flag and, for proactive NBA, `LEAD_ENGINE_V2` + cohort. |

---

## 1. Files to modify

### Lead intelligence and score

| File | Change |
| --- | --- |
| `src/models/Lead.ts` | Add **both** optional fields: `buyingSignals` and `auditId`. No second profile object. |
| `src/services/leadIntelligence/extract.ts` | Persist buying signals, `businessProfile`, and interests by merging. Do not clear prior pain points, objections, or signals that the new message did not mention. |
| `src/services/nba/rules.ts` | Move `computeScoreBand` cutoffs from 15/45/75 to **25 / 50 / 75**. Add `scoreBand` as a *legal-action* constraint, not as a sole default that offers a subscription. |
| `src/models/ScoringRuleConfig.ts` | No new signals unless a conversation phrase already maps to an existing signal (`PRICING_QUESTION`, `DEMO_REQUESTED`, `PURCHASE_INTENT`, and the rest of `DEFAULT_SCORING_RULES`). |
| `src/lib/admin/conversionFunnel.ts` | “Qualified” label must not keep using `leadScore >= 15` after the band change. Use the new warm floor (26) or intent, and say so in the label. |

### Stage writers (existing function, new call sites)

| File | Change |
| --- | --- |
| `src/services/leadOwnership/optOutLead.ts` | Also set `currentStage: 'DO_NOT_CONTACT'` via `setLeadOwnership` (keep `OPTED_OUT`). |
| `src/services/leadOwnership/setLeadOwnership.ts` | No new agent enum. Confirm DO_NOT_CONTACT cancels scheduled actions the same way CUSTOMER does. |
| `src/app/api/whatsapp/webhook/route.ts` | `observeLeadOwnershipShadow` must not set `currentAgent` back to `SALES` while `humanHandoff.active` is true. |
| `src/services/inngest/functions.ts` | After the last `onlyIfNoReply` follow-up is sent and the lead is still silent, one transition to `UNRESPONSIVE`. A later pass of the same scheduler moves `UNRESPONSIVE` to `LONG_TERM_NURTURE` after another wait equal to the **last configured** `delayHours` (72 in the default config, not a hardcoded 72 if the admin changed the config). |
| `src/services/billing/customerActivation.ts` | Set `PAYMENT_VERIFIED`, then invoice/welcome, then `CUSTOMER` / `IN_HOUSE`. Do not mark `CUSTOMER` before verification. On payment failure, do not set `CUSTOMER`. |
| `src/app/api/webhook/razorpay/route.ts` | On `payment.failed` / `subscription.halted`, if a platform lead resolves, set `CONVERSION_PENDING` only when the lead is not already `CUSTOMER`, and do not clear intelligence. Reuse `markBusinessPastDue`. |
| `src/app/api/free-report/start/route.ts` | Apply existing signal `FREE_REPORT_SUBMITTED` once per lead (idempotent via `scoredSignalKeys`). Store `auditId` only if we add that one link field (below). |
| `src/services/inngest/functions.ts` (`reportAgentReply` / audit complete) | If nurture is about to run and no platform lead exists for the phone, call the same upsert `fileFreeReportLead` uses. Do not create a second lead type. |

### Next-best-action execution

| File | Change |
| --- | --- |
| `src/services/inngest/functions.ts` (`NBA_OWNS_REPLY` inside `salesAgentReply`) | Include `EDUCATE`, `SHOW_VALUE`, `SHARE_USE_CASE`, `ANSWER_QUESTION` so the stored action is what gets sent. `ASK_QUALIFICATION` included so qualify is not only the generic composer. |
| `src/services/nba/executeNextAction.ts` | Those actions already have handlers or fall through to grounded compose. Confirm each one sends, logs `NBA_EXECUTED`, and refuses when `isHumanOwned`, opted out, or `CUSTOMER`. `OFFER_SUBSCRIPTION` stays illegal unless intent is `PURCHASE_INTEREST` or `READY_TO_BUY`, **or** a buying signal of type `PURCHASE_INTENT` / `PRICING_QUESTION` is present. Score band `READY` alone must not select it as the default. |
| `src/services/nba/rules.ts` | Demo decision: `OFFER_DEMO` / handoff to booking stays the booking keyword path plus NBA. Default to nurture (`SHOW_VALUE` or `EDUCATE`) when stage is `NURTURING` and there is no demo intent and no purchase intent. Hot band may add `OFFER_DEMO` to the **legal** set. It must not be the default from score alone. |

### Demo and sales loops

| File | Change |
| --- | --- |
| `src/services/demo/postDemoAnalysis.ts` | Keep. It already returns the lead to `SALES` / `DEMO_COMPLETED` and calls `applyExtraction`. Ensure no-show does not set `CUSTOMER` and does not offer subscription from score alone. |
| `src/services/inngest/functions.ts` (`process-demo-booking`) | Include `meetingLink` in the customer email. If calendar is not configured, do not invent a link. |
| `src/services/calendar/googleCalendar.ts` | Keep the existing `CalendarError` when env is missing. Do not add fake slots. |
| `src/services/sales/salesAgent.ts` | Do not add a second composer. Qualification and “understand the business” stay `composeFirstMessage` / `composeAgentReply` plus the audit fact guard. |

### Admin

| File | Change |
| --- | --- |
| `src/app/api/admin/conversion/leads/[id]/route.ts` | Return `buyingSignals`, score band, and the existing profile/objection/NBA fields. |
| `src/app/admin/leads/[id]/page.tsx` | Show buying signals, interests (`businessProfile.interestedServices`), score band, and the latest `LeadEvent` of type `NBA_SELECTED` / `LEAD_SCORE_CHANGED` as “last analysis”. Do not redesign the page. |
| `src/app/admin/leads/page.tsx` | Show the band label next to `leadScore`. Keep sorting on `leadScore`. |

### Support

| File | Change |
| --- | --- |
| `src/services/support/supportAgent.ts` | Keep one in-house agent. Tag replies in the prompt/path as onboarding vs setup vs support using **existing** `PRODUCT_KNOWLEDGE` only. Do not add tools that mutate billing or GBP. |

## 2. Files to create

| File | Why it cannot live in an existing file |
| --- | --- |
| `src/services/leadIntelligence/formSignals.ts` | One function, `applyFormSignal(lead, signal)`, that adds a `ScoringRuleConfig` delta with the same idempotency key as chat scoring. Used by free-report and book-demo so those routes do not embed scoring. |
| `src/services/lifecycle/advanceQuietStage.ts` | Pure function: given follow-up config, `followUpsSent`, `lastLeadReplyAt` or `lastMeaningfulInteractionAt`, and `currentStage`, return the next stage or null. Called from the existing drip and from `nurture-scheduler-tick`. Not a new cron. |
| `tests/integration/lead-score-bands.test.ts` | New boundaries 25/50/75. Update `tests/integration/nba-rules.test.ts` in place rather than duplicating it. |
| `tests/integration/buying-signals-merge.test.ts` | Merge and “do not invent” rules. |
| `tests/integration/quiet-stage.test.ts` | 24h/72h progression using the pure function. |
| `tests/integration/payment-lead-stage.test.ts` | Failure does not set `CUSTOMER`. Success sets `PAYMENT_VERIFIED` then `CUSTOMER` only after the existing activation helpers. |

No new Inngest function. No new lead-create route. No new agent file.

## 3. Database changes

### Reuse, do not add

| Need | Existing field |
| --- | --- |
| Profile | `businessProfile` (`industry`, `businessType`, `goals`, `interestedServices`) plus `businessType`, `budget`, `notes`, `name`, `phone` |
| Interests | `businessProfile.interestedServices` and `businessProfile.goals` |
| Pain points | `painPoints` (merge) |
| Intent | `intent` |
| Score | `leadScore` |
| Objections | `objections[]` |
| History | `SalesConversation.messages`, `BookingConversation.messages` |
| Next action | `nextBestAction`, `nextActionAt` |
| Stage | `currentStage` |
| Ownership | `currentAgent`, `humanHandoff` |
| Last update | `lastMeaningfulInteractionAt` and `LeadEvent.createdAt` |
| Opt-out | `nurtureStatus` |
| Demo | `DemoBooking` |
| Payment | `Subscription`, `Business.subscriptionStatus`, Razorpay ids. Not copied onto `Lead`. |
| Trace | `LeadEvent` (`LEAD_SCORE_CHANGED`, `NBA_SELECTED`, `NBA_EXECUTED`, `HUMAN_HANDOFF`, `OPT_OUT`, `PAYMENT_SUCCESS`, `CUSTOMER_ACTIVATED`) |

### Add one field

`buyingSignals` on `Lead`:

```text
{ type: string, note?: string, detectedAt: Date }
```

`type` is restricted to signals the extractor is already allowed to emit, which match `DEFAULT_SCORING_RULES` names that are evidence of buying interest:

`PRICING_QUESTION`, `IMPLEMENTATION_QUESTION`, `DEMO_REQUESTED`, `DEMO_BOOKED`, `PURCHASE_INTENT`.

No free-text signal types. Empty array when the message does not support one. Merge by `type`: a repeat updates `detectedAt` and does not duplicate the row.

### Add one link field

`Lead.auditId` (ObjectId, optional).

Why `SalesConversation.auditId` is not enough: the report agent can finish an audit before a lead exists, and payment looks up the lead by phone, not by conversation. The lead is the sales identity. Set it from `fileFreeReportLead` / the audit job when the audit id is known. Do not require it for demo-only leads.

### Do not add

- `PAYMENT_PENDING` stage.
- A new score field.
- `conversationSummary` as a required store. The last `LeadEvent` plus the message tail is the analysis record. A summary string would duplicate `SalesConversation.messages`.
- `assigned` human id writes beyond the existing `humanHandoff.assignedUserId` (still unused). Setting it is optional and only if an admin route already has a user id. Do not build a rep-assignment product in this pass.
- Any index change unless a new query needs it. Phone + tenant index already exists.

### Migration

Mongoose will accept missing `buyingSignals` and `auditId` because they are optional with default `[]` / unset. **No backfill script.** Existing leads keep `leadScore` as stored. Bands are computed at read time, so old scores change band label only, not the stored number.

Do not run a migration that rewrites `currentStage`.

`ScoringRuleConfig` documents in the database override `DEFAULT_SCORING_RULES`. Code must keep reading that document. Do not overwrite it.

## 4. API changes

No new public routes.

| Route | Change |
| --- | --- |
| `POST /api/free-report/start` | Same contract. Extra side effect: idempotent `FREE_REPORT_SUBMITTED` score and `auditId` on the lead. |
| `POST /api/leads/book-demo` | Same contract. Extra side effect: idempotent `DEMO_REQUESTED` score delta if not already applied. Still no fake slot. |
| `POST /api/webhook/razorpay` | Same events. Failure path may set `CONVERSION_PENDING` on the platform lead. Success path orders `PAYMENT_VERIFIED` then `CUSTOMER`. |
| `GET /api/admin/conversion/leads/[id]` | Additive JSON fields: `buyingSignals`, `scoreBand`. |
| `POST /api/admin/leads/return-to-ai` | Unchanged. |

Authorization stays `requireSuperAdmin` for admin routes and the existing public rate limits for the two forms.

## 5. Agent changes

| Agent | Change |
| --- | --- |
| Sales (`salesAgent.ts` + `sales-agent-reply`) | Same prompts and fact guard. Reply path executes the larger NBA set. Demo-needed is an NBA outcome (`OFFER_DEMO` / existing `BOOKING_HANDOFF_RE`), not a new agent. |
| Booking (`bookingAgent.ts`) | Unchanged except the confirmation email includes `meetingLink` when `createDemoEvent` returned one. Missing calendar env still throws `CalendarError` and hands off. |
| Report | Before `sales/nurture.requested`, ensure a platform lead exists using the free-report upsert. Do not change report copy or audit evidence. |
| In-house (`supportAgent.ts`) | Same worker. Prompt sections already cover setup. Label the three jobs in the system prompt as onboarding (first messages after `CUSTOMER`), setup (GBP/connect questions), and support (everything else). No new model. |
| Lead intelligence | Not an agent. Extend `applyExtraction` only. |

Do not call `getSalesAgentConfig()` from a script that would insert a disabled default document.

## 6. Automation changes

| Job | Change |
| --- | --- |
| `sales-nurture-requested` / drip | Keep. After the final follow-up, call `advanceQuietStage`. Still skipped when `SalesAgentConfig.enabled` is false. |
| `nurture-scheduler-tick` | Also calls `advanceQuietStage` for platform leads in `NURTURING` or `UNRESPONSIVE` whose last meaningful interaction is older than the configured follow-up tail. Does not send a message by itself. |
| `proactive-nba-scheduler` | Unchanged gate: `LEAD_ENGINE_V2` + cohort. `REENGAGE` remains the action for `UNRESPONSIVE` / `LONG_TERM_NURTURE`, still subject to opt-out, human ownership, cooldown, and the sales-agent enabled flag before any send. |
| `follow-up-cron` | **Do not repair and do not delete.** It matches nothing because `lastInteractionTime` does not exist. |
| `booking-agent-reply`, `DEMO_REMINDER`, `NO_SHOW_CHECK` | Unchanged. |
| `billing-activation-reconcile-cron` | Same activation order as the webhook so a healed payment cannot skip `PAYMENT_VERIFIED` or mark `CUSTOMER` early. |
| New crons | None. |

Quiet progression, using only existing delays:

```text
NURTURING
  follow-ups sent (24h, then 72h) while SalesConversation stays active and onlyIfNoReply
  last follow-up sent AND no lead reply for another last-delayHours
    → UNRESPONSIVE
  another last-delayHours with no reply
    → LONG_TERM_NURTURE
```

If the stored `SalesAgentConfig.followUps` array differs from the defaults, use **that array’s last `delayHours`**, not a hardcoded 72.

A reply at any time returns the lead to `NURTURING` with `currentAgent: 'SALES'` unless they are human-owned, opted out, or `CUSTOMER`.

`LOST` is not set by the timer. It is set only when intent is `NOT_INTERESTED` or the score signal is `EXPLICIT_REJECTION`, through `setLeadOwnership(..., 'LOST')`, and nurture cancels. Do not infer loss from silence.

## 7. Migration requirements

None that rewrite documents.

Deploy order:

1. Code that reads `buyingSignals` as `[]` when missing.
2. Writers that set the new field and the previously unused stages.
3. Tests.
4. No flag flip in the same deploy.

Rollback is a code revert. New fields can remain on old documents; old code ignores them.

## 8. Tests

Extend existing tests first.

| Area | File | Cases |
| --- | --- | --- |
| Bands | Update `tests/integration/nba-rules.test.ts` | 0–25 cold, 26–50 warm, 51–75 hot, 76–100 ready. 25 cold, 26 warm, 50 warm, 51 hot, 75 hot, 76 ready. |
| Score does not sell | `nba-rules.test.ts` | `READY` band + intent `EXPLORING` + no buying signal → default is not `OFFER_SUBSCRIPTION`. `PURCHASE_INTEREST` still defaults to `OFFER_SUBSCRIPTION`. |
| Idempotent score | Existing `tests/integration/scoring-idempotency.test.ts` | `FREE_REPORT_SUBMITTED` twice does not add +10 twice. |
| Buying signals | New test | Unknown type dropped. Repeat type does not duplicate. Message with no evidence leaves the array unchanged. |
| Profile merge | New or same test | Second turn adds a goal and does not wipe `painPoints`. |
| Quiet stages | New pure test | Defaults 24 then 72. Custom last delay is honored. Human-owned and `OPTED_OUT` never advance. Reply resets to `NURTURING`. |
| Handoff | Existing `tests/integration/human-handoff-guard.test.ts` | Shadow sync does not clear human ownership. |
| NBA send set | `tests/integration/nba-executor.test.ts` | `SHOW_VALUE` and `EDUCATE` are executable. `OFFER_SUBSCRIPTION` skipped when the only input is a high score. |
| Payment | New test with mocked lead, no Razorpay network | Failed payment → not `CUSTOMER`. Success sequence → `PAYMENT_VERIFIED` then `CUSTOMER`. Workspace activation still invoked first. |
| Demo email | Unit around the email builder if one exists; otherwise a pure function extract | Link included only when `meetingLink` is non-empty. |
| Duplicates | Existing lead upsert behavior | Same phone + `gmbboost-internal` does not create a second lead. Do not hit a real database in unit tests; cover the pure dedupe key and the form-signal idempotency. |

Run: `npm run test:integration` for the touched files, then the full integration script if those pass.

Do not run a live WhatsApp, Razorpay, or calendar call.

## 9. Rollout

```text
1. Deploy code with flags unchanged.
2. Internal test lead: one platform phone already in a dev thread.
   Confirm score band, buying signal merge, and stage labels in /admin/leads.
3. Do not message a cohort. Proactive NBA stays at the current allowlist
   and rollout percentage (unread; schema default is 0).
4. Sales drip still requires SalesAgentConfig.enabled.
   Turning that on is an operator action, not part of this deploy.
5. Watch LeadEvent NBA_EXECUTED and NURTURE_ACTION_SKIPPED.
6. Only then consider a cohort percentage change, as a separate change.
```

Local env facts that this plan does **not** “fix” by writing secrets:

- `GOOGLE_CALENDAR_ID` and credentials are absent here. Booking code must keep failing closed.
- `TWILIO_TEMPLATE_PAYMENT_RECEIVED` is absent. `sendPaymentReceivedMessage` already skips. Do not invent a template SID.
- `LEAD_ENGINE_V2=true` locally. That must not be treated as “nurture everyone.”
- This workspace points at `growwmatics_dev`, Razorpay test, `localhost`. Production env is still unverified.

## 10. Rollback

- Revert the commit. Optional fields do not break the previous process.
- If a stage writer mis-labels leads, the previous code still reads `currentStage` and will not crash. Restoring a lead is `setLeadOwnership` back to `NURTURING` / `SALES` through the existing return-to-AI or a one-off admin action. No bulk script in this plan.
- If NBA starts sending `SHOW_VALUE` on replies and the copy is wrong, remove those actions from `NBA_OWNS_REPLY` (the previous fall-through to `composeAgentReply`).
- Do not roll back by deleting `Lead` documents or by disabling Razorpay.

## 11. What this plan deliberately does not do

- Redesign `/free-report` or the audit evidence model.
- Mix `Client Prospect` leads into this lifecycle.
- Rebuild WhatsApp, opt-out, 24-hour/template rules, or `QA_SUPPRESS_WHATSAPP_SENDS`.
- Remove human handoff or make return-to-AI automatic.
- Build a second customer-success agent, onboarding checklist, or GBP setup tool. The in-house prompt covers inbound onboarding, setup questions, and support. Proactive success plays stay out of scope (`NEW` in the gap map).
- Generate a local invoice PDF. Keep Razorpay’s invoice list and the existing WhatsApp template.
- Mark a payer `CUSTOMER` when no platform lead and no shadow user phone can be resolved. Workspace activation still runs. Stronger link: `Lead.auditId` → `Audit.businessId` → `Business.userId` → `User.phone`, tried **before** the raw phone match, inside `resolveLeadForPayment`. If that chain hits the same lead, use it. If it hits a different person, keep the phone match and do not guess. Do not create a lead inside the webhook.
- Turn on the sales agent, the booking agent, or the cohort.

## 12. Implementation order (after this plan is accepted)

1. Schema field `buyingSignals` + `auditId` (optional, default safe).
2. `applyExtraction` merge for profile, interests, buying signals.
3. `computeScoreBand` 25/50/75 and NBA rules so score cannot be the only reason to offer a subscription. Update band tests.
4. `applyFormSignal` from free-report and book-demo.
5. Report-agent path calls the existing lead upsert.
6. `NBA_OWNS_REPLY` includes educate, answer, show value, share use case, ask qualification.
7. `advanceQuietStage` from the existing drip / scheduler.
8. Opt-out writes `DO_NOT_CONTACT`. Rejection writes `LOST`. Shadow sync respects human ownership.
9. Payment: `CONVERSION_PENDING` on failure, `PAYMENT_VERIFIED` then `CUSTOMER` on success, audit-id lookup before phone.
10. Demo email includes the real Meet link only.
11. Admin detail shows the new fields.
12. In-house prompt labels only.
13. Tests and `npm run test:integration`.
14. `docs/LEAD_SALES_IMPLEMENTATION_REPORT.md` after that, including what stayed disabled.

## 13. Behavior the runtime should have when the plan is implemented

Flags still decide whether a stranger is messaged. With the sales agent **off**, free report still creates the lead, the audit, and the intelligence seed (`FREE_REPORT_SUBMITTED`), and does not open a sales chat. With the sales agent **on**, the existing consent and drip run, replies update intelligence, the stored next action is executed, silence follows the 24h/72h config into `UNRESPONSIVE` then `LONG_TERM_NURTURE`, a demo still uses the booking agent, and a verified payment still activates the workspace and then the lead.

That is the diagram, using the code that already exists.

---

Coding starts only after this plan is accepted. Step 1 of the requested order is this document.
