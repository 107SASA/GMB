# iOS App Store privacy disclosures — verified data practices

Status: 2026-10-24. Prepared from the iOS app source (`ios/src`) and the
backend it calls (`src/`). **Confirmed** = read in code. **Needs confirmation**
= depends on owner decisions, provider account settings, hosting, or legal
judgement that the code cannot show. Nothing here has been filed in App Store
Connect.

## 1. Canonical URLs (existing pages, reused)

| Page | Canonical URL | Source | Verified |
|---|---|---|---|
| Privacy policy | `https://growwmatics.com/privacy` | `src/app/privacy/page.tsx` (`canonical: "/privacy"`, root `metadataBase` = `https://growwmatics.com`) | Live: 200; `<link rel="canonical" href="https://growwmatics.com/privacy">`; `www.` → 301 and trailing slash → 308 to the canonical URL |
| Account deletion | `https://growwmatics.com/delete-account` | `src/app/delete-account/page.tsx` | Live: 200 |

The iOS app links to `${EXPO_PUBLIC_API_URL}/privacy` and
`${EXPO_PUBLIC_API_URL}/delete-account` (More → Legal; privacy also on the
sign-in screen). In the production EAS profile `EXPO_PUBLIC_API_URL` is
`https://growwmatics.com`, so both resolve to the canonical URLs above.

## 2. What the iOS app collects (confirmed)

The app has **no analytics, advertising, attribution or crash-reporting SDK**
(`ios/package.json`), does not use the advertising identifier, and shows no
App Tracking Transparency prompt. Everything below is sent only to the
GrowwMatics backend.

| Data | Where in the app | Endpoint(s) | Notes |
|---|---|---|---|
| Phone number, one-time code | Sign-in | `/api/auth/phone-login/request`, `/verify` | Code delivered by WhatsApp (Twilio or Meta) |
| Name, email, phone (profile) | Profile | `/api/user/profile` | |
| Business / workspace details (name, category, address, website, phone, keywords, brand colours, intake answers, business hours) | Onboarding, Settings, Business Profile | `/api/business*`, `/api/onboarding/*`, `/api/whatsapp/business-hours` | Onboarding search queries go to Google Places via the backend |
| Contacts (name, phone) — **only entries the user picks** | CRM → From contacts | `/api/leads/bulk-import` | Permission asked after an in-app consent sheet; address book never uploaded wholesale |
| Leads / customers the user enters (names, phone numbers, notes, deal values, follow-ups) | CRM, Customers | `/api/leads/*`, `/api/crm/*`, `/api/customers*`, `/api/followups*` | Personal data about the business's own customers |
| Photos and videos the user picks or records | Posts, Photos & Videos | `/api/gbp/media/upload`, post creation | Stored as **public-read** objects in DigitalOcean Spaces (CDN URL), then published to Google Business Profile when the user chooses |
| Precise location | Photos/videos taken with the in-app camera (device position at capture); GPS embedded in a picked photo | `/api/gbp/media/upload` (`photoLat`, `photoLng`, source, accuracy) | When-in-use permission only; never background location |
| Review replies, post text, messages | Reviews, Posts, Inbox (admin only) | `/api/reviews/*`, `/api/scheduler/*`, `/api/inbox/*` | |
| Review requests / campaigns to the business's customers | Reviews, CRM | `/api/campaigns/send`, `/api/customers/quick-add` | Sent over WhatsApp (Twilio/Meta) and email (SendGrid) to those customers |
| Push notification token | After sign-in, if notifications are allowed | `/api/user/push-token` | Expo push token; notification title/body pass through Expo and Apple (APNs) |
| Google Business Profile connection | Connect Google | `/api/auth/google/mobile-handoff` → Google OAuth | Google tokens stored encrypted server-side; never sent to the app |
| Account and plan status | Billing, Home | `/api/auth/me`, `/api/billing/status`, `/api/user/usage` | Read-only in the app; no payment data in the app |

On the device: the session token in the iOS Keychain (SecureStore); a cache of
recent API responses (up to 24 h) in app storage for offline display.

## 3. What the backend does with it (confirmed providers)

| Purpose | Provider (from code) | Data involved |
|---|---|---|
| Google Business Profile, reviews, insights, posts, media | Google APIs (`business.manage`), Google Places / Maps | Profile data, reviews, posts, photos/videos |
| AI drafting and analysis (review replies, content, audits, keyword suggestions, WhatsApp agents, lead scoring) | **Groq** (model `openai/gpt-oss-120b` via Groq; no direct OpenAI API call found) | e.g. review text, rating, reviewer name, business details, keywords; WhatsApp conversation text for the agents |
| WhatsApp messages (login codes, review requests, agents) | Twilio, Meta WhatsApp Cloud API | Phone numbers, message text |
| Email | Resend, SendGrid | Email addresses, message text |
| File storage | DigitalOcean Spaces (S3 API; default region `blr1`) | Uploaded photos/videos, generated images — public-read URLs |
| Background jobs | Inngest | Event payloads (IDs and job data) |
| Push delivery | Expo push service → APNs / FCM | Push token, notification title/body/data |
| Call tracking | Twilio number on the Google profile | Caller number, name, call times, recording URL (from the provider) |
| Payments (website only) | Razorpay | Not collected by the iOS app |

Account deletion (`POST /api/user/delete-account`, then the purge job after
`PURGE_GRACE_DAYS` = 30) erases these records and the stored files; billing
records without personal fields are kept `BILLING_RETENTION_YEARS` = 8.

## 4. Draft App Privacy answers (to confirm before filing)

"Linked to you" = stored against the account. Purposes from Apple's list.

| Apple data type | Collected | Linked | Tracking | Purpose | Status |
|---|---|---|---|---|---|
| Contact Info — Name, Email Address, Phone Number | Yes | Yes | No | App Functionality | Confirmed |
| Contacts | Yes (user-selected) | Yes | No | App Functionality | Confirmed |
| Location — Precise Location | Yes (camera capture / photo GPS) | Yes | No | App Functionality | Confirmed |
| User Content — Photos or Videos | Yes | Yes | No | App Functionality | Confirmed |
| User Content — Other User Content (posts, replies, CRM notes, messages) | Yes | Yes | No | App Functionality | Confirmed |
| Identifiers — User ID | Yes (account ID) | Yes | No | App Functionality | Confirmed |
| Identifiers — Device ID | Push token only | — | No | App Functionality | **Needs confirmation** whether to declare the push token |
| Usage Data / Diagnostics | No app SDK; server request logs exist | — | No | — | **Needs confirmation** (hosting log contents/retention) |
| Purchases / Financial Info | Not collected by the iOS app (plan status is read-only) | — | — | — | **Needs confirmation** (owner/legal) |
| Other Data (business details, customers' data entered by the user) | Yes | Yes | No | App Functionality | Confirmed; category choice needs confirmation |

**Tracking:** the app contains no tracking code. Whether any collected data is
combined with third-party data for advertising, or shared with data brokers,
is a business practice the code can't prove — **owner confirmation required**
before answering "Data Not Used to Track You".

## 5. Questions for owner / legal / provider configuration

1. Groq: data-retention and training settings on the GrowwMatics account.
2. Hosting/server logs: where they are kept, what they contain (IP addresses,
   request paths), and for how long.
3. Twilio call recordings: whether recording is enabled, and retention.
4. Public-read media URLs: acceptable to disclose as "may be accessible to
   anyone with the link before and after publishing to Google"?
5. Content already published to Google Business Profile: deletion revokes
   GrowwMatics' access; the published content itself remains on Google — the
   policy/deletion page should say so if that is the intended position.
6. Data location: MongoDB host/region and the Spaces region in production.
7. Website analytics: `src/app/layout.tsx` loads Google Analytics 4
   (`G-SNVHQ3RW4B`) on every website page, including pages the iOS app opens
   in its in-app browser (privacy, deletion, Google connect). The privacy
   policy does not mention analytics or cookies.
8. Children: no statement in the policy; the service is for businesses —
   confirm whether to add a statement.

## 6. Missing privacy-policy wording

**Status (2026-10-24):** the code-verified parts below are now applied to
`src/app/privacy/page.tsx` locally (not deployed, pending owner review). Not
applied, because they need owner/legal input first: the "you are responsible
for a lawful basis" sentence, provider retention/training statements, data
regions, hosting/database provider names, call-recording statements, a
children's statement, and the "last updated" date (`LEGAL_LAST_UPDATED` is
shared by all legal pages).

### Original proposal

Existing accurate content (Google Limited Use, Razorpay, 30-day erasure,
8-year billing retention, rights, contact) should be kept. Narrow additions:

**Intro** — "…when you use our website, our Android and iOS apps, and our
services at growwmatics.com."

**Section 1, add items:**
- **Phone sign-in and messages** — your phone number, used to send one-time
  sign-in codes and service messages over WhatsApp.
- **Content you upload** — photos and videos you choose to upload for your
  Google Business Profile. Uploaded files are stored with our cloud storage
  provider at web addresses that are not secret, and are published to your
  Google Business Profile when you choose.
- **Location (mobile apps)** — with your permission, the location of your
  phone when you take a photo or video in the app, or the location stored in a
  photo you upload, so the upload records where it was taken. We do not
  collect location in the background.
- **Contacts (mobile apps)** — only the contacts you select to add to your
  CRM. We never upload your whole address book.
- **Customer and lead information** — names, phone numbers, notes and
  messages about your own customers and leads that you add or that reach your
  business through WhatsApp, calls or reviews. You are responsible for having a
  lawful basis to share this information with us.
- **Device information (mobile apps)** — a push notification token, used only
  to send you notifications.

**Section 4, name the categories already implied** — add messaging providers
(WhatsApp via Twilio/Meta), cloud storage, background processing and push
delivery (Expo/Apple/Google) alongside Google, Razorpay, AI and email; and that
AI features send relevant content (for example review text) to our AI provider
to generate drafts.

**Usage data** — mention website analytics (Google Analytics) if confirmed
(question 7).

Not proposed (needs facts first): provider-specific retention, international
transfer statements, children's statement.
