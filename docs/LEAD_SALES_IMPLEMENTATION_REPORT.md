# Lead / Sales Implementation Report

**Date:** 2026-10-03  
**Plan:** `docs/LEAD_SALES_IMPLEMENTATION_PLAN.md` (approved clarifications applied)  
**Scope:** Connect Platform Lead → intelligence → NBA → silence stages → payment → admin. No production activation.

---

## What was changed

| Area | Change |
| --- | --- |
| Lead schema | Optional `buyingSignals[]` and `auditId` |
| Free Report submit | Immediate platform Lead upsert + `FREE_REPORT_SUBMITTED` + link `auditId` when audit known |
| Book demo | Idempotent `DEMO_REQUESTED` form signal |
| Shared entry | `platformProspectEntry.ts` for free-report + nurture/report paths |
| Extraction | Merge buying signals, business profile, interests; LOST on rejection |
| Score bands | Cold/Warm/Hot/Ready at 25 / 50 / 75 |
| Subscription offer | `subscriptionOfferAllowed` — score alone never selects `OFFER_SUBSCRIPTION` |
| NBA reply path | `NBA_OWNS_REPLY` includes EDUCATE, SHOW_VALUE, SHARE_USE_CASE, ANSWER_QUESTION, ASK_QUALIFICATION |
| Quiet stages | `advanceQuietStage` after drip + nurture-scheduler-tick |
| Opt-out | Writes `nurtureStatus: OPTED_OUT` **and** `currentStage: DO_NOT_CONTACT` |
| Shadow sync | Skips when HUMAN / handoff / CUSTOMER / DO_NOT_CONTACT |
| Payment success | `PAYMENT_VERIFIED` → invoice/welcome → `CUSTOMER` / `IN_HOUSE` |
| Payment failure | Platform lead → `CONVERSION_PENDING` (not CUSTOMER) |
| Lead resolve | Prefer `auditId` chain when it matches phone lead |
| Demo email | Real Meet link only when `meetingLink` present |
| Admin | Buying signals, score band, interests, last analysis events |
| In-house agent | Onboarding / Setup / Support job labels in prompt |

---

## What existing code was reused

- Platform Lead (`tenantId: gmbboost-internal`, `leadType: Platform Prospect`) — no second lead system
- `setLeadOwnership`, `optOutLead`, LeadEvent timeline
- `ScoringRuleConfig` / `DEFAULT_SCORING_RULES` + `scoredSignalKeys` idempotency
- Sales agent, booking agent, report agent, support agent (not rebuilt)
- NBA `decideNextAction` / `executeNextAction` / rule table
- Sales nurture drip + nurture-scheduler-tick + proactive NBA scheduler
- Razorpay webhook + `activatePlan` / `activateBusinessPlan` (entitlements unchanged order)
- Free Report shadow account + audit dispatch (UI/evidence untouched)
- Google Calendar `CalendarError` fail-closed (no invented slots/links)

---

## Database changes

- **Added (optional):** `Lead.buyingSignals` (default `[]`), `Lead.auditId` (ObjectId, indexed)
- **No migration / no backfill**
- **No rewrite** of existing `currentStage` or scores
- `ScoringRuleConfig` documents in DB left alone (code still reads them)

---

## Lifecycle changes

| Event | Stage / ownership |
| --- | --- |
| Free Report submit | Upsert Lead → SALES / NURTURING (if not already further) |
| Book demo | DEMO / DEMO_REQUESTED |
| Opt-out (STOP) | OPTED_OUT + DO_NOT_CONTACT |
| Explicit rejection / NOT_INTERESTED | LOST |
| Silence after drip + last delay | UNRESPONSIVE |
| Further silence | LONG_TERM_NURTURE |
| Payment failed / halted | CONVERSION_PENDING (if not already customer) |
| Payment success | PAYMENT_VERIFIED then CUSTOMER + IN_HOUSE |
| Human handoff | Unchanged; shadow sync no longer overwrites HUMAN |

Silence never sets LOST. Cold/Warm/Hot/Ready are **score bands only**, not stages.

---

## Score changes

- Bands: **0–25 COLD**, **26–50 WARM**, **51–75 HOT**, **76–100 READY**
- Form signals: `FREE_REPORT_SUBMITTED` (+10 default), `DEMO_REQUESTED` (existing delta), idempotent per `scoredSignalKeys`
- Funnel “qualified” floor aligned to warm band (≥26)
- **Invariant:** `leadScore` is temperature. Score alone never causes `OFFER_SUBSCRIPTION`

---

## Buying-signal behavior

- Allowed types only: `PRICING_QUESTION`, `IMPLEMENTATION_QUESTION`, `DEMO_REQUESTED`, `DEMO_BOOKED`, `PURCHASE_INTENT`
- Unknown types dropped; repeat type updates `detectedAt` / note; empty message evidence leaves array unchanged
- Profile goals / interested services merge (append, no wipe)
- Subscription offer may use pricing/purchase/implementation signals **with** intent/stage context

---

## NBA changes

- Decide + execute guard via `subscriptionOfferAllowed`
- READY + EXPLORING + no buying signal → default nurture (`SHOW_VALUE`), not subscription
- Reply executor owns educate / value / use-case / answer / qualify when stored as `nextBestAction`
- Stuck-hot handoff still requires follow-up threshold (unchanged)

---

## Nurture behavior

- Still gated by `SalesAgentConfig.enabled` (not flipped)
- Proactive NBA still gated by `LEAD_ENGINE_V2` + cohort (cohort not raised)
- If nurture runs and no platform lead exists, upsert via shared entry (no FREE_REPORT signal on that path)
- Quiet progression uses config’s **last** `delayHours` (default 72), not a hardcoded constant when admin changes config

---

## Payment / customer behavior

- Workspace activation still runs first (unchanged)
- Lead: `PAYMENT_VERIFIED` → messages → `CUSTOMER` / `IN_HOUSE`
- Failure: `CONVERSION_PENDING` only; intelligence not cleared
- No invented WhatsApp payment template SID; existing skip when template missing
- No Lead created inside the webhook

---

## Tests passed

Command:

```bash
node --experimental-strip-types --test \
  tests/integration/nba-rules.test.ts \
  tests/integration/quiet-stage.test.ts \
  tests/integration/lead-score-bands.test.ts \
  tests/integration/buying-signals-merge.test.ts \
  tests/integration/payment-lead-stage.test.ts \
  tests/integration/demo-confirmation-email.test.ts \
  tests/integration/nba-executor.test.ts \
  tests/integration/scoring-idempotency.test.ts \
  tests/integration/human-handoff-guard.test.ts
```

**Result: 64 passed, 0 failed**

`package.json` `test:integration` updated to include `--experimental-strip-types` so TypeScript test imports load under Node 20+.

---

## Flags still disabled / untouched

| Flag / config | Status |
| --- | --- |
| `SalesAgentConfig.enabled` | Not flipped (default remains off unless already set in DB) |
| Booking agent enable | Not flipped |
| Proactive cohort / `rolloutPercentage` | Not increased |
| Calendar credentials | Not invented |
| `TWILIO_TEMPLATE_PAYMENT_RECEIVED` | Not invented |
| Production deploy / activation | Not performed |

Local `LEAD_ENGINE_V2=true` was left as-is; it was not treated as “message everyone.”

---

## Remaining limitations

1. Live WhatsApp / Razorpay / Calendar end-to-end not exercised in this pass.
2. Production env (calendar, payment-received template, sales-agent flag) still operator-owned.
3. `follow-up-cron` still matches nothing (`lastInteractionTime`) — intentionally not repaired.
4. In-house agent labels are prompt-only; no proactive customer-success plays.
5. Client Prospect / customer CRM lifecycle intentionally separate and untouched.
6. Free Report UI and audit evidence model untouched.
7. Turning on the sales drip or raising cohort is a **separate operator action**, not part of this deliverable.

---

## Clarifications honored

1. Both `buyingSignals` and `auditId` on Lead.  
2. Free Report creates/upserts Platform Lead **at submit**, then signal, then async audit/`auditId`.  
3. Score alone never causes `OFFER_SUBSCRIPTION`.
