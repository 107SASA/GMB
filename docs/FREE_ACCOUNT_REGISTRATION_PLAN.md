# Free Account & Registration — Plan

**Status:** IN PROGRESS (13 Nov 2026)
- ✅ Free CRM tier (200 active leads, 50 scans/month, super admin) — any unpaid workspace
- ✅ Phase 1 — server: sign-up OTP + `/api/auth/signup`, one registration service, website free report logs existing accounts in, in-app report (`/api/app/free-report`), report app mode, WhatsApp reply for free accounts, Admin → Settings switches, rate limits
- ✅ Phase 2 — both apps: "Create free account" (name → business → WhatsApp code), free report card on locked tabs (pick listing in app), "report ready" push
- ✅ Phase 3 — website `/signup` (login + Pricing link to it), daily free-account sync with "needs a call" reasons on Admin → Leads (+ filter, funnel strip), 90-day shadow clean-up (dry run unless `SHADOW_CLEANUP_MODE=live`)
- ⏳ Phase 4 — store paperwork + builds
**Goal:** anyone can download the app and use the CRM + visiting-card scan for free. More downloads → more verified leads → more GBP (Pro) sales.

---

## 1. What we are building (one line)

**One registration flow, three doors, one free account.** Every door creates the same OTP-verified **Free account**: CRM and card scan open, Google-profile tools locked. Paying for Pro upgrades the same account.

```
Door 1 – App: "Create free account"        ┐
Door 2 – Website: "Create free account"    ├─→ one registration ─→ Free account
Door 3 – Website: free GBP report          ┘      (CRM + card scan)
                                                   + free GBP report if a Google listing was picked
```

---

## 2. How accounts are created today (before this plan)

| Way in | Needs | Result |
|---|---|---|
| Website free report (`/free-report`) | Pick listing + WhatsApp OTP (OTP added 12 Nov, commit `3c6ffdc`) | Verified "shadow" account; dashboard **locked** |
| WhatsApp report agent | Message us, connect/pick listing | Shadow account; locked |
| Website sign-up (Pricing → Get started → `/onboarding`) | Name, email, business, phone + OTP | Normal account, **locked until payment** |
| Admin invites / Growth partners | Invite / application | Team or partner accounts (not customers) |
| **Mobile app** | — | **No sign-up — sign-in only** |

Problems:
- No door gives a usable free account. Every unpaid workspace is fully locked (web: subscribe page; app: "workspace inactive").
- After the correct OTP, the free report still answers *"An account already exists for this phone number. Please log in"* for a number that has a real or paid account — the route doesn't tell the account step the phone is verified (`provisionShadowAccount` without `phoneVerified: true`).
- Old shadow accounts created before 12 Nov were never OTP-verified and are never cleaned up.

---

## 3. User journey — mobile app

### 3.1 Sign-up
Login screen → **Create free account** (below the sign-in form):

1. **Your name**
2. **Your business** — search Google and pick the listing (existing Places search), **or** "Skip — I'm not on Google / do it later" → type business name, category, city.
3. **Mobile number** → WhatsApp OTP.
   - Checkbox (checked by default, editable wording): *"Send me my report and updates on WhatsApp."*
4. ✅ Account created → app opens on the **CRM** tab.

Existing number:
- Has an account → the OTP simply **logs them in** (no duplicate).
- Has an old unclaimed shadow account (earlier website report) → **take over that account** (keep its business and report) and turn it into a Free account.

### 3.2 Inside the app
All tabs are visible.

| Tab | Free account |
|---|---|
| CRM (leads, follow-ups, call log, contacts import) | ✅ open |
| Scan visiting card | ✅ open |
| Home, Performance, Posts, Reviews | 🔒 lock screen |

### 3.3 Lock screen (new content)

| Situation | Shows |
|---|---|
| Listing picked, report being made | "Your free Google profile report is being prepared…" |
| Report ready | Score + top 3 problems + **View full report** |
| No listing yet | **Get your free Google profile report** → pick listing **inside the app** → report made in the background → push "Your report is ready" |
| Always | **Chat with us on WhatsApp** |

- "View full report" opens the report page in **app mode**: same report, **no prices, no Subscribe / Book demo buttons** (App Store / Play rules).
- The free report is generated **inside the app** (user is already verified and logged in). No WhatsApp → website round trip.

### 3.4 Unlocking (no buying inside the app)
1. Lock screen → **Chat with us on WhatsApp** (neutral prefilled message, like today's "workspace inactive" button).
2. New automatic WhatsApp reply for Free accounts (draft — team to finalise):
   > "Your free CRM is active ✅. Your Google profile report: [link]. To unlock posts, reviews and Google profile tools, see the plans here: [pricing link] — or reply and our team will call you."
3. Sales is notified ("free user asked about unlocking") → lead goes to **Needs a call**.
4. Payment on the website (Razorpay) → the app **unlocks automatically**, same account, no data moved.

Today's reply ("Please complete your payment…") stays for accounts that started checkout and didn't pay.

---

## 4. User journey — website

### 4.1 Free report (Door 3)
Pick listing → phone → WhatsApp OTP, then:

| Who | After the correct code |
|---|---|
| New person | Free account created + report generated (as today, but the account is a Free account — CRM usable) |
| Existing Pro customer | **Logged in → their dashboard.** No new report (they get monthly reports). |
| Existing Free account | Logged in → their dashboard (their report was made at sign-up / in the app) |
| Old shadow account | Report reused/updated, account becomes a Free account |

Replaces the "An account already exists… please log in" error with an automatic login. The OTP proves the number is theirs — same proof as the login page.

### 4.2 Website sign-up (Door 2)
Pricing → Get started becomes **Create free account → then the upgrade/checkout page.** Someone who doesn't pay still becomes a Free user and a sales lead. *(Decision D6.)*

### 4.3 Free account on the website
The same Free account can sign in on the website and use the CRM there; GBP pages show the website's normal upgrade page (the website may show prices). *(Decision D1.)*

---

## 5. Super admin settings

New **Free plan** section (Admin):

| Setting | Default |
|---|---|
| Free sign-up enabled | On |
| Max **active leads** | **200** |
| Visiting-card scans per month | **50** |
| Auto-generate free GBP report at sign-up | On |
| Send report on WhatsApp after sign-up | On |

Per customer (existing Admin → Customers → Usage limits): **Max active leads** is added next to the existing "Visiting Card Scans / Month", so support can give a good prospect more for free.

**Active lead** = any lead not Won or Lost. Winning/losing a lead frees a slot.

---

## 6. Limits — behaviour

- **Over the lead cap:** new leads refused everywhere (Add lead, card scan, contacts import, CSV) with a neutral message: *"You have 200 active leads. Mark some as Won or Lost to add more."* Existing leads are never touched.
  - Checked **before** the AI reads a card → a refused card costs nothing.
  - Cards waiting on the phone go to "Couldn't add" with that message; they can be retried later.
- **Over the scan cap:** *"You've used 50 of 50 card scans this month. Resets on 1 Dec."* Typing a lead by hand still works.
- In the app (iOS **and** Android): **no buy / upgrade / pricing buttons or links.** Counters only ("38 of 200 leads", "12 of 50 scans left").

---

## 7. Sales side

- Every Free sign-up → a prospect in the **Admin CRM**, source **"App sign-up"** / "Website sign-up" / "Free report": business, city, category, Google listing, report score, scans used, last active.
- Automatic **Needs a call** signals:
  - low report score (good GBP prospect)
  - asked to unlock on WhatsApp
  - 40+ of 50 scans used, or near 200 leads
  - active 3 days in a row
- Funnel numbers in admin: downloads → sign-ups → reports → calls → Pro.

---

## 8. Old shadow accounts

- Accounts created before 12 Nov had no OTP. Keep them; when the number verifies by OTP (app or website), the account becomes a normal Free account.
- **Clean-up job:** shadow accounts with no OTP, no payment and no login for **90 days** are deleted. The admin-CRM lead and a copy of the report are kept for sales. Uses the existing account-purge machinery (`services/account/purgePlan.ts`).

---

## 9. App Store / Play Store

| Rule | Status |
|---|---|
| Account creation in app → account deletion in app (Apple 5.1.1(v), Google) | Exists (Android in-app; iOS links to the website deletion page). Re-check before submission. |
| Sign in with Apple (4.8) | Not needed — login is phone + WhatsApp OTP only, no Google/Facebook login |
| Selling inside the app needs Apple IAP / Google Play Billing | We sell **nothing** in the app. All selling happens on WhatsApp and the website (allowed: contacting users outside the app). |
| No in-app steering to outside payment (outside the US) | Lock screens and limit messages stay neutral; no pricing links in the app. The pricing link is only in the WhatsApp reply. |
| Privacy | Update privacy policy + store data forms: phone, name, business, **contacts and people's details from scanned cards**, photos, camera |
| App Review | Demo account that can sign in without WhatsApp; review notes: the app sells nothing, plans are sold by our team / website |

A future ₹99 "CRM Plus" plan **inside** the app would need Apple IAP + Google Play Billing (~15% fee) — out of scope here.

---

## 10. Cost per Free user

| Item | Per month |
|---|---|
| AI card reading | ~₹0.10/card → max ~₹5 at 50 scans (realistic ~₹1.5 at ~15 scans) |
| Card photo storage (DO Spaces) | ~₹0 (covered by the $5 plan up to 250 GB) |
| Database (200 leads + history) | ~₹0 now; ~₹0.3–0.5/user at thousands of users |
| Follow-up reminders | ₹0 (in-app + push, not WhatsApp) |
| WhatsApp OTP | ~₹0.5–1, once per phone |
| Free GBP report (Places / SERP / AI calls) | **To measure** — the report already runs for website visitors; see `services/audit/costModel.ts` |

Rough total (CRM + scans): ~₹5–6 per heavy user per month; 1,000 free users ≈ ₹1,700–6,000/month.

---

## 11. Build plan

### Phase 1 — Server (~4–5 days)
1. **Free plan workspace state.** A separate flag/plan ("Free") that unlocks only the CRM module (`sales_agent`) and card scan; all other modules stay locked. Existing trial/billing rules untouched.
2. **Free plan settings**: new PlanConfig row; `maxActiveLeads` (new) + `maxCardScansPerMonth` (exists); per-customer override for `maxActiveLeads`; admin UI.
3. **Lead cap** in the shared lead-creation step (`createOrUpdateCustomerLead`) so every path is covered; checked before the AI call in card scan.
4. **One registration service** used by all doors: create user + organization + business + Free plan + admin-CRM prospect; take over an existing shadow account; log in an existing account. OTP request gets a "sign-up" mode (today it answers "no account" for unknown numbers).
5. **Free report**: after the correct OTP, existing account → log in → dashboard; new person → Free account + report.
6. **In-app report**: start the report for the signed-in workspace; report page "app mode" without prices/buttons.
7. **WhatsApp**: new auto-reply for Free accounts + sales notification.
8. **Abuse protection**: OTP rate limits (number, device, IP); one free workspace per phone.

### Phase 2 — Both apps (~4–5 days)
1. Login screen → **Create free account**; 3 sign-up steps (name, business search/skip, phone + OTP).
2. All tabs visible; CRM + scan open; lock screens with report status / report card / "get your free report" / WhatsApp button.
3. Pick-listing-in-app flow + "report ready" push.
4. Limit messages and counters (leads left, scans left, resets on).
5. Replace the full-app "workspace inactive" screen for Free accounts (keep it for genuinely inactive/blocked workspaces).

### Phase 3 — Website + sales (~2–3 days)
1. Website "Create free account" (Door 2) → then upgrade page.
2. Needs-a-call signals, funnel numbers.
3. 90-day shadow-account clean-up job.

### Phase 4 — Release
Store paperwork (privacy, data forms, demo account, review notes), new builds for Android and iOS, App Review.

### Fix before launch (found while planning)
- **Stale-lead reminders** only read 2,000 leads across all businesses per run (`services/crm/followUps.ts`, `.limit(2000)`). With many Free users some leads would silently never get reminders — paginate per business.
- **Inngest**: every new lead fires one job; check the plan covers ~50k+ jobs/month at 1,000 active users.
- **Server RAM** was at 97% after the last build — check before adding load.

---

## 12. Decisions needed

| # | Question | Recommendation |
|---|---|---|
| D1 | Free account usable on the website too? | **Yes** (sign-up first in the app) |
| D2 | Old website free-report visitors (shadow accounts) get the Free plan when they log in? | **Yes** — warmest prospects |
| D3 | Businesses without a Google listing can sign up? | **Yes** — no report; sales follows up differently |
| D4 | "View full report" in the app | **Full report page in app mode** (no prices/buttons) |
| D5 | WhatsApp consent wording at sign-up + the Free-account auto-reply text | Team to write (draft in §3.4) |
| D6 | Website Pricing → Get started | **Create free account first, then upgrade page** |
| D7 | Free limits at launch | 200 active leads, 50 scans/month (editable in admin) |

---

## 13. Related

- Visiting-card scanner (built): auto-save + offline sync, event picker, Edit lead, blur check — `mobile/src/app/(app)/leads/scan-card.tsx`, `src/app/api/leads/business-card/*`.
- Card-scan plan cap: `maxCardScansPerMonth` in `src/lib/planDefaults.ts` / PlanConfig / UserLimitOverride.
- Free report OTP: `src/services/auth/freeReportOtp.ts`, `src/app/api/free-report/*`.
- Shadow accounts: `src/lib/shadowAccount.ts`.
- App lock screen: `mobile/src/components/locked.tsx`; "workspace inactive" + WhatsApp help: `mobile/src/components/workspace-inactive.tsx`, `src/services/whatsapp/appAccessHelp.ts`.
