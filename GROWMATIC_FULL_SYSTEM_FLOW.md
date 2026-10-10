# GrowwMatics — Full System Flow (as implemented)

| | |
|---|---|
| **Scope** | End-to-end execution paths, traced from code. No application code was changed. |
| **Codebase** | Branch `dev`, commit `ee09922` |
| **Written** | 2026-10-07 |
| **Convention** | `file:line` refers to `src/` unless the path says otherwise. Anything not provable from code is marked **NOT VERIFIED FROM CODE**. |
| **Configuration notes** | Values read from `.env` / `.env.local` (names only, no secrets): `GBP_LIVE_WRITES_ENABLED=false`, `WHATSAPP_PROVIDER=twilio`, `MAX_REVIEWS_PER_AUDIT=50`, `REVIEW_PROVIDER=serpapi`, `QA_TESTING_MODE=true` (inert in production, see §19), `TWILIO_TEMPLATE_REVIEW_REQUEST_UTILITY` **not set**. The production server's environment was not inspected. |

---

## Contents

1. System overview
2. Free Report
3. Account creation / login
4. Business / workspace creation
5. Onboarding
6. Google Business Profile connection
7. Current GBP data storage
8. Audit engine
9. SEO Brain
10. Monthly audit / Brain update
11. SEO Plan consumers
12. Content / GBP execution
13. WhatsApp system
14. Review management
15. Customer data
16. Database relationship map
17. Background job map
18. Error / failure paths
19. Security / tenant isolation
20. UI map
21. Complete user journey
22. Critical gaps / duplicate paths
23. FR-3.2 impact
24. File / function index
25. Unknown / not verified from code

---

## 1. System overview

### 1.1 Stack

| Layer | Implementation | Evidence |
|---|---|---|
| Frontend | Next.js 16 App Router, React 19 client and server components, Tailwind | `package.json`, `src/app/**` |
| Mobile | Separate Expo app calling the same `/api/*` with a Bearer session token | `mobile/`, `lib/session.ts` `getSession()` reads `Authorization: Bearer` |
| Backend | Next.js route handlers under `src/app/api/**` (about 230 handlers). No server actions were found. | `src/app/api` |
| Request gate | `src/proxy.ts`, Next 16's middleware equivalent, matcher `['/dashboard/:path*','/api/:path*']` | `proxy.ts` `config` |
| Database | MongoDB through Mongoose (`src/models/*.ts`). No SQL, Prisma or Supabase. | `lib/mongodb.ts`, `package.json` |
| Background jobs | Inngest: 53 functions registered in `src/app/api/inngest/route.ts`, defined in `services/inngest/functions.ts` | — |
| AI | Groq (`GROQ_MODEL = 'openai/gpt-oss-120b'`, `lib/aiModel.ts`) for audits, content, replies and agents. Gemini or NanoBanana for images (`services/ai/imageGenerator.ts`). | — |
| Google | OAuth with `business.manage`; Business Profile APIs (Account Mgmt v1, Business Info v1, My Business v4, Performance v1); Places (legacy and New); Static Maps | `lib/gbpClient.ts`, `services/google/places.ts` |
| Ranking / keywords | DataForSEO Maps Live and Google Ads Search Volume; SerpApi (review fallback) | `services/audit/dataForSeoClient.ts`, `keywordVolumeClient.ts`, `services/reviews/providers/*` |
| WhatsApp | Twilio (active: `WHATSAPP_PROVIDER=twilio`) and Meta Cloud API (implemented, bypassed when Twilio is forced) | `services/whatsapp/send.ts`, `services/twilio/client.ts`, `services/whatsapp/meta.ts` |
| Email | Resend, falling back to SendGrid through nodemailer | `services/email.ts` |
| Billing | Razorpay subscriptions with a webhook | `app/api/billing/*`, `app/api/webhook/razorpay/route.ts` |
| Storage | DigitalOcean Spaces (S3 API) | `lib/storage.ts` |

### 1.2 High-level architecture (code-confirmed)

```text
Visitor ──► /free-report ──► POST /api/free-report/start
               │                 ├─ provisionShadowAccount()  → User(shadow)+Organization+Business+Subscription(Free)
               │                 │                                + session cookie + activeBusinessId cookie
               │                 ├─ fileFreeReportPlatformLead() → platform Lead (tenant 'gmbboost-internal')
               │                 └─ createPendingAuditAndDispatch(fastMode:true) → Inngest 'audit/generate.requested'
               ▼
        /free-report/result (polls GET /api/audit/[id]) ──► "Unlock" → /checkout → Razorpay
                                                                         │
                         Razorpay webhook → activateBusinessPlan()  ◄────┘
                                │   (Business.subscriptionStatus='active')
                                ├─► maybeStartContentAutopilot / maybeStartAuditAutopilot (need GBP too)
                                ▼
        /dashboard  (proxy gate: session epoch, post-payment intake)
          ├─ /dashboard/onboarding/intake → POST /api/onboarding/intake → mergeIntakeIntoSeoPlan (SEO Brain v+1)
          ├─ Connect Google → /api/auth/google → callback → finalizeGbpConnection()
          │        └─ 'gbp/sync.requested' → gbpSyncWorker (insights, keywords, reviews, profile)
          │        └─ maybeStartAuditAutopilot → FULL audit (connected_baseline) → SeoPlan v+1
          ├─ auditAutopilotCron (hourly; 30-day cadence) → monthly audit → comparison + monthly report → SeoPlan v+1
          ├─ weeklyContentAutopilot (hourly; 7-day cadence) → weekly batch posts → scheduled publish (GBP write gated OFF)
          ├─ Reviews: nightly sync, AI reply drafts, auto-reply when opted in (publish gated OFF)
          └─ Review requests: WhatsApp (Twilio, platform number) → delivery/read webhook → click redirect → Google
```

**Entry paths:** there are two ways to create an account.
- The **free report** creates a shadow account. The login page sends new users here: "Don't have an account? Get your free report", in `app/(auth)/login/LoginForm.tsx:194`.
- The **`/onboarding` wizard** creates an unverified account and verifies it by WhatsApp OTP. It is linked from `components/sections/pricing/PricingCards.tsx:125`.

A third path, the WhatsApp report agent, also creates shadow accounts (§6.7).

---

## 2. Free Report: complete flow

### 2.1 Visitor entry

| Item | Implementation |
|---|---|
| Page | `app/free-report/page.tsx` (client component), `app/free-report/layout.tsx` |
| Query parameters | None read on this page. |
| Business selection | `components/shared/BusinessAutocomplete.tsx` calls `GET /api/google/autocomplete?q=&sessiontoken=` (line 102), then `GET /api/google/place-details?placeId=&sessiontoken=` (line 131). |
| Place details source | `services/google/places.ts` `getDetails()`: legacy Places Details with fields `name,formatted_address,address_components,formatted_phone_number,international_phone_number,website,url,rating,user_ratings_total,geometry,types,editorial_summary,photos,opening_hours`, plus Places (New) `primaryTypeDisplayName`. It is IP rate-limited (`app/api/google/place-details/route.ts`) and **unauthenticated**. |
| Visitor input | The selected business plus a WhatsApp phone number (`PhoneNumberInput`, default `+91`). Client-side validation requires at least 8 digits. |
| Browser → server payload | `businessName, category, address, area, city, state, country, businessPhone, website, googlePlaceId, googleMapsUrl, latitude, longitude, placesRating, placesReviewCount, editorialSummary, photoCount, hasHours, googleTypes, phone` (`page.tsx:86-110`). **All Places-derived values arrive from the browser** and are trusted as sent. |

### 2.2 Submission: `POST /api/free-report/start` (`app/api/free-report/start/route.ts`)

```text
UI handleSubmit()
 ↓ POST /api/free-report/start (no auth required)
 ↓ checkDurableRateLimit (Mongo-backed, per IP and per phone; bypassed only by isQaTestingMode())
 ↓ normalizePhoneE164(phone); businessName required
 ↓ provisionShadowAccount({ phone, source:'free-report-form', businessData })          (lib/shadowAccount.ts:109)
 ↓ fileFreeReportPlatformLead({ name, phone, businessName })                            (services/leads/platformProspectEntry.ts)
 ↓ if reused business: reuse a COMPLETED audit < 30 days old, or a PENDING audit < 2 min old
 │                     (an older PENDING one is marked FAILED)
 ↓ createPendingAuditAndDispatch(business, organization, user)  → fastMode defaults to TRUE (lib/startAudit.ts)
 ↓ linkPlatformLeadAudit(leadId, auditId)
 ↓ 201 { success, businessId, auditId, reused:false }  → router.push('/free-report/result?auditId=…')
```

**Failure responses:**

| Condition | Response |
|---|---|
| `CLAIMED_OR_PAID_REUSE_ERROR` | 409 "An account already exists… Please log in" |
| Duplicate key (Mongo 11000) | 409 with a generic message |
| Anything else | 500 "We couldn't generate your report." |
| CRM lead wiring fails | Logged only; the audit still runs. |

### 2.3 Shadow account / lead provisioning: `provisionShadowAccount()` (`lib/shadowAccount.ts:109`)

**New phone number.** The function creates:

| Created | Key values |
|---|---|
| **User** | `fullName:'New User'`, `email:'<digits>@shadow.growwmatics.internal'`, `phone` (E.164), `role:'CLIENT'`, `isShadowAccount:true`, `shadowSource`, `onboardingCompleted:false` |
| **Organization** | `name` = business name, `ownerId` = user, `subscriptionPlan:'Free'` |
| **Business** | Places snapshot fields (`placeId` and `googlePlaceId` both set, `placesRating`, `placesReviewCount`, `photoCount`, `hasHours`, `googleTypes`, `description` = editorialSummary), `googleConnected:false`, `provisionedVia`, `organizationId`, `userId` |
| **User links** | `organizationId`, `activeBusinessId`, and `$addToSet businessIds` |
| **Subscription** | `{ planType:'Free', billingStatus:'Active', trialStatus.isActive:false }`, created if none exists |

It then signs the visitor in:
- `createSession()` sets an HTTP-only `session` JWT cookie (30 days).
- It sets the `activeBusinessId` cookie (30 days).

**Returning phone number.**
- It looks for the same business among `user.businessIds`: by `googlePlaceId` when both sides have one, otherwise by case-insensitive name.
- `isEstablishedAccount = !user.isShadowAccount || any workspace unlocked (paid)`.
- If the caller is anonymous (`phoneVerified` not set) and the account is established, it throws `CLAIMED_OR_PAID_REUSE_ERROR`. QA mode bypasses this outside production.
- `activeBusinessId` is only moved for non-established accounts.

**Platform lead.** `fileFreeReportPlatformLead()` files a CRM `Lead` under the platform tenant `'gmbboost-internal'`, which is GrowwMatics' own sales CRM, not the business's CRM.

**Identifiers connecting everything:** `User._id`, `Organization._id`, `Business._id` (→ `Audit.businessId`), `Audit._id` (→ `Lead.auditId` via `linkPlatformLeadAudit`), and the phone number (User.phone and the Lead's phone).

**Conversion to a real account: there is no separate claim step.**
- The file header of `lib/shadowAccount.ts` says: "There's no separate 'claim' step… phone+WhatsApp OTP (/api/auth/phone-login) is the durable, permanent way back in."
- `isShadowAccount` is **never set back to `false`**; a repository search for writers found none.
- At checkout, a shadow user can replace the placeholder email (`app/api/user/profile/route.ts` PATCH allows an email change only while `isShadowAccount` is true; `app/checkout/page.tsx:109-131`).
- An account becomes "established" for the reuse guard once a workspace has paid.

### 2.4 The free audit

```text
createPendingAuditAndDispatch()  (lib/startAudit.ts)
  Audit.create({ fastMode:true, auditKind:'free_report' (lifecycleOf), status:'PENDING', businessId, tenantId=orgId,
                 userId, organizationId, businessName, category, website, phone, address, city, state, … })
  inngest.send('audit/generate.requested', { auditId })
        ↓
generateAuditJob  (services/inngest/functions.ts:1752)
  step 'pre-sync-reviews'  → SKIPPED (fastMode)
  step 'process-audit'     → processAuditJob(auditId)  (services/audit/auditService.ts:131)
  sendEvent 'sales/nurture.requested'   → salesNurtureRequested (WhatsApp sales drip to the visitor)
  sendEvent 'report/ready.requested'    → sendReportReadyNotification (WhatsApp "report ready", fastMode only)
  step 'owner-whatsapp-report-ready'    → skipped (fastMode)
```

Inside `processAuditJob` for a free audit (`depth = 'free'`, `auditService.ts:548`):

| Area | What happens |
|---|---|
| Reviews | `Review.find({businessId, period window}).limit(MAX_REVIEWS_PER_AUDIT)`, normally empty for a new shadow business. Lifetime totals fall back to `Business.placesRating` / `placesReviewCount`. |
| Website | `getWebsiteIntelligence(website, {maxPages:6})` (`services/intel/websiteIntelligence.ts:74`). The crawl is cached 30 days in `WebsiteIntelligence`, keyed by origin. A failure is logged and does not fail the report. |
| Place cache | `PlaceInsightCache`, keyed by googlePlaceId, **fastMode only** (`auditService.ts:240-262`). It reuses rank and narrative results for the same listing. |
| Rankings | `fetchGeoGridRankings(…, { reduced: true })` (`auditService.ts:276`): 1 keyword × up to 3 points, through DataForSEO, plus hyper-local keyword expansion (`:294`). |
| Keyword volume | DataForSEO Ads (`keywordVolumeClient.ts`), with a city-tier estimate fallback. |
| Competitors | Built from ranking observations (`facts.ts`) and Places text search (`competitorService.ts` `findCompetitors`). |
| GBP | **Not read.** `gbpLive` and `performanceBaseline` are only fetched when `depth === 'full'` (`:560`, `:580`). |
| Score | `finalScore = profileCompletion.completionPercentage` (`:639`), where `calculateProfileCompletion(businessObj, {gbpLive:null, publicProfile})` (`seoAnalyzer.ts:64`). |
| Evidence and findings | `buildEvidenceAndFindings()` (`findings.ts:219`). |
| AI | `generateAIAudit()` (`services/ai/auditEngine.ts`), then `generateSeoPlanDraft()` (`services/ai/seoPlanEngine.ts:681`, depth `'free'`). A Groq failure falls back to `emptyAIResult` and the report still ships. |
| Persistence | `Audit.auditData` (facts, evidenceItems, findings, checklist, seoPlanDraft…) with status COMPLETED. `Business.freeAuditUsed=true`. `upsertSeoPlanFromAudit()` creates SEO Brain **v1** (§9). |

### 2.5 Free Report result

```text
/free-report/result?auditId=…  (app/free-report/result/page.tsx)
  poll every 3 s (POLL_INTERVAL_MS=3000) up to 95 attempts (≈4.75 min), stopping on COMPLETED/FAILED
  GET /api/audit/[id]  → requireAuditAccess(id) (lib/tenant.ts): owner, org member, or SUPER_ADMIN
                         (works because the shadow session cookie was set in §2.3)
  → <FreeReportView audit pricing …/> (components/audit/FreeReportView.tsx)
```

The free report shows these sections (`FreeReportView.tsx` section headers):
- Google Search Ranking
- Businesses shown above you
- Issues we verified
- Review Analytics
- Profile Completion
- Priority Action Items
- Strengths & Areas to Improve
- Common questions

Values come from `auditData.facts` through `services/audit/reportDisplay.ts`. The CTA links to `/checkout?cycle=…&return=/free-report/result?auditId=…` (`FreeReportView.tsx:197`).

`cleanupStalePendingAudits` (every minute) marks PENDING audits older than 5 minutes as FAILED (`functions.ts:1930-1936`).

### 2.6 Free Report → paid account

There is no signup or claim page. The code-confirmed path is:

```text
FreeReportView "Unlock" → /checkout (already logged in via shadow session)
  → PATCH /api/user/profile (name; email allowed only for shadow accounts)
  → POST /api/billing/checkout (Razorpay subscription for the ACTIVE workspace)
  → Razorpay webhook subscription.activated/charged → activateBusinessPlan(businessId) (lib/billing/applyEntitlements.ts:47)
       Business.subscriptionStatus='active', pipelineStage='Customer'; in-app + owner WhatsApp notification
       → maybeStartContentAutopilot / maybeStartAuditAutopilot (each also needs GBP connected)
  → returning later: /login → WhatsApp OTP (phone-login) → same User, same Business, same free Audit
```

| Question | Answer from code |
|---|---|
| Original free report preserved? | Yes. The Audit is never deleted by this flow. |
| Free audit reused? | It remains the most recent audit. The first FULL audit is a new Audit (`connected_baseline`) once subscription, GBP connection and a real category are all in place (§8). |
| Data carried forward | The same Business (Places snapshot fields), SeoPlan v1, and `Business.keywords`/`faqs` prefilled by `upsertSeoPlanFromAudit` when they were empty. |
| Data discarded | Nothing is deleted. Placeholder `email` is replaced if the user enters one at checkout. |
| Shadow flag | Remains `true` permanently. |

---

## 3. Account creation / login

### 3.1 Authentication mechanisms

| Path | Route | Mechanism |
|---|---|---|
| Phone + WhatsApp OTP (primary) | `POST /api/auth/phone-login/request` → `POST /api/auth/phone-login/verify` | UI `app/(auth)/login/LoginForm.tsx:41,65,84`. OTP from `services/auth/otp.ts` (`generateOTP`, `hashOTP`, `verifyOTP`), 10-minute TTL, sent by `sendOtpMessage()`. |
| Wizard sign-up verification | `POST /api/onboarding` → `/verify-phone` → `POST /api/auth/verify-phone-otp` | Verifies and logs in through `finalizeLogin()` |
| Email + password (legacy) | `POST /api/auth/login` | bcrypt. No caller found in the current web login UI (`LoginForm.tsx` calls only the phone-login routes). **Whether any other client calls it: NOT VERIFIED FROM CODE.** |
| Super admin | `app/(auth)/admin-login`, `api/admin/auth` | `lib/superAdminAuth.ts` |

### 3.2 Session

- `lib/session.ts` `createSession(userId, role, sessionEpoch)` issues an HS256 JWT `{userId, role, sv}` signed with `SESSION_SECRET`, stored as the HTTP-only `session` cookie for 30 days.
- `getSession()` accepts `Authorization: Bearer` (mobile) first, then the cookie.
- `lib/authSession.ts:17` `finalizeLogin()` does the following:
  1. Creates the session.
  2. Sets `lastLoginAt` and resets `failedLoginAttempts`.
  3. Resolves `activeBusinessId`: `User.activeBusinessId`, otherwise the first `Business{userId}`.
  4. Sets the `activeBusinessId` cookie.
  5. For `x-client: mobile`, returns the token in JSON.
- **Revocation:** `User.sessionEpoch` is compared with the token's `sv` in `lib/sessionEpoch.ts`. This is enforced by `proxy.ts` for `/dashboard/*` and by `requireClient` for APIs.
- **Lockout:** after 10 failed attempts the account is locked for 15 minutes (`accountLockedUntil`), on top of in-memory IP+phone rate limits (`lib/rateLimit.ts`).

### 3.3 How the app knows "this user is operating Business X"

`lib/tenant.ts` `requireBusinessContext({ businessIdFromBody? })`:

1. `requireClient()` (`lib/auth.ts:7`): a valid session, an existing user, not `isDeleted`, and a matching session epoch.
2. Business ID resolution order: explicit argument → `x-business-id` header (mobile) → `activeBusinessId` cookie.
3. Ownership:
   - SUPER_ADMIN may use any business.
   - Everyone else needs `Business.findOne({ _id, $or: [{ userId }, { organizationId: user.organizationId }] })`.
4. Returns `{ userId, organizationId, businessId, business }`, or 401/400/403.

Workspace switching uses `/api/business/active` and `components/layout/BusinessSwitcher.tsx`, which set the cookie.

### 3.4 Permissions

- Roles are only `SUPER_ADMIN | CLIENT` (`models/User.ts:185-187`). There is no per-workspace role.
- Feature access:
  - `lib/moduleGating.ts` `requireModule(userId, module)` reads `Subscription` **by userId**.
    - SUPER_ADMIN passes.
    - **No Subscription document → allowed** (fail-open).
    - An active trial passes.
    - Otherwise `subscription.modules[module].enabled` decides.
  - Usage limits: `lib/featureGating.ts` `checkUsageLimit`.
  - Workspace lock: `lib/workspaceAccess.ts` `isWorkspaceUnlocked`, used by the **client-side** `components/layout/WorkspaceLockGate.tsx` (blur overlay) and `/api/billing/status`.
- `proxy.ts` **does not redirect locked workspaces**, despite its header comment. It enforces only the session epoch and the post-payment intake redirect (lines 128-163).

---

## 4. Business / workspace creation

| Path | Writes | File |
|---|---|---|
| Free report | User(shadow) + Organization + Business + Subscription(Free); details in §2.3 | `lib/shadowAccount.ts` |
| WhatsApp report agent | The same function with `phoneVerified:true`, plus GBPToken | `lib/reportConnect.ts` `finalizeReportConnection()` |
| `/onboarding` wizard | User (unverified, `freemiumAuditGate`) + Subscription(Free) + Organization + Business (`onboardingCompleted:true`) | `app/api/onboarding/route.ts` |
| Add workspace | A **new Organization** plus Business for the same user | `app/api/business/add-workspace/route.ts` |
| `POST /api/business` | Business inside the user's org, limited by `Organization.maxBusinesses` (default 1) | `app/api/business/route.ts:36` |

**Relationships:**
- `User.organizationId` and `User.businessIds[]` link a user to workspaces; `User.activeBusinessId` is the current one.
- `Business.userId` and `Business.organizationId` link back.
- `Organization.ownerId` points to the owning user.

**Initial business fields** come from Places (free report and wizard business search):
- name, category (`primaryTypeDisplayName` or derived; fallback `'Local Business'`)
- address, area, city, state, country, phone, website
- placeId, googlePlaceId, googleMapsUrl, coordinates
- Places rating and count, photoCount, hasHours, googleTypes

Keywords, intake answers, services and description are added later by the intake (§5.2) or by audit prefill (`upsertSeoPlanFromAudit`).

---

## 5. Onboarding

There are two different onboarding flows.

### 5.1 Sign-up wizard: `/onboarding`

`app/onboarding/page.tsx` → `components/onboarding/OnboardingWizard.tsx:47-53`:

| # | Step | Component | Collects |
|---|---|---|---|
| 1 | account | `StepAccount` | fullName, email, personal phone (login identity) |
| 2 | organization | `StepOrganization` | company name |
| 3 | business | `StepBusinessSearch` | Places autocomplete |
| 4 | confirm | `StepBusinessConfirm` | business fields |
| 5 | google | `StepGoogle` | **Optional** text fields `googlePlaceId` and `gbpUrl`. `handleContinue` just calls `onNext()`. **No OAuth here.** |
| 6 | complete | `StepCompletion` | `POST /api/onboarding` → `/verify-phone?phone=…` |

`POST /api/onboarding` (`app/api/onboarding/route.ts`) does the following:
- Rate limit is 8 per 15 minutes per IP. Shadow-domain emails are rejected. A verified phone returns 409 `existingAccount`.
- **New user:** creates the User (`isPhoneVerified:false`, `freemiumAuditGate:{active:true}`), then `Subscription{Free}`, then sends the WhatsApp OTP.
- **Resume:** sends a new OTP.
- Creates the Organization. Its `subscriptionPlan` is `'Free'` if `selectedPlan==='starter'`, otherwise `'Pro'`; no payment is involved. **Whether `Organization.subscriptionPlan` gates anything: NOT VERIFIED FROM CODE** (gating reads `Subscription`, `User.subscriptionPlan` and `Business.subscriptionStatus`).
- Creates the Business. It sets `whatsappConfig.provider:'meta'`, `integrations.whatsappNumber`, `aiSettings`, social URLs and `onboardingCompleted:true`.
- Rolls back the created documents on failure (`rollbackPartialSignup`).

**WhatsApp business number:** `whatsappBusinessNumber` is defined in `components/onboarding/types.ts`, but **no wizard step renders an input for it** (a repository search found it only in `types.ts` and the API). It can be edited later in `app/dashboard/settings/page.tsx:459` (Business Profile tab), which calls `PATCH /api/business/[id]` with `'integrations.whatsappNumber'`.

There are no wizard steps for target audience, keywords, autopilot/approval mode or plan selection.

### 5.2 Post-payment intake: `/dashboard/onboarding/intake`

- **Gate:** `proxy.ts` redirects an unlocked workspace created on or after `2026-07-23` without `intakeCompleted` to the intake. Profile and billing pages stay reachable.
- **`GET /api/onboarding/intake`** returns current values plus `buildIntakePrefill()` suggestions (`services/intel/intakePrefill.ts`, from website intelligence, Google listing, measured report and the SEO Brain via `seoBrainKeywords`).
- **`POST`** (zod `intakeSchema`):

| Field | Rule |
|---|---|
| category | required |
| description | required, at least 10 characters |
| services | required, at least 3 characters |
| keywords | required, at least 1 |
| offers, city, area, tone, uniqueSellingPoints, targetAudience, competitorNames, primaryGoal | optional |
| acceptedSuggestions | optional; records the source of each accepted suggestion |

  After validation it:
  1. Writes these fields to Business and sets `intakeCompleted:true`.
  2. Calls `mergeIntakeIntoSeoPlan()`, which creates a new SEO Brain version (§9.4).
  3. Calls `maybeStartAuditAutopilot()`.
  4. Calls `maybeStartContentAutopilot()`.

  Each side effect is best-effort, wrapped in try/catch.

---

## 6. Google Business Profile connection

### 6.1 Normal connection flow

```text
User clicks "Connect Google Account" (<a href="/api/auth/google">: dashboard/insights/page.tsx:252, :637;
                                       dashboard/gbp-profile/page.tsx:145)
  ↓
GET /api/auth/google (app/api/auth/google/route.ts)
  requireBusinessContext() → businessId
  JWT {state, businessId} (5 min) → cookie gbp_oauth_state
  302 accounts.google.com  scope=business.manage, access_type=offline, prompt=consent
  ↓
GET /api/auth/google/callback (app/api/auth/google/callback/route.ts)
  verify state cookie vs ?state  (mismatch → /dashboard/insights?error=state_mismatch)
  POST oauth2.googleapis.com/token  (no refresh_token → redirect to re-consent)
  GET oauth2/v3/userinfo → sub, email
  GET mybusinessaccountmanagement.googleapis.com/v1/accounts → accounts[0] ONLY (line 130)
  GET mybusinessbusinessinformation.googleapis.com/v1/{account}/locations?readMask=name,title,storefrontAddress,metadata
      (single page; no pageToken loop)
  match location where metadata.placeId === Business.googlePlaceId
    ├─ no match AND >1 location → PendingGbpConnection.create (tokens AES-GCM encrypted, 15-min TTL)
    │      cookie gbp_pending_selection → /dashboard/gbp-profile/select-location
    │      → POST /api/gbp/select-location → finalizeGbpConnection()
    └─ else → finalizeGbpConnection({ locationId: matched ?? locations[0] ?? '' })
  302 /dashboard?connected=true
  ↓
finalizeGbpConnection()  (lib/gbpConnect.ts:35)
  GBPToken.findOneAndUpdate({businessId}, {encrypted access/refresh, expiresAt, locationId, accountId, scopes,
                                           googleAccountId, googleEmail, connectedAt}, upsert)
  Business: googleConnected=true, googleLocationId
  Review.deleteMany({ businessId, source ≠ 'gbp_api' })     (purge SerpApi/mock reviews)
  inngest.send('gbp/sync.requested', {businessId})            (failure logged only)
  maybeStartContentAutopilot(businessId)
  maybeStartAuditAutopilot(businessId)
```

### 6.2 `gbpSyncWorker` (`services/inngest/functions.ts:4309`, `retries: 2`)

Triggered by `gbp/sync.requested`, which is emitted by `finalizeGbpConnection` and by `gbpNightlySyncScheduler` (cron `0 3 * * *`, `:4280`).

The scheduler selects `Business{ googleConnected:true, googleLocationId set, isDeleted≠true }` and sends one event per business with no throttle.

| Step | Calls | Writes |
|---|---|---|
| `sync-gbp-data` | `fetchDailyMetrics` (last 28 days to yesterday) and `fetchSearchKeywords` for the current month and the 2 before it | `GBPInsights` upsert `{businessId,date}`; `GBPKeyword` upsert `{businessId,keyword,month,year}`; `GBPToken.keywordSync`, `GBPToken.lastSyncAt`. On `GBPAuthError` it sets `Business.googleConnected=false` and returns `skipped`. |
| `sync-gbp-reviews` | `syncReviewsForBusiness(businessId, tenantId)` (§14) | `Review`, `ReviewAnalytics`, `Business.googleReviewTotals` |
| `sync-gbp-profile` | `fetchLocationProfile` | `Business.category` is always overwritten with the GBP primary category. `description`, `phone`, `website` and `address` are written **only if empty**. `title` and `additionalCategories` are **discarded**. |
| `backfill-gbp-history` | `backfillGbpInsightsIfNeeded` (`services/gbpInsightsBackfill.ts`) | One-time 6-month `GBPInsights` history; `GBPToken.historyBackfilledAt` |

### 6.3 Manual sync

`POST /api/gbp/sync` (`app/api/gbp/sync/route.ts`, called from `components/dashboard/GBPSection.tsx:175` and `app/dashboard/insights/page.tsx:209`) is an **inline duplicate** of steps 1 and 3 above. It runs inside the HTTP request, does **not** emit the event, and does **not** sync reviews.

### 6.4 Token handling

`lib/gbpClient.ts:23` `getValidToken(businessId)`:
1. Decrypts the token (`lib/crypto.ts`, AES-256-GCM with `GOOGLE_TOKEN_SECRET`).
2. Refreshes it when it expires within 5 minutes.
3. If the refresh fails, sets `Business.googleConnected=false` and throws `GBPAuthError`.

No user alert is sent when this happens.

### 6.5 Every GBP API call in the codebase

| Function | Endpoint | API | Read mask / params | Pagination | DB destination |
|---|---|---|---|---|---|
| callback | `GET /v1/accounts` | Account Mgmt v1 | – | ❌ (uses `[0]`) | `GBPToken.accountId` |
| callback | `GET /v1/{account}/locations` | Business Info v1 | `name,title,storefrontAddress,metadata` | ❌ | `GBPToken.locationId`; `PendingGbpConnection.candidateLocations` |
| `fetchLocationProfile` (`gbpClient.ts:262`) | `GET /v1/{locationId}` | Business Info v1 | `title,profile.description,phoneNumbers,websiteUri,categories,storefrontAddress` | n/a | See §7 |
| `fetchLocationPin` (`:303`) | `GET /v1/{locationId}` | Business Info v1 | `latlng,metadata` | n/a | `Business.verifiedLocation` (via `lib/verifiedLocation.ts`, 30-day cache) |
| `updateLocationProfile` (`:321`) | `PATCH /v1/{locationId}?updateMask=` | Business Info v1 | title, description, phone, website | – | Always mirrors to Business; the Google write is **gated** |
| `fetchDailyMetrics` (`:80`) | `GET /v1/{locationId}:fetchMultiDailyMetricsTimeSeries` | Performance v1 | 8 daily metrics | n/a | `GBPInsights` |
| `fetchSearchKeywords` (`:194`) | `GET /v1/{locationId}/searchkeywords/impressions/monthly` | Performance v1 | single-month range | ❌ | `GBPKeyword` |
| `GbpApiReviewProvider.fetchReviews` | `GET /v4/{acct}/{loc}/reviews` | My Business v4 | `pageSize=50`, `orderBy=updateTime desc` | ✅, capped by `MAX_REVIEWS_PER_AUDIT` (env 50); incremental mode stops at the first known review | `Review` |
| `replyToReview` (`:445`) | `PUT /v4/…/reviews/{id}/reply` | v4 | – | – | **Gated** |
| `createLocalPost` (`:402`) | `POST /v4/…/localPosts` | v4 | `topicType:'STANDARD'` only | – | **Gated** |
| `listLocationMedia` (`:575`) | `GET /v4/…/media` | v4 | `pageSize=100` | ✅ | `GbpMediaAsset` (only from `listMediaAssets`) |
| `uploadLocationPhoto` (`:504`), `deleteLocationMedia` (`:540`) | v4 media | v4 | – | – | **Gated** |

**Scope:** only `https://www.googleapis.com/auth/business.manage`. "Gated" means `gbpWritesEnabled()` (`lib/gbpSafety.ts`) is `false`, so these calls return `liveWriteApplied:false`.

### 6.6 Connection paths compared

| Path | Writes GBPToken | Calls `finalizeGbpConnection` | Emits `gbp/sync.requested` | Purges SerpApi reviews | Starts autopilots | Audit started |
|---|---|---|---|---|---|---|
| Dashboard OAuth (callback / select-location) | ✅ | ✅ | ✅ | ✅ | ✅ | via `maybeStartAuditAutopilot` (full) if qualified |
| WhatsApp report-connect (`lib/reportConnect.ts:110`) | ✅ (own upsert) | ❌ | ❌ (picked up by the 03:00 cron) | ❌ | ❌ | `createPendingAuditAndDispatch` **fastMode** → GBP never read in that audit |
| Nightly cron | – | – | ✅ | – | – | – |
| Manual sync button | – | – | ❌ (inline) | – | – | – |

### 6.7 WhatsApp report-connect path

1. A prospect's WhatsApp conversation with the platform report agent reaches `GET /api/report-connect/[connectToken]` (OAuth start, same scope).
2. `GET /api/report-connect/callback` runs, and `/connect-google/select-listing` plus `POST /api/report-connect/finalize` handle a multi-location choice.
3. `finalizeReportConnection()` then:
   - calls `provisionShadowAccount({ phoneVerified:true, source:'whatsapp-report-agent' })` with `listingFacts(placeId)`;
   - upserts `GBPToken`;
   - sets `Business.googleConnected=true` and `googleLocationId`;
   - starts a **fastMode** audit;
   - emits `report/deliver.requested`, handled by `reportCardDeliver`, which polls the audit and sends a report-card image over WhatsApp.

---

## 7. Current GBP data storage

| Data | Google source | Current function | Database model | Field | Used by |
|---|---|---|---|---|---|
| Name | Business Info `title` | `fetchLocationProfile` | **Not stored by sync.** Per audit: `Audit` | `auditData.facts.gbpProfile.fields.title` | Audit checklist (`calculateProfileCompletion`), SEO plan draft (`safeSuggestedTitle`), monthly diff, `GET /api/gbp/profile` (display only) |
| Address | `storefrontAddress` (flattened) | `fetchLocationProfile` | `Business` | `address` (only if empty) | Audit, content facts |
| PIN | inside `storefrontAddress.postalCode` | same | `Business` | inside the `address` string only | – |
| Phone | `phoneNumbers.primaryPhone` | same | `Business` (if empty); `Audit` gbpProfile | `phone` | Checklist, post validator (`validatePost` phone rule) |
| Website | `websiteUri` | same | `Business` (if empty); `Audit` gbpProfile | `website` | Website intelligence, checklist |
| Description | `profile.description` | same | `Business` (if empty); `Audit` gbpProfile | `description` | Checklist ("Business Description"), reply facts (`replyPipeline.ts`) |
| Category | `categories.primaryCategory.displayName` | same | `Business` (always overwritten) | `category` | Audit keyword seeding, content |
| Additional categories | `categories.additionalCategories` | same | `Audit` gbpProfile only | `additionalCategories` | Checklist, reply facts (`gbpCategories`) |
| Hours | ❌ not requested | – | `Business.hasHours` comes from **Places** (browser) | `hasHours` (bool) | Checklist "Business Hours" |
| Special hours | ❌ | – | – | – | – |
| Attributes | ❌ | – | – | – | Checklist hard-codes "Unknown" |
| Services | ❌ | – | `Business.services` is owner text | – | Checklist hard-codes "Unknown" |
| Products | ❌ | – | – | – | – |
| Photos | v4 `/media` (owner) | `listLocationMedia` via `listMediaAssets` | `GbpMediaAsset` | `googleMediaName`, `category`, `url`, `publishedVia:'google_sync'` | Photo manager, weekly content images. The audit uses Places `Business.photoCount` instead. |
| Posts | ❌ never read | – | `Post` holds only GrowwMatics-created posts | – | – |
| Reviews | v4 `/reviews` | `GbpApiReviewProvider` | `Review`, `ReviewAnalytics`, `Business.googleReviewTotals` | §14 | Audit, reply pipeline, dashboard |
| Metrics | Performance daily series | `fetchDailyMetrics` | `GBPInsights` | views, viewsMaps, viewsSearch, callClicks, websiteClicks, directionRequests, conversations | Insights page, 15-day digest, audit `performanceBaseline` (live call) |
| Keywords | Performance search keywords | `fetchSearchKeywords` | `GBPKeyword` | keyword, impressions, month, year | Insights (latest month), weekly content keyword priority |
| Location / pin | `latlng` | `fetchLocationPin` | `Business` | `verifiedLocation {lat,lng,source,placeId,verifiedAt}` | Image GPS geotagging only |

---

## 8. Audit engine

### 8.1 Entry points

| Trigger | Caller | fastMode | `auditKind` (`services/lifecycle/period.ts` `lifecycleOf`) | Notes |
|---|---|---|---|---|
| Free report | `POST /api/free-report/start` | true | `free_report` | Anonymous visitor gets a shadow session |
| WhatsApp report-connect | `finalizeReportConnection` | true | `free_report` | GBP connected, but not read |
| Dashboard "run audit" | `POST /api/audit` (`app/api/audit/route.ts:201`) | false (schema default) | `dashboard` | Gated by `freeAuditUsed` and `checkUsageLimit('audits')` |
| First automatic | `maybeStartAuditAutopilot` / `claimAndDispatch` (`lib/auditAutopilot.ts`) | false | `connected_baseline` (trigger `audit-autopilot-first-run`) | Needs active subscription, `googleConnected`, and a real category |
| Monthly | `auditAutopilotCron` (hourly, `functions.ts:1975`) | false | `monthly` (trigger `audit-autopilot-monthly`) | 30-day cadence via `auditAutopilotNextRunAt`; at most 50 businesses per pass |

All entry points send `audit/generate.requested`, handled by `generateAuditJob` and then `processAuditJob`.

### 8.2 `generateAuditJob` (`functions.ts:1752`)

No `retries` value is set, so Inngest's default applies. On a re-run, `processAuditJob` returns early unless the status is `PENDING`.

1. `pre-sync-reviews`: `syncReviewsForBusiness` (skipped when fastMode); usage metered into `metadata.preSyncUsage`; failure tolerated.
2. `process-audit`: `processAuditJob(auditId)`.
3. Emits `sales/nurture.requested` and `report/ready.requested`.
4. `owner-whatsapp-report-ready`: only for COMPLETED, non-fastMode, non-monthly audits; sends the top 3 PLANNED/READY `OptimizationAction`s to the owner over WhatsApp.

### 8.3 `processAuditJob` pipeline (`services/audit/auditService.ts`)

```text
load Audit (must be PENDING) + Business
Review.find(window, limit MAX_REVIEWS_PER_AUDIT)                                   :170
getWebsiteIntelligence(website, maxPages 6) → WebsiteIntelligence (30d cache)       :204
PlaceInsightCache (fastMode only)                                                    :240
fetchGeoGridRankings(reduced = fastMode) → DataForSEO; keyword table + volume        :276
competitors / localities / facts (services/audit/facts.ts)
depth = fastMode ? 'free' : 'full'                                                   :548
  full + googleLocationId → gbpLive = fetchLocationProfile()  (LIVE Google read)     :559
  full + googleLocationId → performanceBaseline = fetchDailyMetrics(28d, live)       :580
calculateProfileCompletion(business, {gbpLive, publicProfile}) → checklist           :609
finalScore = completionPercentage                                                    :639
buildEvidenceAndFindings(...) → evidence[], findings[]                               :664
generateAIAudit(...)  (Groq; failure → emptyAIResult)                                :851
monthly context (non-fastMode): compareAudits(prev full audit, current)              :904-924
generateSeoPlanDraft(...) (Groq; failure logged, draft undefined)                    :930
validateAudit(...) / repairs
auditData assembled: facts (incl. gbpProfile), evidenceItems, findings(+findingExecution),
   optimizationPlan, comparison, lineage, planActions, monthly, sources[], providerUsage
non-fastMode: prev comparable audit → auditData.comparison                            :1214-1231
connected_baseline | monthly: syncOptimizationActions() → OptimizationAction         :1248
monthly: collectExecutions() + buildMonthlyReport() → auditData.monthly             :1260
status COMPLETED; Business.freeAuditUsed=true; pipelineStage 'Lead' if unset
upsertSeoPlanFromAudit(...) → SeoPlan v+1                                             :1419
monthly: notifyMonthlyReport() (in-app + owner WhatsApp)                             :1446
catch: status FAILED, metadata.error, releasePeriod(), rethrow                        :1455
```

### 8.4 Free vs full vs monthly audit

| Aspect | FREE (`free_report`) | FULL (`dashboard` / `connected_baseline`) | MONTHLY (`monthly`) |
|---|---|---|---|
| Review pre-sync | ❌ | ✅ | ✅ |
| Place cache | ✅ | ❌ | ❌ |
| Ranking | reduced (1 keyword × ≤3 points) | full grid | full grid |
| Live GBP profile (`gbpLive`) | ❌ | ✅ if `googleLocationId` | ✅ |
| Performance baseline | not measured | ✅ live | ✅ live |
| Comparison with previous | ❌ | ✅ (`auditData.comparison`) | ✅ (previous non-fastMode) |
| OptimizationAction sync | ❌ | `connected_baseline` only | ✅ |
| Monthly report (`auditData.monthly`) | ❌ | ❌ | ✅ |
| SEO Brain upsert | ✅ | ✅ | ✅ |
| Delivery | Result page; WhatsApp "report ready" template; sales nurture | Owner WhatsApp "report ready" with top-3 plan (not `monthly`) | `notifyMonthlyReport` (in-app + WhatsApp) |

---

## 9. SEO Brain

### 9.1 What it is in the code

The "SEO Brain" is the **`SeoPlan`** collection (`models/SeoPlan.ts:5`: "The SEO brain. One versioned document per business per audit cycle").

- Read and write surface: `services/seoPlan/seoPlanService.ts`.
- Generation: `services/ai/seoPlanEngine.ts` `generateSeoPlanDraft()`, called **only inside `processAuditJob`**.
- There is no separate brain service, cache or memory store beyond these documents.

### 9.2 Stored fields

`businessId, sourceAuditId, version, status ('active'|'superseded'), horizonDays (30), activeFrom, activeUntil, primaryKeywords, secondaryKeywords, cityAreaTerms, keywordTable, suggestedTitle, suggestedDescription, suggestedServices, suggestedCategories, suggestedQas, uspLine, reviewReplyMustInclude, postThemes, keyFinding, keywordInsights, marketOpportunities, competitorLandscape, actionPhases, draft (full ISeoPlanDraft), baseline[] (≤12 snapshots: overallScore, avgRank, reviewCount, rating, completionPct, capturedAt), ownerEdited, appliedAt, appliedLive`.

### 9.3 Generation flow

```text
Data sources (inside processAuditJob)
  Business doc · Review collection · WebsiteIntelligence · DataForSEO rankings/competitors/volume
  · Places public profile (publicProfileFromObservations) · gbpLive (full only) · performanceBaseline (full only)
  · owner intake (Business.intake) · previous audit comparison (monthlyContext)
        ↓
Normalisation: services/audit/facts.ts, seoAnalyzer.calculateProfileCompletion, profileFieldStates
        ↓
Evidence: findings.buildEvidenceAndFindings() → Audit.auditData.evidenceItems / facts  (no separate collection)
        ↓
AI: generateAIAudit() (narrative) → generateSeoPlanDraft() (plan draft; grounded via validateAudit helpers)
        ↓
Storage: Audit.auditData.seoPlanDraft  AND  seoPlanService.upsertSeoPlanFromAudit() → new SeoPlan version
        ↓
Consumers (§11): weeklyBatch · replyPipeline · seoBrainKeywords (intake, suggest-keywords, insights) · applyPlan · /dashboard/seo-plan
```

### 9.4 Versioning (`seoPlanService.ts`)

**`getActiveSeoPlan(businessId)`** returns `SeoPlan.findOne({ businessId, status:'active' }).sort({ version:-1 })`.

**`upsertSeoPlanFromAudit()`** (`:53`) runs after every completed audit, free reports included:
1. `prev` = latest version, whatever its status. `version = prev.version + 1`.
2. Keywords: `primaryKeywords` = top 5 of the keyword table sorted by volume band; `secondaryKeywords` = the next 9.
3. `baseline` = previous baseline entries plus the new one, keeping the last 12.
4. If `prev.ownerEdited`: **carries forward** `suggestedTitle`, `suggestedDescription`, `suggestedServices`, `uspLine` and `reviewReplyMustInclude`. It does **not** carry forward `primaryKeywords`, so keywords merged from the intake are replaced by the audit's keyword table on the next audit.
5. Creates the new document as `active`, then sets `prev` to `superseded` with `activeUntil`.
6. Prefills `Business.keywords` (≤15) and `Business.faqs` (≤6) **only if empty**.

**`mergeIntakeIntoSeoPlan()`** (`:152`) creates a new version without an audit:
- owner keywords placed first in `primaryKeywords` (≤8);
- owner services merged into `suggestedServices`;
- `suggestedDescription` and `uspLine` from the intake;
- `ownerEdited:true`;
- supersedes `prev`.

**What is historical:** every version stays in the collection (superseded documents are never deleted; `dataRetentionCleanupCron` states SeoPlan is never deleted). Each audit also keeps its own `auditData.seoPlanDraft`.

---

## 10. Monthly audit / Brain update

```text
Business qualifies (subscription active + googleConnected + real category)
  maybeStartAuditAutopilot() → claimAndDispatch(): atomic set of auditAutopilotNextRunAt (first caller wins)
     → createPendingAuditAndDispatch(fastMode:false, trigger 'audit-autopilot-first-run')
  Audit (connected_baseline) → processAuditJob → OptimizationAction rows created (PLANNED/READY/BLOCKED)
     → SeoPlan vN+1 (active), vN superseded
        ↓ (weekly content and review replies read the active plan)
auditAutopilotCron (hourly) finds auditAutopilotNextRunAt <= now
  → advances NextRunAt by 30 days (atomic) → dispatch trigger 'audit-autopilot-monthly'
  Audit (monthly) → processAuditJob
     prev = latest COMPLETED non-fastMode audit with facts.version ≥ 1
     auditData.comparison = compareAudits(prev, current)          (only identical searches compared)
     syncOptimizationActions(): status transitions with evidence (EXECUTED needs a record; VERIFIED after re-measure)
     collectExecutions(prev.createdAt → now): Posts published live, replies posted, ProfileActivity edits,
        GbpMediaAsset publishedVia 'growwmatics', ReviewRequests sent/failed, new reviews, content rows
     auditData.monthly = buildMonthlyReport(...) incl. diffGbpSnapshots(prev.facts.gbpProfile, cur.facts.gbpProfile)
     upsertSeoPlanFromAudit → SeoPlan vN+2 active, vN+1 superseded
     notifyMonthlyReport → in-app 'monthly_report' + owner WhatsApp summary
```

| Question | Answer |
|---|---|
| Replaced | The `active` SeoPlan pointer. Owner-edited fields carry forward (except keywords). |
| Preserved | All Audits, all SeoPlan versions, `SeoPlan.baseline[]` (last 12), and OptimizationAction `history[]`. |
| Compared | Ranking (identical searches only), reviews, profile completion, performance (`compareAudits`, `services/audit/optimizationPlan.ts:65`), and the GBP profile fields in `FIELD_LABEL` (`services/lifecycle/monthly.ts:117`). |
| Current Brain selection | Highest `version` with `status:'active'`. |
| Weekly workflows | Read the active plan at run time (§11). |

---

## 11. SEO Plan consumers

| Consumer | Reads from SeoPlan | Action | DB write |
|---|---|---|---|
| `services/content/weeklyBatch.ts:41` (`generateWeeklyBatch`) | `keywordTable` (measured, non-brand), `draft.proposedKeywords`, `postThemes`, `_id` | Plans 4 weekly slots and writes post copy | `Post` (`contentMeta.seoPlanId`, theme, keyword) |
| `services/reviews/replyPipeline.ts:58` (`draftReply` context) | `keywordTable` (measured), `draft.proposedKeywords` | Grounding facts for AI replies; also reads the latest `Audit.auditData.facts.gbpProfile.fields` (`:52-54`) | `Review.aiSuggestedReply`, `replySources` |
| `services/seoPlan/seoBrainKeywords.ts:23` | `keywordTable`, `draft.proposedKeywords` (falls back to the latest Audit) | Returns non-brand keyword suggestions | none |
| ↳ `app/api/onboarding/intake/route.ts:189` | via `seoBrainKeywords` | Intake prefill | none (until POST) |
| ↳ `app/api/onboarding/suggest-keywords/route.ts:55` | via `seoBrainKeywords` | Keyword suggestions | none |
| ↳ `app/api/gbp/insights/route.ts:264` | via `seoBrainKeywords` | "Report keywords" on the Insights page | none |
| `services/seoPlan/applyPlan.ts:27` (`POST /api/seo-plan/apply`) | `suggestedTitle`, `suggestedDescription` | `updateLocationProfile` (mirrors to Business; Google write gated) | `Business.name`/`description`; `SeoPlan.appliedAt`, `appliedLive` |
| `GET /api/seo-plan` → `app/dashboard/seo-plan/page.tsx` | whole active plan | Display and apply button | none |
| `resolveContentKeywords()` (`seoPlanService.ts`) | `primaryKeywords`, `cityAreaTerms`, `uspLine`, `postThemes` | Keyword resolver | none. **No caller outside this file was found** (repository search). |

---

## 12. Content / GBP execution

### 12.1 Weekly autopilot

```text
maybeStartContentAutopilot() (lib/contentAutopilot.ts) on subscription activation / GBP connect / intake
weeklyContentAutopilot (cron hourly, functions.ts:606)
  select Business{subscriptionStatus active, googleConnected, keywords non-empty, autopilotNextRunAt due}
  atomic claim → autopilotNextRunAt += 7 days → event 'scheduler/generate' {force:true, autopilot:true}
processContentJob (functions.ts:794, retries 3)
  checkUsageLimit(userId, businessId, 'posts', POSTS_PER_WEEK)
  generateWeeklyBatch() (services/content/weeklyBatch.ts)
     reads: active SeoPlan, WebsiteIntelligence (stored only, never crawls), GbpMediaAsset (≤40 https assets),
            GBPKeyword (latest month, impressions>0), recent Posts (keyword rotation), WeeklyOffer, festival calendar
     planWeeklySlots (services/content/plan.ts) → writeSlotCopy (Groq via contentEngine) → validatePost
        fail → regenerate once → still failing → safe template saved as DRAFT
     images: customer photos first, else generated (imageGenerator) or branded fallback; geotag via verifiedLocation
  writes Post(status 'scheduled' | 'draft', batchKey, contentMeta), AutomationLog, usage increment
  drafts → notifyBusinessUsers('content_draft'); scheduled → event 'scheduler/post-scheduled' + owner WhatsApp digest
scheduleSinglePostPublish (functions.ts:1526): sleepUntil(scheduledDate), cancelOn reschedule/unschedule
  → event 'scheduler/publish-post' → processPublishPostJob (:1579)
     publishPost() (services/content/publishPost.ts:25): atomic status scheduled→publishing
        gbpWritesEnabled() false → status 'blocked' (BLOCKED_REASON) — CURRENT CONFIGURATION
        Google error → 'failed' (recorded, not retried) → notifyBusinessUsers('post_failed')
        success → 'published', gbpPostName, liveWriteApplied:true → push + in-app + owner WhatsApp digest
publishScheduledPostsCron (hourly safety net, :1552) for scheduled posts already due
```

Other content paths:
- `POST /api/scheduler/generate` emits `scheduler/manual-generate`, handled by `manualContentGenerate`.
- `POST /api/content/generate` generates inline (manual).
- `applyWeeklyOfferJob` handles `content/weekly-offer.answered`.
- Weekly offer prompt: `weeklyContentReminder` (Sunday).

### 12.2 GrowwMatics-created posts vs pre-existing Google posts

| | GrowwMatics-created | Existing on Google before GrowwMatics |
|---|---|---|
| Storage | `Post` (`businessId`, status, `gbpPostName` when published, `liveWriteApplied`, `contentMeta`) | **Not stored.** No `localPosts.list` call exists. |
| Read from Google | – | ❌ |
| Counted in monthly report | Yes, if `status:'published' && liveWriteApplied:true` (`services/lifecycle/collect.ts:21`) | ❌ |

---

## 13. WhatsApp system: deep audit

### 13.1 Configuration

| Item | Value / implementation |
|---|---|
| Provider routing | `services/whatsapp/send.ts` `resolveProvider()`: `WHATSAPP_PROVIDER=twilio` forces Twilio globally (**set in both env files**). Otherwise Meta is used if configured; otherwise Twilio. |
| Twilio credentials | `services/twilio/client.ts` `resolveTwilioCredentials()` reads only platform env vars (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`, optional `TWILIO_MESSAGING_SERVICE_SID`). **Every outbound message, for every business, is sent from GrowwMatics' single platform number.** No per-tenant sender exists (file comment explains it was removed). |
| Meta credentials | `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_BUSINESS_ACCOUNT_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_UTILITY_TEMPLATE_NAME`, `META_TEMPLATE_LANGUAGE` |
| Platform number | `PLATFORM_WHATSAPP_NUMBER` / `NEXT_PUBLIC_WHATSAPP_NUMBER`. In both env files these equal `TWILIO_WHATSAPP_NUMBER` (digits compared; values not printed). |
| Templates (`lib/whatsappTemplates.ts`) | `TWILIO_TEMPLATE_*`: SALES_INTRO, REPORT_READY, REVIEW_REQUEST (legacy marketing; button = Google write-review URL with Place ID), REVIEW_REQUEST_UTILITY (utility; body link `/review/{token}`; **not set** in either env file), NOTIFICATION (generic utility fallback), INVOICE_READY, WELCOME_CUSTOMER, PAYMENT_RECEIVED (not set in env files), LOGIN_OTP (authentication) |
| Business's own WhatsApp number | `Business.integrations.whatsappNumber` and `Business.whatsappConfig.businessPhone`. Editable in `dashboard/settings` (Business Profile tab). Used **only for inbound routing** (`findBusinessByNumber`), not for sending. |
| Opt-in assumption | `lib/whatsappConsent.ts` `hasPhoneMessagedPlatformBefore` (used by platform sales flows). Business customers have **no consent field**; only `Customer.optedOut` exists. |
| Webhooks | `POST /api/whatsapp/webhook` (Twilio and Meta inbound, Meta statuses); `GET` (Meta verify); `POST /api/webhook/twilio` (legacy URL → `handleTwilioWebhook`); `POST /api/webhook/twilio/status` (Twilio delivery status callback) |
| Super-admin UI | `/dashboard/whatsapp` (requires `requireSuperAdmin`), `/admin/whatsapp*`, `/admin/inbox`, `/admin/review-follow-up` |

### 13.2 Account setup and WhatsApp

```text
Account (free report: phone = WhatsApp number; or /onboarding: personal phone)
  ↓ phone is the login identity, verified by WhatsApp OTP
Business: integrations.whatsappNumber / whatsappConfig — not collected by the wizard UI; editable in Settings
  ↓ no verification of the business number; no sending capability tied to it
Owner notifications: notifyOwner() → owner's phone (resolveOwner) from the platform number
```

There is no step that configures a business-owned WhatsApp sender.

### 13.3 WhatsApp OTP

```text
User enters phone (LoginForm / StepAccount)
  ↓ POST /api/auth/phone-login/request  (rate limit 5 / 15 min per IP+phone; 404 noAccount if no user;
                                          lockout check; reviewer account → fixed code, no send)
  ↓ generateOTP() → hashOTP() → User.phoneOtpHash, phoneOtpExpiry (+10 min)
  ↓ sendOtpMessage(phone, text, code)  (services/whatsapp/send.ts)
       Twilio + TWILIO_TEMPLATE_LOGIN_OTP set → ONE authentication-template send {{1}}=code; failure returned (502)
       template SID missing → best-effort free text (only lands inside a 24 h session)
  ↓ POST /api/auth/phone-login/verify (rate limit; verifyOTP vs hash; 10 failures → 15 min lock)
  ↓ finalizeLogin() → session cookie (or Bearer token for mobile) + activeBusinessId
```

Sign-up uses the same `sendOtpMessage` from `POST /api/onboarding`, verified by `POST /api/auth/verify-phone-otp`. Expired OTP fields are cleared daily by `dataRetentionCleanupCron`.

### 13.4 WhatsApp review request

**Entry points**, all of which emit `campaigns/review.request.start`:

| Route | Use | Guards |
|---|---|---|
| `POST /api/campaigns/send` | Single customer | `requireBusinessContext`, `requireModule('marketing_automation')`, `evaluateReviewSendEligibility` |
| `POST /api/customers/quick-add` | Add and send | Same eligibility check |
| `POST /api/campaigns/[id]/launch` | Bulk send to customers whose tags match `targetTags`, or all customers | `requirePlaceIdForReviews`, eligibility check per customer |

The mobile app's review-request panel calls these APIs: **NOT VERIFIED FROM CODE** (`mobile/src/components/review-requests-panel.tsx` exists; its endpoint was not traced).

```text
processReviewCampaign (functions.ts:1114, retries 3)
  load-config: loadReviewFollowUpPolicy() (global, lib/reviewFollowUpPolicyStore.ts) + campaign message text
  fetch-customer: Customer (skip if optedOut / no phone) + Business{name, placeId}
  create-request-log: ReviewRequest{channel:'whatsapp', status:'Pending', token: generateReviewRequestToken(), campaignId?}
  build-initial-message: campaign text with {{name}}{{service}}{{business}}{{link}}, else Groq-written, else fixed text;
        link = NEXT_PUBLIC_BASE_URL + /api/campaigns/track/{ReviewRequest._id}
  optional sleepUntil business hours (campaign sendOnlyBizHours)
  send-initial-message → sendReviewRequest() (functions.ts:1025):
        checkUsageLimit('whatsappMessages') (daily cap)
        choosePrimaryReviewSend():
          UTILITY template SID set → template {{1}} name {{2}} business {{3}} token → link /review/{token}?src=wa
          else free text via Twilio (contains /api/campaigns/track/{id})
             Twilio 63016 (outside 24 h) on platform number → template retry:
                 utility (if set) or LEGACY template whose button opens
                 google.com/local/writereview?placeid={placeId} DIRECTLY (no GrowwMatics click tracking)
        success → ReviewRequest{status:'Sent', sentAt, lastMessageSid, messageSids[], messageHistory[]}; Customer{reviewStatus:'Requested', totalMessagesSent+1}
        failure → ReviewRequest failure fields + messageHistory; Customer.reviewStatus 'Failed'
  follow-ups (§13.6)
```

### 13.5 Review request tracking

| Field (`models/ReviewRequest.ts`) | Set by |
|---|---|
| `sentAt`, `status:'Sent'`, `lastMessageSid`, `messageSids[]`, `messageHistory[].stage/sid/status` | `processReviewCampaign` |
| `deliveredAt`, `status:'Delivered'` | `POST /api/webhook/twilio/status` (MessageStatus `delivered`) |
| `readAt`, `status:'Read'` | same webhook (MessageStatus `read`) |
| `failedAt`, `errorCode`, `errorMessage`, `automationStatus:'Stopped'` | same webhook (`failed`/`undelivered`), after an optional template retry (`retryAsApprovedTemplate`) |
| `clicked`, `clickedAt` (first click), `clickCount` | `lib/reviewRedirect.ts` `resolveClickedRedirect()` via `applyClick()` (`lib/reviewRequestFlow.ts:119`), from `GET /review/[token]`, `GET /api/campaigns/track/[requestId]` or `/go/[id]`. The first click also increments `Campaign.clicked`. |
| `reviewReceived`, `reviewedAt`, `rating` | **Never written.** `applyClick` returns `markReviewReceived:false`; `reviewAutopollCron` is a no-op ("clicks are not reviews"). |
| `Customer.reviewStatus:'Completed'` | **Never written** (only counted in `GET /api/customers`). |

**Link clicked vs review actually submitted:**
- A click records only `clicked` / `clickCount`, then the visitor is redirected with a 302 to `https://search.google.com/local/writereview?placeid=…` (`buildGoogleReviewUrl`, `lib/reviewRequestFlow.ts:105`).
- A submitted Google review appears only later through review sync, as a `Review` document **not linked** to the ReviewRequest. `Review.requestId` exists in the schema but `syncReviewsForBusiness` does not set it.
- If the legacy template is used, the customer taps a button that goes straight to Google, so no click is recorded at all.

### 13.6 Follow-up system

| Item | Value |
|---|---|
| Policy | One global document `ReviewFollowUpPolicy{key:'global'}`. Seeded from `DEFAULT_GLOBAL_REVIEW_FOLLOW_UP` (`lib/reviewFollowUpSettings.ts`). Edited by Super Admin through `/admin/review-follow-up` → `/api/admin/review-follow-up`. |
| Defaults | `enabled:true`, `initialFollowUpDelayDays:2`, `secondFollowUpDelayDays:5`, `maximumFollowUps:2`, `minimumIntervalDays:1`, `stopOnOptOut:true`, `stopOnClick:false` (unused), `stopOnReview:false` (unused) |
| Bounds | Delays 1–60 days; at most 2 follow-ups (`FOLLOW_UP_MAX_COUNT`) |
| Mapping (`resolveReviewFollowUpSettingsWithGlobal`) | `reminder1AfterDays = initialFollowUpDelayDays`; `reminder2AfterDays = secondFollowUpDelayDays`, counted **from reminder 1** (sequential `step.sleep`); a campaign supplies message text only |
| Scheduling | Inside the same `processReviewCampaign` run: `step.sleep('{N}d')`, an eligibility check, an optional business-hours wait, a re-check, then `claimFollowUp()` (atomic `followUpClaim`), then `sendReviewRequest()` |
| Eligibility (`decideFollowUpEligibility`, `:241`) | Policy enabled; stage ≤ max; customer exists and belongs to this business; request not Failed, Cancelled or Stopped; stage not already sent; minimum interval; and `decideReviewSendEligibility` (opted out, has phone, has Place ID, daily WhatsApp cap) |
| Not a stop condition | Click and review submission (by design; see the file header) |
| Per-customer cooldown | `REVIEW_SEND_COOLDOWN_ENFORCED = false` (`lib/reviewRequestFlow.ts:19`) |
| Default message text | `DEFAULT_REMINDER_1` / `DEFAULT_REMINDER_2` in `functions.ts` |
| Policy changes | A run that has already finished `load-config` keeps its old schedule (Inngest step memoisation) |

### 13.7 WhatsApp webhooks

| Provider → webhook | Event | Lookup | DB update | UI |
|---|---|---|---|---|
| Twilio → `POST /api/webhook/twilio/status` (`validateTwilioSignature` with the platform auth token) | `delivered` | `ReviewRequest {lastMessageSid or messageSids}` | `status:'Delivered'`, `deliveredAt`, messageHistory entry | Review requests table (`CampaignsDashboard` → `/api/review-requests`) |
| | `read` | same | `status:'Read'`, `readAt`, back-filled `deliveredAt` | same |
| | `failed` / `undelivered` | same, plus `MessageQueue{payload.sid}` and `Conversation{twilioSid}` | MessageQueue FAILED. A ReviewRequest still `Sent` gets `retryAsApprovedTemplate` (63016) or Failed + `automationStatus:'Stopped'`; `Campaign.delivered -1`; `Customer.reviewStatus:'Failed'`. Non-review messages get `retryGenericAsNotificationTemplate`. | same |
| Twilio inbound → `POST /api/whatsapp/webhook` (`handleTwilioWebhook`, `:963`) or legacy `/api/webhook/twilio` | message | `To` = platform number → `processPlatformInbound` (`:386`); else `findBusinessByNumber` → `processInboundMessage` (`:254`). Signature checked (platform token, or `business.integrations.twilioAuthToken`, which does not exist in the schema), then dedupe (`isDuplicateInboundMessage`) | Platform: STOP → `optOutLeadByPhone` (platform Lead only), then sales, booking, report or support agent events. Tenant: customer `Lead` (`createOrUpdateCustomerLead`), `ConversationThread`; STOP → `Customer.optedOut=true`, AI off; event `whatsapp/incoming` → `processWhatsappMessage` | Inbox (`/dashboard/inbox`), CRM |
| Meta → `POST /api/whatsapp/webhook` (`verifyMetaSignature`, HMAC with `META_APP_SECRET`; skipped only outside production when the secret is unset) | statuses | `Conversation{twilioSid:wamid}`, `MessageQueue{payload.sid}` | `messageStatus`; FAILED. **ReviewRequest is not updated by Meta statuses.** | – |
| | `message_template_status_update` | `META_UTILITY_TEMPLATE_NAME` | alert (`handleTemplateStatusUpdate`) | – |

**Routing consequence:**
- Review requests go out from the platform number (§13.1), and that number is configured as the platform number, so a customer's reply (including STOP) is processed by `processPlatformInbound`.
- On that path STOP calls `optOutLeadByPhone()`, which updates only `Lead{tenantId:'gmbboost-internal'}`.
- The only code paths that set `Customer.optedOut=true` are the **tenant** pipeline (`webhook/route.ts:317`, which needs a business-mapped `To` number) and the manual `PATCH /api/customers/[id]`.

### 13.8 WhatsApp → SEO Brain / audit relationship

| Target | Connected? | Evidence |
|---|---|---|
| Audit | Partially, through the **monthly report only**: `collectExecutions()` counts ReviewRequests sent (`status in ['Sent','Delivered']`) and failed in the period (`services/lifecycle/collect.ts:25-26`); `buildMonthlyReport` includes them | `collect.ts` |
| SEO Brain / SeoPlan | **Currently NOT connected to SEO Brain.** `upsertSeoPlanFromAudit` and `generateSeoPlanDraft` receive no WhatsApp or review-request data. | `auditService.ts:930-985` (draft inputs) |
| ReviewAnalytics | **Not connected.** It is computed from `Review` only (`computeReviewMetrics`). | `services/reviews/reviewMetrics.ts` |
| Weekly monitoring | Counts `requestsSent` | `services/lifecycle/notify.ts:57` |

---

## 14. Review management

### 14.1 Google reviews → GrowwMatics

```text
Google v4 /reviews
  ↓ GbpApiReviewProvider.fetchReviews (newest first; stops at first known id; cap MAX_REVIEWS_PER_AUDIT = 50)
    (no GBPToken → getReviewProvider(): REVIEW_PROVIDER=serpapi → SerpApiGoogleProvider, or Mock)
  ↓ syncReviewsForBusiness (services/reviews/syncReviews.ts)
     analyzeSentiment (rules) → Review.findOneAndUpdate({ providerReviewId }, {businessId, rating, text, reviewer,
        sentiment, source, postedAt, response?/replyStatus 'POSTED'?}, upsert)
     Business.googleReviewTotals ← provider lifetime totals
     ReviewAnalytics upsert ← computeReviewMetrics()
     critical review → 'reviews/critical-alert' → criticalAlertWorker (in-app + push + owner WhatsApp)
     recent unreplied → 'reviews/auto-reply-batch' → processAutoReplyBatchJob → autoReplyToReview()
         draftReply (Groq + validateReply) → if mode 'auto' + consent → approveReply → publishReply
         publishReply → replyToReview gated OFF → outcome 'blocked'
  ↓ Audit: Review.find(period window) → reviewFacts, AI review themes → SeoPlan (reviewReplyMustInclude)
```

**Triggers:**
- `gbpSyncWorker` (connect and 03:00)
- `reviewSyncWorker` (02:00, GBP-connected businesses only) → `reviews/sync` → `processReviewSyncJob`
- `pre-sync-reviews` before full audits
- `POST /api/reviews/fetch` (requires GBP)

### 14.2 Review request → Google → back

```text
Customer ─WhatsApp (platform number)─► link → GET /review/{token} | /api/campaigns/track/{id} → clicked/clickCount
         ─(legacy template button)────► google writereview URL directly (no tracking)
Google write-review page → (customer may or may not post)
Review sync later imports any new review as a Review doc
```

The two systems **do not connect**:
- `Review.requestId` is never set.
- `ReviewRequest.reviewReceived` is never set.
- `Campaign.reviewsReceived` is never incremented (no writer found).

---

## 15. Customer data

| Model | Purpose | Tenant keys | Notes |
|---|---|---|---|
| `Customer` | Review-request recipients (business's customers) | `tenantId` (org ID string), `businessId` | name, phone, email, service, serviceDate, tags, notes, `optedOut`, `reviewStatus`, `totalMessagesSent`, `lastMessageAt`, totalSpend. Partial unique indexes per business for phone/email (`models/Customer.ts:51+`). |
| `ReviewRequest` | One request plus its follow-ups | `tenantId`, `businessId`, `customerId`, `campaignId?` | `token` unique (sparse) |
| `Campaign` | Bulk review campaigns | `businessId`, `tenantId` | Message text, targetTags, counters |
| `Lead` | CRM leads. The business CRM uses `businessId`; the platform sales CRM uses `tenantId:'gmbboost-internal'` | `tenantId`, `businessId` | Indexes `{tenantId,phone}`, `{businessId,phone}` |
| `ConversationThread`, `Conversation`, `MessageQueue` | WhatsApp threads, messages and outbound send log | `tenantId`, `businessId`, `leadId` | `MessageQueue.payload.sid` is the provider message ID |
| `SalesConversation`, `BookingConversation`, `ReportConversation`, `SupportConversation` | Platform agent conversations (prospects) | `phoneKey` | Platform tenant only |
| `Activity`, `FollowUp`, `CallEvent`, `Appointment` | CRM timeline, tasks, calls, appointments | `businessId` / `tenantId` | – |

**Isolation:** enforced in the application by filtering on `businessId` from `requireBusinessContext()`. There is no database-level row security.

---

## 16. Database relationship map

```text
User ─────────────┬─ organizationId ──► Organization (ownerId → User)
 (role, phone,    ├─ businessIds[] ───► Business
  activeBusinessId,                      │  (userId, organizationId, subscriptionStatus, googleConnected,
  sessionEpoch,                          │   googleLocationId, placeId/googlePlaceId, Places snapshot,
  isShadowAccount)                       │   intake, keywords, autopilotNextRunAt, auditAutopilotNextRunAt)
 └─ Subscription (userId; modules, planType)  │
                                         ├── GBPToken (1:1 unique businessId; encrypted tokens, locationId)
                                         ├── PendingGbpConnection (TTL 15 min)
                                         ├── GBPInsights (unique {businessId,date})
                                         ├── GBPKeyword (unique {businessId,keyword,month,year})
                                         ├── Review (providerReviewId unique GLOBAL; businessId)  ── ReviewAnalytics (1:1)
                                         ├── GbpMediaAsset (googleMediaName, publishedVia)
                                         ├── Post (gbpPostName, status, contentMeta.seoPlanId) ── WeeklyOffer
                                         ├── ProfileActivity (TTL 180 d)
                                         ├── Audit (auditData.facts / evidenceItems / seoPlanDraft / monthly)
                                         │     └─ PlaceInsightCache (by googlePlaceId, fastMode)
                                         ├── SeoPlan (versioned; active|superseded; sourceAuditId → Audit)
                                         ├── OptimizationAction (plannedInAuditId → Audit; history[])
                                         ├── Customer ── ReviewRequest ── Campaign
                                         ├── Lead ── ConversationThread / Conversation / Activity / FollowUp / CallEvent
                                         └── OwnerNotifyDigest, Notification (userId + businessId), WeeklyMonitor
WebsiteIntelligence (keyed by website origin — shared across businesses with the same site)
MessageQueue (outbound log; payload.sid) · ProcessedWebhookEvent (Razorpay idempotency) · AutomationLog · AIUsageLog
ReviewFollowUpPolicy (key 'global')
```

---

## 17. Background job map

All jobs live in `services/inngest/functions.ts` and are registered in `app/api/inngest/route.ts`. Cron times are UTC.

| Job | Trigger | Frequency | Reads | Writes | Purpose |
|---|---|---|---|---|---|
| `gbpNightlySyncScheduler` | cron `0 3 * * *` | daily | Business (connected) | events | Fan out GBP syncs |
| `gbpSyncWorker` | `gbp/sync.requested` | on event | GBPToken, Google | GBPInsights, GBPKeyword, Review*, Business, GBPToken | GBP sync (§6.2) |
| `reviewSyncWorker` → `processReviewSyncJob` | cron `0 2 * * *` → `reviews/sync` | daily | GBPToken, Business | Review, ReviewAnalytics | Review sync |
| `processAutoReplyBatchJob` | `reviews/auto-reply-batch` | on event | Review, Business | Review | Draft and auto-publish replies (publish gated) |
| `criticalAlertWorker` | `reviews/critical-alert` | on event | Review | Notification, push, owner WhatsApp | Critical review alert |
| `reviewReplyDraftedWorker` | `reviews/reply-drafted` | on event | – | Notification, push | Approval needed |
| `reviewAutopollCron` / `processReviewAutopollJob` | hourly / event | – | – | – | **No-op** ("clicks are not reviews") |
| `generateAuditJob` | `audit/generate.requested` | on event | Audit, Business, Review, providers | Audit, SeoPlan, OptimizationAction, Business | Audit (§8) |
| `cleanupStalePendingAudits` | cron `*/1 * * * *` | every minute | Audit | Audit FAILED (>5 min PENDING) | Stuck-audit sweep |
| `auditAutopilotCron` | cron `0 * * * *` | hourly | Business | Business.auditAutopilotNextRunAt, Audit | First and monthly audits |
| `sendReportReadyNotification` | `report/ready.requested` | on event | Audit | WhatsApp | Free report ready (fastMode) |
| `reportCardDeliver` | `report/deliver.requested` | on event | ReportConversation, Audit | WhatsApp image | Report-connect delivery |
| `weeklyContentAutopilot` | cron `0 * * * *` | hourly (7-day cadence) | Business | Business.autopilotNextRunAt, events | Weekly content |
| `processContentJob` | `scheduler/generate` | on event | SeoPlan, WebsiteIntelligence, GbpMediaAsset, GBPKeyword, Post | Post, AutomationLog, usage | Weekly batch |
| `manualContentGenerate` | `scheduler/manual-generate` | on event | – | – | Manual "Generate now" |
| `applyWeeklyOfferJob` | `content/weekly-offer.answered` | on event | WeeklyOffer | Post | Offer post |
| `weeklyContentReminder` | cron `0 13 * * 0` | weekly | Post | Notification | Ask for weekly offer |
| `bufferMonitorWorker` | cron `0 8 * * *` | daily | Post | events | Content buffer check |
| `scheduleSinglePostPublish` | `scheduler/post-scheduled` | sleep-until | Post | event | Exact-time publish |
| `processPublishPostJob` | `scheduler/publish-post` | on event | Post | Post, AutomationLog, notifications | Publish (gated → blocked) |
| `publishScheduledPostsCron` | cron `0 * * * *` | hourly | Post | events | Safety net |
| `publishScheduledMediaCron` / `processScheduledMediaPublishJob` | cron `*/15 * * * *` / event | 15 min | GbpMediaAsset | GbpMediaAsset, ProfileActivity | Scheduled photo publish (gated) |
| `processReviewCampaign` | `campaigns/review.request.start` | on event (sleeps days) | ReviewFollowUpPolicy, Campaign, Customer, Business | ReviewRequest, Customer, Campaign | Review request and follow-ups (§13) |
| `seoPlanWeeklySummary` | cron `0 12 * * 1` | weekly | Review, Post, GBPInsights, Audit, OptimizationAction | WeeklyMonitor, Notification, WhatsApp | Weekly monitoring (`runWeeklyMonitoringAll`) |
| `performanceDigestCron` | cron `30 4 * * *` | daily (≤1 per 15 days per business) | GBPInsights | WhatsApp | 15-day performance digest |
| `ownerWhatsAppDigestCron` | cron `30 13 * * *` | daily | OwnerNotifyDigest | WhatsApp, digest stamps | Owner daily digest |
| `subscriptionExpiryWorker` | cron `0 6 * * *` | daily | Business | Business, Notification | Lock expired workspaces and send reminders |
| `billingActivationReconcileCron` | cron `*/10 * * * *` | 10 min | Razorpay, Business | Business | Activation safety net |
| `salesNurtureRequested`, `salesNurtureConsented`, `salesAgentReply`, `bookingAgentReply`, `supportAgentReply`, `reportAgentReply` | events | on event | platform conversations | conversations, WhatsApp | Platform WhatsApp agents |
| `nurtureSchedulerTick` | cron `*/15 * * * *` | 15 min | ScheduledAction | WhatsApp | Platform sales drip |
| `proactiveNbaScheduler` | cron `*/30 * * * *` | 30 min | Lead (platform) | ScheduledAction | Next-best-action |
| `followUpCron` / `processFollowUpJob` | hourly / `scheduler/follow-up` | – | Lead | WhatsApp | Legacy; `processFollowUpJob` skips non-platform leads |
| `scheduleLeadFollowUpsJob`, `dispatchWhatsappFollowUpJob` | `crm/lead-created`, `crm/dispatch-whatsapp` | on event | Lead | Notification | Owner alert; the legacy dispatch drops events |
| `crmFollowUpReminderCron`, `crmStaleLeadReminderCron`, `crmGrowthReportReadyCron` | `*/15`, `30 4`, `45 4` | – | FollowUp, Lead | Notification, push | CRM reminders |
| `processDemoBooking` | `demo/booked` | on event | DemoBooking | email, WhatsApp | Demo notifications |
| `processWhatsappMessage` | `whatsapp/incoming` | on event | ConversationThread, Lead, BusinessAIConfig | Conversation, WhatsApp | Tenant AI reply. Reachable only through a business-mapped inbound number. |
| `cleanupAbandonedSignups` | cron `0 4 * * *` | daily | User | User | Abandoned sign-up cleanup |
| `dataRetentionCleanupCron` | cron `15 3 * * *` | daily | various | deletes or clears | Retention |
| `accountHardPurgeCron` | cron `45 3 * * *` + `account/purge.requested` | daily | User (deleted > 30 days) | all purge targets | DPDP hard purge |

---

## 18. Error / failure paths

| Failure | Behaviour in code |
|---|---|
| Google OAuth error or denied | Callback redirects to `/dashboard/insights?error=<code>` (`state_mismatch`, `no_code`, `token_exchange_failed`, `gbp_api_access` on 403, `gbp_api_error`, `no_gbp_account`). `insights/page.tsx:126+` maps the codes to messages. |
| No refresh token | Redirect to `/api/auth/google?prompt=consent…` |
| GBP token expired or revoked | `getValidToken` sets `Business.googleConnected=false` and throws `GBPAuthError`. The sync returns `skipped`. **No user alert.** The UI shows "not connected" or "Google connection expired — please reconnect" (`GET /api/gbp/profile`). |
| GBP API error | Thrown with `describeGoogleApiError`. The sync step throws, so Inngest retries (`retries: 2`). The audit logs it and continues without `gbpLive` (`gbp_api` source `read_failed`). |
| Review sync fails | Logged in `gbpSyncWorker` and `pre-sync-reviews`. The audit proceeds with stored reviews. |
| Audit fails | `processAuditJob` catch sets `status:'FAILED'` with `metadata.error`, releases the period, and rethrows. The result page shows the failure; `cleanupStalePendingAudits` handles audits stuck in PENDING. |
| AI (Groq) fails | Audit: `emptyAIResult`, facts still ship. SEO plan draft: undefined, plan still upserted. Content: one regeneration, then a safe template saved as DRAFT. Review reply: `NEEDS_REVIEW` or failed draft. |
| Website research fails | `WebsiteIntelligence.status:'failed'`. The audit continues; content notes that website facts were not used. |
| WhatsApp send fails | Review request: failure fields, messageHistory, `Customer.reviewStatus:'Failed'`; template retry on 63016. Other messages: the generic notification-template retry. OTP: 502 back to the UI. |
| WhatsApp webhook invalid | Twilio signature or Meta HMAC failure returns 403. Unknown `To` number is logged and acknowledged with 200. Duplicate inbound messages are skipped. |
| Customer opts out | `Customer.optedOut` (tenant pipeline or manual edit) makes `processReviewCampaign` skip and fails follow-up eligibility. A platform-line STOP opts out only the platform Lead (§13.7). |
| Follow-up ineligible | `decideFollowUpEligibility` returns `send:false` with a code. The step returns with no write. |
| Live GBP writes disabled | Posts get status `blocked`; replies get `replyPublishStatus:'blocked'`; media stays `staged`; profile edits are saved locally only. |

---

## 19. Security / tenant isolation

| Control | Implementation |
|---|---|
| Authentication | JWT session (`lib/session.ts`), session epoch revocation, account lockout, rate limits (`lib/rateLimit.ts` in-memory, `lib/durableRateLimit.ts` Mongo-backed) |
| Business access | `requireBusinessContext` (owner, org member, or SUPER_ADMIN) and `requireAuditAccess` (`lib/tenant.ts`) |
| Organization access | Membership is implied by `User.organizationId`. There is no invite or role model for clients. |
| RLS | None (MongoDB). Isolation depends on every query filtering by `businessId`. |
| Admin | `requireSuperAdmin` (`lib/superAdminAuth.ts`). Impersonation sets the `activeBusinessId` cookie and writes `AdminActionLog` (`app/api/admin/impersonate/route.ts`). |
| Google tokens | AES-256-GCM (`lib/crypto.ts`) for `GBPToken`, `PendingGbpConnection`, `ReportConversation`, `SalespersonCalendarConnection` |
| WhatsApp secrets | Environment variables only. No per-tenant credentials are stored. |
| Webhook validation | Twilio `validateTwilioSignature` (`lib/twilioSignature.ts`); Meta HMAC SHA-256 (`verifyMetaSignature`); Razorpay signature plus `ProcessedWebhookEvent` idempotency; n8n routes use a shared `x-api-key` (`middleware/apiKeyAuth.ts`) |
| QA bypass | `isQaTestingMode()` requires `NODE_ENV !== 'production'` **and** `QA_TESTING_MODE==='true'` (`lib/testingMode.ts`) |
| Module gate fail-open | `requireModule` returns ok when the user has **no** Subscription document (`lib/moduleGating.ts:38`) |
| Security headers | HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy; CSP **report-only** (`next.config.ts`) |

---

## 20. Current UI map

| Data | UI | Route | API | Source |
|---|---|---|---|---|
| Business profile (internal) | Settings → Business Profile | `/dashboard/settings` | `GET /api/business`, `PATCH /api/business/[id]` | `Business` |
| GBP live profile | GBP Profile page; mobile GBP screen | `/dashboard/gbp-profile`; `mobile/src/app/(app)/gbp` | `GET/PATCH /api/gbp/profile` | Live `fetchLocationProfile` (not stored) |
| GBP metrics and keywords | Insights; dashboard GBP section | `/dashboard/insights`, `/dashboard` (`GBPSection`) | `/api/gbp/insights`, `/api/gbp/keyword-intelligence`, `POST /api/gbp/sync` | `GBPInsights`, `GBPKeyword` |
| Reviews | Reviews tab | `/dashboard/reviews` (`ReviewsDashboard`) | `/api/reviews`, `/api/reviews/[id]/*`, `/api/reviews/reply-settings` | `Review`, `ReviewAnalytics` |
| Photos | Photo manager | `/dashboard/gbp-profile` (`GbpMediaManager`) | `/api/gbp/media*` | `GbpMediaAsset` (+ live owner media reconcile) |
| Posts | Content workspace, calendar, pending | `/dashboard/content`, `/dashboard/scheduler`, `/dashboard/posts/*` | `/api/content/*`, `/api/scheduler/*`, `/api/posts*` | `Post` |
| Audit | Audit report (`GatedAuditReport` → `AuditReportGrexa`), history, PDF | `/dashboard/audit/[id]`, `/dashboard/audit/history`, `/api/audit/[id]/pdf` | `GET /api/audit/[id]` | `Audit.auditData` |
| Free report | `FreeReportView` | `/free-report/result` | `GET /api/audit/[id]` | `Audit` |
| SEO Brain / SEO Plan | SEO plan page | `/dashboard/seo-plan` | `GET /api/seo-plan`, `POST /api/seo-plan/apply` | `SeoPlan` (active) |
| WhatsApp (platform agents) | Super admin only | `/dashboard/whatsapp`, `/admin/whatsapp*`, `/admin/inbox` | `/api/admin/*`, `/api/inbox/*` | conversations |
| Review requests | Reviews page → Campaigns tab and quick request | `/dashboard/reviews` (`CampaignsDashboard`, `QuickReviewRequest`); `/dashboard/review-requests` and `/dashboard/campaigns` redirect here | `/api/review-requests`, `/api/campaigns*`, `/api/customers*` | `ReviewRequest`, `Campaign`, `Customer` |
| Follow-up policy | Admin | `/admin/review-follow-up` | `/api/admin/review-follow-up` | `ReviewFollowUpPolicy` |
| CRM follow-ups | CRM | `/dashboard/crm` (`FollowUpTasks`, `FollowUpsTab`) | `/api/followups*` | `FollowUp` |

---

## 21. Complete user journey (code-confirmed)

```text
Visitor
  ↓ /free-report: Places autocomplete + WhatsApp number
  ↓ POST /api/free-report/start → shadow User/Org/Business/Subscription(Free) + SESSION COOKIE (logged in)
  ↓ platform Lead (gmbboost-internal) → WhatsApp sales nurture + "report ready" template
  ↓ fastMode Audit → Evidence → AI → SeoPlan v1
  ↓ /free-report/result (FreeReportView) → /checkout
  ↓ Razorpay → webhook → Business.subscriptionStatus='active'
  ↓ (later visits) /login → WhatsApp OTP → finalizeLogin → same Business
  ↓ /dashboard → proxy redirects to /dashboard/onboarding/intake (new workspaces)
  ↓ intake POST → Business fields + SeoPlan v2 (ownerEdited)
  ↓ Connect Google → OAuth → GBPToken → finalizeGbpConnection
  ↓   ├ gbpSyncWorker: metrics, search keywords, reviews, category (+ gap-fill fields)
  ↓   ├ maybeStartContentAutopilot → weekly batch → Posts scheduled → publish → BLOCKED (live writes off)
  ↓   └ maybeStartAuditAutopilot → FULL audit (connected_baseline; live GBP read) → OptimizationActions → SeoPlan v3
  ↓ Dashboard: insights, reviews (AI drafts; publish blocked), content calendar, SEO plan
  ↓ Review requests: Customer → processReviewCampaign → WhatsApp from PLATFORM number
  ↓   → Twilio status webhook: Delivered / Read → click redirect (/review/{token} or /api/campaigns/track/{id})
  ↓   → Google write-review page (submission NOT detected)
  ↓   → follow-ups at +2 days and +5 more days (global policy)
  ↓ Nightly review sync imports any new Google reviews (unlinked to requests)
  ↓ 30 days → auditAutopilotCron → monthly audit → comparison + monthly report (incl. review-request counts)
  ↓ → SeoPlan v+1 active (previous superseded) → in-app + WhatsApp monthly summary
  ↓ next cycle (weekly content, weekly monitoring, 15-day performance digest, monthly audit)
```

---

## 22. Critical gaps / duplicate paths (documented, not fixed)

1. **Two GBP connect implementations.** The dashboard OAuth path calls `finalizeGbpConnection`. The WhatsApp `finalizeReportConnection` skips it, so there is no sync event, no SerpApi review purge and no autopilot start, and it runs a fastMode audit that never reads GBP.
2. **Two GBP sync implementations.** `gbpSyncWorker` (event) and `POST /api/gbp/sync` (inline in the request; no reviews; no event).
3. **Three review sync triggers** (`gbpSyncWorker` step, `reviewSyncWorker` at 02:00, `pre-sync-reviews`) plus the manual `/api/reviews/fetch`, all calling `syncReviewsForBusiness`. Reviews are synced at both 02:00 and 03:00.
4. **Audit reads GBP live**, separately from the sync (`auditService.ts:559`). The stored sync data and the audit's view of the profile can differ.
5. **Review cap.** `MAX_REVIEWS_PER_AUDIT=50` caps the GBP import; incremental mode stops at the first known review, so older reviews are never imported.
6. **`Review.providerReviewId` is unique across all businesses**, and the upsert filter is `{ providerReviewId }` only (`syncReviews.ts`). If two workspaces are linked to the same Google location, each sync rewrites `businessId` to the workspace that synced last.
7. **Three review-request link forms:**
   - utility template → `/review/{token}`;
   - free text → `/api/campaigns/track/{_id}`;
   - legacy template → a direct Google URL with no tracking. The legacy template is the fallback used when the utility SID is unset, which is the case in both env files.
8. **Review completion is never detected.** `reviewReceived`, `Customer.reviewStatus:'Completed'` and `Campaign.reviewsReceived` have no writers.
9. **STOP routing.** Review requests come from the platform number, so a customer's STOP is processed by the platform pipeline and does not set `Customer.optedOut` (§13.7).
10. **Tenant AI WhatsApp agent** (`processWhatsappMessage`) is reachable only through a business-mapped inbound number. With every send coming from the platform number, the path for customer replies to reach it is **NOT VERIFIED FROM CODE**.
11. **Wizard WhatsApp field.** `whatsappBusinessNumber` is in the onboarding types and API but has no input in the wizard.
12. **Proxy comment vs behaviour.** The proxy header describes redirects for locked workspaces; the code does not redirect. Locking is a client-side blur plus `requireModule`.
13. **`requireModule` is per user, not per workspace.** It fails open when no Subscription document exists.
14. **Owner keywords not carried forward.** `upsertSeoPlanFromAudit` carries owner-edited text fields forward but not keywords.
15. **GBP read scope.** Only `accounts[0]` is used; locations and search keywords are not paginated.
16. **Profile field evidence** is always labelled `source:'google_places'`, even when read from the GBP API (`findings.ts:228-235`).
17. **Live GBP writes are off**, so posts, replies, photos and profile edits do not reach Google.

---

## 23. FR-3.2 impact

FR-3.2 asks for an initial full import of name, address, PIN, phone, website, hours, special hours, categories, attributes, services, products, description, photos, posts and reviews.

| Question | Answer |
|---|---|
| **Where the data should enter** | A **new Inngest function subscribed to the existing `gbp/sync.requested` event**. That event already fires on dashboard connect (`finalizeGbpConnection`) and on the 03:00 scheduler, so no existing function or connect path needs editing. Coverage gaps: report-connect gets it only at 03:00 (§22.1); the manual sync button never emits the event (§22.2). |
| **Where it should be stored** | A **new collection** (for example `GbpLocationSnapshot`, one document per `businessId`, with per-section fetch status). Do not use `Business` (strict schema, owner-edit gap-fill rule), `GBPToken` (credentials), `Post` (counted as GrowwMatics executions in `collect.ts:21`, dashboard stats and the usage limit) or `GbpMediaAsset` (reconciliation deletes rows not in the owner media list; weekly content uses them as post images). |
| **How it should reach the SEO Brain** | Through the existing audit. `processAuditJob` already turns the live `gbpLive` read into the checklist (`calculateProfileCompletion`), evidence (`buildEvidenceAndFindings`, whose `EvidenceSource` already includes `'gbp_api'`) and the plan input (`generateSeoPlanDraft`). The snapshot should feed those same structures; no second evidence system. `replyPipeline.ts:52` shows the existing pattern for reading stored GBP facts. |
| **Where it could appear in the UI** | `/dashboard/gbp-profile` and the mobile GBP screen (same API family); later the audit checklist rows that are hard-coded "Unknown" today (Services Listed, Attributes, Hours) in `AuditReportGrexa` and the PDF. |
| **Existing logic that must stay untouched** | `lib/gbpConnect.ts`, the OAuth routes, `lib/reportConnect.ts`, `gbpSyncWorker` and the scheduler, `lib/gbpClient.ts`, the review sync and providers, `gbpMediaService`, `Post` / content publishing, `auditService` and `seoAnalyzer` (until a deliberate later phase), `seoPlanService`, the lifecycle monthly diff, free report and shadow account code, `proxy.ts`. |
| **Risks** | (1) Feeding new fields into `calculateProfileCompletion` changes the headline score (Complete ÷ (Complete + Missing)) and therefore month-on-month comparisons. (2) Extending `FIELD_LABEL` in `diffGbpSnapshots` would report first-time values as "changed directly on Google". (3) Google quota: the 03:00 fan-out has no throttle; the new function needs its own concurrency limit. (4) Duplicate token refreshes when it runs in parallel with `gbpSyncWorker`. (5) Any new model must be added to `services/account/purgePlan.ts`, or `tests/integration/account-purge-plan.test.ts` fails. (6) Customer media and posts contain third-party personal data. |

---

## 24. File / function index

```text
Authentication / session
- src/lib/session.ts            createSession(), getSession(), verifySessionToken(), destroySession()
- src/lib/authSession.ts        finalizeLogin()
- src/lib/auth.ts               requireClient()
- src/lib/superAdminAuth.ts     requireSuperAdmin()
- src/lib/sessionEpoch.ts       isSessionEpochValid()
- src/services/auth/otp.ts      generateOTP(), hashOTP(), verifyOTP()
- src/app/api/auth/phone-login/request|verify/route.ts
- src/app/api/auth/verify-phone-otp/route.ts
- src/app/api/auth/login/route.ts (email/password, legacy)
- src/proxy.ts                  proxy() — session epoch + intake gate

Tenancy / access
- src/lib/tenant.ts             requireBusinessContext(), requireAuditAccess()
- src/lib/workspaceAccess.ts    isWorkspaceUnlocked()
- src/lib/moduleGating.ts       requireModule()
- src/lib/featureGating.ts      checkUsageLimit(), incrementUsage()
- src/components/layout/WorkspaceLockGate.tsx, BusinessSwitcher.tsx

Free report / shadow accounts
- src/app/free-report/page.tsx, result/page.tsx; src/components/audit/FreeReportView.tsx
- src/app/api/free-report/start/route.ts  POST
- src/lib/shadowAccount.ts      provisionShadowAccount()
- src/services/leads/platformProspectEntry.ts  fileFreeReportPlatformLead(), linkPlatformLeadAudit()
- src/services/leads/beginFreeReport.ts  beginFreeReport() (WhatsApp entry)
- src/services/google/places.ts GooglePlacesService.getDetails()

Onboarding
- src/components/onboarding/OnboardingWizard.tsx (+ Step*.tsx)
- src/app/api/onboarding/route.ts  POST
- src/app/api/onboarding/intake/route.ts  GET/POST; src/services/intel/intakePrefill.ts buildIntakePrefill()

GBP
- src/app/api/auth/google/route.ts, callback/route.ts
- src/app/api/gbp/select-location/route.ts, pending-selection/route.ts
- src/lib/gbpConnect.ts         finalizeGbpConnection(), formatLocationAddress()
- src/lib/reportConnect.ts      finalizeReportConnection()
- src/lib/gbpClient.ts          getValidToken(), fetchDailyMetrics(), fetchSearchKeywords(), fetchLocationProfile(),
                                fetchLocationPin(), updateLocationProfile(), createLocalPost(), replyToReview(),
                                uploadLocationPhoto(), deleteLocationMedia(), listLocationMedia()
- src/lib/gbpSafety.ts          gbpWritesEnabled()
- src/lib/gbpMediaService.ts    listMediaAssets(), publishAsset()
- src/lib/verifiedLocation.ts   getVerifiedBusinessLocation()
- src/services/gbpInsightsBackfill.ts  backfillGbpInsightsIfNeeded()
- src/app/api/gbp/sync/route.ts (manual inline sync), profile/route.ts, insights/route.ts
- src/services/inngest/functions.ts  gbpNightlySyncScheduler (:4280), gbpSyncWorker (:4309)

Audit
- src/lib/startAudit.ts         createPendingAuditAndDispatch()
- src/lib/auditAutopilot.ts     maybeStartAuditAutopilot(), claimAndDispatch(), hasRealAuditCategory()
- src/services/inngest/functions.ts  generateAuditJob (:1752), auditAutopilotCron (:1975), cleanupStalePendingAudits (:1930)
- src/services/audit/auditService.ts  processAuditJob() (:131)
- src/services/audit/seoAnalyzer.ts   calculateProfileCompletion(), fetchGeoGridRankings()
- src/services/audit/facts.ts, findings.ts (buildEvidenceAndFindings, evidenceState), validateAudit.ts,
  optimizationPlan.ts (auditKindOf, compareAudits, buildOptimizationPlan), competitorService.ts,
  keywordSeeds.ts, keywordVolumeClient.ts, dataForSeoClient.ts, websiteSignals.ts
- src/services/intel/websiteIntelligence.ts  getWebsiteIntelligence()
- src/services/ai/auditEngine.ts generateAIAudit(), emptyAIResult

SEO Brain
- src/models/SeoPlan.ts
- src/services/seoPlan/seoPlanService.ts  getActiveSeoPlan(), upsertSeoPlanFromAudit(), mergeIntakeIntoSeoPlan(), resolveContentKeywords()
- src/services/ai/seoPlanEngine.ts        generateSeoPlanDraft()
- src/services/seoPlan/seoBrainKeywords.ts seoBrainKeywords()
- src/services/seoPlan/applyPlan.ts       applyActivePlanToProfile()

Monthly lifecycle
- src/services/lifecycle/period.ts  lifecycleOf(), monthKey()
- src/services/lifecycle/actionsSync.ts syncOptimizationActions()
- src/services/lifecycle/collect.ts collectExecutions()
- src/services/lifecycle/monthly.ts buildMonthlyReport(), diffGbpSnapshots()
- src/services/lifecycle/notify.ts  notifyMonthlyReport(), runWeeklyMonitoringAll()
- src/services/lifecycle/weekly.ts, performanceDigest.ts

Content
- src/lib/contentAutopilot.ts   maybeStartContentAutopilot()
- src/services/content/weeklyBatch.ts generateWeeklyBatch(); plan.ts; validatePost.ts validatePost(); creative.ts; images.ts
- src/services/content/publishPost.ts publishPost()
- src/services/ai/contentEngine.ts, imageGenerator.ts
- src/services/inngest/functions.ts weeklyContentAutopilot (:606), processContentJob (:794), scheduleSinglePostPublish (:1526),
  processPublishPostJob (:1579), publishScheduledPostsCron (:1552)

WhatsApp
- src/services/whatsapp/send.ts  sendOutboundMessage(), sendOtpMessage(), resolveProvider()
- src/services/twilio/client.ts  sendOutboundMessage(), sendTemplateMessage(), resolveTwilioCredentials()
- src/services/whatsapp/meta.ts  sendMetaText(), sendMetaTemplate(), sendMetaImage()
- src/lib/whatsappTemplates.ts   WA_TEMPLATES
- src/lib/twilioSignature.ts     validateTwilioSignature()
- src/app/api/whatsapp/webhook/route.ts  GET, POST, handleTwilioWebhook(), processPlatformInbound(), processInboundMessage(),
                                         verifyMetaSignature(), applyMetaStatus(), findBusinessByNumber()
- src/app/api/webhook/twilio/route.ts (legacy), src/app/api/webhook/twilio/status/route.ts
- src/services/ownerNotify.ts    notifyOwner(), sendPendingOwnerDigests()
- src/services/leadOwnership/optOutLead.ts optOutLeadByPhone()

Review requests
- src/app/api/campaigns/send/route.ts, campaigns/[id]/launch/route.ts, customers/quick-add/route.ts, review-requests/route.ts
- src/lib/reviewSendEligibility.ts evaluateReviewSendEligibility()
- src/lib/reviewRequestFlow.ts     decideReviewSendEligibility(), applyClick(), buildGoogleReviewUrl(), REVIEW_SEND_COOLDOWN_ENFORCED
- src/lib/reviewFollowUpSettings.ts DEFAULT_GLOBAL_REVIEW_FOLLOW_UP, resolveReviewFollowUpSettingsWithGlobal(), decideFollowUpEligibility()
- src/lib/reviewFollowUpPolicyStore.ts loadReviewFollowUpPolicy()
- src/lib/reviewRedirect.ts        handleReviewRedirect(), handleReviewRedirectByToken()
- src/app/review/[token]/route.ts, src/app/api/campaigns/track/[requestId]/route.ts, src/app/go/[id]
- src/services/inngest/functions.ts processReviewCampaign (:1114), sendReviewRequest() (:1025)

Reviews
- src/services/reviews/syncReviews.ts syncReviewsForBusiness()
- src/services/reviews/providers/GbpApiReviewProvider.ts, SerpApiGoogleProvider.ts, index.ts
- src/services/reviews/replyPipeline.ts draftReply(), approveReply(), publishReply(), isAutoPublishActive()
- src/services/reviews/autoReply.ts autoReplyToReview(); validateReply.ts; reviewMetrics.ts computeReviewMetrics(); sentimentEngine.ts
- src/services/inngest/functions.ts reviewSyncWorker (:3890), processReviewSyncJob (:3921), processAutoReplyBatchJob (:3947)

Billing
- src/app/api/billing/checkout|status|invoices|cancel; src/app/api/webhook/razorpay/route.ts
- src/lib/billing/applyEntitlements.ts activateBusinessPlan(), markBusinessPastDue(), cancelBusinessPlan()
```

---

## 25. Unknown / not verified from code

1. **Production environment values.** `GBP_LIVE_WRITES_ENABLED`, `WHATSAPP_PROVIDER`, `TWILIO_TEMPLATE_REVIEW_REQUEST_UTILITY`, `MAX_REVIEWS_PER_AUDIT` and the platform/Twilio number equality were read only from `.env` and `.env.local`. The deployed server may differ.
2. **Twilio console webhook URLs** (which of `/api/whatsapp/webhook` or `/api/webhook/twilio` is configured, and the status callback URL) are external to the repository.
3. **Approval status and exact copy of the Twilio and Meta templates** live in the provider consoles.
4. **Whether `oauth2/v3/userinfo` returns `email`** when only the `business.manage` scope is granted. `GBPToken.googleEmail` is `required` in the schema, but the upsert path does not run validators.
5. **Mobile app API usage.** The endpoints used by mobile review-request, posts approval and GBP screens were only partly traced (`mobile/src/api/endpoints/gbp.ts` → `/api/gbp/profile`).
6. **Whether `Organization.subscriptionPlan`** (set to `'Pro'` by the wizard without payment) affects any gate.
7. **External n8n workflows** (`n8n-workflows/*.json` calling `/api/n8n/*`): whether they are deployed and active.
8. **Whether customer replies can ever reach the tenant pipeline** (`processInboundMessage` / `processWhatsappMessage`) in production. This depends on businesses configuring a number that Twilio routes to this webhook.
9. **Inngest default retry count** for functions without `retries` (for example `generateAuditJob`) is defined by the Inngest SDK, not this repository.
10. **Google API quotas** and approval status for the Business Profile APIs.
11. **`POST /api/auth/login`** (email/password): whether any client still uses it.
12. **`/go/[id]` route callers.** The route exists and uses `handleReviewRedirect`; which messages link to it was not traced.
