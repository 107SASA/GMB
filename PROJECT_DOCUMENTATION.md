# GrowwMatics AI — Complete Project Documentation

**Product:** AI GMB (Google Business Profile) Optimization & Lead Conversion Platform
**Codebase:** `GMBBoost-audit-engine` (Next.js 16 App Router monolith)
**Doc generated:** 2026-07-03, derived from a full read of `src/` (120 API routes, 41 Mongoose models, ~47 service/lib files) plus the existing `documentation/` suite, with contradictions between older docs resolved against actual source code.

> **How to read this document.** This is a single-file, ground-truth reference assembled by reading the live source code (not just prior documentation, which was found to contain several stale/contradictory claims — flagged explicitly below wherever relevant). Where the codebase itself contains duplication, dead code, or unresolved TODOs, that is called out rather than glossed over, because it materially affects how safe it is to build on top of each piece.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Tech Stack](#2-tech-stack)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Repository Structure](#4-repository-structure)
5. [Multi-Tenancy Model](#5-multi-tenancy-model)
6. [Authentication & Authorization](#6-authentication--authorization)
7. [Data Models (41 Mongoose Schemas)](#7-data-models-41-mongoose-schemas)
8. [API Routes (120 endpoints)](#8-api-routes-120-endpoints)
9. [Business-Logic / Service Layer](#9-business-logic--service-layer)
10. [Background Jobs (Inngest)](#10-background-jobs-inngest)
11. [AI / LLM Integration](#11-ai--llm-integration)
12. [External Integrations](#12-external-integrations)
13. [The 9 Product Modules](#13-the-9-product-modules)
14. [Billing, Plans & Usage Limits](#14-billing-plans--usage-limits)
15. [Super Admin Panel](#15-super-admin-panel)
16. [n8n Automation Workflows (Optional Layer)](#16-n8n-automation-workflows-optional-layer)
17. [Environment Variables Reference](#17-environment-variables-reference)
18. [Deployment & Local Development](#18-deployment--local-development)
19. [Known Duplication, Dead Code & Tech Debt](#19-known-duplication-dead-code--tech-debt)
20. [Security Notes & Open Items](#20-security-notes--open-items)
21. [Prior Documentation Index](#21-prior-documentation-index)

---

## 1. Product Overview

GrowwMatics AI is an enterprise SaaS platform that automates local SEO and lead management for businesses that rely on **Google Business Profile (GBP, formerly "Google My Business")** listings — plumbers, dentists, restaurants, retail, and similar local-service businesses, as well as agencies managing many client profiles from one account.

**Core value proposition:**
- **Audit & diagnose** a business's local-SEO position (Google Maps ranking, competitor gap, review health, profile completeness) with a scored, explainable report.
- **Automate content**: AI-generated, auto-scheduled Google Business posts that keep a 7-day content buffer topped up indefinitely without manual effort.
- **Automate reputation management**: sync reviews, draft AI replies for human approval, and run drip campaigns asking happy customers for reviews.
- **Automate lead conversion**: a WhatsApp AI sales agent that answers inbound leads 24/7, scores intent, and hands off to a human when appropriate, feeding a drag-and-drop CRM.
- **Run it all on autopilot** via a durable background-job engine (Inngest) so none of the above requires a human to click a button daily.

**Primary personas:**
- Local business owner / office manager (day-to-day dashboard user).
- Marketing agency managing multiple client businesses under one login (multi-business workspace switcher).
- GrowwMatics AI's own internal team (Super Admin panel — separate, isolated admin surface).

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | **Next.js 16.2.6** (App Router), React 19.2.4 |
| Language | TypeScript 5 (some legacy `.js`/`.jsx` files remain, e.g. `AppLayout.js`, `reviews/page.jsx`) |
| Database | **MongoDB** via **Mongoose 9.6.2** |
| Background jobs / workflow engine | **Inngest 4.4.0** (event-driven, durable step execution, cron) |
| LLM provider | **Groq SDK** (`groq-sdk`) running **Llama 3.3 70B Versatile** — the sole production LLM. `openai` and `@google/generative-ai` packages are also dependencies but used only for narrow secondary purposes (image generation fallback; see §12) |
| SMS / WhatsApp | **Twilio** (`twilio` SDK) — the live, production messaging channel. A Meta WhatsApp Cloud API integration exists only as an unwired stub (`src/services/whatsapp/meta.ts`) |
| Local-SEO / Maps data | **SerpApi** (Google Maps / Google Maps Reviews engines) + **Google Places API** (autocomplete, place details, competitor text search) |
| Google Business Profile API | Hand-rolled `fetch`-based OAuth2 + Business Profile Performance API client (`src/lib/gbpClient.ts`) — the `googleapis` npm package is a listed dependency but is **not actually imported anywhere** in `src/` |
| Email | **Resend** (OTP emails) + **Nodemailer via SendGrid SMTP** (review-request emails) — dual backend, each independently optional/mockable |
| PDF generation | **Puppeteer-core** + **@sparticuz/chromium** (serverless-safe headless Chrome) rendering a hand-built HTML template to PDF for audit reports |
| Auth primitives | **jose** (session JWT, HS256), **bcryptjs** (password hashing, 12 salt rounds), **jsonwebtoken** (a second, separate JWT mechanism — see §6) |
| UI | Tailwind CSS 4, Radix UI primitives, `shadcn/ui`-style components, Framer Motion, `lucide-react` icons, `recharts` (charts), `@dnd-kit` (drag-and-drop Kanban/scheduler) |
| Validation | Zod 4 |
| File parsing | `csv-parse`, `papaparse`, `xlsx` (bulk customer/lead CSV/XLSX imports) |
| Automation (optional/alt layer) | **n8n** workflow JSON exports checked into `n8n-workflows/`, calling a dedicated `/api/n8n/*` API-key-authenticated proxy layer |

---

## 3. High-Level Architecture

```
Browser (Dashboard / Onboarding / Admin)
        │
        ▼
Next.js App Router  ──────────────────────────────────────────────┐
  ├─ src/app/*           (pages: dashboard, admin, onboarding...) │
  ├─ src/app/api/**       (120 route.ts handlers — "controllers") │
  │        │                                                       │
  │        ▼                                                       │
  ├─ src/lib/*            (auth/session/tenant guards, crypto,     │
  │                         Mongo connection, feature gating)      │
  │        │                                                       │
  │        ▼                                                       │
  ├─ src/services/**      (business logic: AI, audit, reviews,     │
  │                         Twilio, Google, email — "domain code") │
  │        │                                                       │
  │        ▼                                                       │
  └─ src/models/*         (41 Mongoose schemas — "persistence")    │
        │                                                          │
        ▼                                                          │
   MongoDB Atlas                                                   │
                                                                    │
Long-running / async work is NEVER done inline in a route handler. │
Instead routes call `inngest.send(...)` and return immediately.   │
        │                                                          │
        ▼                                                          │
  Inngest (src/services/inngest/functions.ts, ~16 workflows) ◄─────┘
        │
        ├─→ Groq (LLM calls: WhatsApp replies, content gen, review replies, lead scoring)
        ├─→ Twilio (WhatsApp/SMS send)
        ├─→ SerpApi / Google Places / GBP Performance API (data sync)
        └─→ writes back into MongoDB (Post, Review, Lead, GBPInsights, ...)

External inbound webhooks (Twilio WhatsApp/Voice) hit dedicated public
routes that ALWAYS return an instant 200/empty-TwiML response and
offload all real work to Inngest — this exists specifically because
Twilio requires a webhook response within ~15 seconds, which is not
enough time for a synchronous LLM round-trip.
```

**Why Inngest exists:** Vercel serverless functions have short execution windows and Twilio webhooks time out fast. Every feature that involves an LLM call, a multi-day drip sequence (e.g. review-request reminders), or a scheduled/cron action is modeled as an Inngest function using `step.run()` / `step.sleep()` / `step.sleepUntil()` for durable, retryable, resumable execution — rather than a synchronous request handler or a separate queueing system.

**No global Next.js middleware.** There is no root `src/middleware.ts`. Every protected route explicitly calls one of the guard functions in `src/lib` (`requireClient`, `requireBusinessContext`, `requireSuperAdmin`) or the API-key check in `src/middleware/apiKeyAuth.ts`. This is an intentional-looking but non-standard choice — see §20 for the security implications (a few routes were found to have skipped this step entirely).

---

## 4. Repository Structure

```
GMBBoost-audit-engine/
├── src/
│   ├── app/
│   │   ├── (auth)/            → login/register pages (route group)
│   │   ├── admin/             → Super Admin panel pages (isolated UI)
│   │   ├── api/                → 120 route.ts handlers, see §8
│   │   ├── book-demo/          → public demo-booking marketing page
│   │   ├── dashboard/          → the main authenticated product UI
│   │   ├── demo-success/       → post-demo-booking confirmation page
│   │   ├── go/                 → short-link redirect handler (review tracking)
│   │   ├── onboarding/         → multi-step signup/workspace wizard
│   │   ├── print/               → print-optimized audit report view (source for PDF render)
│   │   ├── reports/             → public token-shared audit report view
│   │   ├── layout.tsx / page.tsx / globals.css
│   ├── components/             → ~80+ React components, grouped by domain
│   │   (admin/, audit/, campaigns/, content/, crm/, dashboard/, inbox/,
│   │    layout/, onboarding/, reviews/, scheduler/, sections/, ui/)
│   ├── context/                 → BusinessContext.tsx, MobileNavContext.tsx
│   ├── lib/                     → auth/session/tenant/crypto/mongo/feature-gating (§6, §9)
│   ├── middleware/               → apiKeyAuth.ts (static API-key guard)
│   ├── models/                   → 41 Mongoose schemas, see §7
│   ├── services/                  → business logic layer, see §9
│   │   (ai/, audit/, auth/, google/, inngest/, reviews/, twilio/, whatsapp/ + top-level files)
│   └── types/index.ts
├── scripts/                      → one-off/admin Node/TS scripts (seed super-admin, migrations, debug)
├── n8n-workflows/                 → optional alt-orchestrator JSON exports + README (§16)
├── documentation/                 → ~75 pre-existing markdown docs, see §21
├── public/                        → static assets
├── SUPER_ADMIN_HANDOVER.md         → root-level handover doc for the admin panel build
├── AGENTS.md                       → note that this Next.js version has non-standard/breaking APIs vs training data; consult node_modules/next/dist/docs before writing Next.js code
├── package.json / next.config.ts / tsconfig.json / eslint.config.mjs
```

---

## 5. Multi-Tenancy Model

The tenancy hierarchy is **`Organization → Business → (everything else)`**:

- **`Organization`** — the top-level account/tenant container. Has an `ownerId` (→ `User`), a `subscriptionPlan`, and a `maxBusinesses` cap. This is the actual "tenant" in the security sense.
- **`Business`** — one Google Business Profile / storefront under an Organization. Almost every operational model (`Post`, `Review`, `Lead`, `Conversation`, `Audit`, `Campaign`, `GBPToken`, etc.) carries a `businessId`, and most also carry a `tenantId`/`organizationId`.
- **`User`** — an individual login. Has `organizationId` (their org), `activeBusinessId` (currently-selected workspace, mirrored into a cookie), and `businessIds[]` (all businesses they can access).

**Resolving "which business is this request for?"** happens via one of two helpers, and the codebase currently has **two, with different security postures** — a documentation-worthy inconsistency in its own right:

1. **`requireBusinessContext()`** (`src/lib/tenant.ts`) — the stricter, preferred path. Calls `requireClient()` first, resolves `businessId` from an explicit body param or the `activeBusinessId` cookie, then **re-verifies ownership on every call** (`SUPER_ADMIN` may load any business for impersonation; regular users must own it via `userId` or share its `organizationId`). Returns a deliberately ambiguous 403 ("Business not found or access denied") to avoid leaking tenant existence. Never silently falls back to a shared/demo tenant.
2. **`getActiveBusinessContext()`** (`src/lib/business-context.ts`) — an older, looser sibling. Resolves via cookie → `User.activeBusinessId` → any owned business → any org business, but **does not re-verify ownership when a cookie value is already present** ("we trust the db" per an inline code comment) and has no explicit super-admin branch. Used by a subset of read-mostly routes (e.g. `business/route.ts`).

**Field-naming inconsistency across models:** some schemas scope by `organizationId` (proper `ObjectId` ref), some by `tenantId` (plain `String`, not a ref — appears to be a legacy/pre-refactor field carrying the org or user id as text), and a few (`SEOContent`, `FAQ`) even store `businessId` itself as a plain string rather than an `ObjectId` ref. See §7 for the per-model detail and §19 for why this matters.

**Per-tenant external credentials:** rather than one global Twilio/Google account for the whole platform, several integrations resolve credentials **per business** — e.g. `Business.integrations.twilioSid/twilioAuthToken/whatsappNumber` override platform-wide Twilio env vars in `src/services/twilio/client.ts`, and each business has its own encrypted `GBPToken` OAuth grant. This is what lets each client (or each of an agency's client businesses) connect their own Twilio/Google accounts.

---

## 6. Authentication & Authorization

> **Note on prior documentation:** the pre-existing `documentation/` folder contains **three mutually contradictory descriptions** of the auth system (a custom-JWT design, a NextAuth.js design, and a report describing NextAuth being fully ripped out for a hardcoded dev-mode user). Reading the actual current source resolves this: **none of NextAuth's machinery is present in the codebase today.** The system below is what actually runs.

### 6.1 Session mechanism

- **`src/lib/session.ts`** is the single source of truth for "who is logged in." It uses **`jose`** (`SignJWT`/`jwtVerify`, HS256) — chosen over `jsonwebtoken` specifically because it's Edge/runtime-safe.
  - `createSession(userId, role)` signs `{ userId, role }`, sets it as an **httpOnly**, `secure`-in-production, `sameSite=lax` cookie named `session`, 30-day expiry.
  - `getSession()` reads + verifies the cookie; any failure (missing, tampered, expired) is swallowed and treated as "not logged in" rather than thrown.
  - `destroySession()` deletes the cookie (logout).
  - Secret: `SESSION_SECRET` env var. Missing secret throws **at call time** (fails closed), not at import time.

- A **second, separate JWT system** exists in `src/services/auth/security.ts`: `generateToken`/`verifyToken` wrap **`jsonwebtoken`** keyed by a *different* env var, `JWT_SECRET`, with a 7-day default expiry. This is not what gates `requireClient()` — it appears to back a narrower use case (likely password-reset / email-verification links). **These two secrets (`SESSION_SECRET` vs `JWT_SECRET`) must not be confused with each other.**

### 6.2 Request guards (composable, explicit, per-route)

All three guards return a discriminated union: `{ ok: true, ...context }` or `{ ok: false, response: NextResponse }`, letting the route either proceed or `return guard.response` directly.

| Guard | File | Behavior |
|---|---|---|
| `requireClient()` | `src/lib/auth.ts` | Base guard. Resolves session → loads `User` doc. 401 if no session, 403 if user record was deleted, 500 on DB error. |
| `requireBusinessContext()` | `src/lib/tenant.ts` | Composes `requireClient()` + resolves/verifies `businessId` (see §5). The dominant guard across `business`, `campaigns`, `content`, `crm`, `customers`, `dashboard`, `followups`, `gbp`, `inbox`, `reviews`, `scheduler` route domains. |
| `requireSuperAdmin()` | `src/lib/superAdminAuth.ts` | Same shape as `requireClient()` plus a `user.role === 'SUPER_ADMIN'` check (403 otherwise). Structurally near-identical to `requireClient()` — a candidate for a shared `requireRole()` helper, kept separate today. Gates the entire `/admin/*` UI and `/api/admin/*` route tree. Uses its own cookie, `superAdminUserId` (8h expiry), distinct from the regular user's `session` cookie. |

Additionally, `src/middleware/apiKeyAuth.ts` exports `validateApiKey(req)` — a plain (non-async) header check comparing `x-api-key` against `AUTOMATION_API_KEY` with `!==` (**not constant-time**, a minor timing-attack surface, low risk since this gates internal automation callbacks rather than public endpoints). Fails closed (500) if the server-side key isn't configured; 401 on mismatch. Used by all `/api/n8n/*` routes.

### 6.3 Password & OTP primitives

- **Passwords**: `bcryptjs`, 12 salt rounds (`src/services/auth/security.ts`). `validatePasswordStrength()` enforces ≥8 chars + upper + lower + digit + special char.
- **OTPs** (email verification, password reset): `src/services/auth/otp.ts` — `generateOTP()` uses `crypto.randomInt` (6 digits), `hashOTP()` uses SHA-256 (bcrypt deemed unnecessary for short-lived high-entropy codes), and `verifyOTP()` compares using **`crypto.timingSafeEqual`** (correctly constant-time — notably more careful than `apiKeyAuth.ts`'s plain `!==`).
- Failed-login lockout: `User` model has `failedLoginAttempts`/`accountLockedUntil` fields (5 attempts / 15 min lock, per the login route logic).
- Email OTP delivery: max 5 verification attempts, 15-minute expiry (enforced in `POST /api/auth/verify-email`).

### 6.4 Legacy/dev-mode residue still present in the codebase

A handful of routes bypass all of the above and use a hardcoded `DEV_CONTEXT` object (`src/lib/dev-context.ts` — fake ObjectIds for `userId`/`organizationId`/`businessId`) instead of a real session:

- `GET /api/posts` (list posts scoped to `DEV_CONTEXT.businessId`)
- `GET /api/user/businesses` (businesses for `DEV_CONTEXT.userId`)

These read as **legacy/dev-only routes that were never fully migrated** to the current guard system, not intentional public endpoints. Treat any code depending on them as needing a follow-up before being trusted in production. See §19 and §20 for the full list of routes with missing/weak auth.

### 6.5 Super Admin panel auth (known gap, explicitly documented in-repo)

`SUPER_ADMIN_HANDOVER.md` (root) explicitly flags that the super-admin login currently does a **plain-text password comparison** (`user.passwordHash !== password`), not `bcrypt.compare`, as a pre-production TODO. This is a real, currently-live gap, not a resolved historical issue — treat it as an open security item (§20).

---

## 7. Data Models (41 Mongoose Schemas)

All 41 files live in `src/models/*.ts`. Global patterns that apply to every model:

- Every model uses the hot-reload-safe guard: `mongoose.models.X || mongoose.model<IX>('X', XSchema)`.
- All schemas use `{ timestamps: true }` **except** `GBPInsights` and `GBPKeyword`, which rely on a manual `syncedAt` field instead.
- **No schema anywhere defines `.methods`, `.statics`, `.virtual()`, or `.pre()`/`.post()` hooks** (verified by repo-wide grep) — all business logic lives in the service/route layer, never in the model layer.
- Multi-tenancy fields are inconsistent per-model: some use `organizationId` (proper ref), some `tenantId` (plain string), a few store even `businessId` as a plain string. Noted per-model below.

### 7.1 Core Tenancy & Users

**`User`** — account/login record for both super admins and clients. `fullName`, `email` (unique, indexed), `phone` (unique, indexed), `passwordHash`, `role: 'SUPER_ADMIN' | 'CLIENT'`, `companyName`, `isEmailVerified`, `onboardingCompleted`, `organizationId` (→ Organization), `activeBusinessId` (→ Business), `businessIds[]` (→ Business), `subscriptionPlan` (string, default `'Free'`), OTP fields (`emailOtpHash`, `emailOtpExpiry`, `passwordResetOtp`, `passwordResetExpiry`, `failedOtpAttempts`), security fields (`failedLoginAttempts`, `accountLockedUntil`, `lastLoginAt`), embedded `notificationPreferences` (7 booleans), soft-delete (`isDeleted`, `deletedAt`). This is the tenancy root.

**`Organization`** — tenant container. `name`, `ownerId` (→ User, required), `subscriptionPlan: Free|Pro|Enterprise`, `status: Active|Suspended|Cancelled`, `billingId`, `maxBusinesses` (default 1), embedded `settings.whiteLabel`/`customDomain`.

**`Business`** — the central hub most other models attach to. `name`, `category`, `description`, address fields, `googleMapsUrl`, `coordinates {lat,lng}`, `services`, `offers`, `tone`, `phone`, `website`, `rating`, `reviewCount`, `placeId` (unique, sparse), `serpApiDataId` (cached SerpApi review-engine data_id — see §12.3), `photoCount`/`hasHours` (opportunistically cached from SerpApi), `googlePlaceId`/`googleLocationId`/`googleAccountId`/`googleTypes[]`/`googleConnected`, `keywords[]`, `competitors[]` (self-ref), `organizationId` (→ Organization, required), `userId` (→ User), embedded `integrations.whatsappNumber`, `metaBusinessProfileUrl`/`facebookPageUrl`/`instagramUrl`, embedded `whatsappConfig {provider, businessPhone, metaProfileUrl, isConnected}`, embedded `aiSettings {tone, salesPrompt, replyStyle, leadQualificationBehavior}`, embedded `reviewAutomationSettings {enabled, reminderDays, messageTemplate}`, `kanbanColumns[]`, `onboardingCompleted`, `faqs[{question,answer}]`, `isDeleted`. Is the FK target for ~28 other schemas.

**`AdminInvite`** — invitation for onboarding new `SUPER_ADMIN` users. `email`, `token` (unique), `invitedBy` (→ User), `status: pending|accepted|expired`, `expiresAt`.

**`UserLimitOverride`** — per-user override of usage limits, set manually by a super admin. `userId` (→ User, **unique**, 1:1), nullable numeric overrides (`maxAuditsPerBusiness`, `maxPostsPerMonth`, `maxWhatsAppMessagesPerDay`, `reviewRequestCooldownDays`, `maxAIGenerations` — `null` = use plan/global default), `adminNotes`, `updatedBy`.

### 7.2 Google Business Profile / Audit

**`Audit`** — the core product deliverable; the largest/most complex schema. `tenantId`/`userId`/`organizationId` (**plain strings, not refs** — legacy fields), `businessId` (→ Business), `businessName`, `userDefinedCategory`, `website`, `phone`, address fields, `location`, `status: PENDING|COMPLETED|FAILED`, `auditVersion: V5|V6|V7` (default `V7`), `overallScore`, `auditData` (`Schema.Types.Mixed` — houses `googleSearchRank`, `profileScore`, `competitors[]`, `keywordGapAnalysis[]`, `seoScore`, `reviewAnalysis`, `profileCompletion`, `strengths[]`/`weaknesses[]`, `quickWins[]`, `priorityFixes[]`, `thirtyDayPlan[]`/`ninetyDayPlan[]`, `businessTier`, `auditConfidence`, `businessIntelligence`, `geoGridRank`, `localPackCompetitors[]`), `metadata` (Mixed). Compound index `{tenantId, businessName}`.

**`GBPToken`** — OAuth credentials for a Business's connected Google account. `businessId` (→ Business, **unique**, 1:1), `organizationId` (→ Organization), `googleAccountId`/`googleEmail`, `accessToken`/`refreshToken` (**stored encrypted**, see §9.1 `crypto.ts`), `expiresAt`, `locationId`/`accountId`, `scopes[]`, `connectedAt`, `lastSyncAt`.

**`GBPInsights`** — daily GBP performance metrics synced from Google. `businessId`, `organizationId`, `date`, `views`/`viewsMaps`/`viewsSearch`, `callClicks`, `websiteClicks`, `directionRequests`, `conversations`, `syncedAt`. Compound **unique** index `{businessId, date}`.

**`GBPKeyword`** — monthly keyword impression data from Google's "how customers search" insights. `businessId`, `organizationId`, `keyword`, `impressions`, `month`/`year`, `type: DIRECT|INDIRECT|CHAIN`. Compound **unique** index `{businessId, keyword, month, year}`.

**`BusinessAIConfig`** — per-business config for the WhatsApp AI sales agent. `tenantId` (string), `businessId` (→ Business), `systemPrompt` (long default), `aiTone`, `aiEnabled`, `salesRules`, `automationRules`, `aiPersonality: Professional|Friendly|Enthusiastic`, `tone: Formal|Conversational|Casual`, `maxResponseLength`.

### 7.3 Content & Scheduling

**`Post`** — a scheduled/published GBP post. `tenantId`/`organizationId` (strings), `title`, `businessId` (→ Business), `userId` (→ User), `content`, `media[]`, `imageUrl`, `thumbnailPrompt`, `platform` (default `'gmb'`), `status: draft|pending_approval|approved|rejected|scheduled|published|failed|archived`, `aiGenerated`, `generationPrompt`, `keywords[]`, `location`, `tone`, `contentType`, `hashtags[]`, `cta`, `seoScore`, `scheduledDate`, `publishedAt`, `failureReason`, `retryCount`, `aiMetadata`/`automationMetadata` (Mixed).

**`Campaign`** — a review-request outreach campaign. `businessId`, `tenantId`, `name`, `channel: WHATSAPP|EMAIL|SMS`, `status: DRAFT|ACTIVE|PAUSED|COMPLETED`, booleans `day2Reminder`/`day5Reminder`/`stopOnReview`/`sendOnlyBizHours`, `scheduledAt`, `completedAt`, counters `totalRequests`/`delivered`/`clicked`/`reviewsReceived`.

**`ContentTemplate`** — reusable AI content-generation template, **global/platform-level, not tenant-scoped**. `templateType`, `tone`, `structure`, `prompts[]`.

**`ContentGenerationLog`** — audit trail of AI content-generation calls. `businessId`, `userId`, `requestType`, `prompt`, `output`, `tokensUsed`.

**`SEOContent`** — generated SEO business-description content. `tenantId` (string), `businessId` (**stored as a plain string, not an ObjectId ref** — inconsistent with the rest of the codebase), `description`, `seoScore`, `keywords[]`.

**`FAQ`** — business FAQ entries. `tenantId` (string), `businessId` (**string**, optional — "optional if not linked to a specific business record yet"), `question`, `answer`.

### 7.4 Reviews & Reputation

**`Review`** — a customer review (synced from Google or generated via a review request), with AI sentiment/reply data. `tenantId`/`organizationId` (strings), `providerReviewId` (unique+sparse — Google's review ID), `businessId` (→ Business), `requestId` (→ ReviewRequest, unique+sparse, 1:1), `reviewer`, `rating`, `reviewText`, `sentiment: positive|neutral|negative|critical`, `sentimentScore`, `response`, `aiSuggestedReply`, `replyStatus: PENDING|APPROVED|REJECTED|POSTED|FAILED`, `replyTone`, `sourcePlatform` (default `'Google'`).

**`ReviewReply`** — AI-generated reply candidate/draft with approval workflow state. `reviewId` (→ Review), `generatedReply`, `approved`, `posted`, `tone`, `aiGenerated`.

**`ReviewRequest`** — an outbound "please review us" request with a multi-stage follow-up state machine. `tenantId`, `businessId`, `customerId` (→ Customer), `channel: whatsapp|email`, `message`, `status: Pending|Sent|Delivered|Failed|Cancelled`, `sentAt`, `clicked`/`clickedAt`, `reviewReceived`, `rating`, `followUpStage` (0=Initial, 1=Reminder1, 2=Reminder2), `automationStatus: Active|Completed|Stopped`, `inngestEventId`, `campaignId` (→ Campaign).

**`ReviewAnalytics`** — rolled-up review metrics snapshot per business. `tenantId`, `businessId`, `avgRating`, `responseRate`, `sentimentScore`, `unansweredCount`, `totalReviews`, `positiveReviews`, `negativeReviews`.

**`ReviewMonitorLog`** — log of each review-monitoring sync job run. `businessId`, `reviewsFetched`, `newReviewsDetected`, `aiRepliesGenerated`, `errorLogs[]`.

### 7.5 CRM, Leads & Conversations

**`Lead`** — a sales/CRM lead: either a prospective client of GrowwMatics AI itself ("Platform Prospect") or an end-customer lead for a tenant's own business ("Client Prospect"). `tenantId` (string), `organizationId` (string), `businessId` (→ Business), `assignedUserId` (→ User), `name`, `email`, `phone`, `source: WhatsApp|Website|Manual|Instagram|Facebook|Referral|Demo Booking|Google Business Profile`, `leadType: Client Prospect|Platform Prospect`, `status: active|inactive`, `lifeCycleStage: initial|active|closed|converted`, `pipelineStage` (string|null), `tags[]`, `notes`, `followUpDates[]`, AI qualification fields (`aiLeadScore`, `aiInsights`, `qualificationStatus`, `businessType`, `budget`, `urgency`, `interest`), `lastActivityAt`. Hub of the CRM group — referenced by `Conversation`, `ConversationThread`, `FollowUp`, `Appointment`, `DemoBooking`, `Activity`, `MessageQueue`.

**`Customer`** — an end-customer of a tenant's business (distinct from `Lead` — used for review-request/CRM outreach). `tenantId`, `businessId`, `name`, `phone`, `email`, `service`, `serviceDate`, `tags[]`, `notes`, `optedOut`, `reviewStatus: Pending|Requested|Completed|Failed`, `totalMessagesSent`, `lastMessageAt`, `metadata` (Mixed). Two compound **unique partial** indexes dedupe imports: `{businessId,phone}` and `{businessId,email}`, each requiring the field to exist and be non-null.

**`Conversation`** — an individual message within a Lead's chat history. `tenantId`/`organizationId` (strings), `businessId`, `leadId` (→ Lead), `direction: inbound|outbound`, `messageText`, `isAI`, `messageStatus: sent|delivered|read|failed|received`, `twilioSid`, `metadata` (Mixed), `timestamp`.

**`ConversationThread`** — thread-level rollup for a Lead's conversation (the inbox-list view backing model). `tenantId`, `businessId`, `leadId`, `unreadCount`, `lastMessage`, `aiEnabled`, `assignedAgent` (→ User), `lastActivityAt`.

**`FollowUp`** — a scheduled follow-up task/reminder for a Lead. `tenantId`/`organizationId` (strings), `leadId` (→ Lead), `scheduledFor`, `status: pending|completed|skipped|failed`, `messageTemplate`, `completedAt`.

**`Appointment`** — a scheduled meeting/call/demo tied to a Lead. `leadId` (→ Lead), `businessId` (→ Business), `tenantId` (string), `date`/`time`, `proposedDate`, `serviceInterest`, `email`, `meetingType` (default `'Discovery Call'`), `source`, `status: Pending Confirmation|Scheduled|Completed|Canceled`.

**`DemoBooking`** — a prospective-client demo-call booking (platform-level sales funnel). `leadId` (→ Lead), `name`/`email`/`phone`/`company`/`businessType`/`location`, `website`, `monthlyLeads`, `challenges`, `date`, `timeSlot`, `status: Pending|Confirmed|Completed|Cancelled|No Show|Rescheduled`. (Only model without a typed TS `Document` interface.)

**`Activity`** — CRM activity/timeline log entry for a Lead. `tenantId`/`organizationId` (strings), `leadId` (→ Lead), `type: call|WhatsApp|email|note|meeting|status_change`, `content`, `metadata` (Mixed), `createdBy` (→ User).

**`Notification`** — in-app notification for a User. `userId` (→ User), `type`, `message`, `read`.

### 7.6 Automation & Job Queues

**`AutomationLog`** — generic catch-all log for automation/scheduler/AI-generation/Inngest events platform-wide. All tenancy fields (`tenantId`/`organizationId`/`businessId`) are **plain unlinked strings**. `workflow`, `event`, `action`, `status`, `message`, `prompt`, `response`, `aiModel`, `tokens`, `duration`, `error`, `type: scheduler|ai_generation|inngest_job|other`.

**`JobQueue`** — generic internal job queue record. `jobType`, `payload` (Mixed), `status: PENDING|PROCESSING|COMPLETED|FAILED`, `retryCount`, `nextRetryAt`, `completedAt`, `failedReason`.

**`MessageQueue`** — queue/audit-trail of inbound/outbound messages (e.g. WhatsApp). `leadId` (→ Lead), `direction: INBOUND|OUTBOUND`, `status: PENDING|SENT|FAILED`, `scheduledAt`, `sentAt`, `failedReason`, `payload` (Mixed, required).

### 7.7 Billing / Plans / Usage

**`Plan`** — subscription plan catalog entry. `name`, `price`, `billingCycle: monthly|yearly`, `maxPosts`/`maxAudits`/`maxBusinesses` (`-1` = unlimited), `features[]`, `active`.

**`PlanConfig`** — admin-editable per-plan-name limit config (extends `PlanLimits` from `src/lib/planDefaults.ts`), drives plan-based feature gating. `plan` (string, **unique** key — not a ref to `Plan`), `maxAuditsPerBusiness`, `maxPostsPerMonth`, `maxWhatsAppMessagesPerDay`, `reviewRequestCooldownDays`, `maxAIGenerations`, `updatedBy`. Companion to `UserLimitOverride` (plan-level default vs per-user override).

**`Subscription`** — a User's active subscription state. `userId` (→ User, **unique**, 1:1), `planType: Free|Pro|Enterprise`, `billingStatus: Active|PastDue|Canceled|Trialing`, embedded `trialStatus {isActive, endsAt}` (default 14-day trial), embedded `modules` map keyed by `ModuleKey` (`google_ranking_agent`|`reputation_agent`|`sales_agent`|`content_studio`|`marketing_automation`, each `{enabled, activatedAt}` — only `google_ranking_agent` on by default), plus newer "Phase 1 Migration" fields layered on top: `businessId` (→ Business), `planId` (→ Plan), `status`, `startDate`, `endDate`. Visible schema evolution — two coexisting billing designs (per-user/per-module vs per-business/per-plan) in one schema.

**`SubscriptionUsage`** — monthly usage counters against a business's limits. `businessId`, `month` (e.g. `'2023-10'`), `auditsUsed`, `postsUsed`, `reviewRequestsUsed`, `whatsappMessagesUsed`, `leadsCreated`, `businessesUsed`. Compound **unique** index `{businessId, month}`.

**`UsageTracking`** — per-user billing-period usage tracking (parallel/overlapping concept to `SubscriptionUsage`, but by `userId` + billing period rather than `businessId` + month). `userId`, `billingPeriodStart`/`billingPeriodEnd`, embedded `metrics {aiGenerations, whatsappMessages, reviewRequests, contentUsage}`, embedded `limits` (same 4 keys, non-zero defaults).

### 7.8 Misc / Logging / Platform

**`AIUsageLog`** — per-request AI API usage/cost log for admin analytics and quota enforcement. `userId` (→ User), `businessId` (→ Business), `promptType` (e.g. `content_generation`, `review_reply`, `lead_response`), `aiModel` (typed union but stored loosely as string, default `gpt-4o-mini` — note the app's actual LLM is Groq/Llama, see §11), `tokensUsed`/`promptTokens`/`completionTokens`, `estimatedCost` (USD), `status: success|failed|partial`, `errorMessage`, `durationMs`. Four indexes for admin analytics (`createdAt`, `userId+createdAt`, `status+createdAt`, `promptType+createdAt`).

**`PlatformSettings`** — singleton-style global platform config. `platformName` (default `'GrowwMatics AI'`), `supportEmail`, `maxAuditsPerBusiness`, `maxPostsPerMonth`, `maxWhatsAppMessagesPerDay`, `maintenanceMode`, `defaultTrialDays`, `reviewRequestCooldownDays`. No schema-level unique constraint enforcing a single document — app code must guarantee that.

**`ReportShare`** — public/shareable link token for an Audit report. `auditId` (→ Audit), `token` (unique), `createdBy`, `expiresAt`, `viewCount`.

### 7.9 Relationship Map

| Referencing field | Target model | Found in |
|---|---|---|
| `ownerId` | `User` | Organization |
| `organizationId` | `Organization` | User, Business, GBPToken, GBPInsights, GBPKeyword |
| `businessId` | `Business` | Audit, GBPToken, GBPInsights, GBPKeyword, BusinessAIConfig, Post, Campaign, ContentGenerationLog, Review, ReviewRequest, ReviewAnalytics, ReviewMonitorLog, Lead, Customer, Conversation, ConversationThread, Appointment, AIUsageLog, SubscriptionUsage, Subscription |
| `userId` | `User` | Business, Post, ContentGenerationLog, Notification, Subscription, UsageTracking, AIUsageLog, UserLimitOverride |
| `activeBusinessId`, `businessIds[]` | `Business` | User |
| `competitors[]` | `Business` (self-ref) | Business |
| `assignedUserId`, `createdBy`, `assignedAgent`, `invitedBy` | `User` | Lead, Activity, ConversationThread, AdminInvite |
| `leadId` | `Lead` | Conversation, ConversationThread, FollowUp, Appointment, DemoBooking, Activity, MessageQueue |
| `requestId` | `ReviewRequest` | Review |
| `reviewId` | `Review` | ReviewReply |
| `customerId` | `Customer` | ReviewRequest |
| `campaignId` | `Campaign` | ReviewRequest |
| `auditId` | `Audit` | ReportShare |
| `planId` | `Plan` | Subscription |

**Uniqueness constraints:** `GBPToken.businessId`, `Subscription.userId`, `UserLimitOverride.userId`, `PlanConfig.plan`, `Review.requestId` (sparse), `Review.providerReviewId` (sparse), `Business.placeId` (sparse), `AdminInvite.token`, `ReportShare.token`.
**Compound unique indexes:** `GBPInsights{businessId,date}`, `GBPKeyword{businessId,keyword,month,year}`, `SubscriptionUsage{businessId,month}`, `Customer{businessId,phone}` and `{businessId,email}` (partial), `Audit{tenantId,businessName}` (non-unique compound, for lookups).

---

## 8. API Routes (120 endpoints)

All routes live under `src/app/api/**/route.ts`. Auth legend: **Super-admin** = `requireSuperAdmin()`; **Client** = `requireClient()`; **BizContext** = `requireBusinessContext()`; **API key** = `validateApiKey()` header check; **Public** = no auth, either by design (webhooks, marketing forms, token-gated share links) or as a gap (flagged).

### 8.1 `admin/*` (24 routes) — all gated by Super-admin except login/logout/invite-accept

| Route | Methods | Description |
|---|---|---|
| `/api/admin/ai-usage` | GET | AI/Groq/Twilio/SerpApi usage stats, daily breakdown, top users, prompt breakdown |
| `/api/admin/auth` | POST, DELETE | Super-admin login/logout |
| `/api/admin/automations` | GET | Automation run stats (success/fail, by-workflow, recent logs) |
| `/api/admin/automations/trigger` | POST | Manually triggers an automation workflow via Inngest |
| `/api/admin/businesses` | GET | Paginated/searchable list of all businesses |
| `/api/admin/content-monitor` | GET | Platform-wide post/content-buffer stats |
| `/api/admin/crm-monitor` | GET | Platform-wide lead/pipeline stats |
| `/api/admin/customers/[userId]/usage-limits` | GET, PATCH | Fetch/upsert a user's usage-limit overrides |
| `/api/admin/customers` | GET | Paginated customer/user list, enriched with business + subscription |
| `/api/admin/demo-bookings` | GET, PATCH | List/update demo bookings (updates linked Lead's stage) |
| `/api/admin/impersonate` | POST | Sets `activeBusinessId` cookie to impersonate a customer's business |
| `/api/admin/invites/accept` | POST | Public token-gated acceptance of a super-admin invite |
| `/api/admin/invites` | GET, POST, DELETE | List/create/delete super-admin invite tokens (48h expiry) |
| `/api/admin/plan-config` | GET, PATCH, DELETE | View/edit/reset per-plan limit configs |
| `/api/admin/revenue` | GET | MRR/ARR calc, plan revenue breakdown, 6-month trend, churn |
| `/api/admin/reviews-monitor` | GET | Platform-wide review stats |
| `/api/admin/settings/clear-logs` | POST | Deletes AutomationLog entries >90 days old |
| `/api/admin/settings/flush-demo` | POST | Bulk-deletes demo-tenant data |
| `/api/admin/settings` | GET, PATCH | View/update global PlatformSettings |
| `/api/admin/stats` | GET | Top-level dashboard stats |
| `/api/admin/subscriptions` | GET | Paginated subscription list |
| `/api/admin/system-health` | GET | DB ping, pending/failed job counts, message backlog |
| `/api/admin/usage-limits` | GET | Paginated per-user effective usage limits |
| `/api/admin/whatsapp-monitor` | GET | WhatsApp/conversation stats |

### 8.2 `analytics`, `appointments`, `audit`, `auth`

| Route | Methods | Description | Auth |
|---|---|---|---|
| `/api/analytics` | GET | Global lead/appointment analytics (conversion, sources, funnel) | **None — not tenant-scoped** |
| `/api/appointments` | GET, POST | List/create business appointments | BizContext |
| `/api/audit/[id]/geo-map` | GET | Google Static Maps geo-grid-rank image | Client + ownership |
| `/api/audit/[id]/pdf` | GET | Puppeteer-rendered PDF of the audit | Client + ownership |
| `/api/audit/[id]` | GET | Fetch a single audit | **None — no ownership check** |
| `/api/audit/[id]/share` | POST | Creates/reuses a 30-day public share token | BizContext |
| `/api/audit` | GET, POST | List tenant audits / create + dispatch `audit/generate.requested` | Client (+ `checkUsageLimit` on POST) |
| `/api/audit/test-serpapi` | GET | Dev-only SerpApi vs Places diagnostic | Blocked outside dev, no session |
| `/api/auth/google` | GET | Initiates GBP OAuth, signs state JWT | BizContext |
| `/api/auth/google/callback` | GET | OAuth callback, exchanges code, encrypts+stores `GBPToken`, triggers `gbp/sync.requested` | State-JWT (no user session needed) |
| `/api/auth/login` | POST | Email/password login | Public (credential-based) |
| `/api/auth/logout` | POST | Destroys session | Public |
| `/api/auth/resend-email-otp` | POST | Regenerates/emails a verification OTP | Public |
| `/api/auth/verify-email` | POST | Verifies email OTP (5 attempts, 15-min expiry) | Public |

### 8.3 `automation`, `business`, `campaigns`, `content`, `conversations`, `crm`, `customers`, `dashboard`, `demo`, `followups`

| Route | Methods | Description | Auth |
|---|---|---|---|
| `/api/automation/trigger` | POST | Triggers scheduled-posts check for external schedulers | Weak/disabled Bearer check (commented out) |
| `/api/business/[id]` | PATCH | Update business profile | Client + owner/org/super-admin |
| `/api/business/[id]/seo` | PATCH | Update SEO description (≤750 chars) | Client + ownership |
| `/api/business/active` | GET | Returns the `activeBusinessId`-cookie business | **None explicit** |
| `/api/business/add-workspace` | POST | Creates a new Organization + Business ("workspace") | Client |
| `/api/business/all` | GET, POST | List owned businesses / switch active business cookie | Client |
| `/api/business/kanban-columns` | GET, PATCH | CRM Kanban column config | BizContext |
| `/api/business` | GET, POST, PUT | GET/PUT via `getActiveBusinessContext`; POST creates directly | **POST has no auth check** (likely legacy) |
| `/api/campaigns/[id]/launch` | POST | Activates a campaign, queues per-customer Inngest events | BizContext |
| `/api/campaigns/[id]/pause` | PATCH | Sets campaign to PAUSED | BizContext |
| `/api/campaigns/[id]` | DELETE | Delete campaign | BizContext |
| `/api/campaigns/import` | POST | Bulk-import customers + auto-create Leads | BizContext |
| `/api/campaigns` | GET, POST | List/create campaigns | BizContext |
| `/api/campaigns/send` | POST | One-off campaign send to a single customer | BizContext |
| `/api/campaigns/track/[requestId]` | GET | Public click-tracking redirect → Google review page | Public |
| `/api/content/auto-schedule` | POST | Auto-schedules draft posts 1 day apart | BizContext |
| `/api/content/faqs` | POST | Save business FAQ list | BizContext |
| `/api/content/generate` | POST | AI content gen (Groq) + sequential thumbnail gen | BizContext + usage limit |
| `/api/content/posts` | GET | Paginated AI-generated posts | BizContext |
| `/api/content/schedule/batch` | POST | Bulk-create posts with optional dates | BizContext |
| `/api/content/schedule` | POST | Create a single scheduled/draft post | BizContext |
| `/api/conversations/[leadId]` | GET | Chronological conversation history for a lead | BizContext |
| `/api/crm/leads/[id]/activity` | POST | Log a CRM activity entry | BizContext |
| `/api/crm/leads/[id]` | PATCH | Update lead stage/notes/status/tags | BizContext |
| `/api/crm/leads/[id]/timeline` | GET | Merged Activities+FollowUps timeline | BizContext |
| `/api/crm/leads/import` | POST | CSV/XLSX bulk lead import | BizContext |
| `/api/crm/leads` | GET, POST | List/create leads | BizContext |
| `/api/customers` | GET | Paginated/searchable customer list + stats | BizContext |
| `/api/dashboard/stats` | GET | Main dashboard payload (metrics, charts, recent activity) | BizContext |
| `/api/demo` | POST | Public demo-booking form handler | Public |
| `/api/followups` | GET | Scheduled follow-ups for business's leads | BizContext |

### 8.4 `gbp`, `google`, `inbox`, `inngest`, `integrations`, `leads`, `n8n`, `onboarding`

| Route | Methods | Description | Auth |
|---|---|---|---|
| `/api/gbp/insights` | GET | GBP performance summary + period comparison + keywords | BizContext |
| `/api/gbp/sync` | POST | Pulls fresh GBP metrics/keywords from Google | BizContext |
| `/api/google/autocomplete` | GET | Proxies Google Places Autocomplete | None explicit (public proxy) |
| `/api/google/place-details` | GET | Proxies Google Places Details | None explicit (public proxy) |
| `/api/google/resolve-gbp-url` | POST | Resolves a pasted Maps/GBP URL to place details | None explicit (public proxy) |
| `/api/inbox/config` | GET, POST | Per-business `BusinessAIConfig` (system prompt, tone) | BizContext |
| `/api/inbox/messages` | GET, POST | Fetch messages / send manual WhatsApp (disables AI on thread) | BizContext |
| `/api/inbox/sse` | GET | Server-Sent Events stream of updated threads (2.5s/55s) | BizContext |
| `/api/inbox/threads` | GET, PATCH | List threads / toggle `aiEnabled` | BizContext |
| `/api/inngest` | GET, POST, PUT | Inngest SDK `serve()` handler registering all background functions | Inngest signing-key (SDK-internal) |
| `/api/integrations/status` | GET | Boolean flags for which integrations are configured | Client |
| `/api/leads/[id]` | PUT | Update a lead by ID | **None — no tenant scoping** |
| `/api/leads` | GET | List leads globally with filters | **None — no tenant scoping** |
| `/api/n8n/buffer-check` | GET | 7-day post buffer health check | API key |
| `/api/n8n/generate-content` | POST | Dispatches content backfill event | API key |
| `/api/n8n/generate-reply` | POST | AI review reply for a given reviewId | API key |
| `/api/n8n/sync-reviews` | GET | Up to 50 unreplied reviews, flattened for n8n | API key |
| `/api/onboarding` | POST | Full signup/onboarding: User+Org+Business creation | Public (creates account) |

### 8.5 `posts`, `reports`, `review-requests`, `reviews`, `scheduler`, `twilio`, `upload`, `user`, `webhook`, `whatsapp`

| Route | Methods | Description | Auth |
|---|---|---|---|
| `/api/posts/[id]` | PUT, DELETE | Update/delete a post | **None — no auth check** |
| `/api/posts/generate` | POST | AI-generate a single post | BizContext + usage limit |
| `/api/posts` | GET, POST | List/create posts | **`DEV_CONTEXT` stub — no real auth** |
| `/api/reports/[token]` | GET | Public token-gated shared audit report | Public |
| `/api/review-requests` | GET, POST | List/create ReviewRequests | **None — no tenant scoping** |
| `/api/reviews/[id]/approve-reply` | POST | Marks AI-suggested reply APPROVED | BizContext |
| `/api/reviews/[id]/post-reply` | POST | "Posts" the approved reply (currently mocked, 500ms delay) | BizContext |
| `/api/reviews/analytics` | GET | Review-request funnel analytics | BizContext |
| `/api/reviews/fetch` | POST | Triggers `syncReviewsForBusiness` | BizContext |
| `/api/reviews/generate-reply` | POST | AI review reply for a tone | BizContext + usage limit |
| `/api/reviews/generate-suggestion` | POST | AI personalize/suggest for review-request messages | BizContext |
| `/api/reviews/monitor` | POST | Triggers `processNewReviews` | BizContext |
| `/api/reviews/post-reply` | POST | **Retired** — HTTP 410, redirects to `[id]/post-reply` | N/A |
| `/api/reviews/reply` | POST | **Retired** — HTTP 410 | N/A |
| `/api/reviews/request` | POST | Sends a review request via WhatsApp/Email/SMS | **None explicit** |
| `/api/reviews` | GET, POST | List/create reviews | BizContext |
| `/api/reviews/upload-customers` | POST | CSV upload of customers, dedup | **None — no auth check** |
| `/api/scheduler/buffer` | GET | 7-day content-buffer health + calendar view | BizContext |
| `/api/scheduler/generate` | POST | Manually dispatches content generation (force mode) | Resolves internally, no explicit gate |
| `/api/scheduler/posts/[id]` | DELETE, PATCH | Delete/edit a non-published post | BizContext |
| `/api/scheduler/publish` | POST | Immediately publishes a scheduled post | BizContext |
| `/api/scheduler/schedule` | POST | Sets a post's status to scheduled | BizContext |
| `/api/twilio/voice` | POST | Voice-call webhook → creates Lead from caller | Public webhook, **no signature verification** |
| `/api/upload` | POST | CSV customer upload, dedup by phone | **None — no tenant scoping** |
| `/api/user/businesses` | GET | Businesses for `DEV_CONTEXT.userId` | **`DEV_CONTEXT` stub** |
| `/api/user/change-password` | POST | Verify current password, set new bcrypt hash | Client |
| `/api/user/delete-account` | POST | Soft-delete user + owned businesses | Client |
| `/api/user/notifications` | GET, PATCH | Notification preference flags | Client |
| `/api/user/profile` | GET, PATCH | Profile fields (name/phone/company) | Client |
| `/api/user/subscription` | GET | Current subscription (defaults to Free) | Client |
| `/api/user/usage` | GET | Current-month usage vs plan limits | BizContext |
| `/api/webhook/twilio` | POST | Twilio WhatsApp inbound webhook, handles opt-out, dispatches `whatsapp/incoming` | Public webhook, **no signature verification** |
| `/api/whatsapp/webhook` | POST | Lighter/newer variant of the above, ACKs then dispatches raw payload | Public webhook, **no signature verification** |

### 8.6 Cross-cutting observations

- **Dominant tenant pattern**: `requireBusinessContext()` gates the large majority of business-scoped routes.
- **Super-admin panel**: all 24 `admin/*` routes gated except login/logout/invite-accept.
- **n8n surface**: `n8n/*` (4 routes) + `automation/trigger` are designed for external workflow-engine calls using the static API-key header rather than session cookies.
- **Webhooks**: `webhook/twilio`, `whatsapp/webhook`, `twilio/voice` are public, always return 200/empty-TwiML immediately, and offload real work to Inngest — but **none of them verify Twilio's request signature**, which is a real gap (§20).
- **AI usage gating**: every LLM-calling route (`content/generate`, `posts/generate`, `reviews/generate-reply`) consistently calls `checkUsageLimit(...)` before generating and `logAIUsage(...)` after.
- **Routes with no auth guard found** (flagged for follow-up, see §20): `audit/[id]` GET, `leads`/`leads/[id]` (fully unscoped), `posts`/`posts/[id]` (dev-stub/no auth), `review-requests`, `reviews/upload-customers`, `reviews/request`, `upload`, `business` POST, `business/active`, `user/businesses` (dev-stub). Google proxy routes (`autocomplete`, `place-details`) are open but low-risk (read-only proxies with no tenant data).
- **Retired endpoints**: `reviews/post-reply` and `reviews/reply` both return `410 Gone`.

---

## 9. Business-Logic / Service Layer

### 9.1 `src/lib` — platform utilities

| File | Purpose |
|---|---|
| `session.ts` | JWT session cookie (jose, `SESSION_SECRET`) — see §6.1 |
| `auth.ts` | `requireClient()` guard — see §6.2 |
| `superAdminAuth.ts` | `requireSuperAdmin()` guard — see §6.2 |
| `tenant.ts` | `requireBusinessContext()` — the strict tenant-scoping guard — see §5, §6.2 |
| `business-context.ts` | `getActiveBusinessContext()` — the looser, legacy-feeling sibling of `tenant.ts` — see §5 |
| `crypto.ts` | AES-256-GCM envelope encryption (`GOOGLE_TOKEN_SECRET`, 64-char hex key) for secrets at rest — primarily Google OAuth tokens in `GBPToken`. `encrypt()`/`decrypt()` produce/consume `iv:tag:ciphertext` hex strings; decrypt throws on tamper (AEAD tag mismatch) |
| `gbpClient.ts` | Hand-rolled `fetch`-based Google OAuth2 + Business Profile Performance API client (not the `googleapis` SDK). `getValidToken()` auto-refreshes and re-encrypts tokens, flips `Business.googleConnected=false` + throws typed `GBPAuthError` on refresh failure. `fetchDailyMetrics()`/`fetchSearchKeywords()` pull and pivot raw Google metric responses |
| `mongodb.ts` | Standard hot-reload-safe Mongoose connection singleton (`global.mongoose` cache); `bufferCommands:false` so queries fail fast when disconnected |
| `featureGating.ts` | `checkUsageLimit()`/`incrementUsage()` — plan-based usage enforcement (posts/audits/aiGenerations/whatsappMessages), merging `PlanConfig` DB overrides → hardcoded `PLAN_DEFAULTS` → `UserLimitOverride` per-user overrides |
| `planDefaults.ts` | `PlanLimits` interface + hardcoded `PLAN_DEFAULTS` for Free/Pro/Enterprise, `resolveEffectiveLimits()` merge helper |
| `logAIUsage.ts` | Fire-and-forget `AIUsageLog` writer; explicitly designed to **never throw**, only `console.error`s on failure |
| `aiCostEstimator.ts` | Pure pricing calculator (`MODEL_PRICING` table for gpt-4o/claude/gemini/etc.); since the app's real LLM is Groq, these costs are **approximate placeholders**, not vendor-accurate |
| `reviewRedirect.ts` | `handleReviewRedirect()` — resolves a review-request tracking link to a Google review URL, marks `clicked`, increments campaign counters |
| `dev-context.ts` | Hardcoded `DEV_CONTEXT` fake-session object — see §6.4 |
| `utils.ts` | `cn()` — shadcn/ui-style Tailwind class merge helper |
| `api.ts` | Client-side Axios instance (`baseURL: '/api'`) — duplicate of `src/services/api.ts`, see §19 |
| `pdf/browser.ts` | Puppeteer launcher — `@sparticuz/chromium` in production, scans common local Chrome paths in dev |
| `pdf/reportHtml.ts` | 667-line hand-built HTML/inline-CSS template for the audit PDF report (`buildReportHtml()`); duplicates styling logic that also exists in the React report components (visual-drift risk) |

### 9.2 `src/middleware/apiKeyAuth.ts`

Covered in §6.2. No root `src/middleware.ts` exists — every route opts into a guard explicitly.

### 9.3 `src/context` — React client providers

- **`BusinessContext.tsx`** — `"use client"` provider mirroring the server "active business" concept for the UI. Fetches `GET /api/business/all` on mount, exposes `{businesses, activeBusiness, switchBusiness, refreshBusinesses}`.
- **`MobileNavContext.tsx`** — minimal `{isOpen, toggle, close}` UI state for the mobile nav drawer.

### 9.4 `src/services` top-level files

| File | Purpose |
|---|---|
| `ai-analysis.ts` | Groq-based `analyzeBusinessData()` — an earlier/alternate audit-analysis entry point, not obviously wired into the main V7 pipeline |
| `ai.ts` | The largest general Groq wrapper (369 lines): `generateSalesResponse()` (WhatsApp/CRM sales agent with a metadata-tag protocol), `extractLeadInsights()`, `generatePost()`, `generateReviewSuggestions()`, `personalizeReviewMessage()`, `generateAIReply()`, `analyzeSentiment()` (LLM-based) |
| `api.ts` | Client-side Axios instance, duplicate of `lib/api.ts` |
| `automation.ts` | `checkScheduledPosts()` — a **legacy synchronous scheduler**, superseded by the Inngest `bufferMonitorWorker` but still present in the codebase |
| `content-ai.ts` | `generateStructuredContent()` with explicit **prompt-injection defense** (`sanitizeInput()` strips "ignore previous instructions" etc.) — likely superseded by `ai/contentEngine.ts` for the main flow |
| `email.ts` | Dual backend: Nodemailer/SendGrid (review-request emails), Resend (OTP emails); both mock gracefully when keys are absent |
| `google-maps.ts` | SerpApi `google_maps` engine wrapper — an older/simpler integration than `audit/seoAnalyzer.ts`'s geo-grid logic |
| `reviews.ts` | **Mock-based** review pipeline (`fetchGoogleReviews()` returns hardcoded fake reviews) — reads as legacy/demo, distinct from the real `reviews/syncReviews.ts` |
| `sms.ts` | Twilio SMS + Twilio Verify OTP wrapper, per-business credentials with mock fallback |
| `whatsapp.ts` | Per-business Twilio WhatsApp sender with **hardcoded Indian phone-number normalization** — a third, redundant Twilio-send code path (see §19) |

### 9.5 `src/services/ai/` — Groq generation engines (the ones actually wired into production flows)

- **`auditEngine.ts`** — `generateAIAudit()`, the core LLM call behind the V7 audit. Temperature 0.1, explicitly forbidden from inventing competitors/rankings — must reuse pre-computed deterministic analytics verbatim, constrained to narrative synthesis only.
- **`contentEngine.ts`** — `generateAIContent()`, generates a full 7-post batch + SEO description + 5 FAQs + scores in one Groq call (temp 0.7, JSON mode). The function Inngest's `processContentJob` actually calls.
- **`imageGenerator.ts`** — `generateThumbnail()`, dual-provider router: `nb_`-prefixed keys → NanoBanana API; anything else → Google Gemini `gemini-2.0-flash-preview-image-generation`. 30s timeout, fails soft (`null`) rather than throwing.
- **`replyEngine.ts`** — `generateReviewReply()`, a cleaner typed alternative to `ai.ts`'s `generateAIReply()` — throws on failure instead of returning a canned fallback; looks like the newer/preferred implementation.

### 9.6 `src/services/audit/` — the V7 audit scoring pipeline

- **`auditService.ts`** — `processAuditJob()`, the orchestrator. Loads the Audit doc (no-op if not PENDING — idempotency guard), loads/syncs reviews, computes **native (non-LLM) analytics**, computes the final overall score deterministically (`profileCompletion×0.35 + seoScore×0.25 + reviewQuality×0.25 + keywordCoverage×0.15`), calls the LLM for narrative only, then **overwrites the LLM's numeric fields with the native truths** before saving. **The headline audit score is never LLM-generated.**
- **`competitorService.ts`** — `findCompetitors()` via real Google Places Text Search; `isEnterpriseBrand()` (blocklist + review-count heuristic to exclude national chains from local comparisons); `classifyBusinessTier()`; `calculateGapAnalysis()`.
- **`geoGrid.ts`** — pure geometry: generates a 3×3 lat/lng grid (`~9 sq km`) around a business, latitude-corrected for longitude spacing.
- **`seoAnalyzer.ts`** (589 lines, the analytical core) — `calculateProfileCompletion()`, `calculateReviewMetrics()`, `calculateReviewQualityScore()`, `analyzeReviewKeywords()`, a hand-rolled `withConcurrency()` worker pool + `retryWithBackoff()` (429/5xx only, exponential), `fetchGeoGridRankings()` (up to **45 SerpApi calls** — 5 keywords × 9 grid points — at concurrency 6, matches target business by place_id/serpApiDataId then fuzzy name, harvests competitors from results above it), `calculateNativeSeoScore()`, `calculateAuditConfidence()`, `generateNativePriorityFixes()` (rule-based, what the LLM must reuse), `calculateBusinessIntelligence()`. Every function returns a human-readable `evidenceSource` string — a consistent "explainability" design so the audit report is never an unexplained black box.

### 9.7 `src/services/auth/` — password/token/OTP primitives

- **`otp.ts`** — `generateOTP()` (crypto-secure 6-digit), `hashOTP()` (SHA-256), `verifyOTP()` (constant-time compare via `crypto.timingSafeEqual`).
- **`security.ts`** — `hashPassword`/`verifyPassword` (bcryptjs, 12 rounds), `validatePasswordStrength()`, and the second JWT mechanism `generateToken`/`verifyToken` (`jsonwebtoken`, `JWT_SECRET`) — see §6.1.

### 9.8 `src/services/google/` and `src/services/reviews/`

- **`google/places.ts`** — `GooglePlacesService` static class wrapping the real Google Places API for onboarding's business-search autocomplete + place details.
- **`reviews/sentimentEngine.ts`** — the **fast, deterministic, non-LLM** sentiment classifier used by the real sync pipeline. Fixed score midpoints per bucket specifically so repeated reprocessing is stable (documented rationale: analytics must not drift between runs).
- **`reviews/syncReviews.ts`** — `syncReviewsForBusiness()`, the **real production entry point** (used by the nightly cron and pre-audit sync). Upserts by `providerReviewId` (idempotent), recomputes `ReviewAnalytics` from the full review set after each sync, and dynamically imports the Inngest client to fire `reviews/critical-alert` on a critical-sentiment review (dynamic import specifically to avoid a circular dependency with `inngest/functions.ts`).
- **`reviews/providers/index.ts`** — `getReviewProvider()` factory: `MockGoogleProvider` if `SERPAPI_KEY` absent or `REVIEW_PROVIDER=mock`, else `SerpApiGoogleProvider`.
- **`reviews/providers/MockGoogleProvider.ts`** — deterministic fake reviews (stable IDs so re-runs dedupe), simulated latency, and a 1-in-10 random failure on `postReply()` to exercise error paths.
- **`reviews/providers/SerpApiGoogleProvider.ts`** — the real provider. Resolves and **caches** SerpApi's `data_id` (different format from Google's `place_id`) onto `Business.serpApiDataId`; opportunistically harvests `photoCount`/`hasHours` at zero extra cost; paginates via `next_page_token` up to `MAX_REVIEWS_PER_AUDIT` (default 100); degrades gracefully (stops, doesn't throw) on transient errors.

### 9.9 `src/services/twilio/` and `src/services/whatsapp/`

- **`twilio/client.ts`** — `sendOutboundMessage()`, the **canonical outbound WhatsApp sender used by all Inngest workflows**. Business-override credential resolution (business's own Twilio creds beat platform defaults). Logs every send to `MessageQueue` (PENDING → SENT/FAILED) as a durable audit trail independent of Twilio's own dashboard. Silently no-ops if no credentials resolve at all.
- **`whatsapp/meta.ts`** — `MetaWhatsAppService`, an explicitly-labeled **stub/scaffold**, not wired into any live workflow. `sendMessage()` returns a fake ID and logs; the real Graph API call is commented out. See §12.4 for the resolved Twilio-vs-Meta status.

---

## 10. Background Jobs (Inngest)

`src/services/inngest/client.ts` declares a typed `Events` map with 14 event names and instantiates the client (`id: "gmb-optimization-platform"`). `src/services/inngest/functions.ts` (~1140 lines, ~16 functions) implements every async workflow in the platform, served via `src/app/api/inngest/route.ts`.

| Function | Trigger | What it does |
|---|---|---|
| `processWhatsappMessage` | event `whatsapp/incoming` | Checks `ConversationThread.aiEnabled` kill switch → Groq drafts sales reply from last 10 messages → sends via Twilio → second Groq call classifies booking intent (JSON mode) → conditionally creates `Appointment`. `retries: 3` |
| `followUpCron` + `processFollowUpJob` | cron `0 * * * *` (hourly) | Scans stale leads, fans out one `scheduler/follow-up` event per lead; marks follow-up `completed` only **after** the Twilio send succeeds |
| `bufferMonitorWorker` / `manualContentGenerate` / `processContentJob` | cron + manual trigger | Tops up each business's content buffer to ≥7 scheduled posts via `contentEngine.generateAIContent()`; Twilio-alerts the owner if buffer <4 or generation fails |
| `processReviewCampaign` | event `campaigns/review.request.start` | Multi-day drip: initial ask → `step.sleep("2d")` → reminder if unclicked → `step.sleep("5d")` → final reminder if still unclicked |
| `reviewAutopollCron` / `processReviewAutopollJob` | hourly | Finds `ReviewRequest`s clicked >2h ago, marks `REVIEWED`, upserts a placeholder `Review` |
| `publishScheduledPostsCron` / `processPublishPostJob` | every 15 min | Dispatches due `Post`s to a publish job — **the actual GBP publish call is currently a `[MOCK]` console.log**, not a real API call |
| `generateAuditJob` | event `audit/generate.requested` | Best-effort pre-syncs reviews (failure never blocks the audit), then calls `processAuditJob()` |
| `reviewSyncWorker` / `processReviewSyncJob` / `criticalAlertWorker` | nightly cron `0 2 * * *` | Fans out review sync per business; dedicated worker texts the owner on critical-sentiment reviews |
| `scheduleLeadFollowUpsJob` | event `crm/lead-created` | Groq lead scoring, then `step.sleepUntil` ×3 (Day 1/3/7) dispatching `crm/dispatch-whatsapp` per stage |
| `dispatchWhatsappFollowUpJob` | event `crm/dispatch-whatsapp` | Personalized (or rule-based fallback) follow-up message; skips `Converted`/`Not Interested` leads |
| `processDemoBooking` | event `demo/booked` | Sends admin+customer confirmation emails **directly via SendGrid HTTP API**, bypassing `services/email.ts` |
| `gbpNightlySyncScheduler` / `gbpSyncWorker` | cron `0 3 * * *` | Nightly fan-out over all `googleConnected` businesses; pulls 28 days of metrics + keyword data; catches `GBPAuthError` to flip `googleConnected:false` without failing the whole run |

**Implementation notes:**
- Almost every function body uses **dynamic `await import(...)`** for Mongoose models (and even the Groq SDK) inside `step.run()` callbacks rather than static top-of-file imports — inconsistent (a few models like `Lead`/`Conversation` are imported statically too), likely to control Inngest's cold-start/step-memoization bundling behavior.
- Functions touching external APIs (Twilio, Groq) mostly declare `retries: 3`; pure cron dispatchers that only fan out events have no explicit retry (dispatch is idempotent-ish via `step.sendEvent` batching).

---

## 11. AI / LLM Integration

**Production LLM: Groq (`llama-3.3-70b-versatile`) exclusively.** The `openai` and `@google/generative-ai` npm packages are present but used only narrowly — `imageGenerator.ts`'s Gemini fallback branch for thumbnails, and `AIUsageLog`'s `aiModel` enum lists OpenAI/Anthropic/Google model names that don't actually reflect what's called (see §19 — cost estimates are approximate placeholders as a result).

**Multiple, overlapping Groq call sites exist for the same conceptual task** — this is real duplication, not intentional redundancy, and is catalogued in full in §19 (e.g. two sentiment engines, two review-reply generators, two WhatsApp sales-reply code paths, two content generators).

**Design patterns used consistently across the real (non-legacy) AI call sites:**
- **Structured JSON output** (`response_format: {type: 'json_object'}`) instead of parsing free text — replaces older, fragile regex/backtick-stripping approaches still visible in a couple of legacy files.
- **Deterministic constraints for scoring/classification** — low temperature (0.1) plus, in the audit pipeline, an explicit instruction to reuse pre-computed native numbers rather than inventing new ones (`auditEngine.ts`). The headline audit score is computed by a hardcoded weighted formula, never by the LLM (§9.6).
- **Prompt-injection mitigation** — `content-ai.ts`'s `sanitizeInput()` strips phrases like "ignore previous instructions", "system prompt", "act as", "pretend" from user-supplied fields before interpolating them into prompts. This is one of the only explicit mitigations found; not every Groq call site applies it.
- **Contextual dedup** — content generation passes recent posts as context to avoid repeating topics; WhatsApp reply generation passes the last N conversation turns.
- **Usage accounting** — every user-facing generation route calls `checkUsageLimit()` before and `logAIUsage()` after (§9.1), feeding the admin AI-usage dashboard (§15).

---

## 12. External Integrations

### 12.1 Google Business Profile (OAuth + Performance API)

`src/lib/gbpClient.ts` hand-rolls OAuth2 token refresh and calls the real **Business Profile Performance API** (`businessprofileperformance.googleapis.com`) via `fetch` — not the `googleapis` SDK (unused despite being a dependency). Tokens are encrypted at rest (`crypto.ts`, AES-256-GCM) in the `GBPToken` model. Flow: `/api/auth/google` (signs state JWT) → user consents on Google → `/api/auth/google/callback` (exchanges code, fetches accounts/locations, encrypts+stores tokens, triggers `gbp/sync.requested`). Nightly sync (`gbpNightlySyncScheduler`) pulls 28 days of daily metrics + monthly search-keyword data into `GBPInsights`/`GBPKeyword`, surfaced via `/api/gbp/insights`.

### 12.2 Google Places API

`src/services/google/places.ts` (`GooglePlacesService`) — autocomplete + place details for onboarding's business search, proxied server-side so `GOOGLE_MAPS_API_KEY` never reaches the client. Also used independently by `audit/competitorService.ts` (Text Search for nearby competitors) — a second, separate call site against the same underlying Google API.

### 12.3 SerpApi (Google Maps data)

Used for two distinct purposes with two distinct "IDs": `google_maps` engine (place-level competitor/ranking data, keyed by Google's own `place_id`) and `google_maps_reviews` engine (review pull, keyed by SerpApi's own `data_id`, a *different* identifier that `SerpApiGoogleProvider.resolveDataId()` looks up once and caches on `Business.serpApiDataId`). The audit's geo-grid ranking check (`seoAnalyzer.fetchGeoGridRankings()`) is the heaviest consumer — up to 45 calls per audit.

### 12.4 WhatsApp / SMS — Twilio is live; Meta is an unwired stub

**Resolved contradiction** (prior docs disagreed on this — see intro note): reading the actual source confirms **Twilio is the live, production messaging channel**. Evidence: `src/services/twilio/client.ts` is the function every Inngest workflow calls to send WhatsApp messages; `webhook/twilio` and `whatsapp/webhook` are real, wired-up inbound routes; `Business.integrations.twilioSid/twilioAuthToken/whatsappNumber` are actively read at send time. By contrast, `src/services/whatsapp/meta.ts` (`MetaWhatsAppService`) is explicitly a stub — its `sendMessage()` just logs and returns a fake ID, the real Graph API `fetch()` call is commented out, and `parseWebhook()` is a no-op. `Business.whatsappConfig.provider` field exists and can hold `'meta'`, but nothing in the codebase actually branches on it to route through a working Meta implementation. **Treat the Meta integration as planned/future work, not a functioning alternative to Twilio.**

Three separate places in the codebase independently instantiate a Twilio client and format outbound messages (`twilio/client.ts`, `services/whatsapp.ts`, and an ad hoc inline client inside `services/reviews.ts`) — see §19.

### 12.5 Email

Dual backend, both optional/mockable: **Resend** (OTP emails) and **Nodemailer via SendGrid SMTP** (review-request emails). `processDemoBooking` (Inngest) bypasses both and calls the SendGrid HTTP API directly for demo-booking confirmations — a third, separate email code path.

### 12.6 Image generation (post thumbnails)

`src/services/ai/imageGenerator.ts` routes by API key format: `nb_`-prefixed → **NanoBanana** API; anything else → **Google Gemini** (`gemini-2.0-flash-preview-image-generation`). Both branches fail soft (return `null`) on error/timeout — thumbnail generation is treated as a non-critical enhancement layered onto post generation, never a hard blocker.

### 12.7 PDF report generation

`Puppeteer-core` + `@sparticuz/chromium` (serverless-safe headless Chrome) renders the hand-built HTML template from `lib/pdf/reportHtml.ts` to a PDF, triggered by `GET /api/audit/[id]/pdf` forwarding the user's session cookies to a headless render of `/print/audit/[id]`.

---

## 13. The 9 Product Modules

The dashboard is organized around 9 functional modules (per the existing `documentation/modules/` specs, cross-checked against source):

1. **GMB Audit Engine** — `/dashboard/audit`. Discovery/analysis engine: scores profile completeness, SEO, reviews, and local-pack ranking; produces a shareable/downloadable PDF report. Backed by `services/audit/*` (§9.6) and `POST/GET /api/audit`.
2. **AI Content Generator** — `/dashboard/content`. AI-drafts GMB posts (title/content/hashtags/cta/seo_score) via `contentEngine.generateAIContent()`, with prompt-injection-sanitized inputs.
3. **Scheduler & Auto-Posting** — `/dashboard/posts`. Maintains a rolling 7-day content buffer automatically (Inngest `bufferMonitorWorker`), drag-and-drop calendar (`@dnd-kit`), manual schedule/publish endpoints.
4. **Review Management Agent** — `/dashboard/reviews`. Syncs reviews (real: SerpApi provider; §9.8), classifies sentiment (fast rules engine for the real pipeline), drafts AI replies for 1-click approval, alerts on critical reviews.
5. **CRM System** — `/dashboard/crm`. Kanban pipeline (drag-and-drop) over the `Lead` model, fed primarily by the WhatsApp AI agent and CSV/XLSX imports; activity timeline, follow-up scheduling.
6. **WhatsApp AI Agent** — backend-only, no dedicated UI. Twilio webhook → Inngest `processWhatsappMessage` → Groq-drafted reply + intent classification → CRM updates, with human-takeover toggle (`ConversationThread.aiEnabled`).
7. **Automation Layer** — the Inngest engine itself (§10), the "invisible brain" coordinating every other module's async work; optionally paired with n8n for external/visual workflow needs (§16).
8. **Admin Dashboard** — `/dashboard` shell + `/admin/*` — see §15 for the isolated Super Admin surface specifically; the regular `/dashboard` is the day-to-day product UI aggregating all modules via `GET /api/dashboard/stats`.
9. **Review Generation System** — `/dashboard/upload`, `/dashboard/campaigns`. CSV customer upload → `Campaign` → Twilio/Email/SMS review-request drip (Inngest `processReviewCampaign`) → click-tracked smart links → reminder sequence.

---

## 14. Billing, Plans & Usage Limits

Two parallel-but-overlapping systems exist for plan limits and usage tracking (see §7.7, §19):

- **Plan-level defaults**: hardcoded `PLAN_DEFAULTS` (`lib/planDefaults.ts`) for Free/Pro/Enterprise, overridable per-plan via the admin-editable `PlanConfig` model.
- **Per-user overrides**: `UserLimitOverride` (1:1 with `User`) — nullable fields that, when set, take precedence over plan defaults.
- **Usage counting**: `SubscriptionUsage` (per business, per month) for posts/audits/reviewRequests/whatsappMessages/leadsCreated; `AIUsageLog` document count specifically for `aiGenerations` (not a separate counter); `UsageTracking` (per user, per billing period) as a third, overlapping usage-tracking concept.
- **Enforcement**: `featureGating.checkUsageLimit(userId, businessId, metric, amount)` merges all of the above and returns `{allowed, reason, code:'UPGRADE_REQUIRED', limit, used}` (`limit === -1` = unlimited); called before every metered action (audit creation, post generation, AI review replies).
- **Subscription state**: `Subscription` model tracks `planType`/`billingStatus`/`trialStatus` (14-day default trial) and a per-module enablement map (`google_ranking_agent`, `reputation_agent`, `sales_agent`, `content_studio`, `marketing_automation`) — only `google_ranking_agent` enabled by default — plus newer `businessId`/`planId`-based fields from a "Phase 1 Migration" layered onto the same schema.

---

## 15. Super Admin Panel

A fully isolated internal admin surface (`/admin/*` pages, `/api/admin/*` routes — 24 endpoints, §8.1) with its own session cookie (`superAdminUserId`, 8h expiry) and its own `requireSuperAdmin()` guard, separate from the regular product's `session` cookie and `requireClient()`/`requireBusinessContext()` guards. Zero changes were made to existing user-facing flows/APIs to build it — the only schema touch was adding `SUPER_ADMIN` to `User.role`.

**Capabilities:** platform-wide dashboards for users/businesses/content/revenue/AI usage/automations/reviews/CRM/WhatsApp; per-plan limit config editor; per-user usage-limit overrides; subscription management; demo-booking management; business impersonation (loads another user's business context for support purposes); super-admin invite system (48h-expiry tokens); global `PlatformSettings` editor (maintenance mode, trial length, default limits); log cleanup and demo-tenant data flush utilities; system health check (DB ping, job backlog).

**Known, currently-live gap** (documented in-repo, not historical): the super-admin login endpoint does a plain-text password comparison rather than `bcrypt.compare` — see §6.5, §20.

**Bootstrapping the first super admin:** `scripts/create-super-admin.js` (or `scripts/seed-superadmin.mjs`), or manually setting `role: 'SUPER_ADMIN'` on an existing `User` document.

---

## 16. n8n Automation Workflows (Optional Layer)

`n8n-workflows/` at the repo root contains 3 exported workflow JSON files, positioned as an **optional, alternative orchestrator to Inngest** — explicitly documented as **must-not-run-concurrently-with-Inngest** for the same task (risk of duplicate posts/messages/double-counted review requests). They call the same backend logic through a dedicated `/api/n8n/*` proxy layer authenticated by a static API key (`AUTOMATION_API_KEY`) rather than session cookies (§6.2, §8.4).

| Workflow | Trigger | What it does |
|---|---|---|
| `workflow-1-buffer-monitor.json` | daily 8 AM | Checks `/api/n8n/buffer-check`; if <7 scheduled days remain, calls `/api/n8n/generate-content` (fires `scheduler/manual-generate`); Twilio-alerts admin on completion |
| `workflow-2-lead-followup.json` | webhook, on new-lead creation | Welcome WhatsApp → wait 3 days → check lead status via `/api/crm/leads/{id}` → follow-ups at day 3 and day 7 if still active. Requires `x-webhook-secret` header |
| `workflow-3-review-automation.json` | every 6 hours | `/api/n8n/sync-reviews` for unreplied reviews → `/api/n8n/generate-reply` per review → sends AI draft to admin via WhatsApp for approval |

**Multi-tenancy caveat:** n8n is inherently single-tenant per instance — one Docker container per client (or duplicated workflows per business within one instance) is the recommended pattern.

**Import:** n8n UI → Workflows → Add Workflow → Import from File → configure the flagged credential nodes (`GMB API Key`, `Twilio Basic Auth`, `GMB Webhook Secret`) → activate.

---

## 17. Environment Variables Reference

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string — primary datastore |
| `SESSION_SECRET` | Signs the real user session cookie (`lib/session.ts`, jose/HS256) |
| `JWT_SECRET` | Signs the separate `jsonwebtoken`-based tokens in `services/auth/security.ts` (distinct from `SESSION_SECRET` — do not conflate) |
| `GOOGLE_TOKEN_SECRET` | 64-char hex AES-256-GCM key for encrypting GBP OAuth tokens at rest (`lib/crypto.ts`) |
| `GROQ_API_KEY` | Groq API key — the platform's sole production LLM (Llama 3.3 70B) |
| `SERPAPI_KEY` | SerpApi key — Google Maps + Google Maps Reviews engines (audit geo-grid, competitor discovery, review sync provider selection) |
| `GOOGLE_MAPS_API_KEY` | Google Places API — onboarding autocomplete/details, competitor Text Search |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | GBP OAuth2 app credentials (implied by `gbpClient.ts`'s OAuth flow, not directly confirmed in the read but required for the flow to function) |
| `TWILIO_ACCOUNT_SID` | Twilio account identifier — platform-default SMS/WhatsApp sending (overridable per-business) |
| `TWILIO_AUTH_TOKEN` | Twilio auth secret |
| `TWILIO_WHATSAPP_NUMBER` | Twilio-assigned WhatsApp sender (`whatsapp:+1...` format) |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify service — SMS OTP; mocks if unset |
| `INNGEST_EVENT_KEY` | Key for sending events into Inngest |
| `INNGEST_SIGNING_KEY` | Verifies requests hitting `/api/inngest` originate from Inngest |
| `AUTOMATION_API_KEY` | Static API key required by `/api/n8n/*` proxy routes and `middleware/apiKeyAuth.ts` |
| `N8N_WEBHOOK_SECRET` | Shared secret sent as `x-webhook-secret` when notifying n8n's lead-followup webhook |
| `NANOBANANA_API_KEY` | Thumbnail image generation — `nb_`-prefixed keys route here |
| `GOOGLE_AI_API_KEY` / equivalent Gemini key | Thumbnail image generation fallback (any non-`nb_` key format routes to Gemini in `imageGenerator.ts`) |
| `RESEND_API_KEY` | OTP email delivery via Resend; mocks (console.warn) if unset |
| `SENDGRID_API_KEY` | Review-request email delivery via Nodemailer/SendGrid SMTP relay; also used directly (not via Nodemailer) by the demo-booking confirmation email in Inngest |
| `NEXT_PUBLIC_APP_URL` | Public-facing app base URL exposed to the client bundle (used to build tracking/share links) |
| `PUPPETEER_EXECUTABLE_PATH` | Optional local Chrome/Chromium path override for PDF generation in development |

> Some variable names (particularly OAuth client id/secret and the exact Gemini key name) were inferred from the code's behavior rather than directly observed as literal `process.env.X` strings during this pass — verify exact names against `.env.local` / hosting-platform config before relying on this list for a deployment runbook.

---

## 18. Deployment & Local Development

**Local setup:**
1. `npm install`
2. Configure `.env.local` with at minimum `MONGODB_URI`, `SESSION_SECRET`, `GROQ_API_KEY` — everything else degrades gracefully to mock/disabled behavior when unset (Twilio, email, image gen, SerpApi all have documented fallback/mock paths).
3. `npm run dev` (Next.js dev server, port 3000 by default).
4. Run the Inngest dev server separately (`npx inngest-cli@latest dev`) to execute background jobs locally; its dashboard runs on `localhost:8288`.
5. To receive real Twilio webhooks locally, tunnel with `ngrok http 3000` and point the Twilio Console's WhatsApp sandbox "When a message comes in" webhook at `https://<ngrok-domain>/api/webhook/twilio`.

**Production (per existing deployment docs, not independently re-verified against a live deploy in this pass):** Vercel for the Next.js app; Inngest Cloud (linked via the Vercel integration, which auto-injects Inngest keys); MongoDB Atlas with network access opened to `0.0.0.0/0` since Vercel doesn't have static egress IPs.

**Scripts** (`scripts/`): `create-super-admin.js` / `seed-superadmin.mjs` (bootstrap the first admin), `migrate-audits.ts` / `migrate-subscriptions.ts` (data migrations), `cleanup-demo-tenant.js` / `cleanup-test-user.js` (test-data hygiene), `create-test-user.ts`, `debug_business.ts`, `find_user.ts`, `test_*.ts` (ad hoc manual test scripts for audit/bcrypt/demo flows).

---

## 19. Known Duplication, Dead Code & Tech Debt

This section exists because "every detail" of this codebase includes the parts that are messy — knowing about them is what prevents building new work on top of the wrong copy of a function.

**Multiple implementations of the same conceptual task, coexisting:**
- **Sentiment analysis**: `services/reviews/sentimentEngine.ts` (fast, deterministic, rules-based — used by the real sync pipeline) vs `services/ai.ts`'s `analyzeSentiment()` (LLM-based, used only by the legacy mock pipeline in `services/reviews.ts`).
- **Review reply generation**: `services/ai/replyEngine.ts` (typed, throws on failure — looks newer/preferred) vs `services/ai.ts`'s `generateAIReply()` (returns a canned fallback string on failure — looks legacy).
- **WhatsApp sales-agent reply generation**: `inngest/functions.ts`'s inline Groq call inside `processWhatsappMessage` (the live production path) vs `services/ai.ts`'s `generateSalesResponse()` (a separate prompt/tag scheme, unclear if still called from anywhere live).
- **Content generation**: `services/ai/contentEngine.ts`'s `generateAIContent()` (full 7-post batch, the one Inngest actually calls) vs `services/content-ai.ts`'s `generateStructuredContent()` (single-item, prompt-injection-sanitized — possibly used by a different UI entry point, possibly superseded).
- **Content-buffer scheduling**: `services/automation.ts`'s `checkScheduledPosts()` (legacy synchronous loop, no retry/backoff/concurrency control) vs Inngest's `bufferMonitorWorker`/`processContentJob` (the current production path, per-business fan-out with retries).
- **Twilio client instantiation**: three separate places construct a `twilio(...)` client and format outbound messages — `services/twilio/client.ts` (canonical, used by Inngest, logs to `MessageQueue`), `services/whatsapp.ts` (has hardcoded Indian phone-number normalization that the others don't), and an ad hoc inline client inside `services/reviews.ts`'s critical-review alert path.
- **Axios instance duplication**: `lib/api.ts` and `services/api.ts` are near-identical trivial client-side Axios wrappers.
- **Usage tracking duplication**: `SubscriptionUsage` (per business/month) and `UsageTracking` (per user/billing period) overlap conceptually; `featureGating.ts`'s `resolveUserLimits` reimplements the same override-merge logic that `planDefaults.ts`'s `resolveEffectiveLimits()` already provides, rather than calling it.
- **Auth guard near-duplication**: `requireClient()` and `requireSuperAdmin()` share almost identical DB-lookup/error-envelope logic; a shared `requireRole()` helper was never extracted.
- **Two "resolve current business" helpers** with different security postures — `requireBusinessContext()` (strict) vs `getActiveBusinessContext()` (loose, no re-verification when a cookie is present) — see §5.

**Mock/incomplete production paths:**
- `services/reviews.ts`'s `fetchGoogleReviews()` returns two hardcoded fake reviews — this is a legacy/demo module, not the real review sync (that's `reviews/syncReviews.ts` + `SerpApiGoogleProvider`).
- Inngest's `processPublishPostJob` (actual GBP post publishing) is currently a `[MOCK]` console.log, not a real Google Business Profile API call — **published posts are not actually reaching Google today.**
- `POST /api/reviews/[id]/post-reply` similarly mocks "posting" the reply (logs + 500ms delay) rather than calling a real API.
- `services/whatsapp/meta.ts` is an unwired stub (§12.4).
- `AIUsageLog.aiModel`'s enum lists OpenAI/Anthropic/Google model names that don't match the actual Groq model in use, making cost estimates in `aiCostEstimator.ts` approximate placeholders rather than accurate figures.

**Dev-mode residue still reachable in production code paths:** `GET /api/posts` and `GET /api/user/businesses` use the hardcoded `DEV_CONTEXT` object instead of a real session (§6.4) — these were very likely never migrated after an earlier "strip auth for dev speed" pass mentioned in the pre-existing docs.

---

## 20. Security Notes & Open Items

These are drawn directly from reading the route/guard code, not from the (sometimes stale) prior security docs. Treat this as a punch list, not an audit sign-off.

1. **Routes with no authentication/tenant-scoping found**: `GET /api/audit/[id]` (no ownership check on a document that may contain competitor/business data), `GET/PUT /api/leads` and `/api/leads/[id]` (fully unscoped — any caller can read/modify any lead), `POST /api/business` (creates a Business with no auth), `GET /api/business/active` (trusts the cookie with no session validation), `GET/POST /api/review-requests`, `POST /api/reviews/upload-customers`, `POST /api/reviews/request`, `POST /api/upload` (all unscoped), plus the two `DEV_CONTEXT`-stub routes noted above. **These should be reviewed before being exposed to untrusted traffic**, if they aren't already gated by something outside the route file (e.g. a reverse proxy) that this pass didn't inspect.
2. **No Twilio webhook signature verification** on `webhook/twilio`, `whatsapp/webhook`, or `twilio/voice` — anyone who discovers these URLs could POST forged webhook payloads (fake inbound messages, fake calls creating fake leads). Twilio's `X-Twilio-Signature` header validation is the standard mitigation and is currently absent.
3. **Super-admin login uses plain-text password comparison**, not `bcrypt.compare` — a currently-live gap explicitly flagged in the repo's own `SUPER_ADMIN_HANDOVER.md` as pre-production TODO (§6.5, §15).
4. **`apiKeyAuth.validateApiKey()` uses a non-constant-time `!==` comparison** for the shared API key — low risk given its use (internal automation callbacks) but not best practice; contrast with `services/auth/otp.ts`'s correct use of `crypto.timingSafeEqual`.
5. **Two JWT secrets in play** (`SESSION_SECRET` for the real login session via `jose`; `JWT_SECRET` for a separate `jsonwebtoken`-based mechanism in `services/auth/security.ts`) — confirm both are actually distinct, non-default values in every environment; a shared/default secret across both would be a meaningful escalation path.
6. **`GOOGLE_TOKEN_SECRET`** protects every connected business's Google OAuth refresh token via AES-256-GCM — rotating or losing this key would require re-authenticating every connected GBP account; ensure it's backed up/managed like any other root secret.
7. **OTP codes are logged to the console in development mode** (`services/email.ts`) — confirm this path is truly gated on `NODE_ENV !== 'production'` in every deployment target, not just local dev.
8. **`services/whatsapp.ts`'s phone-number normalization is hardcoded to Indian numbers** (`91XXXXXXXXXX`) — sending to non-Indian numbers through this specific code path would silently produce a malformed destination number. Only relevant if this file (rather than `twilio/client.ts`) is actually still on a live send path — see §19.

---

## 21. Prior Documentation Index

The repository already contains an extensive `documentation/` folder (~75 files, indexed at `documentation/MASTER-README.md`) plus a root `SUPER_ADMIN_HANDOVER.md`. This master document supersedes them as the single source of truth for current architecture, but the originals remain useful for historical context, deeper prose walkthroughs, and Mermaid workflow diagrams not reproduced here. Notable clusters:

- **Client-facing**: `documentation/client-docs/` (product overview, feature walkthrough, workflow demos, admin guide).
- **Module specs**: `documentation/modules/module-1-gmb-audit.md` through `module-9-review-generation.md`.
- **Technical deep-dives**: `documentation/technical-docs/` (system/frontend/backend architecture, AI system, queue & workers).
- **Database**: `documentation/database/` (schema + flow docs — cross-check against §7 above, which reflects the live schema).
- **Workflows (Mermaid diagrams)**: `documentation/workflows/*.md`.
- **Deployment/security**: `documentation/deployment/`, `documentation/security/`, `documentation/troubleshooting/`.
- **⚠ Superseded by this document**: `documentation/technical-docs/authentication-architecture.md` (describes a custom-JWT design that isn't what's live), and any doc asserting NextAuth.js is in use (it isn't — see §6) or that the Meta WhatsApp migration is complete (it isn't — see §12.4). Historical incident reports (`AUTH_DEBUG_REPORT.md`, `AUTH_SESSION_FIX_REPORT.md`, `TEMP_AUTH_REMOVAL_REPORT.md`, `MOCK_DATA_REMOVAL_REPORT.md`, `BUGS_AND_CONFLICTS_REPORT.md`) remain useful as a record of *how* the codebase got to its current state, even where their end-state descriptions have since been superseded again.

---

*This document was assembled by reading the live source tree directly (all 120 API routes, all 41 models, all `src/lib`/`src/services` business logic files) and cross-referencing the existing documentation suite, resolving contradictions in favor of source-code ground truth. If the codebase changes, this document will drift — treat it as a snapshot dated 2026-07-03, not a live-synced reference.*
