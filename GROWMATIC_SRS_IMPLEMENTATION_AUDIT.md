# GrowMatic SRS Implementation Audit

| | |
|---|---|
| **Source document** | `GrowMatic Software Requirements Specification (SRS).docx` |
| **Codebase audited** | Branch `dev`, commit `ee09922` (clean working tree) |
| **Audit date** | 2026-10-06 |
| **Audit type** | Review only. No source, database, configuration or UI changes were made. |
| **Status scale** | 🟢 AVAILABLE = implemented, with code evidence that it works · 🟡 NOT AVAILABLE = missing, partial, or not verifiable from the repository |

**Stack observed (for context):** Next.js 16 App Router (`src/app`), MongoDB via Mongoose (`src/models`, 70+ collections), Inngest for background jobs and crons (`src/services/inngest/functions.ts`, 53 registered functions in `src/app/api/inngest/route.ts`), Groq LLM, Razorpay, Twilio and Meta WhatsApp, Resend/SendGrid email, DigitalOcean Spaces storage, and an Expo mobile app (`mobile/`). There is **no Supabase** in this project, so the SRS's row-level-security wording is assessed against MongoDB application-level query filtering.

> **Configuration fact that affects many results.** Every write to Google Business Profile (posts, review replies, photo uploads, profile edits) is behind `gbpWritesEnabled()` in `src/lib/gbpSafety.ts`. `GBP_LIVE_WRITES_ENABLED=false` is set in both `.env` and `.env.local`, and `.env.production.example` does not set it. With the flag off, those code paths save locally and return `liveWriteApplied: false` or status `blocked`. Requirements that depend on publishing to Google are therefore marked 🟡, because publishing cannot be shown to work from this repository.

---

## 1. Audit Summary

The headline count covers every requirement ID in the SRS: FR-1.1 to FR-16.6 (134 IDs; the SRS has no FR-1.7) and NFR-1 to NFR-30 (30 IDs). Sections 4, 5, 7, 8 and 9 contain supporting checks and are **not** added to these totals.

| Metric | Value |
|---|---|
| Total requirements reviewed | **164** (134 FR + 30 NFR) |
| 🟢 AVAILABLE | **15** (12 FR + 3 NFR) |
| 🟡 NOT AVAILABLE | **149** (122 FR + 27 NFR) |
| Percentage available | **9.1%** |
| Percentage not available | **90.9%** |

**By SRS priority (functional requirements only)**

| Priority | Total | 🟢 Available | 🟡 Not available |
|---|---|---|---|
| P0 | 81 | 6 | 75 |
| P1 | 46 | 5 | 41 |
| P2 | 7 | 1 | 6 |
| NFR | 30 | 3 | 27 |

**By functional area**

| Area | Total | 🟢 | 🟡 |
|---|---|---|---|
| FR-1 Accounts, onboarding and workspaces | 7 | 2 | 5 |
| FR-2 Subscription and billing | 6 | 0 | 6 |
| FR-3 GBP connection and sync | 8 | 0 | 8 |
| FR-4 Audit engine | 7 | 2 | 5 |
| FR-5 Profile optimization automation | 10 | 0 | 10 |
| FR-6 Photo and media manager | 11 | 0 | 11 |
| FR-7 Review management | 11 | 1 | 10 |
| FR-8 Post creation and scheduling | 10 | 1 | 9 |
| FR-9 Citations and NAP consistency | 7 | 0 | 7 |
| FR-10 Website and schema helpers | 8 | 0 | 8 |
| FR-11 Rank tracking | 7 | 0 | 7 |
| FR-12 Analytics and reporting | 10 | 1 | 9 |
| FR-13 Mini CRM | 11 | 2 | 9 |
| FR-14 AI agent and approval workflow | 12 | 2 | 10 |
| FR-15 Notifications | 3 | 0 | 3 |
| FR-16 Admin console | 6 | 1 | 5 |
| NFR-1 to NFR-30 | 30 | 3 | 27 |

---

## 2. Executive Summary

**Where the SRS is met.** The codebase has a working foundation in a few areas:
- Phone + OTP sign-up and login (OTP sent over WhatsApp).
- Multiple workspaces per login, with a switcher and a separate Razorpay subscription for each workspace.
- A substantial audit engine: keyword research with locality expansion and DataForSEO search volume, competitor discovery, a fixed 3×3 geo-grid rank check, AI narrative, and a public free-report page.
- A content calendar with month and week views and drag-and-drop rescheduling.
- AI grounding and fact-check gates on generated posts, review replies and SEO-plan text.
- A monthly report that compares stored audits and lists what was done, what changed and what is still pending.
- A CRM with a configurable Kanban/list pipeline, activity timeline, follow-ups, call capture and a monthly growth/ROI report.
- An admin console with search, audited impersonation and per-customer limit overrides.

**What is mostly missing.**
- **Writing to Google.** Every GBP write path exists in code but is switched off in every environment file in the repository. Profile optimization, photo publishing, review auto-reply and post scheduling therefore cannot be shown to work.
- **GBP sync depth and cadence.** The sync reads only title, description, phone, website, categories and address. It runs nightly, not every 6 hours, and reviews are not polled hourly.
- **Change history and revert.** No field-level before/after log exists and nothing can be reverted (FR-3.7, FR-5.10).
- **The AI agent's control layer.** There are no risk classes, no unified approval queue with a diff view, no task engine with Planned/Awaiting approval/Running/Done/Failed statuses, and no kill switch (FR-14.2 to FR-14.5, FR-14.12).
- **Billing completeness.** There is a single paid plan instead of the Starter/Growth/Pro/Agency tiers, no Stripe, no GST invoicing, and no upgrade, downgrade, pause or proration.
- **Team accounts.** Roles are only `SUPER_ADMIN` and `CLIENT`; there are no Owner, Manager, Staff or View-only members.
- **Whole modules absent.** Citations/NAP (FR-9), customer-facing schema and website helpers (FR-10), standalone rank tracking (FR-11), GA4 and Search Console, SMS, and review widgets.
- **Non-functional requirements.** There is no CI/CD, no centralised logging or error tracking, no evidence of a backup restore test, no dead-letter queue, no RBAC, no staging environment, no WCAG work, and no Hindi or Bengali output.

**Biggest gaps against the MVP promise** ("connect GBP, get an audit, and have the agent keep the profile active with posts, review replies and a monthly report"):
1. Live GBP writes are disabled, so the agent cannot yet act on a real profile.
2. There is no change history or revert, which the SRS lists as the main mitigation for suspension risk.
3. There are no risk classes and no kill switch.
4. There is no GST invoicing and no plan tiers.

---

## 3. Detailed Requirement Audit

### FR-1 Accounts, onboarding and workspaces

#### FR-1.1 — Sign up with mobile and OTP
> SRS: (P0) Sign up with mobile and otp

**Status:** 🟢 AVAILABLE

**Evidence:**
- `src/app/api/onboarding/route.ts`: creates the `User` with a normalised E.164 `phone`, stores a hashed OTP (`hashOTP`) with a 10-minute expiry, and sends it with `sendOtpMessage`. The route is rate-limited.
- `src/app/api/auth/verify-phone-otp/route.ts`: verifies the OTP, applies a lockout threshold, and completes login through `finalizeLogin`.
- `src/app/api/auth/phone-login/request/route.ts` and `.../verify`: OTP login for existing accounts.
- `src/app/(auth)/verify-phone/page.tsx`: the UI step.

**Assessment:** Mobile-number sign-up with OTP verification is implemented end to end. The OTP is delivered over WhatsApp, not SMS.

#### FR-1.2 — Workspace model with roles (Owner, Manager, Staff, View-only)
> SRS: (P0) Workspace model: one owner, invitable team members with roles (Owner, Manager, Staff, View-only)

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/models/User.ts:185-187`: `role` enum is only `['SUPER_ADMIN', 'CLIENT']`.
- `src/models/Organization.ts`: `ownerId` only; there is no members array and no per-workspace role.
- `/api/admin/invites` (`src/app/api/admin/invites`) invites platform super admins, not workspace members.
- `src/hooks/useCurrentUserRole.ts` knows only `SUPER_ADMIN | CLIENT`.

**Assessment:** A workspace has one owner. No team-member invitation exists, and none of the Owner, Manager, Staff or View-only roles are modelled.

#### FR-1.3 — Guided onboarding wizard
> SRS: (P0) Guided onboarding wizard: business basics, connect GBP, choose mode (autopilot or approval), pick plan - Pending

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/components/onboarding/OnboardingWizard.tsx:47-53`: steps are `account, organization, business, confirm, google, complete`.
- `src/components/onboarding/StepGoogle.tsx`: the "Google" step is two optional text inputs (Place ID, GBP URL), and `handleContinue` just calls `onNext()`. It does not start OAuth.
- `StepModules.tsx` (single-plan display) is not in the wizard's `steps` array, and the wizard comment says "No pricing step here, deliberately."
- No mode-selection step (autopilot or approval) exists.

**Assessment:** The wizard collects business basics only. Connecting GBP via OAuth, choosing a mode and picking a plan are not part of it.

#### FR-1.4 — No-GBP creation and verification guidance
> SRS: (P1) If the business has no GBP, wizard guides creation and verification, then resumes - Pending

**Status:** 🟡 NOT AVAILABLE

**Evidence:** Searches of `src/components/onboarding` and `src/app/dashboard/gbp-profile` found no GBP-creation or verification guidance. The OAuth callback (`src/app/api/auth/google/callback/route.ts:122-128`) only logs and redirects when an account manages no profiles.

**Assessment:** Not implemented.

#### FR-1.5 — Agency accounts
> SRS: (P1) Agency accounts: many workspaces under one login, client switcher, per-client or pooled billing - Hold

**Status:** 🟢 AVAILABLE

**Evidence:**
- `src/app/api/business/add-workspace/route.ts`: creates an additional Organization and Business for the same logged-in user.
- `src/app/api/business/all/route.ts` and `src/app/api/business/active/route.ts` list workspaces and switch the active one.
- `src/components/layout/BusinessSwitcher.tsx`, `AddWorkspaceModal.tsx` and `src/context/BusinessContext.tsx` provide the switcher UI.
- Per-workspace billing: `src/lib/workspaceAccess.ts` (`isWorkspaceUnlocked`), `Business.subscriptionStatus`, the gate in `src/proxy.ts`, and per-workspace Razorpay subscriptions (`src/app/api/billing/checkout/route.ts`, `src/lib/billing/applyEntitlements.ts` `activateBusinessPlan`).

**Assessment:** Many workspaces under one login, a client switcher and per-client billing all exist. There is no distinct "agency" account type and no pooled billing; the SRS allows per-client *or* pooled billing.

#### FR-1.6 — White-label option
> SRS: (P2) White-label option: agency logo, colours and custom domain on reports - Hold

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `src/models/Organization.ts` defines `settings.whiteLabel` and `settings.customDomain`, but a repository-wide search found no code that reads either field. The report renderers (`src/lib/pdf/reportHtml.ts`, `src/app/reports/[token]/page.tsx`) do not apply agency branding.

**Assessment:** Schema placeholders only.

#### FR-1.8 — Data export and account deletion (DPDP and GDPR)
> SRS: (P0) Data export and account deletion on request (DPDP and GDPR) - Pending

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- Deletion exists: `src/app/api/user/delete-account/route.ts` soft-deletes (`isDeleted`, `deletedAt`). `src/services/account/purgePlan.ts` defines `PURGE_GRACE_DAYS = 30` and per-collection purge targets, `src/services/account/hardPurge.ts` performs the purge, and `accountHardPurgeCron` runs it. `tests/integration/account-purge-plan.test.ts` covers the plan.
- Export: no data-export endpoint or UI was found (searched for export/download-my-data patterns across `src/app`, `src/services` and `src/lib`).

**Assessment:** Deletion is implemented; data export is missing.

---

### FR-2 Subscription and billing

#### FR-2.1 — Plans with monthly and annual billing, per-location pricing
> SRS: (P0) Plans with monthly and annual billing, per-location pricing,

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/lib/billing/planCatalog.ts`: "THE single source of truth for the one sellable plan". `CYCLES` supports monthly, quarterly, half-yearly and yearly.
- Each workspace needs its own subscription (`src/lib/workspaceAccess.ts`), so the price is effectively per location.
- `src/lib/planDefaults.ts`: only `Free` and `Pro`.

**Assessment:** Monthly and annual cycles and per-workspace pricing exist, but only one paid plan is sold. The plan structure the SRS describes (Starter, Growth, Pro, Agency; see Section 10 of the SRS) is not implemented.

#### FR-2.2 — Razorpay (India) and Stripe (international)
> SRS: (P0) Payment via Razorpay (UPI, cards, netbanking, e-mandate) for India; Stripe for international

**Status:** 🟡 NOT AVAILABLE

**Evidence:** Razorpay subscriptions: `src/lib/billing/razorpay.ts`, `src/app/api/billing/checkout/route.ts`, `src/app/api/webhook/razorpay/route.ts`. A search for `stripe` across `src/` returned no matches, and `package.json` has no Stripe dependency.

**Assessment:** Razorpay only; Stripe is missing.

#### FR-2.3 — GST-compliant invoices
> SRS: (P0) GST-compliant invoices (GSTIN capture, HSN/SAC, tax split) emailed and whatsapp downloadable

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/app/api/billing/invoices/route.ts` lists Razorpay-hosted invoice `short_url`s. Its comment reads "there is no local Payment/Invoice model".
- A search for `gstin`, `hsn` and `SAC` across `src/` returned no matches.
- `TWILIO_TEMPLATE_INVOICE_READY` is defined in `.env`, but no send path for it was found.

**Assessment:** No GSTIN capture, no HSN/SAC codes, no tax split, and no invoice email or WhatsApp delivery.

#### FR-2.4 — Feature gating and usage limits by plan
> SRS: (P0) Feature gating and usage limits by plan (locations, posts, AI credits, tracked keywords, CRM contacts) - Only for Reports

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/lib/featureGating.ts` `checkUsageLimit` supports `posts | audits | aiGenerations | whatsappMessages`, with limits from `src/models/PlanConfig.ts` or `src/lib/planDefaults.ts` and per-user overrides in `src/models/UserLimitOverride.ts`.
- Call sites: `src/app/api/audit/route.ts`, `src/app/api/content/generate/route.ts`, `src/app/api/reviews/generate-reply/route.ts`, `src/lib/reviewSendEligibility.ts`, and `services/inngest/functions.ts`.
- `src/lib/moduleGating.ts` `requireModule` handles module on/off.
- No limits exist for locations, tracked keywords or CRM contacts.

**Assessment:** Posts, audits, part of the AI credits, and WhatsApp messages are gated. Locations, tracked keywords and CRM contacts, which the SRS names explicitly, are not.

#### FR-2.5 — Upgrade, downgrade, pause, cancel, proration, dunning
> SRS: (P0) Upgrade, downgrade, pause, cancel; proration; dunning (retry failed payments, email and WhatsApp reminders) - Hold

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- Cancel: `src/app/api/billing/cancel/route.ts`.
- Payment failure: the webhook handles `payment.failed` and `subscription.halted` → `markBusinessPastDue` (`src/lib/billing/applyEntitlements.ts:108`), which sends an in-app notification, a WhatsApp `notifyOwner` message and `sendPaymentFailedEmail`.
- No upgrade, downgrade, pause or proration logic was found (searched `src/app/api/billing`, `src/lib/billing`, `src/services/billing`).

**Assessment:** Cancel and failed-payment reminders exist. Upgrade, downgrade, pause and proration are missing.

#### FR-2.6 — Add-on purchases
> SRS: (P1) Add-on purchases (extra locations, extra keywords, review-request SMS credits) - Hold

**Status:** 🟡 NOT AVAILABLE

**Evidence:** No add-on products or checkout exist. `src/components/onboarding/StepModules.tsx` states "No tiers, no add-ons."

**Assessment:** Not implemented.

---

### FR-3 GBP connection and sync

#### FR-3.1 — Google OAuth; list all accounts and locations; select locations
> SRS: (P0) Google OAuth 2.0 with GBP scope; list all accounts and locations the user manages; select locations to connect

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/app/api/auth/google/route.ts`: OAuth with scope `business.manage`.
- `src/app/api/auth/google/callback/route.ts:130`: `const account = accounts[0];`. Only the **first** Google account's locations are fetched.
- A picker (`src/app/dashboard/gbp-profile/select-location/page.tsx`, `src/models/PendingGbpConnection.ts`) appears only when that account has several locations and none matches the workspace's Place ID. One location is linked per workspace (`GBPToken.locationId`).

**Assessment:** OAuth works, but the code does not list all accounts and does not let the user select multiple locations to connect.

#### FR-3.2 — Initial full import
> SRS: (P0) Initial full import: name, address, pin, phone, website, hours, special hours, categories, attributes, services, products, description, photos, posts, reviews

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/lib/gbpClient.ts:268`: profile `readMask = 'title,profile.description,phoneNumbers,websiteUri,categories,storefrontAddress'`.
- The pin is read separately for geotagging only (`fetchLocationPin`).
- Photos: `listLocationMedia`. Reviews: `src/services/reviews/providers/GbpApiReviewProvider.ts`.
- No import of hours, special hours, attributes, services, products or existing GBP posts was found (search for `regularHours`, `specialHours`, `serviceItems` and listing `localPosts` found none outside audit text).

**Assessment:** Partial import. Hours, special hours, attributes, services, products and posts are not imported.

#### FR-3.3 — Sync at least every 6 hours plus on demand; detect outside changes
> SRS: (P0) Ongoing sync at least every 6 hours plus on demand; detect changes made outside GrowMatic, including Google-suggested edits

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `gbpNightlySyncScheduler` runs on cron `0 3 * * *` (once a day) (`src/services/inngest/functions.ts:4280`).
- On-demand sync: `src/app/api/gbp/sync/route.ts`.
- The only change handling is overwriting `Business.category` when GBP differs (`sync-gbp-profile` step). There is no Google-suggested-edit detection (no `hasGoogleUpdated` / `getGoogleUpdated` usage).

**Assessment:** Sync runs daily, not every 6 hours, and there is no detection of external or Google-suggested edits.

#### FR-3.4 — Encrypted tokens, auto-refresh, revoked-access detection with user alert
> SRS: (P0) Encrypted token storage, auto-refresh, revoked-access detection with user alert

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- Encryption: `src/lib/crypto.ts` (AES-256-GCM), used in `src/lib/gbpConnect.ts:46-47`.
- Auto-refresh: `src/lib/gbpClient.ts` `getValidToken`.
- Revocation: on refresh failure the code sets `Business.googleConnected = false` and throws `GBPAuthError`. No notification, email or WhatsApp alert is sent; a search for a revoke-time notification call found none.

**Assessment:** Encryption and refresh are implemented. Revoked access is detected, but the user is not alerted.

#### FR-3.5 — Verification, suspension and "needs attention" handling
> SRS: (P0) Handle verification status, suspension and "needs attention" states with alerts and a fix guide - Pending

**Status:** 🟡 NOT AVAILABLE

**Evidence:** A search for `voiceOfMerchant`, `verifications`, `SUSPENDED` and similar returned nothing. The audit's "suspension risk" (`src/services/audit/reportMath.ts` `computeSuspensionRisk`) is a heuristic and does not read the real GBP state.

**Assessment:** Not implemented.

#### FR-3.6 — Duplicate listing detection
> SRS: (P1) Duplicate listing detection (Places search by NAP) with a suggested action - Pending

**Status:** 🟡 NOT AVAILABLE

**Evidence:** No duplicate-listing logic was found in `src/services`, `src/lib` or `src/app/api`.

**Assessment:** Not implemented.

#### FR-3.7 — Change history with before/after/source and one-click revert
> SRS: (P0) Change history: every field change stored with before, after, source (user, agent, Google) and timestamp, with one-click revert

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/models/ProfileActivity.ts` holds activity feed rows (`type`, `title`, `detail`, `updatedBy`) with a 180-day TTL. It has no `before` or `after` fields and no revert.
- `src/lib/gbpClient.ts` `updateLocationProfile` overwrites `Business` fields without storing the previous value.
- No `ChangeLog`, `revert` or before/after model exists.

**Assessment:** Not implemented.

#### FR-3.8 — Quota-aware API client with queue, backoff and rate limiting
> SRS: (P0) Quota-aware API client with queue, retry with backoff and per-project rate limiting - Only Reports

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/lib/gbpClient.ts` uses plain `fetch` with no retry, backoff or rate limiting.
- `src/lib/providerMeter.ts` counts provider calls during audits only.
- Retries come from Inngest function `retries` settings, not from a quota-aware client.

**Assessment:** Not implemented as specified.

---

### FR-4 Audit engine

#### FR-4.1 — Profile audit score (0-100) across all listed dimensions
> SRS: (P0) Profile audit score (0-100) across completeness, category fit, services, attributes, photos, posts, reviews, NAP consistency, website and schema

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/services/audit/auditService.ts:639`: `const finalScore = profileCompletion.completionPercentage;` (the headline score is profile completion only).
- `src/services/audit/seoAnalyzer.ts` `calculateProfileCompletion`: `Services Listed`, `Attributes`, `Videos`, `Logo / Cover Image` and `Social Links` are always pushed as `'Unknown'`.
- No posts, NAP-consistency or schema dimension exists.

**Assessment:** A 0-100 score exists, but it does not cover the dimensions the SRS lists.

#### FR-4.2 — Competitor benchmark
> SRS: (P0) Competitor benchmark: top 3 to 5 local-pack competitors per target keyword; compare categories, review count and velocity, photo count, posting frequency

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/services/audit/competitorService.ts`: the `Competitor` interface holds name, rating, reviewCount, category, website and distance; `calculateGapAnalysis` compares review count and website.
- `src/services/audit/facts.ts:461` `ReviewComparison`: lifetime review count and rating medians only.
- No competitor photo count, review velocity or posting frequency is collected.

**Assessment:** Partial. Review velocity, photo count and posting frequency are not compared.

#### FR-4.3 — Keyword research
> SRS: (P0) Keyword research: seed from category and services, expand to "service + locality" terms, show volume estimates where available

**Status:** 🟢 AVAILABLE

**Evidence:**
- `src/services/audit/keywordSeeds.ts` `buildFreeReportKeywords`: seeds from the category and expands to `<category> <neighbourhood>`, city and "near me" terms.
- `src/services/audit/auditService.ts:199-310`: adds the services stated on the website and the owner's services (`websiteServiceKeywords`, `ownerTerms`).
- `src/services/audit/localities.ts`: neighbourhood discovery.
- `src/services/audit/keywordVolumeClient.ts`: live DataForSEO Google Ads search volume, with an estimate fallback (`src/lib/cityTierVolume.ts`).
- Tests: `tests/integration/audit-intel.test.ts`, `audit-facts.test.ts`.

**Assessment:** Implemented as specified.

#### FR-4.4 — Prioritised issue list with impact and "fix it for me"
> SRS: (P0) Prioritised issue list (critical, high, medium) with estimated impact and a "fix it for me" action

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/services/audit/findings.ts:102`: `Severity = 'high' | 'medium' | 'low'`, with no "critical" level.
- `src/models/OptimizationAction.ts` tracks plan items.
- No "fix it for me" action exists in `src/components` or `src/app` (search for "fix it" returned nothing).

**Assessment:** A prioritised findings list exists. The critical tier and the one-click fix action are missing.

#### FR-4.5 — Website audit
> SRS: (P1) Website audit for the linked URL: title, H1, NAP in text, embedded map, schema presence and validity, mobile and speed signals, HTTPS, indexability

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/services/audit/websiteSignals.ts` reads the title, meta description, sitemap page count and FAQ/About/Contact/Pricing/Blog presence.
- `src/services/intel/websiteIntelligence.ts` and `websiteExtract.ts` extract services.
- No checks exist for NAP in text, embedded map, schema validity, mobile or speed, HTTPS, or indexability (no `ld+json`, `noindex` or `viewport` parsing found).

**Assessment:** Light website read only.

#### FR-4.6 — Automatic monthly re-audit, re-audit after major changes, score trend
> SRS: (P0) Automatic monthly re-audit and re-audit after major changes; score trend

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/lib/auditAutopilot.ts` (`AUDIT_AUTOPILOT_INTERVAL_MS` = 30 days) and `auditAutopilotCron` (hourly check) run the monthly re-audit.
- `src/app/dashboard/audit/history/page.tsx` shows audit history.
- No re-audit is triggered by profile changes.

**Assessment:** The monthly re-audit exists; re-audit after major changes is missing.

#### FR-4.7 — Public lead-magnet audit page
> SRS: (P2) Public lead-magnet audit page: a prospect enters a business name and gets a mini report and a sign-up prompt

**Status:** 🟢 AVAILABLE

**Evidence:**
- `src/app/free-report/page.tsx` and `src/app/free-report/result/page.tsx`.
- `src/app/api/free-report/start/route.ts`: durable rate limit, shadow account, audit dispatch.
- `src/services/leads/beginFreeReport.ts`.
- `src/components/audit/AuditPaywallSidebar.tsx` shows the upgrade prompt.

**Assessment:** Implemented.

---

### FR-5 Profile optimization automation

#### FR-5.1 — Primary and secondary category recommendation
> SRS: (P0) Primary and secondary category recommendation based on competitor usage and the business's services; apply with approval

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `src/services/ai/seoPlanEngine.ts:577` carries the comment "No AI-suggested categories: nothing can verify them". `SeoPlan.suggestedCategories` exists but is not populated by recommendation logic, and no apply path writes categories (`updateLocationProfile` supports only title, description, phone and website).

**Assessment:** Not implemented.

#### FR-5.2 — Description generator with policy checks
> SRS: (P0) Description generator (750 characters max, first 250 carry the key message), policy-checked: no links, no promotions, no stuffing

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/services/ai/seoPlanEngine.ts:540`: prompt asks for 150-750 characters. The output is passed through `groundText` and truncated to 750 in `src/services/seoPlan/applyPlan.ts`.
- No deterministic check exists for links, promotions or stuffing on the description (`src/services/audit/validateAudit.ts` has no URL or promotion rule for descriptions).
- Applying writes to Google only when live writes are enabled (they are disabled).

**Assessment:** A generator exists, but the specified policy checks are not enforced, and it cannot be applied live.

#### FR-5.3 — Services and products generator with bulk apply
> SRS: (P0) Services and products generator: names and descriptions with natural keywords, bulk apply

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `SeoPlan.suggestedServices` is a copy of verified service names (`seoPlanEngine.ts:576`). There are no generated descriptions, no products, and no apply path (`applyActivePlanToProfile` handles title and description only).

**Assessment:** Not implemented.

#### FR-5.4 — Attribute completion
> SRS: (P0) Attribute completion: suggest and apply all applicable attributes

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `seoPlanEngine.ts:553` states "Tell us which attributes genuinely apply — we never guess them". No attribute read or write exists.

**Assessment:** Not implemented.

#### FR-5.5 — Hours manager with festival reminders
> SRS: (P0) Hours manager: regular, holiday and special hours; reminders for upcoming festivals and holidays

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/app/api/gbp/profile/route.ts` edits title, description, phone and website only.
- `src/app/api/whatsapp/business-hours/route.ts` holds hours for the WhatsApp agent, not GBP.
- `src/lib/festivalCalendar.ts` is used for festival *posts*, not hours reminders.

**Assessment:** Not implemented.

#### FR-5.6 — Business name guard
> SRS: (P0) Business name guard: warn on any keyword-stuffed name change; never auto-edit name, address or primary category without explicit approval

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `seoPlanEngine.ts:314` `safeSuggestedTitle` only allows the AI to *remove* words from the name.
- Manual name edits through `src/app/api/gbp/profile/route.ts` (zod `title`) have no stuffing warning.
- Profile writes are owner-initiated (`src/models/ProfileActivity.ts` notes no autonomous edits exist).

**Assessment:** No automatic name edits happen, but the required warning on keyword-stuffed manual name changes is missing.

#### FR-5.7 — Links with auto-added UTM parameters
> SRS: (P0) Website, appointment, menu and order links with auto-added UTM parameters

**Status:** 🟡 NOT AVAILABLE

**Evidence:** A search for `utm_source` and `utm_medium` across `src/` returned nothing. Only the website link is editable.

**Assessment:** Not implemented.

#### FR-5.8 — Service-area manager
> SRS: (P1) Service-area manager for SABs: add up to 20 areas by city or PIN code

**Status:** 🟡 NOT AVAILABLE

**Evidence:** No service-area read or write. `seoAnalyzer.ts` reports `Service Area` as `'Unknown'`.

**Assessment:** Not implemented.

#### FR-5.9 — Pin accuracy check
> SRS: (P1) Pin accuracy check: compare the pin against the geocoded address and flag mismatch

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `src/lib/gbpClient.ts` `fetchLocationPin` is used only by `src/lib/verifiedLocation.ts` for image geotags. There is no comparison with the geocoded address.

**Assessment:** Not implemented.

#### FR-5.10 — Every automated edit previewed, logged and reversible
> SRS: (P0) Every automated edit is previewed, logged and reversible (see FR-3.7)

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `src/app/dashboard/seo-plan/page.tsx` previews the suggested title and description. `ProfileActivity` logs that a change happened. Revert is impossible (see FR-3.7).

**Assessment:** Preview and basic logging exist; reversibility is missing.

---

### FR-6 Photo and media manager

#### FR-6.1 — Upload from web or mobile (PWA) with drag-and-drop and bulk upload
> SRS: (P0) Upload photos and videos from web or mobile (PWA) with drag-and-drop and bulk upload; accept JPG, PNG and MP4

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/app/api/gbp/media/upload/route.ts` accepts one file per request (JPEG, PNG, WebP, MP4, MOV).
- `src/components/gbp/GbpMediaManager.tsx` has no `onDrop` and no `multiple` attribute.
- There is no PWA manifest or service worker in `public/` or `src/app`. The native Expo app has photo screens (`mobile/src/app/(app)/photos`).

**Assessment:** Single-file upload works on web and native mobile. Drag-and-drop, bulk upload and PWA are missing.

#### FR-6.2 — Auto-validate against GBP specs
> SRS: (P0) Auto-validate against GBP specs: JPG or PNG, 10 KB to 5 MB, minimum 720x720 px, video up to 30 seconds and 75 MB; flag blur, low resolution and stock photos - Pending

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `src/app/api/gbp/media/upload/route.ts:13-14`: `MAX_IMAGE_BYTES = 10 MB` (the spec says 5 MB) and `MAX_VIDEO_BYTES = 75 MB`. There is no 10 KB minimum, no 720×720 minimum, no video-duration check, and no blur, low-resolution or stock-photo detection.

**Assessment:** Only MIME type and maximum size are checked, and the image limit does not match the spec.

#### FR-6.3 — Category tagging
> SRS: (P0) Category tagging: logo, cover, exterior, interior, team, at work, product, common area, food and drink

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `src/models/GbpMediaAsset.ts:73`: `category` enum is `['LOGO','COVER','ADDITIONAL','PROFILE']`.

**Assessment:** The exterior, interior, team, at work, product, common area and food and drink categories are missing.

#### FR-6.4 — SEO file renaming
> SRS: (P0) SEO file renaming with a brand-service-locality.jpg pattern

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `src/lib/storage.ts` `uploadPublicObject` is called with the prefix `gbp-media/<businessId>`. No brand-service-locality naming logic exists.

**Assessment:** Not implemented.

#### FR-6.5 — EXIF writer
> SRS: (P1) EXIF writer: embed GPSLatitude and GPSLongitude (from the verified pin), title, description, keywords and copyright before upload, using a server-side library such as ExifTool

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/lib/imageGeotag.ts` `geotagMedia` writes GPS IFD tags (`exifGpsTags`) using `sharp`, preferring the verified pin from `src/lib/verifiedLocation.ts`.
- `src/lib/mediaUpload.ts` `prepareGalleryMedia` applies it on upload.
- Test: `tests/integration/geotag.test.ts`.
- No title, description, keywords or copyright tags are written.

**Assessment:** The GPS part is implemented; the other required EXIF fields are not.

#### FR-6.6 — EXIF safety
> SRS: (P1) EXIF safety: coordinates may only be the business's real location or the genuine capture location; no user-entered fake coordinates; strip personal data such as device serial and owner name

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/lib/mediaUpload.ts:40-47` `photoLocationFromForm` accepts client-supplied `photoLat` and `photoLng` with a self-declared `photoLocationSource`. The server cannot tell these from user-entered coordinates.
- `src/lib/imageGeotag.ts` uses `keepMetadata()` and `withExifMerge`, which keep existing EXIF. There is no stripping of device serial or owner name.

**Assessment:** The verified pin is preferred, but fake-coordinate prevention and personal-data stripping are not enforced.

#### FR-6.7 — EXIF reader with home-location warning
> SRS: (P1) EXIF reader: show existing metadata; warn if a phone photo carries a home address location

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `readImageExifTags` and `listExifTags` exist in `src/lib/imageGeotag.ts`, but no caller exists outside that file. No UI shows metadata and no home-location warning exists.

**Assessment:** Not implemented as a feature.

#### FR-6.8 — Publish via the Media API; sync existing and customer photos
> SRS: (P0) Publish to GBP via the Media API; sync existing GBP and customer-uploaded photos into the library

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/lib/gbpMediaService.ts` `publishAsset` calls `uploadLocationPhoto` (`src/lib/gbpClient.ts:504`), which returns `liveWriteApplied: false` while `GBP_LIVE_WRITES_ENABLED=false`.
- `listMediaAssets` reconciles owner media via `listLocationMedia`. Customer-uploaded media (the separate customer-media endpoint) is not synced.

**Assessment:** Publishing is disabled in every repository environment file, and customer photos are not synced.

#### FR-6.9 — Photo cadence planner
> SRS: (P1) Photo cadence planner with weekly target, reminder and a mobile upload link sent to staff

**Status:** 🟡 NOT AVAILABLE

**Evidence:** No cadence, target or staff upload-link logic was found.

**Assessment:** Not implemented.

#### FR-6.10 — Photo coverage score per category
> SRS: (P1) Photo coverage score per category with gaps highlighted

**Status:** 🟡 NOT AVAILABLE

**Evidence:** None found. The only "coverage score" in the code is review keyword coverage (`seoAnalyzer.ts:287`).

**Assessment:** Not implemented.

#### FR-6.11 — Export geotagged and renamed images
> SRS: (P1) Export the same geotagged and renamed images for the business website

**Status:** 🟡 NOT AVAILABLE

**Evidence:** There is no export function. Renaming does not exist (FR-6.4).

**Assessment:** Not implemented.

---

### FR-7 Review management

#### FR-7.1 — Pull all reviews; poll at least hourly
> SRS: (P0) Pull all reviews with rating, text, reviewer, date and reply status; poll at least hourly

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/services/reviews/providers/GbpApiReviewProvider.ts` (v4 `.../reviews`) and `src/services/reviews/syncReviews.ts`. `src/models/Review.ts` stores rating, text, reviewer, reply status and timestamps.
- Scheduling: `reviewSyncWorker` runs on cron `0 2 * * *` (nightly) and `gbpSyncWorker` runs nightly. `reviewAutopollCron` (hourly) is a no-op that returns `skipped: 'clicks are not reviews'`.

**Assessment:** Review fields are pulled, but only daily, not hourly.

#### FR-7.2 — Unified inbox with filters, assignment and status
> SRS: (P0) Unified inbox with filters (rating, unreplied, keyword, sentiment), assignment to staff and status

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/components/reviews/ReviewFilterBar.tsx` filters are `all, unanswered, critical, 5-star, positive, negative`. There is no keyword search and no full rating filter.
- `src/models/Review.ts` has no assignee field, and a search for review assignment found nothing.

**Assessment:** A filtered review list exists. Keyword filtering and staff assignment are missing.

#### FR-7.3 — AI reply drafts; approve, edit or auto-post (auto-post limited to 4 and 5 star)
> SRS: (P0) AI reply drafts in the brand voice: personal, mention the service or locality naturally, apologetic and offline-friendly for negatives; approve, edit or auto-post (auto-post limited to 4 and 5 star, by user choice)

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/services/reviews/replyPipeline.ts` (draft, validate, approve, publish), `src/services/reviews/validateReply.ts`, routes `src/app/api/reviews/[id]/approve-reply|reject-reply|post-reply`.
- `src/services/reviews/autoReply.ts` auto-publishes whenever `isAutoPublishActive` is true. **There is no rating filter**, so auto mode would post replies to 1-3 star reviews too.
- Publishing calls `replyToReview`, which is gated off (`GBP_LIVE_WRITES_ENABLED=false`).

**Assessment:** Drafting and approval are implemented. The 4-5 star auto-post limit is missing, and live posting is disabled.

#### FR-7.4 — Reply SLA tracker with alerts after 24 hours
> SRS: (P0) Reply SLA tracker with alerts for any review unanswered for more than 24 hours

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `src/services/lifecycle/weekly.ts:72-74` includes an unanswered count in the **weekly** summary. No 24-hour SLA timer or alert exists.

**Assessment:** Not implemented.

#### FR-7.5 — Review request engine
> SRS: (P0) Review request engine: unique short link and QR code, WhatsApp, SMS and email templates, triggered from the CRM after a completed service

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- Short link: `src/app/review/[token]` with `src/lib/reviewRedirect.ts` and `src/lib/reviewRequestFlow.ts`. QR: `src/components/reviews/ReviewQrCard.tsx`.
- `src/models/ReviewRequest.ts:19`: `channel: 'whatsapp'` only. Twilio sends in `src/services/twilio/client.ts` all use the `whatsapp:` prefix.
- `src/services/email.ts` `sendEmail` (review-request email) has no callers.
- No SMS path exists.
- No CRM-stage trigger exists (see FR-13.6).

**Assessment:** Link, QR code and WhatsApp work. SMS, email delivery and the CRM trigger are missing.

#### FR-7.6 — Request pacing with per-customer frequency cap; no review gating
> SRS: (P0) Request pacing for steady velocity with a per-customer frequency cap; no review gating, so every customer gets the same request

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- No gating: every click is redirected to Google's write-review URL (`src/lib/reviewRedirect.ts`, covered by `tests/integration/review-request-flow.test.ts`).
- Pacing: the daily WhatsApp cap via `checkUsageLimit('whatsappMessages')` in `src/lib/reviewSendEligibility.ts`.
- **Per-customer cap disabled:** `src/lib/reviewRequestFlow.ts:19` sets `export const REVIEW_SEND_COOLDOWN_ENFORCED = false;`, and `src/lib/reviewSendEligibility.ts` notes the 3-attempts/24-hours rule "is not applied".

**Assessment:** No gating exists and daily pacing works, but the per-customer frequency cap is turned off.

#### FR-7.7 — Sentiment and topic analysis
> SRS: (P1) Sentiment and topic analysis of recurring praise and complaints, such as staff, wait time and price

**Status:** 🟢 AVAILABLE

**Evidence:**
- `src/services/reviews/sentimentEngine.ts` labels each review as positive, neutral, negative or critical (stored in `Review.sentiment`).
- `src/services/ai/auditEngine.ts:149` and `src/services/audit/fieldRegistry.ts:110-118` produce `reviewAnalysis.{reviewThemes, mostCommonPraises, mostCommonComplaints}` from real review text, shown in the audit and monthly reports.

**Assessment:** Implemented. Topic analysis runs inside the audit and monthly report, not in the review inbox.

#### FR-7.8 — Flag fake or policy-violating reviews
> SRS: (P1) Flag suspected fake or policy-violating reviews and prepare a removal request

**Status:** 🟡 NOT AVAILABLE

**Evidence:** No flagging or removal-request logic was found.

**Assessment:** Not implemented.

#### FR-7.9 — Review widget for the business website
> SRS: (P1) Review widget for the business website (embed script) showing real reviews

**Status:** 🟡 NOT AVAILABLE

**Evidence:** No embed script or public widget route was found.

**Assessment:** Not implemented.

#### FR-7.10 — Review velocity and rating trend versus competitors
> SRS: (P1) Review velocity and rating trend versus competitors

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `src/services/audit/facts.ts:476` `compareReviews` compares lifetime count and rating medians at one point in time. There is no competitor velocity or trend.

**Assessment:** Not implemented.

#### FR-7.11 — Compliance guard against purchased reviews, incentives and dictated wording
> SRS: (P0) Compliance guard: block purchased reviews, incentives for reviews, and templates that dictate rating or wording

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `src/app/api/campaigns/generate-message/route.ts` generates review-request text with Groq and does not validate incentive or rating-dictation language. No such guard exists in `src/lib/whatsappTemplates.ts` or the campaign routes.

**Assessment:** Not implemented.

---

### FR-8 Post creation and scheduling

#### FR-8.1 — Post types with image, CTA and UTM link
> SRS: (P0) Post types What's New, Offer and Event, each with image, CTA button (Book, Order, Learn more, Sign up, Call) and link with UTM

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/lib/gbpClient.ts:414` hard-codes `topicType: 'STANDARD'`. There is no OFFER or EVENT payload.
- CTA action types are supported in `LocalPostInput`.
- No UTM handling exists anywhere.

**Assessment:** Only "What's New" (STANDARD) posts are possible, with no UTM links.

#### FR-8.2 — AI post generator
> SRS: (P0) AI post generator from the profile, services, offers, festivals and recent reviews; produces body up to 1,500 characters, CTA and image suggestion

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/services/ai/contentEngine.ts` and `src/services/content/weeklyBatch.ts` / `plan.ts` generate from the SEO plan, services, owner offer (`WeeklyOffer`) and festivals (`src/lib/festivalCalendar.ts`), returning `cta` and `thumbnailPrompt`.
- Recent reviews are **not** an input (none referenced in `src/services/content`).
- 1,500 characters is only a publish-time truncation (`src/services/content/publishPost.ts:43`).

**Assessment:** Mostly implemented. The recent-reviews input is missing.

#### FR-8.3 — AI image creation or template graphics with canvas editor
> SRS: (P1) AI image creation or template graphics (brand colours, logo) with a canvas editor

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/services/ai/imageGenerator.ts` uses Gemini or NanoBanana.
- `src/services/content/creative.ts` and `src/services/content/images.ts` handle brand-colour fallback graphics.
- No canvas editor component exists.

**Assessment:** Image generation exists; the canvas editor is missing.

#### FR-8.4 — Content calendar with month and week views and drag-and-drop
> SRS: (P0) Content calendar (month and week views) with drag-and-drop rescheduling

**Status:** 🟢 AVAILABLE

**Evidence:**
- `src/components/scheduler/WeeklyCalendar.tsx` has month (`generateMonthGrid`, `DroppableMonthCell`) and week views and uses `@dnd-kit`.
- `onReschedule` calls `/api/scheduler/posts/[id]`. Published posts are not draggable.
- Page: `src/app/dashboard/scheduler/page.tsx`.

**Assessment:** Implemented.

#### FR-8.5 — Scheduler publishes through the Local Posts API, with retry and failure alerts
> SRS: (P0) Scheduler publishes at the chosen time through the Local Posts API, with retry and failure alerts

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `scheduleSinglePostPublish` (sleep until `scheduledDate`) → `processPublishPostJob` → `src/services/content/publishPost.ts`. There is an hourly safety-net cron and a `post_failed` notification.
- With `GBP_LIVE_WRITES_ENABLED=false` the outcome is `blocked` ("nothing reached Google").
- Google rejections are recorded as `failed` and deliberately **not retried** (comment in `functions.ts:1588-1591`).

**Assessment:** The scheduling mechanism exists, but live publishing is disabled and failed publishes are not retried.

#### FR-8.6 — Bulk plan of 4 to 12 weeks in one click
> SRS: (P0) Bulk plan: auto-generate 4 to 12 weeks of posts in one click for approval

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/services/content/weeklyBatch.ts` generates **one week** (4 slots) per run.
- `weeklyContentAutopilot` runs weekly.
- `src/app/api/scheduler/generate/route.ts` dispatches one generation.
- `src/app/api/content/auto-schedule/route.ts` schedules existing posts.

**Assessment:** No 4-12 week one-click plan exists.

#### FR-8.7 — Recurring and evergreen rules; auto-expire offers and events
> SRS: (P1) Recurring and evergreen post rules; auto-expire offers and events

**Status:** 🟡 NOT AVAILABLE

**Evidence:** No evergreen, recurring or expiry logic was found.

**Assessment:** Not implemented.

#### FR-8.8 — Policy checker
> SRS: (P0) Policy checker: no phone numbers in text, no prohibited content, no excessive caps or emoji, offer dates present

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `src/services/content/validatePost.ts` checks claims, superlatives, discounts, unknown services, third-party links and SEO meta-language. Phone numbers are **allowed** when they match the business phone. There are no caps or emoji checks and no offer-date check.

**Assessment:** A strong fact-check exists, but several SRS policy rules are not enforced.

#### FR-8.9 — Post performance stored and used for future generation
> SRS: (P1) Post performance (views, clicks) stored and used to guide the next generation

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `src/models/Post.ts` has no views or clicks metrics.

**Assessment:** Not implemented.

#### FR-8.10 — Cross-post to Facebook and Instagram
> SRS: (P2) Cross-post to Facebook and Instagram pages through Meta APIs

**Status:** 🟡 NOT AVAILABLE

**Evidence:** The only Meta Graph usage is WhatsApp (`src/services/whatsapp/meta.ts`).

**Assessment:** Not implemented.

---

### FR-9 Citations and NAP consistency

#### FR-9.1 — NAP master record per location
> SRS: (P0) NAP master record per location, including variants such as abbreviations and old addresses

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `Business` holds a single name, address and phone. There is no variants or history structure, and a search for NAP or citation models returned nothing.

**Assessment:** Not implemented.

#### FR-9.2 — Citation scan
> SRS: (P1) Citation scan across core and niche directories, with name, address and phone match status

**Status:** 🟡 NOT AVAILABLE

**Evidence:** None found. The audit's `platformGaps` prompt (`seoPlanEngine.ts:541`) explicitly says "we did NOT check whether the business is listed there".

**Assessment:** Not implemented.

#### FR-9.3 — Directory library
> SRS: (P1) Directory library by country and category (India: JustDial, Sulekha, IndiaMART, Shiksha and similar; global: Bing Places, Apple Business Connect, Yelp, Foursquare)

**Status:** 🟡 NOT AVAILABLE

**Evidence:** None found.

**Assessment:** Not implemented.

#### FR-9.4 — Fix workflow
> SRS: (P1) Fix workflow: auto-submit where an API or partner aggregator exists, otherwise a guided checklist with copy-paste data and status tracking

**Status:** 🟡 NOT AVAILABLE

**Evidence:** None found.

**Assessment:** Not implemented.

#### FR-9.5 — Duplicate and wrong-listing detection
> SRS: (P1) Duplicate and wrong-listing detection with a suppression or correction task

**Status:** 🟡 NOT AVAILABLE

**Evidence:** None found.

**Assessment:** Not implemented.

#### FR-9.6 — Bing Places and Apple Business Connect sync
> SRS: (P2) Bing Places and Apple Business Connect sync via API or bulk upload

**Status:** 🟡 NOT AVAILABLE

**Evidence:** None found.

**Assessment:** Not implemented.

#### FR-9.7 — Monthly citation health score
> SRS: (P1) Monthly citation health score

**Status:** 🟡 NOT AVAILABLE

**Evidence:** None found.

**Assessment:** Not implemented.

---

### FR-10 Website and schema helpers

#### FR-10.1 — JSON-LD generator for the business
> SRS: (P0) JSON-LD generator for LocalBusiness or a subtype with name, address, phone, geo coordinates, hours, areaServed, sameAs, hasMap, services and FAQ

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `src/lib/seoSchemas.ts` and `src/components/seo/JsonLd.tsx` generate schema for **GrowMatic's own marketing pages** (`src/app/faq`, `src/app/services/*`). No customer LocalBusiness generator exists (a search for `LocalBusiness` in customer features returned nothing).

**Assessment:** Not implemented for customers.

#### FR-10.2 — Snippet, WordPress plugin, GTM or hosted JS delivery
> SRS: (P1) Delivery as copy-paste snippet, WordPress plugin, Google Tag Manager snippet or hosted JS include

**Status:** 🟡 NOT AVAILABLE

**Evidence:** None found.

**Assessment:** Not implemented.

#### FR-10.3 — Schema validator
> SRS: (P1) Schema validator against Google's rich result rules; warn about ineligible self-serving review markup

**Status:** 🟡 NOT AVAILABLE

**Evidence:** None found.

**Assessment:** Not implemented.

#### FR-10.4 — Location landing page generator
> SRS: (P1) Location landing page generator: SEO title, H1, unique copy, NAP, embedded map, FAQ, directions and landmarks, exported as HTML or pushed to WordPress

**Status:** 🟡 NOT AVAILABLE

**Evidence:** None found. `src/models/SEOContent.ts` and the Content Studio SEO tab store a generated description and keywords, not a landing page.

**Assessment:** Not implemented.

#### FR-10.5 — Service-area city page generator
> SRS: (P2) Service-area city page generator with a duplicate-content guard

**Status:** 🟡 NOT AVAILABLE

**Evidence:** None found.

**Assessment:** Not implemented.

#### FR-10.6 — Internal linking suggestions
> SRS: (P2) Internal linking and anchor suggestions

**Status:** 🟡 NOT AVAILABLE

**Evidence:** None found.

**Assessment:** Not implemented.

#### FR-10.7 — Click-to-call and WhatsApp widget with tracking
> SRS: (P1) Click-to-call and WhatsApp widget with call and click tracking

**Status:** 🟡 NOT AVAILABLE

**Evidence:** No embeddable widget exists. `src/lib/phoneLinks.ts` builds links inside the app only.

**Assessment:** Not implemented.

#### FR-10.8 — Search Console connection
> SRS: (P1) Search Console connection for query and page data on the location pages

**Status:** 🟡 NOT AVAILABLE

**Evidence:** No Search Console API usage (searched `searchconsole` and `webmasters`).

**Assessment:** Not implemented.

---

### FR-11 Rank tracking

#### FR-11.1 — Track keywords per location with plan limits
> SRS: (P0) Track keywords per location, with plan limits on keyword count

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- No tracked-keyword entity exists.
- `src/models/GBPKeyword.ts` stores Google-reported search impressions, not tracked rank keywords.
- Keywords are ranked only inside audits (`src/models/Audit.ts` `IKeywordRank`).
- No keyword-count limit exists in `PlanLimits`.

**Assessment:** Not implemented as a tracking feature.

#### FR-11.2 — Geo-grid rank checks rendered as a heat map
> SRS: (P0) Geo-grid rank checks (for example 5x5 or 7x7 points, 1 to 10 km radius) showing local-pack position per point, rendered as a heat map

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/services/audit/geoGrid.ts`: fixed `GRID_SIZE = 3` and `GRID_SPACING_KM = 1.5` (a 3×3 grid, ±1.5 km), run only inside audits.
- `src/app/api/audit/[id]/geo-map/route.ts` renders a static map image.
- Grid size and radius are not configurable.

**Assessment:** A fixed 3×3 audit grid exists. Configurable grids (5×5 or 7×7, 1-10 km) as a tracking feature do not.

#### FR-11.3 — Weekly scheduled scans plus on-demand scans, with credit usage shown
> SRS: (P0) Scheduled scans (weekly by default) plus on-demand scans, with credit usage shown

**Status:** 🟡 NOT AVAILABLE

**Evidence:** Rank data is refreshed only by the monthly re-audit (`src/lib/auditAutopilot.ts`). There is no weekly scan cron and no scan-credit display.

**Assessment:** Not implemented.

#### FR-11.4 — Competitor tracking (positions 1 to 3 over time)
> SRS: (P1) Competitor tracking: who holds positions 1 to 3 for each keyword and how that changes

**Status:** 🟡 NOT AVAILABLE

**Evidence:** Competitors "above you" are captured per audit (`aheadFacts` in `src/services/audit/auditService.ts`). There is no per-keyword top-3 history.

**Assessment:** Not implemented.

#### FR-11.5 — Rank history, share of voice, movement alerts
> SRS: (P1) Rank history, share-of-voice score and movement alerts (drop of 3 or more positions)

**Status:** 🟡 NOT AVAILABLE

**Evidence:** The monthly report compares rankings across audits (`src/services/lifecycle/monthly.ts`). There is no share-of-voice score and no rank-drop alert (no such notification type is emitted).

**Assessment:** Not implemented.

#### FR-11.6 — Organic rank via Search Console
> SRS: (P1) Organic (web) rank for the location landing page via Search Console

**Status:** 🟡 NOT AVAILABLE

**Evidence:** No Search Console integration.

**Assessment:** Not implemented.

#### FR-11.7 — Swappable rank data provider; cost per scan documented
> SRS: (P0) Rank data provider abstraction so the SERP or Maps data source can be swapped; document cost per scan

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- Cost is documented in `src/services/audit/costModel.ts` (`UNIT_PRICES.dataForSeoMapsLiveTask`).
- Ranking calls `src/services/audit/dataForSeoClient.ts` directly, with no provider interface (unlike reviews, which have `src/services/reviews/providers/index.ts`).

**Assessment:** Cost documentation exists; the provider abstraction does not.

---

### FR-12 Analytics and reporting

#### FR-12.1 — Performance dashboard
> SRS: (P0) Dashboard from the GBP Performance API: search views (branded versus discovery), Maps and Search impressions, calls, messages, bookings, direction requests, website clicks

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/lib/gbpClient.ts` `fetchDailyMetrics` requests impressions (desktop and mobile, Search and Maps), call clicks, website clicks, direction requests and conversations.
- These are stored in `src/models/GBPInsights.ts` and served by `src/app/api/gbp/insights/route.ts` to `src/app/dashboard/insights/page.tsx`.
- **Bookings** (`BUSINESS_BOOKINGS`) and branded-versus-discovery split are absent.

**Assessment:** Mostly implemented; bookings and the branded/discovery split are missing.

#### FR-12.2 — Top search queries, month on month
> SRS: (P0) Top search queries that triggered the profile, month on month

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `fetchSearchKeywords` stores monthly rows in `GBPKeyword` (`src/services/inngest/functions.ts` sync step).
- `src/app/api/gbp/insights/route.ts:205-225` and `src/app/api/gbp/keyword-intelligence/route.ts:13-16` read **only the latest month**.

**Assessment:** Top queries are shown for one month; there is no month-on-month comparison.

#### FR-12.3 — Review metrics
> SRS: (P0) Review metrics: count, average rating, velocity, response rate and response time

**Status:** 🟡 NOT AVAILABLE

**Evidence:** The `src/services/reviews/reviewMetrics.ts` `ReviewMetrics` interface has total, average, unanswered, response rate, sentiment and star distribution. There is no response time, and no velocity on the dashboard (velocity exists only inside audit facts).

**Assessment:** Response time and dashboard velocity are missing.

#### FR-12.4 — Post and photo performance
> SRS: (P0) Post and photo performance

**Status:** 🟡 NOT AVAILABLE

**Evidence:** No views or clicks for posts or photos are stored (`src/models/Post.ts`, `src/models/GbpMediaAsset.ts`).

**Assessment:** Not implemented.

#### FR-12.5 — GA4 integration
> SRS: (P1) GA4 integration with UTM-tagged GBP traffic, conversions and goal events

**Status:** 🟡 NOT AVAILABLE

**Evidence:** GA4 appears only in GrowMatic's own CSP allow-list (`next.config.ts`). There is no GA4 Data API usage and no UTM tagging.

**Assessment:** Not implemented.

#### FR-12.6 — Call tracking with call log and recording
> SRS: (P1) Call tracking: optional tracking number or click-to-call event capture, with call log and recording where legally permitted

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- Tracking number: `src/app/api/twilio/voice/route.ts` → `src/services/crm/calls.ts` (`businessForCalledNumber`, `recordCallEvent`) → `src/models/CallEvent.ts`. Call log: `src/app/api/crm/calls`, `src/components/crm/PendingCallsBanner.tsx`.
- Recording: `src/services/telephony/normalize.ts:10-11,69` always sets `recordingUrl: null` ("not enabled anywhere today").

**Assessment:** Tracking-number capture and the call log exist; recording is not implemented.

#### FR-12.7 — Automated monthly PDF and email report
> SRS: (P0) Automated monthly PDF and email report (white-label for agencies) with plain-language insights and next-month plan

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- The monthly audit is automatic (`auditAutopilotCron`), and its content is built in `src/services/lifecycle/monthly.ts`.
- `src/services/lifecycle/notify.ts` `notifyMonthlyReport` sends an in-app notification and a WhatsApp summary.
- A PDF is available on request (`src/app/api/audit/[id]/pdf/route.ts`).
- **No email delivery** (`sendTransactionalEmail` is used only for billing and demo emails) and **no white-label** branding.

**Assessment:** The monthly report is generated and delivered in-app and on WhatsApp. Email delivery and white-label are missing.

#### FR-12.8 — Date range picker, previous-period comparison, CSV export
> SRS: (P0) Date range picker, comparison to the previous period, CSV export

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/app/api/gbp/insights/route.ts`: preset ranges (`VALID_RANGES`) and a previous period of the same length (`pctChange`).
- No CSV export exists (the only CSV code is the CRM import template download).

**Assessment:** CSV export is missing.

#### FR-12.9 — Goal tracking
> SRS: (P1) Goal tracking: owner sets a target (for example calls per month) and sees progress

**Status:** 🟡 NOT AVAILABLE

**Evidence:** No goal or target model or UI was found.

**Assessment:** Not implemented.

#### FR-12.10 — Weekly WhatsApp or email digest
> SRS: (P1) Weekly WhatsApp or email digest of the three numbers that matter

**Status:** 🟢 AVAILABLE

**Evidence:**
- `seoPlanWeeklySummary` (cron `0 12 * * 1`) → `src/services/lifecycle/notify.ts` `runWeeklyMonitoringAll` → `src/services/lifecycle/weekly.ts` `buildWeeklySummary`. This produces a WhatsApp summary of reviews, unanswered reviews and performance, with the `weeklyUpdateWhatsApp` and `weeklyReportAlwaysWhatsApp` preferences.
- A 15-day performance digest also exists (`src/services/lifecycle/performanceDigest.ts`).
- Test: `tests/integration/lifecycle.test.ts`.

**Assessment:** Implemented. The digest is sent when the week has activity, or every week if the owner opts in.

---

### FR-13 Mini CRM

#### FR-13.1 — Contacts with consent status; CSV import and manual add
> SRS: (P0) Contacts with name, phone, email, source, tags, notes and consent status; import by CSV and manual add

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/models/Lead.ts` has name, phone, `email`, `source`, `tags`, `notes`.
- Import: `src/app/api/crm/leads/import/route.ts` (CSV and XLSX). Manual add: `src/app/api/leads/quick-add/route.ts`.
- Consent: there is no consent-status field. Only opt-out exists (`Lead.nurtureStatus = 'OPTED_OUT'`, `Customer.optedOut`).

**Assessment:** Contacts, import and manual add exist; consent status is not stored.

#### FR-13.2 — Lead capture from GBP channels, widgets and a hosted enquiry form
> SRS: (P0) Lead capture from GBP channels: call events, message and booking leads, website forms and click-to-call or WhatsApp widget, and a hosted enquiry form with QR code

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- Call events become leads through "Save as lead" (`src/services/crm/calls.ts`). WhatsApp inbound messages create leads (`src/app/api/whatsapp/webhook/route.ts`).
- There is no GBP message or booking lead capture, no website-form endpoint, no widget, and no hosted enquiry form with QR code.

**Assessment:** Partial.

#### FR-13.3 — Pipeline with Kanban and list view
> SRS: (P0) Pipeline with stages (New, Contacted, Booked, Won, Lost) in a Kanban and list view

**Status:** 🟢 AVAILABLE

**Evidence:**
- `src/lib/leadStages.ts`: configurable stages, with defaults New, Exploring, Interested, Follow Up, Prospect, Sales Closed, Lost, and owners can rename or add stages.
- `src/app/api/business/lead-stages/route.ts`.
- `src/components/crm/KanbanBoard.tsx` and `src/components/crm/LeadListView.tsx`, toggled in `src/app/dashboard/crm/page.tsx`.

**Assessment:** Implemented. The default stage names differ from the SRS but are configurable.

#### FR-13.4 — Activity timeline per contact
> SRS: (P0) Activity timeline per contact: calls, messages, notes, tasks, review requests sent

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/app/api/crm/leads/[id]/timeline/route.ts` reads `Activity` and `FollowUp`. `src/models/Activity.ts` types are `call, WhatsApp, email, note, meeting, status_change, lead_created, follow_up, appointment, deal_won, deal_lost`.
- Review requests are tied to `Customer`, not `Lead` (`src/models/ReviewRequest.ts`), and do not appear on the timeline.

**Assessment:** Review requests are missing from the timeline.

#### FR-13.5 — Tasks and follow-up reminders with assignment to staff
> SRS: (P0) Tasks and follow-up reminders with due dates and assignment to staff

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/models/FollowUp.ts` has `scheduledFor`, `type`, `assignedUserId`, `reminderSentAt`. `crmFollowUpReminderCron` (every 15 minutes) sends reminders. UI: `src/components/crm/FollowUpTasks.tsx`.
- No staff users exist (see FR-1.2), so tasks cannot be assigned to staff.

**Assessment:** Tasks and reminders work; staff assignment is blocked by the missing team model.

#### FR-13.6 — Trigger review requests from CRM events
> SRS: (P0) Trigger review requests from CRM events (stage set to Won or service completed), subject to FR-7.6 pacing

**Status:** 🟡 NOT AVAILABLE

**Evidence:** No CRM stage-change code dispatches `campaigns/review.request.start`. Review requests start only from manual sends or campaigns (`src/app/api/campaigns/send/route.ts`, `src/app/api/campaigns/[id]/launch`).

**Assessment:** Not implemented.

#### FR-13.7 — Message templates via WhatsApp, SMS and email, with opt-out
> SRS: (P1) Message templates and send via WhatsApp Business API, SMS and email, with opt-out handling

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- WhatsApp templates and STOP handling: `src/lib/whatsappTemplates.ts`, `src/app/api/admin/inbox/templates`, `src/app/api/whatsapp/webhook/route.ts:56,314,390`, `src/services/leadOwnership/optOutLead.ts`.
- No SMS sending exists, and there is no email sending from the CRM.

**Assessment:** WhatsApp only.

#### FR-13.8 — Source attribution
> SRS: (P1) Source attribution: tie leads to GBP, posts, keywords and campaigns

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `src/services/crm/sources.ts` provides a channel-level `source` only. There is no attribution to specific posts, keywords or campaigns.

**Assessment:** Not implemented.

#### FR-13.9 — Revenue per lead and conversion rate, feeding ROI in the monthly report
> SRS: (P1) Basic revenue per lead and conversion rate reports, feeding ROI in the monthly report

**Status:** 🟢 AVAILABLE

**Evidence:**
- `src/services/crm/roi.ts` (`conversionRate`, `revenuePerLead`, `computeRoiFigures`).
- `src/services/crm/growthReport.ts` (monthly growth report: leads, won, revenue, conversion rate, ROI) and `src/app/api/crm/growth-report/route.ts`.
- `crmGrowthReportReadyCron`.
- Tests: `tests/integration/crm-growth-report.test.ts`.

**Assessment:** Implemented as a CRM monthly growth report, separate from the GBP monthly report.

#### FR-13.10 — Appointment calendar and booking link sync
> SRS: (P2) Appointment calendar and booking link sync

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `src/models/Appointment.ts` and `src/components/crm/AppointmentsTab.tsx` store appointments internally. Google Calendar sync exists only for GrowMatic salespeople's demo bookings (`src/services/calendar/*`), not for customer businesses.

**Assessment:** Not implemented for customers.

#### FR-13.11 — Consent and DND compliance
> SRS: (P1) Consent and DND compliance: store consent, honour opt-outs, follow TRAI and WhatsApp template rules

**Status:** 🟡 NOT AVAILABLE

**Evidence:** Opt-outs are honoured (STOP handling as above). WhatsApp templates are used for cold sends (`src/lib/reviewCampaignGuard.ts`). Consent is not stored. TRAI DLT does not apply because SMS does not exist.

**Assessment:** Partial; consent storage is missing.

---

### FR-14 AI agent and approval workflow

#### FR-14.1 — 30-day Local SEO plan per location, broken into tasks
> SRS: (P0) Agent produces a 30-day Local SEO plan per location from the audit, broken into tasks with type, risk level, estimated impact and due date

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/models/SeoPlan.ts` (`horizonDays: 30`, `actionPhases`) and `src/services/seoPlan/seoPlanService.ts` `upsertSeoPlanFromAudit`.
- `src/models/OptimizationAction.ts` has priority and status but **no risk level and no due date**.

**Assessment:** A 30-day plan exists; its tasks lack risk level and due date.

#### FR-14.2 — Risk classes; High always needs explicit approval
> SRS: (P0) Risk classes: Low (posts, photo captions, review replies on 4 to 5 stars), Medium (services, attributes, hours, links), High (name, address, categories, description, pin); High always needs explicit approval

**Status:** 🟡 NOT AVAILABLE

**Evidence:** A search for risk class, riskLevel and similar returned nothing.

**Assessment:** Not implemented.

#### FR-14.3 — Approval queue with preview, diff, edit and one-tap approve, on web and mobile
> SRS: (P0) Approval queue with preview, diff, edit and approve or reject in one tap, on web and mobile

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- Separate approval flows exist: posts (`src/app/dashboard/posts/pending/page.tsx`), review replies (`src/app/api/reviews/[id]/approve-reply`, `reject-reply`) and the SEO plan (`src/app/dashboard/seo-plan/page.tsx`).
- There is no unified queue and no diff view. The mobile app has no post-approval screen (`mobile/src/app/(app)/posts` contains create, list and detail only).

**Assessment:** Not implemented as specified.

#### FR-14.4 — Autopilot rules set by the user
> SRS: (P0) Autopilot rules by the user, such as auto-publish approved post plans and auto-reply to 5-star reviews

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- Review reply mode `manual | auto` (`src/app/api/reviews/reply-settings/route.ts`) has no star-rating rule.
- Content autopilot (`src/lib/contentAutopilot.ts`) starts automatically on subscription plus GBP connection, and there is no user rule to configure it.

**Assessment:** One on/off toggle exists; configurable user rules do not.

#### FR-14.5 — Task engine with queue, scheduler, retries, idempotency and per-task status
> SRS: (P0) Task engine with job queue, scheduler, retries, idempotency and per-task status (Planned, Awaiting approval, Running, Done, Failed)

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- Inngest provides the queue, scheduling and retries for individual jobs (`src/services/inngest/functions.ts`).
- `src/models/ScheduledAction.ts` has idempotency keys, but for sales nurture.
- `OptimizationAction` statuses are `PLANNED, READY, EXECUTED, VERIFIED, BLOCKED`. There is no unified agent task entity with the SRS status set.

**Assessment:** The infrastructure exists, but the agent task engine does not.

#### FR-14.6 — Brand voice profile with English, Hindi and Bengali output
> SRS: (P0) Brand voice profile (tone, language, do and don't words, sample replies), including English, Hindi and Bengali output

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- Tone fields exist (`Business.reviewReplySettings.tone`, `src/models/BusinessAIConfig.ts` `aiTone`).
- There are no do or don't word lists and no sample replies.
- A search for `hindi`, `bengali` and `bangla` in `src/services`, `src/lib` and `src/models` returned nothing.

**Assessment:** Not implemented.

#### FR-14.7 — Guardrails: policy checks, hallucination control, no fabricated claims
> SRS: (P0) Guardrails: policy checks before any publish, hallucination control (use only facts from the profile and business notes), no fabricated claims, prices, awards or testimonials

**Status:** 🟢 AVAILABLE

**Evidence:**
- `src/services/content/validatePost.ts` (`CLAIMS` regex set for superlatives, ratings, percentages, years, awards, guarantees, discounts and testimonials, plus unknown services and businesses). A failing post is regenerated once, then saved as DRAFT.
- `src/services/reviews/validateReply.ts`, enforced in `replyPipeline.ts` `approveReply` and `publishReply`.
- `src/services/audit/validateAudit.ts` (`groundText`, `groundItems`, `inventedClaimChecker`) used by `seoPlanEngine.ts`.
- `src/lib/agentGuardrails.ts` for conversational agents.
- Tests: `tests/integration/content-engine.test.ts`, `review-reply.test.ts`, `audit-final.test.ts`.

**Assessment:** Implemented for AI-generated posts, replies and plan text.

#### FR-14.8 — Full audit trail of AI actions
> SRS: (P0) Full audit trail of AI actions with prompt, output, model, cost and user decision

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/models/AIUsageLog.ts` stores model, tokens, cost and status, but **no prompt or output**.
- `src/models/ContentGenerationLog.ts` stores prompt and output for content only.
- User decision is recorded only on reviews (`replyApprovedBy`).
- There is no unified AI run record.

**Assessment:** Partial.

#### FR-14.9 — Learning loop
> SRS: (P1) Learning loop: use post, review and rank outcomes to adjust future plans

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `src/services/content/keywordPriority.ts` uses GBP search-keyword impressions and recent post keywords to rotate keywords. Post, review and rank outcomes are not used.

**Assessment:** Not implemented as specified.

#### FR-14.10 — In-app chat assistant
> SRS: (P1) Chat assistant inside the app to ask questions, such as "why did calls drop last week?", answered from the workspace's data

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/services/report/reportAgent.ts` and `src/services/support/supportAgent.ts` are WhatsApp agents for platform prospects and support.
- No in-app assistant UI was found in `src/components` or `src/app/dashboard`.

**Assessment:** Not implemented.

#### FR-14.11 — Monthly agent summary
> SRS: (P1) Monthly agent summary of what was done, what changed, and what needs the owner

**Status:** 🟢 AVAILABLE

**Evidence:**
- `src/services/lifecycle/monthly.ts`: changes with previous value, current value, source and actor; execution records; `planCompleted` and `planPending`. `src/models/OptimizationAction.ts` holds `ownerAction`.
- Delivered through `src/services/lifecycle/notify.ts` `notifyMonthlyReport` (in-app and WhatsApp).
- Test: `tests/integration/lifecycle.test.ts`.

**Assessment:** Implemented.

#### FR-14.12 — Kill switch
> SRS: (P0) Kill switch to pause all automation per location or per workspace

**Status:** 🟡 NOT AVAILABLE

**Evidence:** No kill switch or pause-all automation flag exists. `GBP_LIVE_WRITES_ENABLED` is a global environment variable, not a per-location or per-workspace control.

**Assessment:** Not implemented.

---

### FR-15 Notifications

#### FR-15.1 — In-app, email, push (PWA) and WhatsApp alerts
> SRS: (P0) In-app, email and push (PWA) notifications; WhatsApp alerts for critical items

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- In-app: `src/services/notifications.ts` and `src/models/Notification.ts`.
- WhatsApp: `src/services/ownerNotify.ts`.
- Push: native Expo push only (`src/services/push.ts`); there is no PWA manifest or service worker.
- Email: the `newReviewEmail`, `newLeadEmail` and `weeklyDigestEmail` preferences (`src/app/api/user/notifications/route.ts`) are **never read** by any sender (repository search). Email is sent only for billing and demo bookings.

**Assessment:** In-app and WhatsApp work. Email alerts and PWA push are missing.

#### FR-15.2 — Required alert types
> SRS: (P0) Alert types: new review, unanswered review, approval needed, post failed, profile edited by Google or others, suspension or verification issue, payment failed, rank drop

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- Emitted types include `critical_review`, `weekly_new_reviews`, `weekly_unanswered_reviews`, `reply_drafted`, `content_draft`, `post_failed` and `billing_past_due`.
- Not emitted: real-time new review (weekly only), profile edited by Google or others, suspension or verification, and rank drop.

**Assessment:** Several required types are missing.

#### FR-15.3 — User-level preferences by channel, type and frequency; daily digest
> SRS: (P0) User-level preferences by channel, type and frequency; daily digest option

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/app/api/user/notifications/route.ts` stores boolean preferences, and a daily WhatsApp digest exists (`ownerWhatsAppDigestCron`, `dailyDigestWhatsApp`).
- The email preferences have no effect, and there is no frequency setting.

**Assessment:** Partial.

---

### FR-16 Admin console

#### FR-16.1 — Workspace and user management with search, audited impersonation and plan override
> SRS: (P0) Workspace and user management with search, impersonation (audited) and plan override

**Status:** 🟢 AVAILABLE

**Evidence:**
- Search: `src/app/api/admin/customers/route.ts` (`search`, `plan` filters) and `src/app/api/admin/businesses/route.ts`.
- Impersonation with audit trail: `src/app/api/admin/impersonate/route.ts` writes `AdminActionLog` with admin, target, IP and timestamp.
- Overrides: `src/app/api/admin/customers/[userId]/usage-limits/route.ts` (`UserLimitOverride`), `src/app/api/admin/plan-config`.
- Pages under `src/app/admin`.

**Assessment:** Implemented.

#### FR-16.2 — Job monitor
> SRS: (P0) Job monitor: queue depth, failures, retries, API quota use and per-workspace cost

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- `src/app/api/admin/system-health/route.ts` counts `JobQueue` PENDING rows (a legacy queue; jobs actually run on Inngest) and failed `AutomationLog` rows in the last 24 hours.
- `src/app/api/admin/ai-usage/route.ts` aggregates AI cost globally and per day.
- There is no API quota view, no per-workspace cost, and no Inngest retry or depth data.

**Assessment:** Partial.

#### FR-16.3 — Plan, coupon and feature-flag management
> SRS: (P0) Plan, coupon and feature-flag management

**Status:** 🟡 NOT AVAILABLE

**Evidence:**
- Plan management: `src/app/api/admin/billing-plan` and `src/app/api/admin/plan-config`.
- No coupons.
- Feature flags: only `src/app/api/mobile/flags/route.ts`, which reads environment variables. There is no admin flag management.

**Assessment:** Partial.

#### FR-16.4 — Support tools
> SRS: (P1) Support tools: error logs per location, resync button, GBP policy flag lookup

**Status:** 🟡 NOT AVAILABLE

**Evidence:** There is no admin resync and no per-location error log (search for `resync` and `gbp/sync.requested` in `src/app/api/admin` and `src/app/admin` returned nothing).

**Assessment:** Not implemented.

#### FR-16.5 — Content and prompt template management with versioning and A/B tests
> SRS: (P1) Content and prompt template management with versioning and A/B tests

**Status:** 🟡 NOT AVAILABLE

**Evidence:** Admin can edit agent personas (`src/app/api/admin/sales-agent`, `report-agent`, `booking-agent`, `nurture-config`). There is no versioning or A/B testing (`src/models/ContentTemplate.ts` has no version or variant fields).

**Assessment:** Not implemented as specified.

#### FR-16.6 — Business metrics
> SRS: (P0) Business metrics: MRR, churn, trial conversion, activation rate, cost of goods per customer

**Status:** 🟡 NOT AVAILABLE

**Evidence:** `src/app/api/admin/revenue/route.ts` computes an approximate MRR (`activeCount * monthlyPriceInr`) and ARR. There is no churn, trial conversion, activation rate or COGS per customer.

**Assessment:** Partial.

---

## 4. External Integrations Audit

| Integration (SRS §7) | Status | Evidence |
|---|---|---|
| GBP Account Management API | 🟡 NOT AVAILABLE | `accounts.list` is called in `src/app/api/auth/google/callback/route.ts:100`, but only `accounts[0]` is used (FR-3.1). |
| GBP Business Information API (read) | 🟢 AVAILABLE | `src/lib/gbpClient.ts` `fetchLocationProfile`, `fetchLocationPin`; location listing in the callback. |
| GBP Business Information API (write) | 🟡 NOT AVAILABLE | `updateLocationProfile` exists but is gated off (`GBP_LIVE_WRITES_ENABLED=false`). |
| GBP Reviews API (read) | 🟢 AVAILABLE | `src/services/reviews/providers/GbpApiReviewProvider.ts` (v4 `.../reviews`). |
| GBP Reviews API (reply) | 🟡 NOT AVAILABLE | `replyToReview` is gated off. |
| GBP Media API | 🟡 NOT AVAILABLE | `listLocationMedia` reads; `uploadLocationPhoto` and `deleteLocationMedia` are gated off. |
| GBP Local Posts API | 🟡 NOT AVAILABLE | `createLocalPost` is gated off and STANDARD-only. |
| GBP Notifications (Pub/Sub) | 🟡 NOT AVAILABLE | No Pub/Sub or notification-settings code. |
| GBP Performance API | 🟢 AVAILABLE | `fetchDailyMetrics`, `fetchSearchKeywords` in `src/lib/gbpClient.ts`; backfill in `src/services/gbpInsightsBackfill.ts`. |
| Google OAuth 2.0 (GBP authorisation) | 🟢 AVAILABLE | `src/app/api/auth/google/route.ts` (`business.manage`, offline, signed state cookie). |
| Google OAuth 2.0 (sign-in) | 🟡 NOT AVAILABLE | Login is phone + OTP only; there is no Google sign-in in `src/app/(auth)/login/page.tsx`. |
| Google Places API | 🟢 AVAILABLE | `src/services/google/places.ts`, `src/app/api/google/autocomplete`, `place-details`; competitor discovery in `src/services/audit/competitorService.ts`. |
| Google Geocoding API | 🟢 AVAILABLE | Metered as `googleGeocoding` (`src/lib/providerMeter.ts`); `src/services/audit/localities.ts`. |
| Google Maps Embed / Maps JavaScript API | 🟡 NOT AVAILABLE | Only the Static Maps image (`src/app/api/google/static-map`, `src/app/api/audit/[id]/geo-map`). |
| Google Search Console API | 🟡 NOT AVAILABLE | No usage. |
| GA4 Data API | 🟡 NOT AVAILABLE | No usage (GA4 appears only in the site CSP). |
| LLM provider | 🟡 NOT AVAILABLE | Groq is used throughout (`src/lib/aiModel.ts`), and per-workspace cost is metered (`AIUsageLog.businessId`). The SRS asks for a provider-agnostic wrapper and prompt versioning, and neither exists. |
| Image generation | 🟢 AVAILABLE | `src/services/ai/imageGenerator.ts` (Gemini or NanoBanana) plus brand-colour fallback graphics. |
| SERP / Maps rank provider | 🟢 AVAILABLE | DataForSEO Maps live (`src/services/audit/dataForSeoClient.ts`) and SerpApi (review provider, `src/app/api/audit/test-serpapi`). Used in audits only (see FR-11). |
| Keyword volume provider | 🟢 AVAILABLE | DataForSEO Google Ads search volume (`src/services/audit/keywordVolumeClient.ts`). |
| Citation / aggregator partner | 🟡 NOT AVAILABLE | None. |
| WhatsApp Business (Cloud API or BSP) | 🟢 AVAILABLE | Meta Cloud API (`src/services/whatsapp/meta.ts`) and Twilio BSP (`src/services/twilio/client.ts`), selected in `src/services/whatsapp/send.ts`; webhooks at `src/app/api/whatsapp/webhook`, `src/app/api/webhook/twilio`. |
| SMS gateway (DLT-registered) | 🟡 NOT AVAILABLE | All Twilio sends use the `whatsapp:` prefix; there is no SMS path. |
| Email service | 🟢 AVAILABLE | Resend, with SendGrid via nodemailer as fallback (`src/services/email.ts`). Event notification emails are not wired (FR-15.1). |
| Razorpay | 🟢 AVAILABLE | Subscriptions, checkout, idempotent signed webhooks (`src/app/api/webhook/razorpay/route.ts`, `ProcessedWebhookEvent`), reconcile cron. |
| Stripe | 🟡 NOT AVAILABLE | None. |
| GST invoice generation module | 🟡 NOT AVAILABLE | None (FR-2.3). |
| WordPress plugin (P1) | 🟡 NOT AVAILABLE | None. |
| Public REST API with API keys (P2) | 🟡 NOT AVAILABLE | `src/middleware/apiKeyAuth.ts` is a single shared `AUTOMATION_API_KEY` for internal n8n routes (`src/app/api/n8n/*`), not per-customer API keys. |
| Outbound webhooks (P2) | 🟡 NOT AVAILABLE | None. |
| Embeddable assets (review widget, enquiry form, call/WhatsApp widget, schema snippet) | 🟡 NOT AVAILABLE | None. |
| Web app: responsive, installable PWA | 🟡 NOT AVAILABLE | The web app is responsive, but there is no manifest or service worker (not installable). A native Expo app exists in `mobile/`. |
| Twilio Voice (call tracking) | 🟢 AVAILABLE | `src/app/api/twilio/voice/route.ts` with signature validation (`src/lib/twilioSignature.ts`). |
| Google Calendar | 🟢 AVAILABLE | For internal salesperson demo booking only (`src/services/calendar/googleCalendar.ts`). |

---

## 5. Data Model Audit

**Storage:** MongoDB with Mongoose (`src/models/*.ts`); there is no SQL or Supabase. Most schemas use `{ timestamps: true }`. The tenant key is usually `businessId`, with `organizationId` and `tenantId` used inconsistently.

| SRS entity | Status | Implementation / gap |
|---|---|---|
| Workspace | 🟡 | `Business` + `Organization`: name, owner (`userId`/`ownerId`), status (`isActive`), `subscriptionStatus`, timezone. Missing: `locale`, `brand_voice_id`, `plan_id` reference. |
| User and Membership | 🟡 | `User`: email, phone, password hash, `role` (global only). Missing: Google ID, 2FA secret, role per workspace, membership entity. |
| Subscription | 🟡 | `Subscription` (`planType`, `billingStatus`, `trialStatus`, `razorpaySubscriptionId`) plus `Business.subscriptionStatus`. Missing: GSTIN, `next_invoice_date`, explicit billing cycle on the record. |
| Location | 🟡 | Fields are split across `Business` and `GBPToken` (`accountId`, `locationId`), plus coordinates and categories. Missing: service areas, verification status, `automation_mode`, `last_synced_at` on the location. |
| LocationSnapshot and ChangeLog | 🟡 | Missing. `ProfileActivity` has no before, after, source or reverted flag. |
| OAuthToken | 🟡 | `GBPToken`: encrypted access and refresh tokens, scopes, expiry. Missing: `status` (revocation is stored as `Business.googleConnected=false`). |
| Service and Product | 🟡 | Missing as entities. `Business.services` is free text. |
| MediaAsset | 🟡 | `GbpMediaAsset`: URL, media type, category (4 values), geotag lat/lng, GBP media name, status. Missing: original name, SEO name, EXIF written flag, dimensions, validation result. |
| Review | 🟡 | `Review`: provider review ID, rating, text, reviewer, sentiment, reply text and status. Missing: topics per review, assignee. |
| ReviewRequest | 🟢 | `ReviewRequest`: `customerId`, `channel` (WhatsApp only), token link, `sentAt`, status, `clicked` (opened), `reviewReceived`. |
| Post | 🟡 | `Post`: `contentType`, content, image, CTA, `scheduledDate`, status, `gbpPostName`, `aiGenerated`. Missing: link, metrics, explicit approval state. |
| Keyword | 🟡 | No tracked-keyword entity. `GBPKeyword` holds impression data; `SeoPlan` holds keyword lists. |
| RankScan and RankPoint | 🟡 | Embedded in `Audit.auditData.geoGridRank`; no standalone entity and no stored competitor top 3 per point. |
| Competitor | 🟡 | Embedded in audit data. Missing: photo count, a stored place ID entity. |
| Citation | 🟡 | Missing. |
| AuditReport and AuditIssue | 🟢 | `Audit` (`overallScore`, sub-scores, findings with severity and recommended action) plus `OptimizationAction` (status). |
| Task | 🟡 | Missing. `OptimizationAction` lacks risk class, payload, approver, `scheduled_for`, error and cost. |
| AIRun | 🟡 | `AIUsageLog` (model, tokens, cost) and `ContentGenerationLog` (prompt, output) are separate. Missing: `task_id`, prompt version, input hash, policy-check result. |
| Contact, Lead, Pipeline Stage, Activity, FollowUpTask | 🟡 | `Customer`, `Lead`, `Business.leadStages`, `Activity`, `FollowUp` all exist. Missing: consent field. |
| Metric (daily series) | 🟢 | `GBPInsights`: one row per business per day (views, Maps/Search, calls, website clicks, directions, conversations), with a unique index on `{businessId, date}`. |
| Notification and Preference | 🟡 | `Notification` (in-app) and `User.notificationPreferences`. Missing: channel and delivery status on the notification. |
| Report | 🟡 | No Report entity (period, PDF URL, `sent_to`). Monthly content lives in `Audit.auditData.monthly`. |
| AuditLog | 🟡 | `AdminActionLog` (admin, action, target, IP, timestamp) is written only by impersonation. Security events (logins, password resets) are not logged there. |
| Common fields: `id`, `workspace_id`, `created_at`, `updated_at` on every entity | 🟡 | Timestamps are mostly present, but `workspace_id` is not universal (for example `Notification` and `User` key on `userId`). |

**Data rules (SRS §8.1)**

| Rule | Status | Evidence |
|---|---|---|
| Soft-delete with 30-day recovery window; hard delete on verified request | 🟡 | Soft delete plus a 30-day grace period before hard purge exist (`PURGE_GRACE_DAYS = 30`, `accountHardPurgeCron`). No restore or recovery path was found (search for restore or undelete). |
| Per-workspace tenant isolation at query level (row-level security) | 🟡 | Application-level checks in `src/lib/tenant.ts` (`requireBusinessContext`, `requireAuditAccess`). There is no database-enforced RLS (MongoDB), and no cross-tenant tests (see Section 9). |
| Metrics retained ≥ 24 months; AI run logs ≥ 12 months | 🟡 | `GBPInsights` has no TTL (kept indefinitely) and `AIUsageLog` has a 365-day TTL. However, `ContentGenerationLog`, the only log with prompt and output, has a TTL of **180 days**. |

---

## 6. Non-Functional Requirements Audit

### 9.1 Performance and scalability

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| NFR-1 | Dashboard p95 < 3 s on 4G | 🟡 NOT AVAILABLE | No performance budget, measurement or monitoring was found. |
| NFR-2 | 10,000 locations at launch; scale to 100,000 | 🟡 NOT AVAILABLE | `scripts/deploy.sh` deploys to a single 1.9 GB droplet under pm2. `src/lib/rateLimit.ts` is in-memory per process. No load-test evidence. |
| NFR-3 | All GBP, rank and AI work in background queues | 🟡 NOT AVAILABLE | Inline work exists in request handlers: `src/app/api/gbp/sync/route.ts` (calls `fetchDailyMetrics`), `src/app/api/reviews/fetch/route.ts` (`syncReviewsForBusiness`), `src/app/api/reviews/generate-reply/route.ts` (`draftReply`), `src/app/api/campaigns/generate-message/route.ts` (Groq), `src/app/api/content/generate/route.ts`. |
| NFR-4 | Scheduled posts publish within 5 minutes | 🟡 NOT AVAILABLE | `scheduleSinglePostPublish` sleeps until the exact time, but live publishing is disabled and there is no timing measurement. |
| NFR-5 | Scans and syncs batched and rate-limited within quotas | 🟡 NOT AVAILABLE | The nightly fan-out sends one event per business with no throttle or concurrency limit (`gbpNightlySyncScheduler`, `reviewSyncWorker`). The GBP client has no rate limiter. |

### 9.2 Reliability

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| NFR-6 | 99.5% monthly uptime | 🟡 NOT AVAILABLE | Single droplet; no uptime monitoring found. |
| NFR-7 | Idempotent jobs, exponential backoff, DLQ and alerting | 🟡 NOT AVAILABLE | Inngest `retries` and some idempotency keys (`ScheduledAction`, `ProcessedWebhookEvent`) exist, but there is no dead-letter queue and no job-failure alerting. |
| NFR-8 | Daily backups, 30-day retention, tested restore; RPO 24 h, RTO 4 h | 🟡 NOT AVAILABLE | `documentation/deployment/atlas-migration-runbook.md` plans to "enable backups on M10". There is no restore-test evidence and no RPO/RTO documentation. |
| NFR-9 | Graceful degradation: queue and notify | 🟡 NOT AVAILABLE | Some fallbacks exist (template posts saved as DRAFT when AI fails, `src/services/content/weeklyBatch.ts:241-247`; `src/lib/providerHealth.ts`), but there is no general queue-and-notify behaviour for Google or AI outages. |

### 9.3 Security

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| NFR-10 | Tokens and keys encrypted at rest (AES-256/KMS); TLS 1.2+ | 🟢 AVAILABLE | AES-256-GCM in `src/lib/crypto.ts` for GBP, report-connect and calendar tokens (`src/lib/gbpConnect.ts`, `src/app/api/auth/google/calendar/callback/route.ts`, `src/app/api/report-connect/callback/route.ts`). Platform API keys live in the environment, not the database. HSTS is set in `next.config.ts`. |
| NFR-11 | Minimum Google scopes; show users exactly what access is requested | 🟡 NOT AVAILABLE | The only scope is `business.manage` (`src/app/api/auth/google/route.ts:6`), but the connect UI (`src/app/dashboard/insights/page.tsx`, `src/app/dashboard/gbp-profile/page.tsx`) shows benefits, not the access being requested. |
| NFR-12 | RBAC, tenant isolation, audited impersonation | 🟡 NOT AVAILABLE | Impersonation is audited and tenant checks exist in `src/lib/tenant.ts`, but there is no role-based access control within workspaces (FR-1.2). |
| NFR-13 | OWASP Top 10, validation, rate limiting, CSRF/XSS, dependency scanning | 🟡 NOT AVAILABLE | zod validation, rate limits (`src/lib/rateLimit.ts`, `src/lib/durableRateLimit.ts`), SSRF guard (`src/lib/ssrfGuard.ts`) and security headers exist. CSP is **report-only** (`next.config.ts`). There is no dependency scanning or CI. |
| NFR-14 | Secrets in a vault; separate dev, staging, prod | 🟡 NOT AVAILABLE | Secrets are in `.env` files, and `.env` holds live production credentials per project notes. No vault and no staging environment. |
| NFR-15 | Annual third-party penetration test | 🟡 NOT AVAILABLE | No evidence in the repository. |

### 9.4 Compliance and policy

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| NFR-16 | Google API Services User Data Policy and Limited Use; publish privacy policy and terms | 🟢 AVAILABLE | `src/app/privacy/page.tsx` (states the Limited Use requirements, line 60), `src/app/terms/page.tsx`, `src/app/refund/page.tsx`, `src/app/delete-account/page.tsx`. Actual policy compliance is not verifiable from code. |
| NFR-17 | DPDP Act consent, purpose limitation, data principal rights; GDPR | 🟡 NOT AVAILABLE | Deletion exists; data export and consent records do not (FR-1.8, FR-13.1). |
| NFR-18 | GBP content policy enforced by the product | 🟡 NOT AVAILABLE | No review gating, and post claims are validated. However, there is no incentive guard (FR-7.11), no stuffed-name warning (FR-5.6), and no fake-address checks. |
| NFR-19 | TRAI DLT for SMS, WhatsApp template approval and opt-in, anti-spam consent | 🟡 NOT AVAILABLE | WhatsApp templates and STOP handling exist, but there are no stored opt-in or consent records. SMS does not exist. |
| NFR-20 | GST invoicing and record retention | 🟡 NOT AVAILABLE | No GST invoicing. `BILLING_RETENTION_YEARS = 8` exists in `src/services/account/purgePlan.ts` but applies to records that are not GST invoices. |
| NFR-21 | Call recording only with disclosure and local-law compliance | 🟢 AVAILABLE | Recording is never enabled: `src/services/telephony/normalize.ts` sets `recordingUrl: null`, so no non-compliant recording can occur. |

### 9.5 Usability and accessibility

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| NFR-22 | Mobile-first UI; approve a task, reply to a review and upload a photo on a phone | 🟡 NOT AVAILABLE | Review reply and photo upload exist in the Expo app (`mobile/src/app/(app)/reviews`, `photos`). There is no task or approval flow on mobile. |
| NFR-23 | Plain-language UI; every automated action explained in one sentence | 🟡 NOT AVAILABLE | Plain-language error mapping exists (`src/lib/errors/friendlyMessage.ts`), but there is no mechanism that guarantees a one-sentence explanation for every automated action. Not verifiable. |
| NFR-24 | WCAG 2.1 AA for core screens | 🟡 NOT AVAILABLE | No accessibility audit or tooling. ARIA attributes appear in only 45 TSX files. |
| NFR-25 | English at launch; Hindi and Bengali content from MVP | 🟡 NOT AVAILABLE | No Hindi or Bengali generation and no i18n library. |

### 9.6 Observability and maintainability

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| NFR-26 | Centralised logging, metrics, tracing; error tracking with alerts | 🟡 NOT AVAILABLE | `console.*` only. No Sentry, OpenTelemetry or log aggregation. `src/instrumentation.ts` only validates the environment. |
| NFR-27 | Feature flags and staged rollouts | 🟡 NOT AVAILABLE | Environment toggles only (`GBP_LIVE_WRITES_ENABLED`, `LEAD_ENGINE_V2`, `src/app/api/mobile/flags`). No flag service or staged rollout. |
| NFR-28 | Unit coverage, mocked integration tests, end-to-end tests | 🟡 NOT AVAILABLE | 39 `node --test` files in `tests/integration` (mostly pure-function tests) plus `tests/render`. No coverage tooling, no end-to-end framework, and no mocked Google or billing flow tests. |
| NFR-29 | CI/CD with automated migrations and rollback | 🟡 NOT AVAILABLE | No `.github/` or CI config. Deployment is manual (`scripts/deploy.sh`); migrations are manual scripts (`scripts/db-migrate.mjs`). No rollback procedure. |
| NFR-30 | Documented API and runbooks | 🟡 NOT AVAILABLE | Runbooks exist (`documentation/deployment/*`, `documentation/troubleshooting/troubleshooting-guide.md`). `documentation/api-reference/api-docs.md` (last changed 2026-06-19) covers about 13 endpoints of roughly 230 route handlers and refers to `/api/auth/register`, which no longer exists. |

---

## 7. Subscription Plan / Feature Gating Audit

| SRS plan element | Status | Evidence |
|---|---|---|
| Plans as configurable data, editable by admin without a release | 🟢 | `BillingPlan` (price and copy, `src/app/api/admin/billing-plan`) and `PlanConfig` (limits, `src/app/api/admin/plan-config`). |
| Starter tier (1 location) | 🟡 | Not modelled. `src/lib/planDefaults.ts` has `Free` and `Pro` only; `planCatalog.ts` sells one plan. |
| Growth tier | 🟡 | Not modelled. |
| Pro tier (up to 3 locations) | 🟡 | The internal plan key `Pro` is the single paid plan. There is no 3-location bundle; each workspace pays separately. |
| Agency tier (10+ workspaces, pooled credits, client billing, API, webhooks) | 🟡 | Multi-workspace exists (FR-1.5). No pooled credits, API or webhooks. |
| Trial (7 or 14 days, audit and limited agent plan, no card) | 🟡 | `Subscription.trialStatus` defaults to 14 days, but sign-up sets `planType: 'Free'` with `trialStatus.isActive: false` (`src/app/api/onboarding/route.ts`). Free users get one free audit (`freemiumAuditGate`, `Business.freeAuditUsed`), not a time-boxed trial. |
| Audit and monthly re-audit | 🟢 | `src/app/api/audit/route.ts` and `src/lib/auditAutopilot.ts`. |
| Approval mode vs autopilot mode by tier | 🟡 | Not modelled (FR-1.3, FR-14.4). |
| Posts per month limit | 🟢 | `maxPostsPerMonth` (+ `postLimitFrequency`) enforced through `checkUsageLimit('posts')`. |
| AI credits (content, replies, images) | 🟡 | `maxAIGenerations` is enforced only on manual generation (`src/app/api/content/generate/route.ts`, `src/app/api/reviews/generate-reply/route.ts`). Autopilot batches, auto-replies and images are not counted as credits. |
| Tracked keywords limit | 🟡 | Not modelled. |
| Geo-grid scan credits | 🟡 | Not modelled. |
| Outbound WhatsApp messages | 🟢 | `maxWhatsAppMessagesPerDay` via `checkUsageLimit('whatsappMessages')`. |
| Outbound SMS messages | 🟡 | SMS does not exist. |
| Locations limit | 🟡 | `Organization.maxBusinesses` is checked in `src/app/api/business/route.ts:36`, but `add-workspace` creates a new Organization per workspace, so there is no plan-level location limit. |
| Team seats | 🟡 | No team model (FR-1.2). |
| CRM contact limit | 🟡 | Not modelled. |
| Review request engine per plan | 🟡 | Module gate `marketing_automation` exists (`src/lib/moduleGating.ts`), but with one paid plan it is not tiered. |
| Citation, schema, landing pages, GA4/Search Console, call tracking, AI chat, white-label per plan | 🟡 | The underlying features are absent (FR-9, FR-10, FR-12.5, FR-14.10, FR-1.6). |
| Admin sees cost per workspace | 🟡 | Per-audit cost model (`src/services/audit/costModel.ts`) and global AI cost exist, but there is no per-workspace cost view. |

---

## 8. Release Phase Audit

A phase item is 🟢 only when **every** FR it bundles is 🟢.

### MVP (P0)

| Item | Status | FR breakdown |
|---|---|---|
| Gate: GBP API access applied and approved | 🟡 | Not verifiable from the repository; live writes are disabled pending verification (`src/lib/gbpSafety.ts`). |
| Accounts and workspaces, onboarding, billing with GST invoices (FR-1, FR-2) | 🟡 | 🟢 1.1 · 🟡 1.2, 1.3, 1.8, 2.1–2.5 |
| GBP connect, sync, change history and revert (FR-3) | 🟡 | 🟡 3.1–3.5, 3.7, 3.8 |
| Audit engine (FR-4.1–4.4, 4.6) | 🟡 | 🟢 4.3 · 🟡 4.1, 4.2, 4.4, 4.6 |
| Profile optimization with approval (FR-5) | 🟡 | 🟡 all P0 items (5.1–5.7, 5.10) |
| Photo upload, validation, publish (FR-6.1–6.4, 6.8) | 🟡 | 🟡 all |
| Review inbox, AI replies, request link and QR (FR-7.1–7.6, 7.11) | 🟡 | 🟡 all |
| Post generator, calendar, scheduler (FR-8.1, 8.2, 8.4–8.6, 8.8) | 🟡 | 🟢 8.4 · 🟡 8.1, 8.2, 8.5, 8.6, 8.8 |
| Basic geo-grid rank tracking (FR-11.1–11.3, 11.7) | 🟡 | 🟡 all |
| Analytics dashboard and monthly report (FR-12.1–12.4, 12.7, 12.8) | 🟡 | 🟡 all |
| Mini CRM core (FR-13.1–13.6) | 🟡 | 🟢 13.3 · 🟡 13.1, 13.2, 13.4, 13.5, 13.6 |
| AI agent: plan, risk classes, approval queue, guardrails, audit trail, kill switch (FR-14.1–14.8, 14.12) | 🟡 | 🟢 14.7 · 🟡 14.1–14.6, 14.8, 14.12 |
| Notifications and basic admin (FR-15, FR-16 P0) | 🟡 | 🟢 16.1 · 🟡 15.1–15.3, 16.2, 16.3, 16.6 |
| Schema generator (FR-10.1) | 🟡 | 🟡 10.1 |

### V1 (P1)

| Item | Status | FR breakdown |
|---|---|---|
| EXIF writer and reader, photo cadence and coverage (FR-6.5–6.7, 6.9–6.11) | 🟡 | 🟡 all (GPS-only writer exists) |
| Website audit, landing page generator, WordPress plugin, widgets (FR-4.5, FR-10) | 🟡 | 🟡 all |
| Citation scan and fix workflow (FR-9) | 🟡 | 🟡 all |
| Competitor rank tracking, share of voice, alerts (FR-11.4–11.6) | 🟡 | 🟡 all |
| GA4, Search Console, call tracking, goals, weekly digest (FR-12.5, 12.6, 12.9, 12.10) | 🟡 | 🟢 12.10 · 🟡 12.5, 12.6, 12.9 |
| WhatsApp and SMS in CRM, attribution, ROI reports (FR-13.7–13.9, 13.11) | 🟡 | 🟢 13.9 · 🟡 13.7, 13.8, 13.11 |
| Agency accounts, learning loop, AI chat assistant (FR-1.5, 14.9–14.11) | 🟡 | 🟢 1.5, 14.11 · 🟡 14.9, 14.10 |
| Duplicate detection, service-area manager, pin check (FR-3.6, 5.8, 5.9) | 🟡 | 🟡 all |
| Other P1 items not bundled above (FR-1.4, 2.6, 7.7–7.10, 8.3, 8.7, 8.9, 16.4, 16.5) | 🟡 | 🟢 7.7 · 🟡 the rest |

### V2 (P2)

| Item | Status | Evidence |
|---|---|---|
| White-label with custom domain (FR-1.6) | 🟡 | Schema fields only. |
| Public audit lead magnet (FR-4.7) | 🟢 | `src/app/free-report`. |
| Public API and webhooks | 🟡 | Not implemented. |
| Bing Places and Apple Business Connect sync (FR-9.6) | 🟡 | Not implemented. |
| Meta cross-posting (FR-8.10) | 🟡 | Not implemented. |
| Service-area city pages (FR-10.5) | 🟡 | Not implemented. |
| Internal linking suggestions (FR-10.6) | 🟡 | Not implemented. |
| Booking calendar sync (FR-13.10) | 🟡 | Not implemented for customers. |
| UI localisation in Hindi and Bengali | 🟡 | No i18n. |
| Coupons and referrals | 🟡 | Not implemented. |

---

## 9. Dev Cross-Check Checklist

| # | Checklist item | Status | Evidence |
|---|---|---|---|
| 1 | Google GBP API access applied, approved, quotas noted | 🟡 | No repository record of approval or quota numbers. The callback handles a 403 `gbp_api_access` error. Live writes are disabled (`.env`, `.env.local`). |
| 2 | Every P0 requirement ID has an owner, an estimate and a test case | 🟡 | No traceability from SRS IDs to tests or owners exists in the repository. |
| 3 | Risk classes (FR-14.2) enforced in code, not just in the UI | 🟡 | Risk classes do not exist. |
| 4 | Change history and revert (FR-3.7) work for every field the agent can edit | 🟡 | No change history or revert. |
| 5 | Review request flow contains no gating or incentive logic (FR-7.6, FR-7.11) | 🟢 | Every click redirects to Google's write-review URL (`src/lib/reviewRedirect.ts`, `src/lib/reviewRequestFlow.ts`), tested in `tests/integration/review-request-flow.test.ts`. No gating or incentive code exists. (The FR-7.11 *guard* that blocks incentive wording in templates is still missing.) |
| 6 | Photo validation matches current GBP media specs (FR-6.2) | 🟡 | 10 MB image limit (spec: 5 MB); no dimension, duration or quality checks. |
| 7 | EXIF write uses only real coordinates and strips personal metadata (FR-6.5, FR-6.6) | 🟡 | Client-supplied coordinates are accepted (`src/lib/mediaUpload.ts:40`); metadata is kept, not stripped (`keepMetadata()`). |
| 8 | Scheduler meets the 5-minute target and retries failures (NFR-4, FR-8.5) | 🟡 | Exact-time sleep exists, but Google rejections are not retried and live publishing is disabled. |
| 9 | Billing handles failed payments, proration, GST invoices and webhooks idempotently (FR-2) | 🟡 | Failed payments and idempotent webhooks exist (`ProcessedWebhookEvent`). There is no proration and no GST invoicing. |
| 10 | Tenant isolation verified by tests (NFR-12) | 🟡 | `tests/integration/security/api-boundaries.test.ts` tests unauthenticated access only. No cross-tenant test (user A requesting business B). |
| 11 | Token encryption and revoked-access handling tested (FR-3.4, NFR-10) | 🟡 | Encryption is implemented, but no test covers `src/lib/crypto.ts`, `getValidToken` or `GBPAuthError`. |
| 12 | Kill switch pauses all queued jobs for a location or workspace (FR-14.12) | 🟡 | No kill switch. |
| 13 | AI outputs pass policy checks and are grounded in profile data (FR-14.7) | 🟢 | `src/services/content/validatePost.ts`, `src/services/reviews/validateReply.ts`, `src/services/audit/validateAudit.ts`; tests `content-engine.test.ts`, `review-reply.test.ts`, `audit-final.test.ts`. |
| 14 | Monthly report generates automatically with correct period data (FR-12.7) | 🟢 | `auditAutopilotCron` and `src/lib/auditAutopilot.ts` (30-day cadence); period logic in `src/services/lifecycle/monthly.ts` and `period.ts`, tested in `tests/integration/lifecycle.test.ts`. FR-12.7 itself stays 🟡 for missing email and white-label. |
| 15 | DPDP data export and delete flows work (FR-1.8) | 🟡 | Delete works; export does not exist. |
| 16 | Monitoring, alerts, backups and a restore test are in place (NFR-8, NFR-26) | 🟡 | No monitoring or alerting stack and no restore-test evidence. |

---

## 10. Missing Features — Consolidated List

Only 🟡 NOT AVAILABLE requirement IDs are listed.

### P0 Missing (75)

- **FR-1:** FR-1.2 Workspace roles and team invites · FR-1.3 Onboarding wizard (GBP OAuth, mode, plan) · FR-1.8 Data export (deletion exists)
- **FR-2:** FR-2.1 Plan tiers with per-location pricing · FR-2.2 Stripe · FR-2.3 GST-compliant invoices · FR-2.4 Gating for locations, keywords, CRM contacts · FR-2.5 Upgrade, downgrade, pause, proration
- **FR-3:** FR-3.1 All accounts and multi-location selection · FR-3.2 Full import (hours, attributes, services, products, posts) · FR-3.3 6-hourly sync and external-edit detection · FR-3.4 Revoked-access user alert · FR-3.5 Verification and suspension handling · FR-3.7 Change history and revert · FR-3.8 Quota-aware GBP client
- **FR-4:** FR-4.1 Multi-dimension audit score · FR-4.2 Competitor velocity, photos, posting · FR-4.4 Critical tier and "fix it for me" · FR-4.6 Re-audit after major changes
- **FR-5:** FR-5.1 Category recommendation and apply · FR-5.2 Description policy checks and live apply · FR-5.3 Services and products generator · FR-5.4 Attribute completion · FR-5.5 Hours manager · FR-5.6 Stuffed-name warning · FR-5.7 UTM links · FR-5.10 Reversible automated edits
- **FR-6:** FR-6.1 Drag-and-drop, bulk upload, PWA · FR-6.2 GBP spec validation · FR-6.3 Full category set · FR-6.4 SEO file renaming · FR-6.8 Live Media API publish and customer-photo sync
- **FR-7:** FR-7.1 Hourly review polling · FR-7.2 Keyword filter and staff assignment · FR-7.3 4-5 star auto-post limit and live posting · FR-7.4 24-hour reply SLA alerts · FR-7.5 SMS and email requests, CRM trigger · FR-7.6 Per-customer frequency cap · FR-7.11 Incentive and wording compliance guard
- **FR-8:** FR-8.1 Offer and Event types, UTM · FR-8.2 Recent-reviews input · FR-8.5 Live publishing with retries · FR-8.6 4-12 week bulk plan · FR-8.8 Full post policy checker
- **FR-9:** FR-9.1 NAP master record
- **FR-10:** FR-10.1 Customer JSON-LD generator
- **FR-11:** FR-11.1 Keyword tracking with limits · FR-11.2 Configurable geo-grid heat map · FR-11.3 Weekly and on-demand scans with credits · FR-11.7 Rank provider abstraction
- **FR-12:** FR-12.1 Bookings and branded/discovery split · FR-12.2 Month-on-month queries · FR-12.3 Response time and velocity · FR-12.4 Post and photo performance · FR-12.7 Email delivery and white-label of the monthly report · FR-12.8 CSV export
- **FR-13:** FR-13.1 Consent status · FR-13.2 GBP, website, widget and hosted-form lead capture · FR-13.4 Review requests on the timeline · FR-13.5 Staff assignment · FR-13.6 CRM-triggered review requests
- **FR-14:** FR-14.1 Plan tasks with risk level and due date · FR-14.2 Risk classes · FR-14.3 Unified approval queue with diff (web and mobile) · FR-14.4 User autopilot rules · FR-14.5 Agent task engine and statuses · FR-14.6 Brand voice profile and Hindi/Bengali · FR-14.8 Full AI audit trail · FR-14.12 Kill switch
- **FR-15:** FR-15.1 Email and PWA push channels · FR-15.2 Missing alert types · FR-15.3 Per-channel, per-frequency preferences
- **FR-16:** FR-16.2 Job monitor (quota, per-workspace cost) · FR-16.3 Coupons and feature-flag management · FR-16.6 Churn, trial conversion, activation, COGS

### P1 Missing (41)

- FR-1.4 No-GBP creation guidance
- FR-2.6 Add-on purchases
- FR-3.6 Duplicate listing detection
- FR-4.5 Full website audit
- FR-5.8 Service-area manager · FR-5.9 Pin accuracy check
- FR-6.5 EXIF title, description, keywords, copyright · FR-6.6 EXIF safety (fake coordinates, personal data) · FR-6.7 EXIF reader and warning · FR-6.9 Photo cadence planner · FR-6.10 Photo coverage score · FR-6.11 Image export
- FR-7.8 Fake-review flagging · FR-7.9 Review widget · FR-7.10 Velocity and trend versus competitors
- FR-8.3 Canvas editor · FR-8.7 Evergreen rules and auto-expiry · FR-8.9 Post performance loop
- FR-9.2 Citation scan · FR-9.3 Directory library · FR-9.4 Fix workflow · FR-9.5 Duplicate and wrong-listing detection · FR-9.7 Citation health score
- FR-10.2 Snippet, WordPress, GTM delivery · FR-10.3 Schema validator · FR-10.4 Landing page generator · FR-10.7 Click-to-call and WhatsApp widget · FR-10.8 Search Console
- FR-11.4 Competitor rank tracking · FR-11.5 History, share of voice, drop alerts · FR-11.6 Organic rank
- FR-12.5 GA4 · FR-12.6 Call recording · FR-12.9 Goal tracking
- FR-13.7 SMS and email messaging · FR-13.8 Source attribution · FR-13.11 Consent storage
- FR-14.9 Learning loop · FR-14.10 In-app chat assistant
- FR-16.4 Support tools · FR-16.5 Template versioning and A/B tests

### P2 Missing (6)

- FR-1.6 White-label
- FR-8.10 Meta cross-posting
- FR-9.6 Bing and Apple sync
- FR-10.5 Service-area city pages
- FR-10.6 Internal linking suggestions
- FR-13.10 Appointment and booking calendar sync

### NFR / Security / Compliance Missing (27)

- **Performance and scale:** NFR-1, NFR-2, NFR-3, NFR-4, NFR-5
- **Reliability:** NFR-6, NFR-7, NFR-8, NFR-9
- **Security:** NFR-11, NFR-12, NFR-13, NFR-14, NFR-15
- **Compliance:** NFR-17, NFR-18, NFR-19, NFR-20
- **Usability:** NFR-22, NFR-23, NFR-24, NFR-25
- **Observability and maintainability:** NFR-26, NFR-27, NFR-28, NFR-29, NFR-30

---

## 11. Evidence / Confidence Notes

These items were hard to verify. Each is still classified strictly under the rules above.

1. **Live GBP writes are disabled.** `GBP_LIVE_WRITES_ENABLED=false` in `.env` and `.env.local`, and it is not set in `.env.production.example`. The production server's environment could not be inspected. Code paths exist for FR-5.2 (apply), FR-6.8, FR-7.3 (posting), FR-8.5 and the related integration rows, but they could not be shown to reach Google, so they are 🟡.
2. **Third-party APIs were not called.** No Google, Razorpay, Meta, Twilio, DataForSEO, Groq or Gemini APIs were exercised. The project memory notes that `.env` holds live production credentials, so no harness or test run was performed. Integration rows marked 🟢 are based on implemented client code and webhook handling only.
3. **Google API access approval** (checklist item 1) and the quota numbers live outside the repository.
4. **Production infrastructure** (uptime, TLS version, Atlas backup settings, nginx configuration) cannot be inspected from the repository. NFR-6, NFR-8 and the TLS part of NFR-10 rely on repository documents only. NFR-10 is 🟢 based on application-level AES-256-GCM and HSTS.
5. **NFR-16** is 🟢 because the required policy pages are published. Actual adherence to Google's Limited Use policy is an operational matter that code cannot prove.
6. **NFR-21** is 🟢 only because call recording is never enabled (`recordingUrl: null`). If recording is added later, this needs re-review.
7. **Partially implemented items** (classified 🟡) with substantial existing work worth noting for the next round: FR-1.8 (deletion), FR-2.5 (failed-payment dunning), FR-3.4 (encryption and refresh), FR-6.5 (GPS EXIF writer), FR-7.3 (draft, validate, approve pipeline), FR-7.6 (no gating, daily cap), FR-8.2 (grounded generator), FR-8.8 (claim validator), FR-11.2 (3×3 audit grid), FR-12.1 (performance metrics), FR-12.7 (monthly report in-app and WhatsApp), FR-13.5 (follow-up tasks), FR-14.8 (AI cost logging).
8. **Automated tests:** 39 integration test files exist, mostly for pure functions (`node --test`). There are no end-to-end tests, no coverage reporting, and no cross-tenant isolation tests. The tests were not run during this audit.
9. **Mobile app:** `mobile/` (Expo) was inspected only for screen presence (reviews, photos, posts) in relation to FR-6.1, FR-14.3 and NFR-22. It was not audited in depth.
10. **Documentation in `docs/` and `documentation/`** was not used as evidence where it conflicts with code. For example, `docs/AUDIT_SCORING.md` describes a weighted four-pillar score, but `src/services/audit/auditService.ts:639` now uses profile completion only.
