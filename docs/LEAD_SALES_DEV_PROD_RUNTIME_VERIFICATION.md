# Lead / Sales Development vs Production Runtime Verification

**Date:** 2026-10-03  
**Mode:** Read-only. No code changes, no database writes, no flag changes, no deploy, no WhatsApp, no nurture jobs, no payments, no test leads.

**Queries used:** `listDatabases`, `countDocuments`, `findOne`, `aggregate` only. No `update` / `insert` / `delete` / `save` / `create`.

---

## 1. Executive Summary

Development MongoDB (`growwmatics_dev`) **connected** and was read. Production MongoDB **was not connected**: this workspace has no production connection string (`.env.production` is absent). Production runtime flags are **DATABASE UNAVAILABLE** and are not inferred from code or from Development.

On Development, the stored Sales Agent document has **`enabled: false`**. Booking Agent, Report Agent, and Orchestration config **documents do not exist** (collections are empty), so those enabled/rollout values are **not stored** — they are not reported as false by assumption.

Local app env that points at Development has `LEAD_ENGINE_V2=true`, WhatsApp/Twilio present, Google Calendar **ABSENT**, payment-received template **ABSENT**. Eight platform leads exist; none have `leadScore > 0`, `buyingSignals`, or `auditId`.

---

## 2. Development Environment

### MongoDB Connection

| Item | Value |
| --- | --- |
| Status | **VERIFIED** — connected (~2s) |
| Environment | Development |
| Expected consumer | Local `npm run dev` (`.env` and `.env.local`) |
| Atlas user role name | `gm_dev_app` |
| Database | `growwmatics_dev` |
| Cluster host prefix | `ac-evus3g8` (3 shard hosts, `*.mongodb.net`) |
| Other databases on this cluster | `admin`, `local` only — **`growwmatics_prod` is not on this cluster** |
| Protocol | Standard seed-list `mongodb://` (not SRV) |

`.env` and `.env.local` both point at this same development database. Passwords and full URIs are omitted.

### Runtime Flags

Stored Mongo documents (not code defaults):

```text
DEVELOPMENT

Sales Agent:
  document exists = yes (key: default)
  enabled = false
  firstMessage.delayMinutes = 2
  followUps = 2 steps, delayHours 24 then 72, onlyIfNoReply true on both
  rollout field on this document = not present

Booking Agent:
  collection bookingagentconfigs exists
  documents = 0
  enabled = NOT STORED (no document)

Report Agent:
  collection reportagentconfigs exists
  documents = 0
  enabled = NOT STORED (no document)
```

### Orchestration

```text
Orchestration:
  collection orchestrationconfigs exists
  documents = 0
  rolloutPercentage = NOT STORED
  leadIdAllowlist = NOT STORED
  cooldownHours = NOT STORED
  stuckLeadScoreThreshold = NOT STORED
  stuckNurtureCyclesThreshold = NOT STORED
```

`LEAD_ENGINE_V2` is **not a Mongo field**. Local env files that use this database set:

```text
LEAD_ENGINE_V2 = true
```

With no orchestration document, cohort membership cannot be read from Mongo. Code would fall back to defaults only at runtime; that fallback is **not** treated here as a stored value.

### Lead Data

Platform filter: `tenantId = gmbboost-internal`. All 8 leads are `leadType = Platform Prospect`. No PII is included.

```text
Total platform leads: 8

Lifecycle stages (currentStage):
  NEW: 5
  NURTURING: 2
  CUSTOMER: 1
  HUMAN_HANDOFF: 0
  DO_NOT_CONTACT: 0
  CONVERSION_PENDING: 0
  PAYMENT_VERIFIED: 0
  LOST: 0

Score bands (computed from stored leadScore, not a stored stage):
  COLD (0–25): 8
  WARM: 0
  HOT: 0
  READY: 0

currentAgent:
  NONE: 5
  SALES: 2
  IN_HOUSE: 1

Fields populated (count / percent of 8):
  currentStage: 8 (100%)
  currentAgent: 8 (100%)
  intent: 8 (100%)
  leadScore > 0: 0 (0%)
  buyingSignals (non-empty): 0 (0%)
  auditId: 0 (0%)
  painPoints (non-empty): 0 (0%)
  objections (non-empty): 0 (0%)
  nextBestAction: 0 (0%)
  businessProfile (any industry/type/goals/services): 0 (0%)
  scoredSignalKeys non-empty: 0 (0%)
  businessId set: 0 (0%)
```

Client Prospect leads in this database: **0**.

### WhatsApp

From Development env files (`.env` / `.env.local`) — presence only:

| Item | Development |
| --- | --- |
| Provider | `twilio` |
| Twilio account SID / auth / WhatsApp number | PRESENT |
| Sales intro template | PRESENT |
| Report-ready template | PRESENT |
| Invoice template | PRESENT |
| Welcome template | PRESENT |
| Payment-received template | **ABSENT** |
| `QA_SUPPRESS_WHATSAPP_SENDS` | `false` |
| Opt-out handling | PRESENT in application code (not re-executed) |

No message was sent.

### Calendar

| Item | Development |
| --- | --- |
| `GOOGLE_CALENDAR_ID` | **ABSENT** |
| `GOOGLE_CALENDAR_CREDENTIALS_JSON` | **ABSENT** |

**Development calendar: ABSENT**

### Payment

| Item | Development |
| --- | --- |
| `RAZORPAY_KEY_ID` | PRESENT, **test** prefix (`rzp_test`) |
| `RAZORPAY_WEBHOOK_SECRET` | PRESENT |
| Platform leads in `PAYMENT_VERIFIED` | 0 |
| Platform leads in `CONVERSION_PENDING` | 0 |
| Platform leads in `CUSTOMER` | 1 (stage only; payment event not replayed) |

No payment or webhook was triggered.

---

## 3. Production Environment

### MongoDB Connection

| Item | Value |
| --- | --- |
| Status | **DATABASE UNAVAILABLE** |
| Expected file | `.env.production` (documented in `documentation/deployment/atlas-migration-runbook.md` as `growwmatics_prod` / user `gm_prod_app` / cluster planned name `prod-0`) |
| File on disk | **Absent** (repo root and a Desktop search found only `.env.production.example`) |
| URI in `.env` or `.env.local` | No — both are Development |
| Connection attempt | **Not made** — there is no production credential in this workspace to use |
| Error | None (no socket opened). Reason: **production connection string not configured locally** |

Documented identifiers (runbook only, **not verified by a live connection**):

```text
Environment: Production
Atlas Project/Cluster: Production / prod-0 (documented name; not reached)
Database: growwmatics_prod (documented; not reached)
```

### Runtime Flags

```text
PRODUCTION

Sales Agent enabled = DATABASE UNAVAILABLE
Booking Agent enabled = DATABASE UNAVAILABLE
Report Agent enabled = DATABASE UNAVAILABLE
```

Not copied from Development. Not copied from code defaults.

### Orchestration

```text
rolloutPercentage = DATABASE UNAVAILABLE
leadIdAllowlist = DATABASE UNAVAILABLE
cooldownHours = DATABASE UNAVAILABLE
stuck-hot thresholds = DATABASE UNAVAILABLE
LEAD_ENGINE_V2 on the production host = UNKNOWN
```

### Lead Data

**DATABASE UNAVAILABLE.** No production lead counts.

### WhatsApp

Production host environment was not readable.

| Item | Production |
| --- | --- |
| Provider | **UNKNOWN** |
| Twilio | **UNKNOWN** |
| Sales intro / report-ready / invoice / welcome templates | **UNKNOWN** |
| Payment-received template | **UNKNOWN** |
| Opt-out code | Same application source as Development (code present); production process config **UNKNOWN** |

### Calendar

**Production: UNKNOWN** (no production env file). Not assumed ABSENT.

### Payment

**UNKNOWN** whether production Razorpay keys are test or live. Not inspected.

---

## 4. Development vs Production Comparison

| Configuration | Development | Production |
| --- | --- | --- |
| MongoDB reachable | VERIFIED | DATABASE UNAVAILABLE |
| Database | `growwmatics_dev` | Documented `growwmatics_prod` — not connected |
| Sales Agent | VERIFIED `enabled=false` | DATABASE UNAVAILABLE |
| Booking Agent | Document **ABSENT** (0 rows) | DATABASE UNAVAILABLE |
| Report Agent | Document **ABSENT** (0 rows) | DATABASE UNAVAILABLE |
| LEAD_ENGINE_V2 | VERIFIED `true` in local env | UNKNOWN (host env) |
| Nurture rollout | NOT STORED (0 orchestration docs) | DATABASE UNAVAILABLE |
| Nurture allowlist | NOT STORED | DATABASE UNAVAILABLE |
| Calendar | ABSENT | UNKNOWN |
| WhatsApp | PRESENT (Twilio + several templates) | UNKNOWN |
| Payment template | ABSENT | UNKNOWN |
| Platform leads | VERIFIED 8 | DATABASE UNAVAILABLE |
| Customer CRM leads | VERIFIED 0 Client Prospect | DATABASE UNAVAILABLE |

---

## 5. Platform vs Customer CRM Isolation

**Development (verified):**

| Population | Count |
| --- | --- |
| `tenantId=gmbboost-internal` and `leadType=Platform Prospect` | 8 |
| `leadType=Client Prospect` | 0 |
| Platform tenant AND Client Prospect (overlap) | 0 |
| Leads with `tenantId` other than `gmbboost-internal` | 0 |

No mixed population in this database. Application lookups for sales/nurture remain scoped to `gmbboost-internal` in code (prior implementation verification). Production data isolation: **DATABASE UNAVAILABLE**.

---

## 6. Free Report → Lead Verification

**Code (both environments share this source):** `POST /api/free-report/start` upserts a platform lead immediately, applies `FREE_REPORT_SUBMITTED`, then links `auditId` when the audit id exists. Nurture remains flag-gated. No Free Report was submitted in this audit.

**Development database:** the path is **not reflected in stored lead fields yet**:

| Signal of the new path | Stored rows |
| --- | --- |
| `auditId` set | 0 / 8 |
| `buyingSignals` non-empty | 0 / 8 |
| `leadScore > 0` | 0 / 8 |
| `scoredSignalKeys` non-empty (includes form signals) | 0 / 8 |

Existing leads predate or have not been through a post-implementation Free Report submit. Code connection: **present**. Database evidence that a submit has run since implementation: **none**.

Production: **DATABASE UNAVAILABLE**.

---

## 7. Payment → Customer Verification

**Code:** Razorpay webhook activates the workspace first, then `PAYMENT_VERIFIED` → invoice/welcome → `CUSTOMER` / `IN_HOUSE`. Failure sets `CONVERSION_PENDING`, not `CUSTOMER`. Lead resolution prefers audit link when it matches the phone lead. No lead is created in the webhook. No payment was made.

**Development config:** Razorpay test key PRESENT; webhook secret PRESENT; payment-received WhatsApp template ABSENT.

**Development data:** 1 platform lead is already `CUSTOMER` / `IN_HOUSE`. Zero leads are currently `PAYMENT_VERIFIED` or `CONVERSION_PENDING`. This audit did not open that lead or infer how it became CUSTOMER.

Production payment config and lead stages: **UNKNOWN / DATABASE UNAVAILABLE**.

---

## 8. Runtime Activation Status

### DEVELOPMENT

| Piece | Status |
| --- | --- |
| Database readable | Ready |
| Sales nurture sends | **Not active** — stored `enabled=false` |
| Booking agent config | **Not stored** — no singleton document |
| Report agent config | **Not stored** — no singleton document |
| Proactive cohort | **Not stored** — no orchestration document; env `LEAD_ENGINE_V2=true` alone does not prove a cohort |
| Calendar booking | **Not configured** |
| WhatsApp transport | Configured locally; not exercised |
| New lead fields on existing leads | Empty |

### PRODUCTION

| Piece | Status |
| --- | --- |
| Database readable from this machine | **Not available** — no production URI in the workspace |
| Agent flags / cohort / lead counts | **Not verified** |
| Do not assume disabled | **Correct — unknown** |

---

## 9. Production Safety Findings

- Production was not queried because no production credential exists here. Nothing was written on Development either.
- Development user `gm_dev_app` can see only `growwmatics_dev` on cluster `ac-evus3g8`. It cannot see `growwmatics_prod`.
- Sales agent on Development is stored **disabled**, so this read did not find an enabled nurture switch on the database that was reached.
- One Development platform lead is already `CUSTOMER`. Treat that row as real dev data; it was not modified.

---

## 10. Remaining Configuration Requirements

1. **Production URI** must be available to a future read-only check (secure local `.env.production` or equivalent). It is not in this repo today. Do not commit it.
2. **Production Atlas network access** for whatever host runs that check (this Development connection now succeeds; production was not attempted).
3. Development Booking / Report / Orchestration singletons are **missing documents**. Until an operator creates them deliberately, those enabled/rollout values are unset in Mongo.
4. Google Calendar env is absent on the Development env files.
5. `TWILIO_TEMPLATE_PAYMENT_RECEIVED` is absent on the Development env files.
6. Do not turn on Sales Agent until a separate activation decision. This audit does not enable it.

---

## 11. Final Recommendation

Nothing was activated.

### DEVELOPMENT

Database is reachable. Sales Agent is **verified disabled**. Booking, Report, and nurture cohort **have no stored documents**. Calendar is **absent**. WhatsApp credentials and most templates are **present**; payment-received template is **absent**. Platform and customer CRM populations are **not mixed** (8 platform leads, 0 client prospects). New intelligence fields are **not populated** on those 8 leads.

### PRODUCTION

**DATABASE UNAVAILABLE** from this workspace. Flags, cohort, leads, WhatsApp, calendar, and Razorpay mode are **UNKNOWN**. Do not copy Development values onto Production.

### SAFE NEXT ACTION

1. Keep Sales / Booking / Report agents and cohort unchanged.  
2. Obtain the production connection the same way Development is configured (gitignored env on the operator machine or droplet), then repeat this read-only audit against `growwmatics_prod`.  
3. Only after both databases have been read, decide activation separately for Development and Production.  
4. Add Calendar credentials and the payment-received template only if those features are required — still as an operator config change, not part of this audit.

---

## Identifier summary (no secrets)

```text
Environment: Development
Atlas cluster host prefix: ac-evus3g8
Database: growwmatics_dev
App env files: .env and .env.local
Connection: VERIFIED

Environment: Production
Atlas cluster: prod-0 (name from runbook only)
Database: growwmatics_prod (name from runbook only)
App env file: .env.production ABSENT
Connection: DATABASE UNAVAILABLE
```
