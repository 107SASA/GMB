# Production Lead Lifecycle Audit

**Date:** 2026-10-03  
**Database:** `growwmatics_prod` (read from the production host)  
**Population:** `tenantId = gmbboost-internal` only  
**Mode:** Read-only aggregates. No PII, payment ids, or message text. No writes, sends, nurture, payments, calendar events, or deploys.

---

## Platform Lead Population

| Item | Count |
| --- | --- |
| Platform Prospect leads | **7** |
| `leadType = Platform Prospect` | 7 / 7 |

---

## Lead Sources

| Stored `source` | Count |
| --- | --- |
| Website | 6 |
| Demo Booking | 1 |

Notes were classified on the server and not printed:

| Creation path | Count |
| --- | --- |
| Free Report wording in notes | 6 |
| Demo wording in notes | 1 |
| Unclassified | 0 |

`LEAD_CREATED` events whose channel is `free-report`: **5**.  
One Website / Free Report lead has no `LEAD_CREATED` event. The Demo Booking lead is the other lead without that channel.

---

## Lifecycle Stages

Stored `currentStage`:

| Stage | Count |
| --- | --- |
| NURTURING | 3 |
| NEW | 2 |
| CUSTOMER | 2 |
| PAYMENT_VERIFIED | 0 |
| CONVERSION_PENDING | 0 |
| DEMO_REQUESTED / DEMO_SCHEDULED / DEMO_COMPLETED | 0 |
| UNRESPONSIVE | 0 |
| LONG_TERM_NURTURE | 0 |
| LOST | 0 |
| DO_NOT_CONTACT | 0 |
| HUMAN_HANDOFF | 0 |

---

## Agent Ownership

Stored `currentAgent`:

| Agent | Count |
| --- | --- |
| NONE | 4 |
| SALES | 3 |
| DEMO | 0 |
| IN_HOUSE | 0 |
| HUMAN | 0 |

Both `CUSTOMER` leads are currently `currentAgent = NONE`.

`AGENT_HANDOFF` events for these phones/ids (targets only):

| `payload.to` | Events |
| --- | --- |
| SALES | 5 |
| NONE | 5 |
| IN_HOUSE | 2 |

| `payload.stageTo` | Events |
| --- | --- |
| NURTURING | 5 |
| CUSTOMER | 2 |
| (no stage change) | 5 |

The five `NONE` handoffs use reason `platform_inbound_shadow_sync` and do not set a new stage. That is what left the two customer leads on stage `CUSTOMER` with agent `NONE` after they had been set to `IN_HOUSE`.

---

## Intelligence Fields

| Field | Populated |
| --- | --- |
| `leadScore` stored as a number | 7 / 7 |
| `leadScore` greater than 0 | 0 / 7 |
| `intent` | 7 / 7 |
| `painPoints` | 0 / 7 |
| `objections` | 0 / 7 |
| `buyingSignals` | 0 / 7 |
| `auditId` | 0 / 7 |
| `nextBestAction` | 0 / 7 |
| `businessProfile` | 0 / 7 |
| `businessId` on the lead | 0 / 7 |
| `aiLeadScore` (seed field, not the decision score) | 3 / 7 |

`intent` is `EXPLORING` on all 7. There is no `INTENT_CHANGED` event for these leads.

WhatsApp history is not stored on the lead row. It exists on conversation documents (next section): **3 / 7** have a sales conversation, **1 / 7** has a report conversation, **0 / 7** have a booking conversation.

---

## Score Distribution

`leadScore` is present and **exactly 0** on every platform lead. None are missing the field.

| Band | Count |
| --- | --- |
| 0–25 | 7 |
| 26–50 | 0 |
| 51–75 | 0 |
| 76–100 | 0 |
| No numeric score | 0 |

---

## Buying Signals

`0/7 populated`

No signal types are stored.

---

## Next Best Action

`0/7 populated`

No `nextBestAction` value is stored. `nextActionAt` is also missing on 7 / 7. There are no `NBA_SELECTED` or `NBA_EXECUTED` events for these leads.

---

## WhatsApp / Sales Interaction

Matched by phone on the server. Phones were not printed.

| Interaction | Leads / docs |
| --- | --- |
| Sales WhatsApp conversation | 3 conversation docs, 3 distinct leads |
| Sales inbound reply | **0** leads (0 inbound messages) |
| Sales outbound message | **2** leads (3 outbound messages) |
| Sales conversation status | 1 `active`, 2 `completed` |
| Sales-agent `MESSAGE_SENT` lead event | 1 |
| `NURTURE_ACTION_SCHEDULED` | 1 event |
| Booking conversation | 0 |
| DemoBooking rows | 0 |
| Report conversation | 1 (`awaiting_connection`; 1 inbound, 1 outbound) |
| Human handoff event | 0 |
| `humanHandoff.active` | 0 |

No booking-agent interaction is stored for these 7 leads.

---

## Customer Conversion

**2** platform leads are `currentStage = CUSTOMER`. Both are `currentAgent = NONE`.

| Evidence | Count |
| --- | --- |
| `CUSTOMER_ACTIVATED` events | 2 |
| `AGENT_HANDOFF` to `IN_HOUSE` + stage `CUSTOMER` + reason `payment-verified` | 2 |
| `PAYMENT_SUCCESS` events | 0 |
| `PAYMENT_VERIFIED` stage | 0 |
| Lead `businessId` set | 0 / 2 |
| Users matched by that phone | 2 / 2 |
| Businesses for those users | 3, all `subscriptionStatus = active` |
| User plan label | `Pro` on 2 / 2 users |
| Subscription documents | 2, both `active` |
| Subscription documents with a Razorpay reference field | 2 / 2 |

Lifecycle reading, without identifiers:

1. Payment activation code ran. It set agent `IN_HOUSE` and stage `CUSTOMER` with reason `payment-verified`, then wrote `CUSTOMER_ACTIVATED`.
2. There is no `PAYMENT_VERIFIED` stage and no `PAYMENT_SUCCESS` event, so these rows did not pass through the newer two-step stage (`PAYMENT_VERIFIED`, then `CUSTOMER`).
3. A later `platform_inbound_shadow_sync` handoff set `currentAgent` to `NONE` and did not change the stage. That is why they are still `CUSTOMER` but not `IN_HOUSE`.
4. The lead row itself has no `businessId`. The workspace link is the user phone: 2 users, 3 active businesses, 2 active subscriptions that each have a Razorpay reference. Workspace activation exists. It is not copied onto the lead.

One of the customer-phone timelines also has an `OPT_OUT` event. That is included in the customer event set; it is not a second conversion.

---

## In-House / Human Handoff

| Check | Result |
| --- | --- |
| `currentAgent = IN_HOUSE` now | **0** |
| Historical handoff to `IN_HOUSE` / stage `CUSTOMER` | **2** events (`payment-verified`) |
| `HUMAN_HANDOFF` events | **0** |
| `humanHandoff.active` | **0** |
| `currentStage = HUMAN_HANDOFF` | **0** |

The running activation path can set `IN_HOUSE`. Production evidence shows it did, then shadow sync cleared the agent back to `NONE`. Human handoff has no records for these leads.

Code in this workspace supports `IN_HOUSE` on verified payment and supports skipping shadow sync while the lead is `CUSTOMER` or `IN_HOUSE`. The production event history shows the older shadow-sync behavior still occurred for these two leads. This audit did not change that code or those rows.

---

## Follow-Up State

Actual stored values only.

| State | Count |
| --- | --- |
| `nurtureStatus = ACTIVE` | 6 |
| `nurtureStatus = OPTED_OUT` | 1 |
| `nurtureStatus = PAUSED` or `STOPPED` | 0 |
| `nextActionAt` in the future (follow-up due) | 0 |
| `nextActionAt` in the past | 0 |
| `nextActionAt` missing | 7 |
| Pending `ScheduledAction` rows | 0 |
| `currentStage = HUMAN_HANDOFF` or handoff active | 0 |
| `currentStage = LOST` | 0 |
| `currentStage = UNRESPONSIVE` | 0 |
| `currentStage = LONG_TERM_NURTURE` | 0 |
| `currentStage = DO_NOT_CONTACT` | 0 |

The opted-out lead is `OPTED_OUT` on nurture status only. It was not moved to `DO_NOT_CONTACT`. There is 1 `OPT_OUT` event.

There is no stored “waiting for customer” status. Sales threads show 0 inbound replies, which is the closest evidence, and it is not a lead-stage value.

---

## Architecture Reality Check

Compared with the intended path, using production records for these 7 leads.

| Step | Status |
| --- | --- |
| Free Report / Demo → Lead | **IMPLEMENTED + DATA PRESENT** — 6 Free Report notes, 1 Demo Booking source |
| Intent | **IMPLEMENTED + DATA PRESENT** — 7 / 7, all `EXPLORING`; no later intent updates |
| Pain points | **IMPLEMENTED BUT DATA NOT PRESENT** — 0 / 7 |
| Buying signals | **IMPLEMENTED BUT DATA NOT PRESENT** — 0 / 7 |
| Score (above the zero default) | **IMPLEMENTED BUT DATA NOT PRESENT** — 7 / 7 are exactly 0 |
| Next best action | **IMPLEMENTED BUT DATA NOT PRESENT** — 0 / 7 |
| Sales | **IMPLEMENTED + DATA PRESENT** — 3 sales threads, outbound on 2, no inbound replies |
| Booking | **IMPLEMENTED BUT DATA NOT PRESENT** — 0 booking threads, 0 demo rows |
| Payment | **IMPLEMENTED + DATA PRESENT** for 2 leads — active subscriptions with Razorpay references; no `PAYMENT_VERIFIED` stage |
| Customer | **IMPLEMENTED + DATA PRESENT** — 2 leads at `CUSTOMER`, then agent overwritten to `NONE` |

`auditId` linkage is **IMPLEMENTED BUT DATA NOT PRESENT** (0 / 7).

---

## Findings

1. These 7 leads were created as platform prospects, mostly from Free Report (`Website`) plus one Demo Booking. They were not created by this audit.
2. Intelligence never moved past the default: intent `EXPLORING`, score 0, no pain points, objections, buying signals, audit link, profile, or next action.
3. Sales WhatsApp exists for 3 leads and sent outbound text for 2. Nobody has replied on a sales thread. Booking was never started for this set.
4. Two leads became `CUSTOMER` through the payment activation handoff (`payment-verified` → `IN_HOUSE` / `CUSTOMER` + `CUSTOMER_ACTIVATED`). Their users have active Pro workspaces and Razorpay-backed subscriptions. The lead document does not store `businessId`.
5. Shadow sync later set those agents to `NONE` without changing `CUSTOMER`. In-house ownership did not stick.
6. One lead is `OPTED_OUT` and is not `DO_NOT_CONTACT`. Nothing is scheduled. Nothing is unresponsive, lost, or in long-term nurture.
7. Proactive cohort and agent flags were not changed. Rollout was not read again in this pass; the prior production check found rollout 0.

---

## Conclusion

Production has real platform leads and two real customer conversions, but the lead records are still the early record: source, stage, a default intent, and a zero score. The newer intelligence fields are empty. Sales outreach started for a minority and received no replies. Booking did not start. Payment activation did run for two people and marked them `CUSTOMER`, then inbound shadow sync removed `IN_HOUSE` and left the stage in place.

No data was modified.
