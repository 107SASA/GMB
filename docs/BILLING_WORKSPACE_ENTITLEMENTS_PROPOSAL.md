# Workspace-level entitlements — current behaviour and proposal

Status: **proposal for review — nothing here is implemented.** No route, guard
or record changes until a separately reviewed implementation plan is approved.

## 1. Current behaviour

Billing state lives in two places:

| Record | Scope | Holds | Read by |
|---|---|---|---|
| `Business` billing fields (`subscriptionStatus`, trial, grace, hold) | **one workspace** | `trialing`, `trial_active`, `active`, `past_due`, `canceled` | dashboard gate (`isWorkspaceUnlocked` → proxy, `/api/billing/status`, `WorkspaceLockGate`), automations (`workspaceHasPlanAccess` / `planAccessWorkspaceFilter`), audit route |
| `Subscription` (one per **user**) + `User.subscriptionPlan` | **the user, across all their workspaces** | `billingStatus`, `modules`, trial, grace, hold | `requireModule()` → every module API (web and mobile), usage limits (`checkUsageLimit`, `/api/user/usage`), mobile entitlements (`/api/auth/me`) |

Consequence: when an owner pays for (or trials) **workspace A**, the
user-level `Subscription` gets every module. Their unpaid **workspace B**:

- is **locked in the dashboard** (pages blurred) and gets **no automations**
  (content/audit autopilot, digests) — those are per workspace;
- but its **module APIs answer** (CRM, inbox, reviews, content, campaigns),
  because `requireModule(userId, …)` only looks at the user. A direct API
  call, or the mobile app (whose tabs follow the user-level block), can use
  B's paid modules.

This is **not cross-tenant**: `requireBusinessContext` still requires the
caller to own (or share an organization with) the workspace. It is "one
payment opens the owner's other workspaces' module APIs". It has been true for
paid customers since per-workspace billing (2026-07-23); the free trial
inherits it.

### Affected routes — 43, all `requireModule(ctx.userId, …)`

- **sales_agent (15):** crm/calls, crm/calls/[id], crm/growth-report, crm/leads, crm/leads/[id], crm/leads/[id]/activity, crm/leads/[id]/timeline, crm/roi, crm/roi/investment, followups, followups/[id], inbox/messages, inbox/threads, leads/bulk-import, leads/quick-add
- **reputation_agent (6):** reviews, reviews/[id]/approve-reply, reviews/[id]/post-reply, reviews/[id]/reject-reply, reviews/generate-reply, reviews/reply-settings
- **content_studio (12):** content/auto-schedule, content/faqs, content/generate, content/posts, content/posts/images, content/schedule, content/schedule/batch, scheduler/buffer, scheduler/generate, scheduler/posts/[id], scheduler/publish, scheduler/schedule
- **marketing_automation (8):** campaigns, campaigns/[id], campaigns/[id]/cancel, campaigns/[id]/launch, campaigns/[id]/pause, campaigns/generate-message, campaigns/import, campaigns/send
- **google_ranking_agent (2, always free):** gbp/insights, gbp/keyword-intelligence
- **Also user-level today:** usage limits (`lib/featureGating.ts`, `/api/user/usage`) and mobile tab locks (`mobile/src/entitlements`).

## 2. Proposed design

### 2.1 Guard

```ts
// lib/workspaceModuleGate.ts (proposed)
requireWorkspaceModule(ctx: BusinessContext, module: ModuleKey)
```

1. `SUPER_ADMIN` → allowed (as today).
2. Always-free module → allowed.
3. Load the workspace's billing fields (`PLAN_ACCESS_FIELDS`) — `ctx` already
   carries the verified `businessId` from `requireBusinessContext`, so tenant
   isolation is unchanged.
4. Decide with the rules that already exist in `lib/billing/entitlements.ts`
   (`workspaceAccessState` + the per-module rule now in `userCanUseModule`):
   paid / authorized trial / grace → allowed; restricted → its frozen list;
   held → paid modules locked; never paid / cancelled → locked.
5. **Legacy fallback (compatibility):** a workspace created before 2026-07-23
   with no own billing state keeps today's user-level answer — exactly the
   fallback `isWorkspaceUnlocked` already applies — so no pre-billing paying
   customer loses access.

The 43 call sites change mechanically:
`requireModule(ctx.userId, m)` → `requireWorkspaceModule(ctx, m)`.

### 2.2 Usage limits

The limits plan comes from the workspace (`limitsPlanFor` fed workspace state
instead of the user record). `SubscriptionUsage` is already keyed by
`businessId`; AI-generation counts are per user today (decision below).

### 2.3 Mobile

The app reads entitlements for its active workspace (`x-business-id`) from
`/api/billing/status` (already per workspace) instead of the user block on
`/api/auth/me`. Older app builds keep showing the user-level view; the server
remains the enforcer.

### 2.4 Free trial rule

Unchanged and strengthened: `TrialClaim` still allows one trial per verified
phone and one workspace (`holderBusinessId` unique). With workspace-level
gating a second workspace can never ride on the first one's trial or payment.

## 3. Migration and compatibility

- **No data migration.** Workspace billing state already exists for every
  workspace created since 2026-07-23; older ones use the legacy fallback.
- **No entitlement ownership moves** — the user-level `Subscription` stays
  (mobile, usage history, admin views) until a later clean-up.
- Feature flag `WORKSPACE_ENTITLEMENTS` = `off` | `shadow` | `on`.

## 4. Rollout

1. **Shadow (1–2 weeks):** every module call computes both answers, serves the
   user-level one, and logs each disagreement (user, workspace, module, both
   answers, legacy-fallback used?).
2. **Review the log:** it is the exact list of owners who would lose API
   access to an unpaid second workspace, and of any case where the new guard
   would *grant* something the old one refused (must be zero).
3. **Customer decision** for those owners (grandfather / message / nothing).
4. **On**, per environment, with the shadow comparison kept logging.

## 5. Rollback

Flip the flag back to `off` (or `shadow`): no data was changed, so the old
behaviour returns instantly. No deploy needed if the flag is read at runtime.

## 6. Test matrix (before switching on)

| Workspace A | Workspace B (same owner) | Module call on B | Expected (on) |
|---|---|---|---|
| paid | never paid | paid module | **403** (today: 200) |
| paid | paid | paid module | 200 |
| authorized trial | never paid | paid module | **403** |
| paid | past due, in grace | paid module | 200 |
| paid | past due, restricted (list) | restricted / unrestricted module | 403 / 200 |
| paid | held | paid module | 403 |
| any | any | always-free module | 200 |
| legacy (pre-2026-07-23, user plan Pro) | — | paid module on A | 200 (fallback) |
| — | another owner's workspace | any | 403 (tenant isolation, unchanged) |
| super admin | any | any | 200 |

Plus: web and mobile (cookie / bearer + `x-business-id`) for every row, usage
limits per workspace, shadow-log contents, flag rollback.

## 7. Decisions needed from you

1. **Policy:** should a payment for one workspace keep opening the module APIs
   of the owner's other workspaces (today), or must each workspace pay
   (proposal)?
2. **Existing multi-workspace customers:** grandfather them, notify them, or
   apply the rule from the switch-on date? (The shadow log will list them.)
3. **AI-generation limit:** per user (today) or per workspace?
4. **Mobile:** require an app update before switching on, or accept that older
   builds show tabs the server will refuse?
5. **Rollout:** approve the shadow → review → on sequence and its duration.
