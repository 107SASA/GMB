# Production Runtime Verification

**Date:** 2026-10-03  
**Mode:** Read-only on the production host and production MongoDB.  
No code, `.env.production`, MongoDB documents, Atlas settings, flags, leads, WhatsApp, nurture, calendar events, payments, webhooks, PM2, or deploys were changed.

Secrets are not included. Connection strings, passwords, and API keys were not printed.

---

## 1. Production Host

| Item | Evidence |
| --- | --- |
| SSH | `root@168.144.22.255` succeeded with the existing local identity |
| Hostname | `growwmatics-prod` |
| Application path | `/var/www/gmbboost` |
| Env file | `/var/www/gmbboost/.env.production` is **PRESENT** (contents not copied) |

---

## 2. Production Application Runtime

| Item | Evidence |
| --- | --- |
| Process manager | PM2 |
| Process name | `growwmatics` |
| Status | **online** |
| Mode | fork, user **root**, watching disabled |
| PID at check | 1157225 |
| Uptime at check | about 75 minutes |
| Historical restarts | 1012 (not restarted by this audit) |
| Process working directory | `/var/www/gmbboost` |
| Git checkout | `695102a` — `Merge pull request #65 from 107SASA/dev` (2026-10-03 20:14 +0530) |
| Branch | `main` tracking `origin/main` |
| `NODE_ENV` in `.env.production` | **ABSENT** (Next `next start` normally sets production itself; the PM2 env block was not dumped) |

This audit did not restart PM2 or Next.js.

---

## 3. Production Environment Configuration

Read from the existing `.env.production` on the server. Values below are presence or non-secret mode only.

| Variable | Status |
| --- | --- |
| `MONGODB_URI` | **PRESENT** |
| Database name (path segment) | `growwmatics_prod` |
| DB user role name | `gm_prod_app` |
| Protocol | `mongodb` (seed list, 3 hosts) |
| Atlas host prefix | `ac-mzhvmzj` (not the Development cluster) |
| `LEAD_ENGINE_V2` | **`true`** |
| `WHATSAPP_PROVIDER` | **`twilio`** |
| `QA_SUPPRESS_WHATSAPP_SENDS` | **ABSENT** |
| Twilio account SID | **PRESENT** |
| Twilio auth token | **PRESENT** |
| Twilio WhatsApp number | **PRESENT** |
| Sales intro template | **PRESENT** |
| Report-ready template | **PRESENT** |
| Invoice template | **PRESENT** |
| Welcome template | **PRESENT** |
| Payment-received template | **PRESENT** |
| `GOOGLE_CALENDAR_ID` | **ABSENT** |
| `GOOGLE_CALENDAR_CREDENTIALS_JSON` | **ABSENT** |
| `GOOGLE_CALENDAR_CREDENTIALS` | **ABSENT** |
| `RAZORPAY_KEY_ID` | **PRESENT** |
| Razorpay mode | **test** (`rzp_test` prefix only; key not printed) |
| `RAZORPAY_KEY_SECRET` | **PRESENT** |
| `RAZORPAY_WEBHOOK_SECRET` | **PRESENT** |
| Public app host | `growwmatics.com` |

---

## 4. Production MongoDB

| Item | Result |
| --- | --- |
| Connection | **Succeeded** from the production host using the app’s existing URI |
| Operations | `listCollections`, `countDocuments`, `findOne`, `aggregate` only |
| Database name returned by the driver | `growwmatics_prod` |
| Writes | None |

---

## 5. Sales Agent

Stored document in `salesagentconfigs` (`key: default`). One document.

| Field | Stored value |
| --- | --- |
| Document | **Exists** |
| `enabled` | **`true`** → **VERIFIED ENABLED** |
| First-message delay | **2 minutes** |
| Follow-ups | **2** steps: **24h** then **72h**, both `onlyIfNoReply: true` |

Not taken from Development (Development’s stored Sales Agent was `enabled: false`). Not taken from code defaults.

---

## 6. Booking Agent

Stored document in `bookingagentconfigs` (`key: default`). One document.

| Field | Stored value |
| --- | --- |
| Document | **Exists** |
| `enabled` | **`true`** → **VERIFIED ENABLED** |

Calendar credentials are **ABSENT**, so creating a real slot still fails closed in code. The agent flag itself is on.

---

## 7. Report Agent

Stored document in `reportagentconfigs` (`key: default`). One document.

| Field | Stored value |
| --- | --- |
| Document | **Exists** |
| `enabled` | **`true`** → **VERIFIED ENABLED** |

---

## 8. Orchestration / Nurture

Stored document in `orchestrationconfigs` (`key: default`). One document.

| Field | Stored value |
| --- | --- |
| Document | **Exists** |
| `rolloutPercentage` | **0** |
| `leadIdAllowlist` | **0 entries** |
| `cooldownHours` | **NOT STORED** on the document |
| `stuckLeadScoreThreshold` | **76** |
| `stuckNurtureCyclesThreshold` | **3** |

`LEAD_ENGINE_V2=true` is set in the production env. With rollout **0** and an empty allowlist, the proactive cohort contains **no** leads. That does **not** turn off the sales drip: the drip checks `SalesAgentConfig.enabled`, which is **true**.

| Path | Runtime |
| --- | --- |
| Post-audit sales drip | **RUNTIME CONFIGURATION ENABLES IT** (`enabled: true`) |
| Proactive NBA scheduler cohort | **VERIFIED — no leads in cohort** (flag on, rollout 0, allowlist empty) |
| Actual sends during this audit | **NOT TESTED** |

---

## 9. Production Lead Data

No names, phones, emails, or business names were read.

**All leads:** 9

### Lead type

| leadType | Count |
| --- | --- |
| Platform Prospect | 7 |
| Client Prospect | 2 |

### Platform leads (`tenantId = gmbboost-internal`) — 7

**currentStage**

| Stage | Count |
| --- | --- |
| NURTURING | 3 |
| CUSTOMER | 2 |
| NEW | 2 |

**currentAgent**

| Agent | Count |
| --- | --- |
| NONE | 4 |
| SALES | 3 |

No platform lead is stored as `currentAgent = IN_HOUSE`.

**Score bands** (from stored `leadScore`; missing/0 counts as 0–25)

| Band | Count |
| --- | --- |
| 0–25 | 7 |
| 26–50 | 0 |
| 51–75 | 0 |
| 76–100 | 0 |

`leadScore > 0`: **0**

**Intelligence fields (non-empty / set)**

| Field | Count |
| --- | --- |
| `buyingSignals` | 0 |
| `auditId` | 0 |
| `nextBestAction` | 0 |
| `intent` | 7 |
| `painPoints` | 0 |
| `objections` | 0 |
| `businessProfile` | 0 |

---

## 10. Platform vs Customer CRM Isolation

| Population | Count |
| --- | --- |
| Platform (`tenantId = gmbboost-internal`, all `Platform Prospect`) | 7 |
| Client Prospect | 2 |
| Leads whose tenant is not `gmbboost-internal` | 2 |
| Overlap: platform tenant **and** `Client Prospect` | **0** |

The two Client Prospect leads are both `currentStage = NEW` and `currentAgent = NONE`. They are not inside the platform tenant. No overlap was found.

---

## 11. Payment / Customer Activation

Code supports: checkout → Razorpay webhook → `PAYMENT_VERIFIED` → `CUSTOMER` / `IN_HOUSE`, and failure → `CONVERSION_PENDING`. **NOT TESTED** (no payment, no webhook).

Platform stage counts that exist in this database:

| Stage | Count |
| --- | --- |
| `CONVERSION_PENDING` | 0 |
| `PAYMENT_VERIFIED` | 0 |
| `PAYMENT_INITIATED` / `PAYMENT_PENDING` | 0 (not present as stages) |
| `CUSTOMER` | **2** |

Those two `CUSTOMER` rows are not paired with `currentAgent = IN_HOUSE` in the agent histogram (only `NONE` and `SALES` appear). This audit did not open the rows or change them.

Razorpay on this host is **test** mode, not live.

---

## 12. WhatsApp Configuration

| Item | Status |
| --- | --- |
| Provider | **twilio** |
| Twilio SID / token / number | **PRESENT** |
| Sales intro template | **PRESENT** |
| Report-ready template | **PRESENT** |
| Invoice template | **PRESENT** |
| Welcome template | **PRESENT** |
| Payment-received template | **PRESENT** |
| `QA_SUPPRESS_WHATSAPP_SENDS` | **ABSENT** (sends are not suppressed by that variable) |
| Opt-out | **CODE SUPPORTS IT** (not re-executed) |
| A message sent by this audit | **No** |

---

## 13. Google Calendar

| Item | Status |
| --- | --- |
| Calendar ID | **ABSENT** |
| Calendar credentials | **ABSENT** |

Booking agent flag is on. Calendar booking is **not** configured. No event was created.

---

## 14. Razorpay

| Item | Status |
| --- | --- |
| Key id | **PRESENT** |
| Mode | **test** |
| Key secret | **PRESENT** |
| Webhook secret | **PRESENT** |
| Payment or webhook run by this audit | **No** |

---

## 15. Activation Readiness

| Capability | Code supports it | Production runtime |
| --- | --- | --- |
| Sales messaging / post-audit drip | Yes | **VERIFIED ENABLED** (`SalesAgent.enabled = true`, follow-ups 24h/72h). Sends **NOT TESTED** |
| Booking agent replies | Yes | **VERIFIED ENABLED**. Real Meet slots **blocked** (calendar ABSENT) |
| Report WhatsApp agent | Yes | **VERIFIED ENABLED**. Sends **NOT TESTED** |
| Proactive NBA / V2 cohort nurture | Yes | Env flag **true**, but cohort **empty** (`rolloutPercentage = 0`, allowlist 0). Proactive cohort sends should not select leads. **NOT TESTED** |
| Payment-received WhatsApp | Yes | Template **PRESENT**. **NOT TESTED** |
| Customer activation sequence | Yes | Razorpay is **test**. Two leads already `CUSTOMER` stage; none stored as `IN_HOUSE`. **NOT TESTED** |

Nothing was enabled or disabled by this audit. Sales, Booking, and Report were **already** stored as enabled before this check.

---

## 16. Remaining Dependencies

1. Google Calendar ID and credentials are **ABSENT**, so confirmed demo slots cannot be created.
2. Razorpay is **test**, not live.
3. Proactive V2 nurture cohort is **0%** with an empty allowlist. The sales drip can still run because Sales Agent is enabled.
4. New lead fields (`buyingSignals`, `auditId`, `leadScore > 0`, `nextBestAction`) are **unpopulated** on all 7 platform leads.
5. `cooldownHours` is **NOT STORED** on the orchestration document.
6. Do not treat Development (`growwmatics_dev`, Sales Agent disabled, no booking/report documents) as this production state.

---

## 17. Safety Findings

- This audit only read the host and the database. The temp audit script was removed from `/tmp` after the run.
- Production Sales, Booking, and Report agents are **already enabled**. That is different from Development.
- Production Razorpay keys are **test** mode while the public host is `growwmatics.com`.
- Calendar is not configured, so an enabled booking agent cannot complete a real calendar booking.
- `QA_SUPPRESS_WHATSAPP_SENDS` is absent, so WhatsApp sends are not short-circuited by that flag.
- PM2 shows 1012 historical restarts. This audit did not restart it.
- Untracked files exist on the server checkout. They were **not** opened.

---

## Final Conclusion

Production is a separate database (`growwmatics_prod` on Atlas host prefix `ac-mzhvmzj`) from Development. The running app is PM2 process `growwmatics` at `/var/www/gmbboost`, checkout `695102a`.

**Verified enabled in MongoDB:** Sales Agent, Booking Agent, Report Agent.  
**Verified not in the proactive cohort:** rollout 0 and empty allowlist, while `LEAD_ENGINE_V2=true`.  
**Absent:** Google Calendar.  
**Razorpay:** test mode.  
**Leads:** 7 platform, 2 client CRM, overlap 0. New intelligence fields are empty. Two platform leads are stage `CUSTOMER`.

No flag was changed and nothing was sent.

---

| Component | Production Status | Evidence | Safe to Activate? |
| --- | --- | --- | --- |
| Sales Agent | VERIFIED ENABLED | Mongo `salesagentconfigs.enabled = true`; delay 2 min; follow-ups 24h and 72h | No — already on; this audit must not change it |
| Booking Agent | VERIFIED ENABLED | Mongo `bookingagentconfigs.enabled = true` | No — already on; calendar is ABSENT so slots cannot complete |
| Report Agent | VERIFIED ENABLED | Mongo `reportagentconfigs.enabled = true` | No — already on; do not change it |
| Nurture | Drip enabled; proactive cohort empty | Sales `enabled=true`; `LEAD_ENGINE_V2=true`; `rolloutPercentage=0`; allowlist 0 | No — do not raise rollout or toggle the agent |
| WhatsApp | PRESENT (Twilio + templates, including payment-received) | `.env.production` presence only; suppress flag ABSENT | No — do not send |
| Calendar | ABSENT | Calendar ID and credentials absent | No |
| Razorpay | PRESENT, mode **test** | Key prefix only; secrets not printed | No — not live; do not pay |
| Customer Activation | CODE SUPPORTS IT; 2 leads already stage CUSTOMER; 0 `PAYMENT_VERIFIED`; 0 `IN_HOUSE` | Aggregate counts only | No — not tested; do not trigger webhooks |
