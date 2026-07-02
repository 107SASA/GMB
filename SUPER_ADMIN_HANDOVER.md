# GMBBoost — Super Admin Feature: Handover Document

**Date:** 2026-05-29  
**Branch/Context:** Added on top of `integration-branch`  
**Status:** ✅ Implementation complete — ready for testing

---

## 1. Overview

A fully self-contained Super Admin panel has been added to the existing GMBBoost SaaS project. It is completely isolated from the regular user dashboard — separate routes, separate session cookie, separate API namespace. **Zero changes were made to existing user flows or APIs.**

---

## 2. What Was Implemented

### 2.1 Super Admin Role
- Added `super_admin` to the `role` enum in `User` model (interface + schema)
- Existing users are unaffected — default role remains `BusinessOwner`

### 2.2 Authentication & Session
- Dedicated login page at `/admin/login`
- Dedicated logout (DELETE `/api/admin/auth`)
- Session stored in a **separate** `httpOnly` cookie: `superAdminUserId`
- Does not touch the existing `activeBusinessId` cookie used by the regular dashboard
- A reusable `requireSuperAdmin()` helper validates every admin API call

### 2.3 Super Admin Dashboard (`/admin/dashboard`)
Real data shown — no mocks:
- Total users (excluding super_admin accounts)
- Total businesses
- Total content generated (from `ContentGenerationLog`)
- New users in the last 7 days
- New businesses in the last 7 days
- Recent signups table (latest 10 users)

### 2.4 Businesses Management Page (`/admin/businesses`)
- Full list of all businesses across the platform
- **Search** by name, category, city, address
- **Filter** by: All / Google Connected / WhatsApp Active / Fully Onboarded
- **Per-business data:** name, category, location, owner (name + email + plan), phone, website, integration statuses, content generated count, joined date
- **Pagination** (20 per page, with smart ellipsis page selector)
- Refresh button

### 2.5 Admin Layout & Navigation
- Admin-specific sidebar (`AdminSidebar`) styled consistently with the existing `Sidebar`
- Admin layout (`/admin/layout.tsx`) mirrors the structure of `/dashboard/layout.tsx`
- Purple (`violet-600`) accent to distinguish admin from user UI

---

## 3. Files Changed

### Modified
| File | Change |
|------|--------|
| `src/models/User.ts` | Added `super_admin` to `role` enum in TypeScript interface and Mongoose schema |

### Created
| File | Purpose |
|------|---------|
| `src/lib/superAdminAuth.ts` | Reusable middleware — validates `superAdminUserId` cookie and confirms `super_admin` role |
| `src/app/api/admin/auth/route.ts` | `POST` = login, `DELETE` = logout |
| `src/app/api/admin/stats/route.ts` | Real platform-wide stats for the dashboard |
| `src/app/api/admin/businesses/route.ts` | Businesses list with search, filter, pagination |
| `src/app/admin/page.tsx` | Root redirect: session → dashboard, no session → login |
| `src/app/admin/login/page.tsx` | Admin login UI |
| `src/app/admin/layout.tsx` | Admin section shell (sidebar + main content) |
| `src/app/admin/dashboard/page.tsx` | Admin dashboard with real stats |
| `src/app/admin/businesses/page.tsx` | Businesses management page |
| `src/components/admin/AdminSidebar.tsx` | Admin-specific sidebar component |
| `scripts/create-super-admin.js` | One-time Node.js seed script to create the first super_admin user |

### Not Modified (intentionally preserved)
- All existing dashboard pages, components, API routes
- Auth flow, `BusinessContext`, cookies used by regular users
- `Sidebar.tsx`, `DashboardHeader.tsx`, `DashboardLayout`
- All models except the single enum extension in `User.ts`

---

## 4. Database Changes

**Only one change required:**  
Add `super_admin` as a valid value for the `role` field on the `users` collection.

The Mongoose schema change is backward-compatible — existing documents with roles `Admin`, `BusinessOwner`, or `TeamMember` are unaffected. No migration needed.

---

## 5. How to Create the First Super Admin User

### Option A — Run the seed script (recommended)

```bash
# 1. Edit the credentials at the top of the script
nano scripts/create-super-admin.js

# 2. Run against your database
MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/gmb-ai" \
  node scripts/create-super-admin.js
```

The script will:
- Create a new user with `role: 'super_admin'`
- If the email already exists, it upgrades that user to `super_admin`
- Print confirmation with ID and login URL

### Option B — MongoDB Shell / Compass

```js
db.users.insertOne({
  fullName: "Super Admin",
  email: "superadmin@yourdomain.com",
  phone: "+910000000001",
  passwordHash: "YourSecurePassword",
  role: "super_admin",
  isEmailVerified: true,
  onboardingCompleted: true,
  subscriptionPlan: "Enterprise",
  failedOtpAttempts: 0,
  failedLoginAttempts: 0,
  businessIds: [],
  createdAt: new Date(),
  updatedAt: new Date()
})
```

### Option C — Upgrade an existing user

```js
db.users.updateOne(
  { email: "youruser@example.com" },
  { $set: { role: "super_admin" } }
)
```

---

## 6. Accessing the Admin Panel

| URL | Description |
|-----|-------------|
| `/admin/login` | Admin login page |
| `/admin/dashboard` | Platform stats dashboard |
| `/admin/businesses` | Businesses management |
| `/admin` | Auto-redirects based on session |

---

## 7. Security Notes

- The `superAdminUserId` cookie is `httpOnly: true` — not accessible from JavaScript
- Cookie is `secure: true` in production (`NODE_ENV === 'production'`)
- Cookie expires after **8 hours**
- All admin API routes (`/api/admin/*`) call `requireSuperAdmin()` first — a missing or invalid cookie returns `401`; a non-`super_admin` role returns `403`
- The admin login endpoint returns a generic `"Invalid credentials"` error for both wrong email and wrong password (no user enumeration)

### ⚠️ Production: Replace Plain-Text Password Check
The current login uses `user.passwordHash !== password` (plain text) which is consistent with the existing dev-mode auth pattern in the project. Before going to production, replace this with:

```ts
import bcrypt from 'bcryptjs';
const valid = await bcrypt.compare(password, user.passwordHash);
if (!valid) { ... }
```

And hash the password when creating the admin user:
```js
const bcrypt = require('bcryptjs');
passwordHash: await bcrypt.hash('YourPassword', 12)
```

---

## 8. Planned (Not Yet Implemented — future sessions)

Per the task specification, the following were explicitly excluded and will be added later:
- Revenue analytics
- AI usage analytics
- Automations monitoring
- Advanced charts
- Subscription analytics
- System health monitoring

---

## 9. Testing Checklist

- [ ] Run `scripts/create-super-admin.js` with your MongoDB URI
- [ ] Visit `/admin/login` — log in with created credentials
- [ ] Verify redirect to `/admin/dashboard`
- [ ] Confirm stats show real numbers (or zeros if DB is empty)
- [ ] Visit `/admin/businesses` — confirm list loads
- [ ] Test search by business name
- [ ] Test filters (Google Connected, WhatsApp Active, etc.)
- [ ] Test pagination if > 20 businesses
- [ ] Click Logout — confirm redirect to `/admin/login`
- [ ] Manually visit `/admin/dashboard` without a session — confirm redirect to login
- [ ] Confirm regular users can still log in at `/login` and access `/dashboard` normally

---

## PHASE 2 — AI Usage Analytics & Subscription Management

**Date:** 2026-05-29  
**Status:** ✅ Complete

---

### New Pages Added

| Route | Description |
|-------|-------------|
| `/admin/ai-usage` | AI Usage Analytics with daily chart, top users, prompt breakdown |
| `/admin/subscriptions` | Subscription Management with filters, usage bars, module visibility |

### New Files Created

| File | Purpose |
|------|---------|
| `src/models/AIUsageLog.ts` | New model — tracks per-request AI usage (tokens, cost, model, status) |
| `src/lib/aiCostEstimator.ts` | Utility to estimate USD cost from token counts per model |
| `src/app/api/admin/ai-usage/route.ts` | AI usage analytics API — overview, daily stats, top users, prompt breakdown |
| `src/app/api/admin/subscriptions/route.ts` | Subscriptions API — enriched with User + UsageTracking data |
| `src/app/admin/ai-usage/page.tsx` | AI Usage Analytics page |
| `src/app/admin/subscriptions/page.tsx` | Subscriptions Management page |

### Modified Files

| File | Change |
|------|--------|
| `src/components/admin/AdminSidebar.tsx` | Added AI Usage and Subscriptions nav links |

---

### Database Changes

**New collection: `aiusagelogs`**  
Schema: `userId`, `businessId`, `promptType`, `aiModel`, `tokensUsed`, `promptTokens`, `completionTokens`, `estimatedCost`, `status`, `errorMessage`, `durationMs`, `createdAt`

Indexes: `createdAt`, `userId+createdAt`, `status+createdAt`, `promptType+createdAt`

**Existing collections used (read-only from admin):**
- `subscriptions` — plan type, billing status, trial status, modules
- `usagetrackings` — AI generation credits used vs limits
- `contentgenerationlogs` — legacy content count

No changes to existing schemas.

---

### AI Usage Tracking Architecture

When to log: Call `AIUsageLog.create({...})` inside any service that calls an AI API.

```typescript
import AIUsageLog from '@/models/AIUsageLog';
import { estimateAICost } from '@/lib/aiCostEstimator';

// After any AI API call succeeds or fails:
await AIUsageLog.create({
  userId:           currentUser._id,
  businessId:       business._id,
  promptType:       'content_generation',   // or 'review_reply', 'lead_response', etc.
  aiModel:          'gpt-4o-mini',
  tokensUsed:       response.usage.total_tokens,
  promptTokens:     response.usage.prompt_tokens,
  completionTokens: response.usage.completion_tokens,
  estimatedCost:    estimateAICost('gpt-4o-mini', promptTokens, completionTokens),
  status:           'success',              // or 'failed'
  durationMs:       Date.now() - startTime,
});
```

Until you add this logging to your AI service calls, the AI Usage page will show zeros but will not error. The `ContentGenerationLog` count is used as a fallback total.

---

### Subscription Management Logic

- Reads from `Subscription` model (already exists) joined with `User` and `UsageTracking`
- Filters: plan (Free/Pro/Enterprise), billing status (Active/Trialing/PastDue/Canceled), search by name/email
- Shows enabled modules per subscription
- Shows AI generation usage bar (used vs limit from UsageTracking)
- Pagination: 20 per page

---

### Future Scalability Suggestions

1. **AI cost alerting** — add a threshold field to `AIUsageLog` aggregation; trigger email when daily cost exceeds limit
2. **Subscription plan change log** — add a `SubscriptionHistory` model to track upgrades/downgrades over time
3. **AI usage by business** — extend the `/api/admin/ai-usage` route with a `?groupBy=business` param
4. **Export to CSV** — add `?format=csv` support to the subscriptions and AI usage APIs
5. **Webhook-based billing sync** — when Stripe webhooks arrive, update `billingStatus` in real time
