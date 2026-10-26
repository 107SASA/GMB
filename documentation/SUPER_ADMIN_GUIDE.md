# Growwmatics Super Admin — Team Guide

This guide explains every section of the Super Admin panel: what it shows, what you can do there, and what to watch out for.

**Where:** sign in at `growwmatics.com/admin-login` with your super admin email and password. You get access by accepting a **Team Invite** from an existing super admin.

> **Important:** a super admin can see every customer's data and act on their behalf. Never share your login, always sign out on shared computers, and only change settings you understand.

---

## How the system works (the 2-minute version)

Growwmatics finds and wins customers mostly on **WhatsApp**, with AI agents doing the first conversations and your team stepping in when needed.

1. **A lead comes in** — someone runs a **free report** (website or WhatsApp), **books a demo** on the website, or just **messages our WhatsApp** number. Every one of them becomes a **lead** in **Leads & Pipeline**.
2. **The AI agents talk to them:**
   - **Sales Agent** — sends one invitation after the free report, one follow-up 48 hours later if they don't reply, and answers their questions.
   - **Booking Agent** — books demos on the connected Google Calendar with a Meet link and sends reminders.
   - **Report Agent** — collects business details on WhatsApp and delivers the free report.
3. **Your team steps in** whenever needed — take over a chat in the **WhatsApp Inbox**, record demo outcomes in **Demos**, update stages, log calls and set follow-ups in the **CRM**.
4. **They pay** (often after a 3-month free trial on the yearly plan) — billing is handled by Razorpay and shows in **Subscriptions**, **Billing Controls** and **Revenue**.

---

## Sidebar at a glance

| Group | Section | Use it for |
|---|---|---|
| — | **Overview** | Headline numbers and platform health |
| **Conversion** | **Conversion Overview** | The sales funnel: how leads move to customers |
| | **Leads & Pipeline** | **The CRM** — every lead, edit, import, export, board |
| | **Nurturing** | When automated sales messages go out |
| | **WhatsApp Inbox** | Live chats; take over from the AI |
| | **Demos** | Demo bookings and their outcomes |
| | **Analytics** | Conversion rates and agent performance |
| **Customers & Billing** | **Customers** | Every customer account, usage limits, "sign in as" |
| | **Businesses** | Every customer workspace (business) |
| | **Subscriptions** | Who pays for what; the plan and its price |
| | **Billing Controls** | Free trial, failed-payment rules, payment reminders |
| | **Revenue** | MRR, ARR and subscription status counts |
| **Agents** | **Sales Agent** / **Booking Agent** / **Report Agent** | What each AI agent says and how it behaves |
| | **Customer WhatsApp** | A customer business's own WhatsApp AI agent |
| **Operations** | **System Health** / **Automations** / **AI & API Usage** | Is everything running, and what it costs |
| **Monitors** | Customer Leads, Audit, Content, Review, Review Requests, Review Follow-ups, WhatsApp | Read-only views across all customers |
| **Moderation** | **Showcase** / **Testimonial Approvals** | Approve what appears on our public website |
| **Admin** | **Settings** / **Team Invites** / **Security Log** | Platform settings, adding team members, security |

---

## Overview

The landing page after you sign in.

- **Total Customers** — customer accounts (not counting test/shadow accounts).
- **Active Businesses** — paying + on free trial (the small line underneath splits them, and shows the total of all workspaces).
- **MRR** — monthly recurring revenue (a yearly plan counts as one-twelfth per month).
- **AI Requests Today**, **New Customer Leads (7d)** — leads in our customers' own CRMs.
- **Recent Signups** and **Platform Health** (database, failed jobs, message backlog).

If a number shows **"—"**, that source failed to load — refresh; it is not zero.

---

## CONVERSION

### Conversion Overview
**The funnel for our own sales:** lead → demo → payment → customer.

- **Range picker** (Today / 7d / 30d / 90d / All time) — every number on the page is for **leads created in that range**. The line under the title says which.
- **Lead cards** — Leads, Active sales leads, Demo interest, Demo scheduled, Attended a demo, Purchase intent, Customers, With a human, Opted out / lost, Pending payments. Cards marked **"(now)"** show the current state; the others count leads that **ever reached** that stage.
- **Demo bookings row** — bookings (not leads): total, upcoming, held, no-shows, cancelled.
- **Revenue strip** — MRR, free trials, past-due workspaces.
- **Stages reached** (funnel) and **Conversion rates**.

**Tip:** click any number — it opens Leads & Pipeline showing **exactly** those leads.

### Leads & Pipeline — the CRM
**Every lead Growwmatics has**, kept up to date by the AI and by your team.

**Where leads come from (Source):**

| Source | Meaning |
|---|---|
| **Website Free Report** | Ran a free report on the website |
| **Website Demo Booking** | Booked a demo on the website form |
| **WhatsApp Free Report** | Asked for the free report on WhatsApp |
| **WhatsApp** | Messaged our WhatsApp number |
| Manual / CSV Import / Referral / Phone Call … | Added by the team |

A lead keeps **its first source** and shows every later channel as small tags (e.g. a free report and then a demo booking).

**What you can do:**
- **Add lead** — phone + name or business. If the number already exists, it offers to open that lead (no duplicates). **Adding a lead never messages them.**
- **Import CSV** — bulk-upload existing leads.
  1. Click **Download sample CSV**.
  2. Fill it in: `name, phone, email, business, city, source, stage, tags, notes` — **phone and (name or business) are required**. Tags are separated by `;`.
  3. Upload (.csv or .xlsx, up to 1,000 rows). You see how many were added / updated / skipped and the reason for every rejected row.
  - A phone already in the CRM only gets its **empty** fields filled — nothing is overwritten. Tick *"Also change the stage of leads that already exist"* to update stages too.
- **Export CSV** — downloads exactly the leads your current filters show.
- **List / Board** — the Board has one column per stage. **Drag a card** to another column to move the lead, or use the stage picker on the card.
- **Change a stage** right in the table; **select several leads** with the checkboxes → **Move to stage**.
- **Filters** — stage, source, assigned person, agent, intent, nurture, ownership, demo, payment, score; search by name, business or phone (any format).
- **Follow-ups** button — every open follow-up for the team, soonest first (overdue in red); tick **Only mine**.
- **Custom stages** button — your own sub-stages under a main stage (e.g. *"Called twice"* under Qualifying). Rename = updates all leads; delete = clears it from them.

**Stages:**

| Group | Stages |
|---|---|
| Open | New, Qualifying, Nurturing |
| Demo | Demo requested, Demo scheduled, Demo completed |
| Closing | Payment pending, Payment verified |
| Won | Customer |
| Inactive | Cold, Unresponsive, Long-term nurture |
| Lost | Lost, Do not contact |

What a stage change does automatically:
- **Customer** → the lead moves to the in-house team; sales and demo messages stop.
- **Lost / Do not contact** → any queued automated message is cancelled (Do not contact also stops nurturing).
- Moving back from **Customer** → the Sales agent takes over again.
- **"With a human"** can't be picked — use **Take over** in the WhatsApp Inbox.

**The lead page** (click a name):
- **Lead details** — edit name, business, phone, email, city, source, tags, **stage**, **sub-stage**, **assigned to**, **automated messages** (Active / Paused / Stopped), **deal value**, and a **reason** when marking lost. Click **Save changes**.
- **Team notes** — add a note; each shows who wrote it and when.
- **Log a call** — we called / they called, outcome (Connected, No answer, Busy, Asked to call back, Wrong number, Left voicemail), minutes, notes.
- **Follow-ups** — pick date & time, type (Call / WhatsApp / Email / Meeting / Other), who to remind, a note → **Schedule**. The person gets a **push reminder** when it's due. **The lead is never messaged.** Mark it ✓ done or ✕ cancel.
- **Conversations** — every chat with this lead (sales, demo booking, report, support), each message labelled **lead's name**, **AI** or **Team**.
- **Timeline** — everything that happened, with the team member's name next to every change.
- **Return to AI** — appears when a human owns the lead; hands it back to the Sales agent.

> If a person **opted out** (sent STOP), only they can opt back in.

### Nurturing
**When the Sales agent's automated messages go out** after a free report.

The sequence is fixed: **one invitation** (at least 2 hours after the report), then **one follow-up** 48 hours later only if they haven't replied — then it stops.

| Control | What it does |
|---|---|
| **Nurturing** on/off | Stops/starts the automated invitation + follow-up. The Sales agent still answers people who message us. |
| **Quiet hours** on/off, From, Until, Timezone | On = messages due in that window wait until it ends. Off = no time restriction. |
| **Invitation** on/off, **Send after** | Whether the invitation is sent and how long after the report (minimum 2 hours). |
| **Follow-up** on/off | Whether the one follow-up is sent. |
| **Preview a lead** | Paste a lead's ID — shows what would happen next and why. Sends nothing. |
| **Recently skipped messages** | Messages that were due but not sent, with the reason (e.g. "The lead replied", "Nurturing is switched off"). |

Message **wording** is edited on the **Sales Agent** page, not here.

### WhatsApp Inbox
**Live WhatsApp chats** on our number — where the team talks to leads.

- Filters: All, Unread, Mine, Unassigned, Human required, AI active, Nurturing, Demo, Customers, Resolved.
- **Take over** — you own the chat; the AI goes silent for this person. Every message they send is saved here and the team gets a push notification.
- **Return to AI** — hand the chat back.
- **Assign** to a team member, add **notes/tags**, **resolve**.
- **Send** a reply — free text inside 24 hours of their last message; after that, only an approved template (pick from the list).

### Demos
**Every demo booking** and what happened.

- Tabs: Today, Upcoming, Needs scheduling, **Needs outcome**, Completed, Cancelled / no-show / rescheduled.
- **After every demo, record the outcome** (buttons appear once the demo time has passed):

| Button | When | Message to the customer |
|---|---|---|
| **Attended** | They joined | A thank-you follow-up a few hours later |
| **No show** | They didn't come | "Sorry we missed you — reply RESCHEDULE" |
| **Our team missed it** | Our team couldn't join | An apology + "reply RESCHEDULE" (doesn't count against them) |
| **Declined** / **Not ready** | Joined, not interested / not ready | Nothing |

  Clicked the wrong one? Click the right one — the wrong message is cancelled.
- **Status menu:**
  - **Cancelled** / **Rescheduled** for an upcoming demo → frees the calendar slot, stops reminders, and **tells the customer once** on WhatsApp. The page confirms whether the message went out.
  - **Completed** can't be chosen before the demo has ended — use the Attendance buttons.
- Reminders go out automatically **24 hours, 1 hour and 15 minutes** before each demo.
- If nobody records an outcome, the system marks it *"No-show (auto, unconfirmed)"* and **sends nothing** — a person must click a button.

### Analytics
Conversion rates (lead → qualified → demo → customer), timing (average days to demo / to payment), and **agent performance** (Sales agent results, demo bookings, in-house activations). Uses the same range picker and definitions as Conversion Overview.

---

## CUSTOMERS & BILLING

### Customers
Every customer account: plan, signup date, usage.
- **Usage limits** — per-customer caps (audits per business, posts per month, WhatsApp messages per day, AI generations per month, review-request cooldown).
- **Sign in as customer** (impersonate) — see the dashboard exactly as they do, for support. **Every use is recorded** in the Security Log and admin audit trail. Use it only when helping that customer.

### Businesses
Every customer workspace: owner, status (**Paying / Free trial / Past due / Canceled / Never paid**), Google connected, WhatsApp active, onboarding complete.

### Subscriptions
Who is on which plan and billing status, plus usage this month. **Edit plan** changes the plan's name and prices per billing cycle (monthly / quarterly / 6-month / yearly) — **this changes what new customers pay**; double-check before saving.

### Billing Controls
- **Free trial offer** — on/off and length (default **3 months**, yearly plan only, one trial per verified phone).
- **Failed payments** — what a customer can still use after a charge fails (first charge after a trial: restrict immediately; renewals: a grace period, default 3 days), which modules get restricted, and whether a recovered payment restores access automatically.
- **WhatsApp payment reminders** — sent after a failed payment until it's fixed (default days 0, 1, 2, 7; max 4; 9:00–20:00 IST). Needs the approved template SID (`growwmatics_payment_reminder`) and the "Meta has approved" tick before **Turn reminders ON** works.
- **Subscriptions** / **Needs review** tabs — monitoring and anything the system couldn't decide on its own.

### Revenue
- **MRR / ARR** — from each subscription's real billing cycle (yearly ₹9,999 ≈ ₹833/month).
- Status rows: **Paying**, **Free trial (mandate set up)**, Past due, **Signed up, never paid**, Canceled this month, Trials ended unpaid this month.

---

## AGENTS

These are the AI assistants that talk to people on WhatsApp. **Each must be switched ON to work.**

### Sales Agent
Talks to **prospects** — free-report leads and anyone who messages us.
- **On/off** — off = it stops replying to leads **and** no automated messages are sent.
- **First message** (invitation) and **Follow-up** wording — AI-written or a fixed template. "Send after" can't be less than 2 hours.
- **Agent instructions** (persona) for live replies.
- **Business knowledge** — what Growwmatics does, services, FAQs, objection answers, pricing wording. **Keep this accurate** — the AI only states facts written here.
- **Subscribe / platform links** it may share.

### Booking Agent
Books **demos**.
- **On/off**.
- **Connect my calendar** — connect the Gmail account that should receive demos. **Without a connected calendar, demos are not confirmed** (the chat is handed to a human).
- Working hours, timezone, demo length, minimum notice, how many days ahead, buffer between demos, assignment (first available / round-robin between salespeople).
- **Agent persona** — tone for answering questions from people who already have a demo booked (picking a time uses fixed buttons).
- **Confirmation message** — the "your demo is booked" text.

### Report Agent
Handles the **free report on WhatsApp**: asks for the business name and location, starts the report, sends it when ready. On/off, intro and summary messages, instructions.

### Customer WhatsApp
Not our sales agent — this is the WhatsApp AI agent of **our customers' businesses** (it replies to *their* customers). Pick a business with the switcher to view or manage it, e.g. for support.

---

## OPERATIONS

### System Health
Is everything configured and running: each provider (SerpApi balance, Groq AI, Google, Razorpay, email, WhatsApp) shows Healthy / Running low / Critical / Not set, plus pending jobs, failed jobs (24h) and message backlog. **Check this first when something "isn't working".**

### Automations
The background jobs (content scheduling, post publishing, review sync, follow-ups, alerts…): when they last ran and whether they succeeded. Some can be run manually.

### AI & API Usage
AI generations, tokens used and estimated cost over 7 / 14 / 30 / 90 days, plus WhatsApp sent / failed / pending counts.

---

## MONITORS (read-only, across all customers)

| Monitor | Shows |
|---|---|
| **Customer Leads (tenant CRM)** | Leads in our **customers' own** CRMs (not our sales leads) |
| **Audit Monitor** | Every AI audit run and its result |
| **Content Monitor** | AI-generated posts: generated, scheduled, published, drafts |
| **Review Monitor** | All Google reviews of customer businesses: rating, unanswered, critical (≤2★) |
| **Review Requests** | WhatsApp delivery of review requests (link clicks are not counted as reviews) |
| **Review Follow-ups** | Settings for review-request reminders: on/off, delays, max follow-ups, stop on opt-out / after the link is clicked |
| **WhatsApp Monitor** | All customer WhatsApp conversations: active, AI enabled, messages today |

---

## MODERATION

- **Showcase Approvals** — customer photo/video uploads. **Approve** to publish on `growwmatics.com/showcase`, or **Reject** with a reason.
- **Testimonial Approvals** — customer reviews of Growwmatics. Approve to publish, or reject.

Nothing appears publicly until someone approves it.

---

## ADMIN

### Settings
- **Support email** — shown to customers as the support contact.
- **Danger Zone** — *Flush demo data*, *Clear automation logs*. Each needs typing **CONFIRM**. **Don't use these unless you are told to.**

### Team Invites
Invite a new super admin by email. They get a link (valid 48 hours, usable once) to set their name, **mobile number** and password. Only invite people who need full access.

### Security Log
Everything security-related, with time, outcome (success / failed / blocked), who (email or masked phone), IP address and device:
- sign-ins (super admin and customers), login and signup codes, password resets, sign-outs;
- admin invites, **"sign in as customer"**, CSV exports and imports;
- webhooks with a forged signature (Razorpay, Twilio, Meta).

**Alerts:** many failed super admin sign-ins in a short time raise a **critical alert** (push notification + red banner). If you see one you can't explain, tell the platform owner immediately.

The **Admin actions** tab shows the audit trail of privileged admin actions (sign in as customer, billing changes).

---

## Daily routine (suggested)

**Every morning**
1. **WhatsApp Inbox** → *Unread* and *Human required* — reply or return to AI.
2. **Leads & Pipeline** → **Follow-ups** → *Only mine* — do today's and overdue ones.
3. **Demos** → *Today* — check bookings; join on time.

**After each demo** → **Demos** → record the outcome (**Attended / No show / Our team missed it / Declined / Not ready**).

**After each call** → open the lead → **Log a call** → set a **follow-up** if needed → update the **stage**.

**Weekly**
- **Conversion Overview** and **Revenue** — how are we doing.
- **Nurturing → Recently skipped messages** — anything unexpected?
- **Security Log** — anything strange?
- **System Health** — anything red or running low?

---

## Common questions

**A lead didn't get the WhatsApp invitation.** Check: Sales Agent **on**? Nurturing **on**? Then **Nurturing → Recently skipped messages** or **Preview a lead** for the exact reason (e.g. they replied, already a customer, opted out, a demo is booked).

**The AI keeps replying but I want to talk to them.** WhatsApp Inbox → open the chat → **Take over**. Hand back later with **Return to AI**.

**A demo wasn't confirmed / no times were offered.** Booking Agent → is the agent **on** and a **calendar connected**?

**I uploaded a CSV and some rows failed.** The result lists each row number and the reason (e.g. "phone is missing", "stage is not a CRM stage"). Fix those rows and upload again — existing leads are matched, never duplicated.

**Can the follow-up reminder message the lead?** No. Follow-ups are reminders **for the team** only.

**Someone sent STOP.** They're opted out everywhere. Only they can opt back in by messaging us.

**A number on Overview shows "—".** That part failed to load — refresh. It is not zero.
