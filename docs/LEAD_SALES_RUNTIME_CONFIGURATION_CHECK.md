# Lead / Sales Runtime Configuration Check

**Date:** 2026-10-03  
**Scope:** READ-ONLY only. No code changes, no database writes, no flag changes, no deploy, no WhatsApp sends, no nurture job triggers.

**Method:** One-off Node/mongoose probe (outside the repo) using existing `MONGODB_URI` from `.env.local`, with `readPreference: 'secondaryPreferred'`. Agent getters that insert defaults (`getSalesAgentConfig`, etc.) were **not** called.

---

# Database Connection

| Item | Result |
| --- | --- |
| URI present | Yes (`.env.local`) |
| Target host family | MongoDB Atlas shard hosts (`*.mongodb.net`) |
| Database name in URI | Historically `growwmatics_dev` (not re-printed here) |
| Connection attempt | **FAILED** |
| Error | `MongooseServerSelectionError` |
| Message | Could not connect to any servers in your MongoDB Atlas cluster. One common reason is that you're trying to access the database from an IP that isn't whitelisted. |
| Elapsed | ~15s (`serverSelectionTimeoutMS: 15000`) |
| Writes attempted | **None** |
| TLS / credentials / env modified | **No** |

### Diagnosis (read-only; no fix applied)

Atlas rejected server selection from this machine’s current network path. The driver message points to **IP allowlist** as the common cause. This check did **not** change Atlas networking, credentials, TLS options, or local env to work around it.

**Conclusion for Steps 2–3:**

```text
DATABASE RUNTIME FLAGS COULD NOT BE VERIFIED
```

Stored Mongo values for Sales / Booking / Report `enabled` and nurture cohort were **not** read. They are **not** inferred from source-code defaults.

---

# Actual Runtime Flags

## From database (Mongo singleton docs)

| Flag | Actual stored value | Status |
| --- | --- | --- |
| Sales Agent `enabled` | — | **DATABASE UNAVAILABLE** |
| Booking Agent `enabled` | — | **DATABASE UNAVAILABLE** |
| Report Agent `enabled` | — | **DATABASE UNAVAILABLE** |
| OrchestrationConfig `rolloutPercentage` | — | **DATABASE UNAVAILABLE** |
| OrchestrationConfig `leadIdAllowlist` | — | **DATABASE UNAVAILABLE** |
| OrchestrationConfig `cooldownHours` | — | **DATABASE UNAVAILABLE** |
| OrchestrationConfig stuck-hot thresholds | — | **DATABASE UNAVAILABLE** |

Code defaults (`enabled: false`, `rolloutPercentage: 0`) exist in the repo but are **explicitly not used** as substitutes for this report.

## From local environment files (not Mongo)

These are process env values on this machine, not Atlas documents:

| Switch | Actual local env value | Status |
| --- | --- | --- |
| `LEAD_ENGINE_V2` | `true` | VERIFIED (env) — not a Mongo field |
| `WHATSAPP_PROVIDER` | `twilio` | VERIFIED (env) |
| `QA_SUPPRESS_WHATSAPP_SENDS` | `false` | VERIFIED (env) |
| `GOOGLE_CALENDAR_ID` | ABSENT | CONFIGURATION REQUIRED |
| `GOOGLE_CALENDAR_CREDENTIALS_JSON` | ABSENT | CONFIGURATION REQUIRED |
| `TWILIO_TEMPLATE_PAYMENT_RECEIVED` | ABSENT | CONFIGURATION REQUIRED |
| `TWILIO_ACCOUNT_SID` / WhatsApp number | SET | VERIFIED (env presence only; send not tested) |
| Production host env | Not inspected | UNKNOWN |

Production Mongo / hosting env: **UNKNOWN**.

---

# Nurture Cohort

| Item | Actual value | Status |
| --- | --- | --- |
| `OrchestrationConfig.rolloutPercentage` | unread | **DATABASE UNAVAILABLE** |
| `OrchestrationConfig.leadIdAllowlist` length | unread | **DATABASE UNAVAILABLE** |
| Effect of unread cohort | Cannot state whether any lead is in cohort | UNKNOWN |

Even with local `LEAD_ENGINE_V2=true`, proactive V2 nurture still requires a cohort match in Mongo. That match **could not be verified**.

---

# Existing Lead Field Population

| Check | Result |
| --- | --- |
| Platform leads queried (`tenantId: gmbboost-internal`) | **Not queried** |
| Field presence for `currentStage`, `currentAgent`, `leadScore`, `buyingSignals`, `auditId`, `intent`, `painPoints`, `objections`, `nextBestAction` | **DATABASE UNAVAILABLE** |

No lead documents were returned; no PII was available to redact or display.

---

# Configuration Dependencies

Still required for full activation (independent of this failed DB read):

1. **Mongo-reachable environment** with IP allowlist (or private connectivity) so agent flags and cohort can be read/set by operators.  
2. **SalesAgentConfig.enabled** must be true in Mongo before the sales drip sends.  
3. **BookingAgentConfig.enabled** + Google Calendar env for real slots/Meet links.  
4. **ReportAgentConfig.enabled** for report WhatsApp agent paths.  
5. **Cohort** (`rolloutPercentage` / allowlist) for proactive LEAD_ENGINE_V2 NBA scheduling.  
6. **TWILIO_TEMPLATE_PAYMENT_RECEIVED** if that specific post-pay WhatsApp is desired (currently ABSENT locally).

---

# Runtime Blockers

| Blocker | Status | Notes |
| --- | --- | --- |
| Atlas connectivity from this machine | **DATABASE UNAVAILABLE** | Server selection failed; likely IP whitelist |
| Verify Sales/Booking/Report enabled | Blocked by DB | Do not assume disabled or enabled |
| Verify nurture cohort | Blocked by DB | Do not assume 0% |
| Google Calendar | CONFIGURATION REQUIRED | Env ABSENT |
| Payment-received template | CONFIGURATION REQUIRED | Env ABSENT |
| Live WhatsApp / nurture | Not attempted | Per instructions |

---

# Activation Readiness

| Question | Answer |
| --- | --- |
| Can this workspace activate sales messaging safely based on verified DB flags? | **No — flags unread** |
| Is architecture code ready? | Yes (prior verification) |
| Are runtime Mongo switches confirmed? | **No** |
| Safe next operator step (outside this task) | Restore Atlas connectivity / whitelist, then re-run a read-only flag query. Do not enable agents from inference. |

**Activation readiness: NOT READY TO ASSERT** — database runtime flags could not be verified.

---

# Summary Statement

```text
DATABASE RUNTIME FLAGS COULD NOT BE VERIFIED
```

Connection failed with `MongooseServerSelectionError` citing Atlas IP whitelist as a common cause. No Mongo documents were read. No code defaults were substituted for Sales / Booking / Report `enabled` or nurture cohort. No configuration was changed to force a connection.

---

# Final Table

| Runtime Component         | Actual Value | Evidence | Activation Dependency |
| ------------------------- | ------------ | -------- | --------------------- |
| Sales Agent               | DATABASE UNAVAILABLE | Mongo connect failed; `salesagentconfigs` unread | Must read/set `enabled` in Mongo after connectivity |
| Booking Agent             | DATABASE UNAVAILABLE | Mongo connect failed; `bookingagentconfigs` unread | Must read/set `enabled` in Mongo after connectivity |
| Report Agent              | DATABASE UNAVAILABLE | Mongo connect failed; `reportagentconfigs` unread | Must read/set `enabled` in Mongo after connectivity |
| LEAD_ENGINE_V2            | `true` (local env) | `.env.local` | Production host unknown; V2 still needs cohort in Mongo |
| Nurture Cohort            | DATABASE UNAVAILABLE | `orchestrationconfigs` unread | `rolloutPercentage` / allowlist must be read in Mongo |
| Google Calendar           | CONFIGURATION REQUIRED | `GOOGLE_CALENDAR_ID` / credentials ABSENT in local env | Required for real demo slots / Meet links |
| WhatsApp                  | Provider `twilio`; suppress `false`; SID/number SET locally | Env presence only; no send attempted | Agent enabled flags + templates still gate real sends |
| Payment Received Template | CONFIGURATION REQUIRED | `TWILIO_TEMPLATE_PAYMENT_RECEIVED` ABSENT | Optional post-pay notice; other invoice/welcome templates may exist |

---

**End of read-only check.** Nothing was modified.
