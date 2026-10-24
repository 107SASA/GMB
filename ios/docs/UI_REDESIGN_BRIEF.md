# GrowwMatics AI — Mobile App UI Redesign Brief

Paste this whole document (or the relevant sections) to a UI-design AI. It describes every screen in the current app — what it's for, what's on it, what data it shows, and what the user can do — plus the current design system, so the redesign has full context on both content and existing visual language.

**App:** GrowwMatics AI mobile — a companion app for local businesses to manage their Google Business Profile (GBP), reviews, leads/CRM, AI-generated content, and a WhatsApp AI agent.
**Stack:** Expo Router (file-based routing), React Native, NativeWind (Tailwind for RN).

---

## 1. Brand & Design Tokens (current state)

- **Identity:** "Trust Blue / Growth Green." Signature diagonal gradient `#00386c → #1a4f8b → #006c45` (deep blue → mid blue → green) used on primary CTAs, the logo mark, avatar initials, and upload buttons.
- **Color roles** (semantic, flip with light/dark mode):
  - `surface` / `surface-raised` (cards) / `surface-overlay` (elevated/pressed) / `surface-border` (hairlines)
  - `brand` / `brand-bright` (icons, active tints) / `brand-muted` (pressed/disabled)
  - `accent-{violet,cyan,emerald,amber,rose}` for status/semantic accents
  - Status tints: emerald = positive, amber = warning, rose = negative, indigo = info
- **Concrete colors — dark mode:** bg `#191c1e`, card `#24282c`, overlay `#303438`, border `#737781`, brand `#9bc2ff`, emerald `#80f6b8`, rose `#ffdad6`, text `#f7f9fb`.
- **Concrete colors — light mode:** bg `#f7f9fb`, card `#ffffff`, brand (deep trust blue) `#00386c`, emerald (growth green) `#006c45`, rose `#ba1a1a`.
- **Typography:** "Public Sans, Inter" primary stack. Screen titles: 28px extrabold, tight tracking. Section labels: 11px bold uppercase, wide tracking.
- **Radius:** heavy rounding — cards `12–24px` (`rounded-xl/2xl/3xl`), buttons/badges/chips/avatars fully pill-shaped.
- **Elevation:** flat/bordered cards (1px hairline `surface-border`), not drop shadows — this is the dominant depth cue in the current app.
- **Spacing:** `px-5` screen gutters, `px-4` card padding, `gap-2/3` between stacked cards, `mt-3` to `mt-8` for section rhythm.
- **Icons:** Ionicons only (outline default, filled when active), no custom icon set.
- **Haptics:** light impact on primary buttons, warning notification on destructive confirmations.

## 2. Navigation Structure

- **Bottom tab bar (4 tabs):** Home (dashboard) · GBP · Photos · All Contacts (leads — hidden if the leads module isn't in the plan).
- **"More" screen** acts as a sidebar/hub for everything not in the tab bar, grouped into: **Grow** (Audit Engine, Content Generator, Content Scheduler), **Customers** (Leads, WhatsApp AI Agent — super-admin only), **Account** (Settings, Billing, Profile), plus Log out.
- Each section (audit, billing, content, gbp, inbox, leads, photos, profile, reviews, scheduler, settings, whatsapp) is its own stack, several gated by plan entitlements (`LockedScreen`) or by role (`inbox`, `whatsapp` are super-admin only).
- **Locked/gated state** is a first-class full-screen pattern (`LockedScreen`), not just a disabled button — shown when a plan doesn't include a module.
- Modals are in-screen bottom sheets (not router routes): business switcher, post edit, date/time picker, WhatsApp cancel-appointment, CRM-capture consent, post-call prompt.

## 3. Shared Component Vocabulary (current design system)

These are reused across almost every screen — a redesign should decide, for each, whether to keep the pattern or replace it:

| Component | Role |
|---|---|
| `Screen` | Safe-area + background wrapper on every screen |
| `ScreenTitle` | 28px page heading |
| `AppHeader` | Branded header: avatar, business-switcher, notification bell, settings gear, help button (used on Dashboard/GBP/Leads/Photos) |
| Custom back-chevron header | Manual back + title row (used on ~half the stack screens) — a **third, inconsistent header pattern** alongside `AppHeader`/`ScreenTitle` |
| `Field` / `LabeledField` | Text input with focus glow |
| `PrimaryButton` | Gradient pill CTA, loading state, haptic tap — the app's single most recognizable affordance |
| `SecondaryButton` | Outlined pill, quiet variant |
| `Skeleton` | Pulsing placeholder — used for all loading states instead of spinners |
| `EmptyState` | Title + hint + optional action — used for every empty list and error state |
| `Badge` | Status pill, 5 tone variants |
| `Chip` | Filter/selection pill |
| `SegmentedControl` | Equal-width tab switcher (Content, WhatsApp) |
| `ProgressBar` | Brand→amber→rose ramp (audit completion %, billing usage, buffer health) |
| `InitialsAvatar` | Gradient circle with initials |
| `LockedScreen` / `BillingBanner` | Plan-gating states |
| `charts.tsx` (`WeeklyBars`, `ImpactBars`) | Hand-rolled bar charts, no chart library |
| `review-bits.tsx` (`Stars`, sentiment/reply badges) | Review-specific chrome |
| `SchedulerPanel` | Buffer health + post list, embedded in 2 places |
| `BusinessAssets` | Photo library grid, embedded in 2 places |
| `AiActionsCard` | "What the AI did" feed, on Dashboard + GBP Overview |

**Known inconsistencies worth fixing in redesign:** three different header patterns coexist; some screens (audit detail, leads detail, reviews detail) redefine local versions of `SectionLabel`/`Card`/`SecondaryButton` instead of using the shared ones; two unused leftover tab-icon PNG assets; a score/rank color-tier rule (≤5 green/≤10 amber/>10 rose, or ≥70/≥40/<40) is duplicated across 4 files instead of being one shared utility.

## 4. Screens With the Most Redesign Surface Area

Flag these as priority — they contain nearly every UI pattern in the app and are the most data-dense:
- **`/audit/[id]`** — the flagship report screen: score hero, stat tiles, rank tables, geo-grid maps, competitor cards, checklists, strengths/weaknesses, 30/90-day plans.
- **`/gbp`** — a 6-tab hub (Overview, Performance, Posts, Reviews, Photos, Profile) that's effectively 6 screens behind one route; heavy on stat tiles, tables, and charts.

---

## 5. Full Screen-by-Screen Catalog

### Auth

**Login** (`/login`)
Centered layout: gradient app-icon badge, title + tagline, email/password fields, gradient "Sign in" button, "Forgot password?" link, footer note. No signup — accounts are web-managed.

**Forgot password** (`/forgot-password`)
3-step flow in one screen: (1) email → send code, (2) 6-digit OTP → verify, with resend-cooldown timer, (3) new/confirm password with live validation, (4) success state with checkmark.

### Home

**Dashboard** (`/dashboard`)
Daily action-center. Sections: branded header; billing banner; "This Week's Reviews" full-bleed color card (dark green if goal met / dark red if not) with big number, flame emoji, progress bar, "days since last review" warning, and a 3-step funnel strip (More Customers → More Reviews → Better Ranking); "Add Customer" card (phone input + import-from-contacts + gradient button); "Complete Your Onboarding Tasks" card (upload-photos CTA); AI Actions feed. Sticky bottom banner nudging photo uploads if stale.

**Notifications** (`/notifications`)
List of notification rows (type icon, title, 2-line body, unread dot, relative time, "mark all read"). Tapping deep-links into the relevant screen.

**More** (`/more`)
Sidebar-style hub: profile row, business switcher, grouped menu (Grow / Customers / Account) with icon chips and lock icons for gated modules, log-out button.

### Audit Engine

**Audit list** (`/audit`) — cards with a color-coded circular score ring, business name, time, status badge; "Run audit" button top-right.

**Run audit** (`/audit/run`) — form: business summary, category + city override fields, "Start audit" button. Shows a "connect Google first" empty state if not connected.

**Audit report** (`/audit/[id]`) — the app's most complex screen. Pending state (spinner, auto-polling, timeout/retry). Completed state: score hero circle, star rating, 4 hero stat tiles, executive summary, keyword rank table (color-coded), geo-grid rank map images, competitor cards, profile-completion checklist with progress bar, SEO opportunity pills + tips, review analysis, strengths/weaknesses cards (impact/effort/gain badges), quick wins, priority fixes, 30-day and 90-day plan cards. Share button (native share sheet).

### Billing

**Billing** (`/billing`) — plan card (name, status badge, trial/renewal dates, enabled modules, "view plans on web", cancel button); "This month's usage" — 4 progress-bar rows (AI generations, audits, posts, WhatsApp messages).

### Content Generator

**Content** (`/content`) — segmented Generate/History.
- *Generate:* topic field, tone chips, keyword chips, content-type multi-select chips, "Generate" button (30–60s hint), result cards (thumbnail + title/body/hashtags/CTA), "Auto-schedule all", SEO description card, FAQ cards.
- *History:* infinite-scroll post cards (status badge, preview, scheduled date, schedule/edit/delete actions), edit bottom-sheet modal.

### Google Business Profile Hub

**GBP** (`/gbp`) — 6 horizontally-scrolling sub-tabs in one screen:
- **Overview** — before/after impact split card (views/calls/directions bars vs. "optimization in progress" placeholder) + AI Actions feed.
- **Performance** — 3 stat cards, "Latest Google Rank" card, keyword rank table (expandable), rank-by-location geo circle, competitor table (your row highlighted), 8-week review-trend bar chart with rating/count trend badge.
- **Posts** — upcoming-posts count + "Generate Posts" button, post cards, embedded full Scheduler panel, edit modal.
- **Reviews** — review-trend chart + filterable (by star rating) review list.
- **Photos** — the shared Business Assets photo grid.
- **Profile** — read-only Google-verified info + editable business-info form; connect-Google empty state; paused-writes banner.

### Inbox (WhatsApp conversations — super admin only)

**Thread list** (`/inbox`) — rows: avatar, name, time, AI-sparkle indicator, last-message preview, unread badge.

**Thread** (`/inbox/[leadId]`) — chat bubbles (outbound brand-filled right, inbound surface-raised left), AI-agent on/off switch in header, composer with send button.

### Leads / All Contacts

**Leads list** (`/leads`) — branded header, capture-action chip row (Add / Log a call / From contacts / Recent calls), search, pipeline-stage filter chips, lead cards (AI lead-score badge, source badge, stage badge).

**Lead detail** (`/leads/[id]`) — custom header with score badge; 4 square contact-action buttons (Call/WhatsApp/Email/Inbox); pipeline-stage chip selector; details/AI-insights card; notes field; post-call "how did it go" bottom sheet; activity timeline (type-coded icon rows).

**Add lead / log call** (`/leads/add`) — clipboard-paste phone chip, phone/name/note fields, gradient submit.

**Import contacts** (`/leads/import-contacts`) — consent + permission gates, search, checkbox list, sticky "Import N contacts" button, success banner.

**Recent calls** (`/leads/recent-calls`) — placeholder "coming soon" screen.

### Photos

**Photos** (`/photos`) — branded header + the Business Assets grid (category-labeled photos, gradient upload button, Smart Tips cards).

### Profile

**Profile** (`/profile`) — identity card (avatar, name, email, verified check, plan badge, member-since); edit-profile form; change-password form.

### Reviews

**Reviews list** (`/reviews`) — header with sync button, filter chips (All/Needs reply/Replied), review cards (stars, sentiment badge, reply-status badge, preview).

**Review detail** (`/reviews/[id]`) — full review card; posted-reply card (if replied); AI-suggested-reply workflow (generate → approve → post, with regenerate/reject).

### Scheduler

**Scheduler** (`/scheduler`) — header with "Generate" button; buffer-health progress card; upcoming-posts list (publish now/reschedule/delete); unscheduled-drafts list.

### Settings

**Settings** (`/settings`) — business-profile form (name, category, description, phone, website, address, WhatsApp number, keyword chips); notification-preference switches; Google connect/disconnect row.

### WhatsApp AI Agent (super admin only)

**WhatsApp** (`/whatsapp`) — segmented AI Settings / Booking / Appointments.
- *AI Settings:* enable switch, personality chips, tone chips, max-length field, system-prompt + sales-rules text areas.
- *Booking:* enable switch, 7 working-day switches, open/close time fields, slot-duration field.
- *Appointments:* status filter chips, appointment cards with cancel action + confirm modal.

---

## 6. Things to Decide Explicitly in the Redesign

1. Keep the flat/bordered-card look, or move to elevation/shadows?
2. Keep the gradient-pill primary button as the brand signature, or evolve it?
3. Unify the 3 competing header patterns into one.
4. Formalize the score/rank 3-tier color logic as a single reusable token/component.
5. Decide the fate of emoji-as-accent (🔥 ✨ 💡) — keep as personality, convert to icons, or drop.
6. Keep hand-rolled charts or adopt a chart library — relevant mainly for Audit report + GBP Performance/Reviews.
7. Treat `LockedScreen` (plan-gating) as a designed state, not an afterthought.
