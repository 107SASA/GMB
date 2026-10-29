# GrowwMatics AI — Customer Manual (Website + Mobile App)

> **Status:** DRAFT — text written, screenshots pending.
> Every `📸` block marks where a screenshot goes. Capture it using the shot list in **Part 0**, save it with the exact file name shown, and the image link will start working on its own.

---

## Part 0 — Plan for producing this manual

### 0.1 Who this manual is for
Business owners who use GrowwMatics AI to manage their Google Business Profile, reviews, posts and leads. Assume they are not technical. Every step should say **where to tap/click** and **what they will see**.

### 0.2 Steps to finish the manual

| # | Step | Owner | Done |
|---|------|-------|------|
| 1 | Set up a **demo workspace** with realistic data (connected Google profile, 10+ reviews, 5+ leads, posts, a finished audit). Never use a real customer's data. | | ☐ |
| 2 | Capture **website** screenshots (W-xx) on desktop, 1440×900, browser zoom 100%, light theme | | ☐ |
| 3 | Capture **mobile app** screenshots (M-xx) on one phone size (e.g. iPhone 15 / Pixel 8) | | ☐ |
| 4 | Blur or replace phone numbers, emails, customer names and OTP codes | | ☐ |
| 5 | Save files into `docs/screenshots/web/` and `docs/screenshots/app/` using the names below | | ☐ |
| 6 | Read through each section next to the live product and fix any wording that no longer matches | | ☐ |
| 7 | Add red arrows/boxes on screenshots where a button is hard to find | | ☐ |
| 8 | Final review, then export (PDF / help centre) | | ☐ |

### 0.3 Screenshot rules
- **File name format:** `W-07-audit-results.png` (web) or `M-12-review-reply.png` (app). Use PNG.
- One idea per screenshot. If a page is long, take two shots (`W-07a`, `W-07b`).
- Close popups, toasts and dev tools before capturing, unless the popup is the subject.
- Keep the same demo business in every screenshot so the guide feels consistent.

### 0.4 Folder layout
```
docs/
├── CUSTOMER_MANUAL.md
└── screenshots/
    ├── web/   W-01-….png … W-40-….png
    └── app/   M-01-….png … M-40-….png
```

### 0.5 Master shot list

**Website**

| ID | Screen | URL | What must be visible | ☐ |
|----|--------|-----|----------------------|---|
| W-01 | Login | `/login` | Phone number field, "Welcome Back" | ☐ |
| W-02 | OTP entry | `/login` | "Enter Code" field + Resend link | ☐ |
| W-03 | Onboarding – account | `/onboarding` | "Create your account" step | ☐ |
| W-04 | Onboarding – find business | `/onboarding` | Search by name / paste Google Maps URL | ☐ |
| W-05 | Onboarding – confirm details | `/onboarding` | "Confirm your details" form | ☐ |
| W-06 | Onboarding – connect Google | `/onboarding` | "Connect Google Profile" button | ☐ |
| W-07 | Choose your listing | `/connect-google/select-listing` | "Which listing is yours?" | ☐ |
| W-08 | Onboarding – train AI / finish | `/onboarding` | "Train your AI Agent", completion screen | ☐ |
| W-09 | Dashboard – overview | `/dashboard` | Performance Overview cards + sidebar | ☐ |
| W-10 | Workspace switcher | sidebar | "Active Workspace" dropdown open | ☐ |
| W-11 | Audit list | `/dashboard/audit` | List of audits with scores | ☐ |
| W-12 | Audit running | `/dashboard/audit` | Progress steps ("Analyzing your Business Profile…") | ☐ |
| W-13 | Audit result | `/dashboard/audit/[id]` | Scores + recommendations | ☐ |
| W-14 | SEO Plan | `/dashboard/seo-plan` | Key Finding, Target keywords, Action plan | ☐ |
| W-15 | SEO Plan – drafts | `/dashboard/seo-plan` | Listing drafts, Weekly post plan, Suggested Q&As | ☐ |
| W-16 | Profile optimization – overview | `/dashboard/profile-optimization` | Sections list ("Improve your profile") | ☐ |
| W-17 | Profile optimization – edit | `/dashboard/profile-optimization` | e.g. Business description with "Use this description" | ☐ |
| W-18 | Profile optimization – confirm | `/dashboard/profile-optimization` | "Yes, apply to Google" dialog | ☐ |
| W-19 | Google Profile | `/dashboard/gbp-profile` | Live name, address, phone, website, category | ☐ |
| W-20 | Reviews – monitor | `/dashboard/reviews` | Review cards, filters, analytics cards | ☐ |
| W-21 | Reviews – AI reply | `/dashboard/reviews` | A review with AI-drafted reply | ☐ |
| W-22 | Reviews – reply mode | `/dashboard/reviews` | "How should review replies work?" | ☐ |
| W-23 | Review requests | `/dashboard/reviews` (Review Requests tab) | Customer list + statuses | ☐ |
| W-24 | Add customer / quick request | same | "Add Customer" or "Quick review request" form | ☐ |
| W-25 | Review QR code | same | "Google review QR code" card | ☐ |
| W-26 | CRM – list view | `/dashboard/crm` | Lead list, stats row, filters | ☐ |
| W-27 | CRM – kanban | `/dashboard/crm` | Lead columns by stage | ☐ |
| W-28 | CRM – add lead | `/dashboard/crm` | "Add New Lead" form | ☐ |
| W-29 | CRM – import leads | `/dashboard/crm` | "Import Leads" file drop | ☐ |
| W-30 | CRM – lead details | `/dashboard/crm` | Lead drawer with timeline / follow-ups | ☐ |
| W-31 | CRM – analytics | `/dashboard/crm` | Analytics view | ☐ |
| W-32 | Growth report | `/dashboard/crm/growth-report` | Monthly report | ☐ |
| W-33 | Content – weekly posts | `/dashboard/content` | "Your weekly posts are generated automatically" | ☐ |
| W-34 | Content – create / schedule | `/dashboard/content` | Create Post with date & time picker | ☐ |
| W-35 | Content – FAQ / SEO tabs | `/dashboard/content` | FAQ tab, SEO Optimized Description | ☐ |
| W-36 | Insights | `/dashboard/insights` | Search views, calls, keywords | ☐ |
| W-37 | Settings – business details | `/dashboard/settings` | Business Details + keywords | ☐ |
| W-38 | Settings – notifications | `/dashboard/settings` | Notification toggles | ☐ |
| W-39 | Billing | `/dashboard/billing` | Current plan, usage, invoices | ☐ |
| W-40 | Upgrade / checkout | `/dashboard/upgrade`, `/checkout` | Plan picker (yearly selected), "Your details" | ☐ |
| W-41 | Profile | `/dashboard/profile` | Account Overview, Change Password | ☐ |

**Mobile app**

| ID | Screen | Where | What must be visible | ☐ |
|----|--------|-------|----------------------|---|
| M-01 | Welcome slides | first launch | "Grow your business on Google" + Skip | ☐ |
| M-02 | Login | Login | Phone + "Send code on WhatsApp" | ☐ |
| M-03 | OTP | Login | Code + "Verify & sign in" | ☐ |
| M-04 | Onboarding | first login | Business setup step | ☐ |
| M-05 | Home | Home tab | Dashboard cards, bottom tabs | ☐ |
| M-06 | Performance | Performance tab | Views/calls/directions chart | ☐ |
| M-07 | Posts list | Posts tab | Posts / Photos toggle | ☐ |
| M-08 | Create post | Posts → + | Text, image, Preview, "Publish now" / "Schedule post" | ☐ |
| M-09 | Photos | Posts → Photos | Photo grid / upload | ☐ |
| M-10 | Reviews overview | Reviews tab | Rating distribution + trends | ☐ |
| M-11 | Reviews list | Reviews tab | Filters: Needs reply / Replied | ☐ |
| M-12 | Review reply | tap a review | "Generate suggestion", "Approve reply", "Post reply to Google" | ☐ |
| M-13 | Review requests | Reviews → Review Requests | Request list | ☐ |
| M-14 | CRM list | CRM tab | Search bar, Add lead / Log a call / From contacts | ☐ |
| M-15 | Add lead | CRM → Add lead | Phone, name, valuation, notes | ☐ |
| M-16 | Import from contacts | CRM → From contacts | Contact picker | ☐ |
| M-17 | Recent calls | CRM → Calls | "Save as Lead", "Save + call-back task" | ☐ |
| M-18 | Lead details | tap a lead | Stage, notes, timeline | ☐ |
| M-19 | Monthly growth | CRM → Monthly Growth | Report numbers | ☐ |
| M-20 | Inbox | More / CRM | Conversations list | ☐ |
| M-21 | More menu | More | All menu items | ☐ |
| M-22 | Audit list | More → Audit Engine | Audits + "Run audit" | ☐ |
| M-23 | Run audit | Audit → Run audit | Category, city, "Start audit" | ☐ |
| M-24 | Audit result | tap an audit | Scores + tips | ☐ |
| M-25 | Business Profile | More → Business Profile | Overview / Profile tabs | ☐ |
| M-26 | Content | More → Content | Draft / Scheduled / Published | ☐ |
| M-27 | Content Scheduler | More → Content Scheduler | Calendar | ☐ |
| M-28 | Notifications | More → Notifications | Notification list | ☐ |
| M-29 | Settings | More → Settings | Business profile, keywords, brand | ☐ |
| M-30 | Review settings | More → Review settings | Reply mode + tone | ☐ |
| M-31 | Billing | More → Billing | Plan, usage this month | ☐ |
| M-32 | Profile | More → Profile | Edit profile, Change password | ☐ |

---

# Part A — Website (Dashboard)

## A1. Getting started

### A1.1 Log in
1. Open the website and click **Login**.
2. Enter your **phone number** and continue. We send a one-time code to that number **on WhatsApp**.
3. Type the code in **Enter Code**. Didn't get it? Click **Resend**.

> 📸 **W-01** ![Login](screenshots/web/W-01-login.png)
> 📸 **W-02** ![Enter code](screenshots/web/W-02-otp.png)

**Tip:** If you are already logged in on this browser, you go straight to your dashboard — no new code needed.

### A1.2 First-time setup (onboarding)
The setup wizard runs once, the first time you log in.

1. **Create your account** — enter your full name, email and company name.
2. **Find your business** — search by business name, or paste your Google Maps / Google Business Profile link.
3. **Confirm your details** — check name, address, city, area, phone and website. Fill in anything missing.
4. **Connect Google Profile** — sign in with the Google account that manages your listing and allow access.
5. **Which listing is yours?** — if your Google account manages more than one listing, pick the right one.
6. **Train your AI Agent** — choose your brand tone of voice (e.g. Professional, Friendly) and add anything the AI should know.
7. Finish — you land on the dashboard.

> 📸 **W-03** ![Create account](screenshots/web/W-03-onboarding-account.png)
> 📸 **W-04** ![Find business](screenshots/web/W-04-onboarding-find.png)
> 📸 **W-05** ![Confirm details](screenshots/web/W-05-onboarding-confirm.png)
> 📸 **W-06** ![Connect Google](screenshots/web/W-06-onboarding-google.png)
> 📸 **W-07** ![Select listing](screenshots/web/W-07-select-listing.png)
> 📸 **W-08** ![Train AI](screenshots/web/W-08-onboarding-ai.png)

### A1.3 Finding your way around
- **Left sidebar** (desktop): Dashboard, Audit Engine, SEO Plan, Profile optimization, Google Profile, Review Management, CRM, Content, Settings, Billing, Profile.
- **Bottom bar** (phone browser): Home, Audit, Reviews, CRM, More.
- **Active Workspace** (top of sidebar): switch between your businesses if you manage more than one.

> 📸 **W-09** ![Dashboard](screenshots/web/W-09-dashboard.png)
> 📸 **W-10** ![Workspace switcher](screenshots/web/W-10-workspace-switcher.png)

---

## A2. Dashboard
Your home screen. It shows:
- **Performance Overview** — how many people saw your profile, called, asked for directions or visited your website.
- **CRM & AI Activity** — new leads and what the AI has done for you recently.
- A prompt to **connect your Google Business Profile** if it isn't connected yet.

---

## A3. Audit Engine
A health check of your Google Business Profile, with a score and a fix list.

1. Go to **Audit Engine**.
2. Start a new audit. You'll see progress steps: *Analyzing your Business Profile → Checking SEO signals → Analyzing competitors nearby → Generating your report*.
3. When the status shows a **Score**, click the audit to open **Audit Results**.
4. Work through the recommendations, starting at the top.

> 📸 **W-11** ![Audit list](screenshots/web/W-11-audit-list.png)
> 📸 **W-12** ![Audit running](screenshots/web/W-12-audit-running.png)
> 📸 **W-13** ![Audit result](screenshots/web/W-13-audit-result.png)

**Note:** The number of audits per month depends on your plan (see **Billing**).

---

## A4. SEO Plan
Your step-by-step plan to rank higher on Google Maps, built from your audit.

What you'll find:
- **Key Finding** — the single most important thing to fix.
- **Target keywords** — the searches you should show up for.
- **Action plan** — tasks in order, with a completion percentage.
- **Listing drafts** — suggested title and description.
- **Suggested services**, **Extra Google categories**, **Suggested Q&As**.
- **Weekly post plan** and **Your USP** (used in your posts and review replies).
- **Baseline history** — your rating, reviews and average rank over time.

> 📸 **W-14** ![SEO plan](screenshots/web/W-14-seo-plan.png)
> 📸 **W-15** ![SEO plan drafts](screenshots/web/W-15-seo-plan-drafts.png)

---

## A5. Profile optimization
Improve your live Google profile section by section — with a check before anything is sent.

Sections: **Business description, Categories, Services, Opening hours (incl. special dates/holidays), Service area, Booking & order links, Attributes.**

1. Go to **Profile optimization**.
2. Open a section. You'll see your current Google value and our suggestion.
3. Edit if you like, then click e.g. **Use this description** / **Add these services** / **Save hours**.
4. Confirm with **Yes, apply to Google**.
5. Changes may show **Google is reviewing** for a while. Click **Check Google again** to refresh.
6. Changed your mind? **Discard** (nothing is sent) or **Undo changes** / **Yes, roll back** after applying.

> 📸 **W-16** ![Profile optimization](screenshots/web/W-16-profile-opt.png)
> 📸 **W-17** ![Edit section](screenshots/web/W-17-profile-opt-edit.png)
> 📸 **W-18** ![Apply to Google](screenshots/web/W-18-profile-opt-confirm.png)

**Tip:** "This draft didn't pass our checks" means the text would likely be rejected by Google — edit it and try again.

---

## A6. Google Profile
View and edit the live details on your Google profile: business name, address, primary phone, website, primary category and description.

> 📸 **W-19** ![Google profile](screenshots/web/W-19-gbp-profile.png)

---

## A7. Review Management
Two tabs: **Monitor Reviews** and **Review Requests**.

### A7.1 Monitor and reply to reviews
1. Go to **Review Management → Monitor Reviews**. Click **Sync Reviews** the first time.
2. Filter by **All / Positive / Negative / Critical / Unanswered**.
3. Each review gets an **AI-drafted reply**. Edit it if needed and post it.
4. Top cards show **Avg Rating, Response Rate, Sentiment Score, Pending Reviews**.

> 📸 **W-20** ![Reviews](screenshots/web/W-20-reviews.png)
> 📸 **W-21** ![AI reply](screenshots/web/W-21-review-reply.png)

### A7.2 Choose how replies work
Under **How should review replies work?** pick:
- **AI drafts, I approve** — nothing is posted until you approve it.
- **Auto-reply to all reviews** — the AI posts replies for you.

Also choose a **Reply tone**. You can switch any time, per business.

> 📸 **W-22** ![Reply mode](screenshots/web/W-22-reply-mode.png)

### A7.3 Ask customers for reviews (WhatsApp)
1. Open **Review Requests**.
2. Click **Add Customer** (name, WhatsApp number, service, service date, groups) — or **Import from CRM**.
3. Use **Quick review request** to send one immediately.
4. Track each request: **Pending → Delivered → Read → Clicked → Completed**. Customers who don't respond get a follow-up.
5. Print the **Google review QR code** for your counter or reception.

> 📸 **W-23** ![Review requests](screenshots/web/W-23-review-requests.png)
> 📸 **W-24** ![Add customer](screenshots/web/W-24-add-customer.png)
> 📸 **W-25** ![QR code](screenshots/web/W-25-review-qr.png)

---

## A8. CRM (AI Lead Manager)
All your leads in one place, with follow-up reminders.

### A8.1 Views
Switch at the top: **List**, **Kanban** (drag leads between stages; desktop only) and **Analytics**.

> 📸 **W-26** ![CRM list](screenshots/web/W-26-crm-list.png)
> 📸 **W-27** ![CRM kanban](screenshots/web/W-27-crm-kanban.png)
> 📸 **W-31** ![CRM analytics](screenshots/web/W-31-crm-analytics.png)

### A8.2 Add or import leads
- **Add New Lead** — name, phone, deal value (e.g. 50000), notes.
- **Import Leads** — drop a CSV/Excel file. You'll see how many leads were created and how many were skipped as duplicates.

> 📸 **W-28** ![Add lead](screenshots/web/W-28-crm-add.png)
> 📸 **W-29** ![Import leads](screenshots/web/W-29-crm-import.png)

### A8.3 Work a lead
Click a lead to open its details: activity timeline, notes, calls, meetings, follow-up tasks and appointments. Move it through stages (**Active → Converted / Closed**) as the deal progresses.

> 📸 **W-30** ![Lead details](screenshots/web/W-30-crm-lead.png)

### A8.4 Growth report
**CRM → Growth report** shows the month's leads, conversions and follow-ups in one page.

> 📸 **W-32** ![Growth report](screenshots/web/W-32-growth-report.png)

---

## A9. Content (AI Content Studio)
Google posts for your profile, written by AI.

1. **Weekly posts** are generated automatically ("Autopilot is on"). If you add **this week's offer**, a promotional post is created from it.
2. To make your own: **Create Post** → choose a tone (Professional, Friendly, Luxury…) → review title, text, hashtags and call-to-action → **Pick a date & time** to schedule.
3. Other tabs: **FAQ** (questions & answers for your profile), **SEO** (optimized description + SEO score) and **History**.

> 📸 **W-33** ![Weekly posts](screenshots/web/W-33-content-weekly.png)
> 📸 **W-34** ![Create post](screenshots/web/W-34-content-create.png)
> 📸 **W-35** ![FAQ / SEO](screenshots/web/W-35-content-faq-seo.png)

---

## A10. Insights
Google performance: **Search Views, Maps Views, Website Clicks, Call Clicks, Directions**, this month vs last month, and **Keywords to Grow Your Business** with estimated monthly searches. Click **Sync Now** to refresh. Keyword data updates monthly.

> 📸 **W-36** ![Insights](screenshots/web/W-36-insights.png)

---

## A11. Settings
- **Business Details** — name, category, description and keywords (these power the audit's keyword analysis).
- **Google Business Profile** — connect/disconnect.
- **Notifications** — choose what you hear about (new leads, new reviews, critical 1–2★ reviews, weekly summary, report ready, low content buffer, Google performance every 15 days) and whether by **WhatsApp**.

> 📸 **W-37** ![Settings](screenshots/web/W-37-settings.png)
> 📸 **W-38** ![Notifications](screenshots/web/W-38-notifications.png)

---

## A12. Billing & plans
- **Billing** shows your current plan, trial end date, enabled modules, **This Month's Usage** (resets on the 1st), plan limits and invoices.
- To subscribe or upgrade: open **Upgrade**, pick a plan (yearly is selected by default), then enter **Your details** at checkout and pay.
- If a workspace has no active plan you'll see **Subscribe to unlock this workspace**.

> 📸 **W-39** ![Billing](screenshots/web/W-39-billing.png)
> 📸 **W-40** ![Upgrade](screenshots/web/W-40-upgrade.png)

---

## A13. Profile (your account)
Update your full name and company, see your login phone and email, change your password, and — under **Danger Zone** — delete your account. To change your email, contact support.

> 📸 **W-41** ![Profile](screenshots/web/W-41-profile.png)

---

# Part B — Mobile App (iOS & Android)

## B1. Getting started

### B1.1 Install and log in
1. Install **GrowwMatics AI** from the App Store / Google Play.
2. Swipe through the welcome screens (or tap **Skip**).
3. Enter your phone number → **Send code on WhatsApp** → enter the code → **Verify & sign in**.

> 📸 **M-01** ![Welcome](screenshots/app/M-01-welcome.png)
> 📸 **M-02** ![Login](screenshots/app/M-02-login.png)
> 📸 **M-03** ![OTP](screenshots/app/M-03-otp.png)

Use the **same phone number** as on the website — it's the same account and the same data.

### B1.2 First-time setup
If you haven't set up a business yet, the app walks you through it, the same as the website (see A1.2).

> 📸 **M-04** ![Onboarding](screenshots/app/M-04-onboarding.png)

### B1.3 Navigation
Bottom tabs: **Home, Performance, Posts, Reviews, CRM**. Everything else is under **More**.

> 📸 **M-05** ![Home](screenshots/app/M-05-home.png)
> 📸 **M-21** ![More menu](screenshots/app/M-21-more.png)

---

## B2. Home
Quick view of how your business is doing, with shortcuts such as **Add Fresh Photos** and tips for **Better Ranking, More Reviews, More Customers**.

## B3. Performance
Views, calls, website clicks and directions from Google over time.

> 📸 **M-06** ![Performance](screenshots/app/M-06-performance.png)

## B4. Posts & Photos
- **Posts** tab → tap **+** → write your post, **Choose an image**, check the **Preview**, then **Publish now** or **Schedule post**.
- Switch to **Photos** to see and upload photos to your Google profile.

> 📸 **M-07** ![Posts](screenshots/app/M-07-posts.png)
> 📸 **M-08** ![Create post](screenshots/app/M-08-create-post.png)
> 📸 **M-09** ![Photos](screenshots/app/M-09-photos.png)

## B5. Reviews
- **Overview** — rating distribution and review trends for the last 8 weeks.
- **Reviews** — filter by rating, **Needs reply** or **Replied**.
- Tap a review → **Generate suggestion** → edit if needed → **Approve reply** → **Post reply to Google**. Not happy? **Regenerate** or **Reject**.
- **Review Requests** — see WhatsApp review requests you've sent.

> 📸 **M-10** ![Reviews overview](screenshots/app/M-10-reviews-overview.png)
> 📸 **M-11** ![Reviews list](screenshots/app/M-11-reviews-list.png)
> 📸 **M-12** ![Review reply](screenshots/app/M-12-review-reply.png)
> 📸 **M-13** ![Review requests](screenshots/app/M-13-review-requests.png)

Set reply mode and tone in **More → Review settings** (same options as A7.2).

> 📸 **M-30** ![Review settings](screenshots/app/M-30-review-settings.png)

## B6. CRM (Leads)
- Search leads by name, phone or email.
- **Add lead** — phone (or **Paste number**), name, valuation in ₹, and how the call went.
- **From contacts** — import from your phone's contacts (allow contacts permission when asked).
- **Calls** — your recent calls. For each: **Save as Lead**, **Save + call-back task**, link to an **Existing Lead**, or **Dismiss**.
- Tap a lead to see details, notes and history.
- **Monthly Growth** — leads received, conversion, completed follow-ups, overdue follow-ups.

> 📸 **M-14** ![CRM](screenshots/app/M-14-crm.png)
> 📸 **M-15** ![Add lead](screenshots/app/M-15-add-lead.png)
> 📸 **M-16** ![From contacts](screenshots/app/M-16-contacts.png)
> 📸 **M-17** ![Recent calls](screenshots/app/M-17-calls.png)
> 📸 **M-18** ![Lead details](screenshots/app/M-18-lead-details.png)
> 📸 **M-19** ![Monthly growth](screenshots/app/M-19-growth.png)

## B7. Inbox
Conversations with your leads in one list. Tap one to open the chat.

> 📸 **M-20** ![Inbox](screenshots/app/M-20-inbox.png)

## B8. Audit Engine (More → Audit Engine)
1. Tap **Run audit**.
2. Confirm the **Business category** and optionally a **City** (detected from your profile if blank).
3. Tap **Start audit**. Status shows **Running**, then the score. Tap to open the result.

Your Google Business Profile must be connected first.

> 📸 **M-22** ![Audits](screenshots/app/M-22-audits.png)
> 📸 **M-23** ![Run audit](screenshots/app/M-23-run-audit.png)
> 📸 **M-24** ![Audit result](screenshots/app/M-24-audit-result.png)

## B9. Business Profile (More → Business Profile)
**Overview** and **Profile** tabs showing your live Google listing.

> 📸 **M-25** ![Business profile](screenshots/app/M-25-business-profile.png)

## B10. Content & Scheduler
- **Content** — your posts by status: **Draft, Scheduled, Published**. Tap to **Edit**, **Schedule** or **Delete**. Weekly posts are generated automatically.
- **Content Scheduler** — calendar of upcoming posts.

> 📸 **M-26** ![Content](screenshots/app/M-26-content.png)
> 📸 **M-27** ![Scheduler](screenshots/app/M-27-scheduler.png)

## B11. Notifications
All alerts (new reviews, new leads, reports) in one list.

> 📸 **M-28** ![Notifications](screenshots/app/M-28-notifications.png)

## B12. Settings
Business profile (name, category, address, phone, website, WhatsApp number, description), **Keywords** (max 20), **Brand for post images**, notification preferences, and **Disconnect Google Business Profile**.

> 📸 **M-29** ![Settings](screenshots/app/M-29-settings.png)

## B13. Billing
Current plan, **This month's usage** (audits, posts, WhatsApp messages today), cancel subscription, and **Questions? Chat with us**.

> 📸 **M-31** ![Billing](screenshots/app/M-31-billing.png)

## B14. Profile
**Edit profile** (full name, company) and **Change password**. Your phone number is your login and can't be changed here. Log out from the **More** screen.

> 📸 **M-32** ![Profile](screenshots/app/M-32-profile.png)

---

# Part C — Help

## C1. Common questions

| Problem | What to do |
|---------|-----------|
| I didn't get the WhatsApp code | Check the number and country code, wait 30 seconds, then tap **Resend**. |
| "Connect Google Business Profile first" | Go to **Settings → Google Business Profile** and connect the Google account that owns your listing. |
| My listing isn't in "Which listing is yours?" | You're signed in to the wrong Google account. Disconnect and connect with the right one. |
| A change shows "Google is reviewing" | Normal. Google checks edits; it can take minutes to a few days. Use **Check Google again**. |
| "Limit reached" on billing | You've used this month's allowance. It resets on the 1st, or upgrade your plan. |
| A feature is locked | It's not in your plan, or the workspace has no active subscription. See **Billing**. |
| Data looks different in app vs website | Pull down to refresh in the app, or reload the website. Both use the same account. |

## C2. Contact support
<!-- TODO: add support WhatsApp number, email and hours -->
- WhatsApp: _TBD_
- Email: _TBD_
- Hours: _TBD_
