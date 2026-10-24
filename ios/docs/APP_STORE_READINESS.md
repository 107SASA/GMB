# iOS App Store readiness — decisions and open items

Status as of 2026-10-24. Everything below is derived from the code in this
repository and the App Review Guidelines text quoted at
<https://developer.apple.com/app-store/review/guidelines/>. Nothing here has
been confirmed with Apple; items marked **Decision** need the product owner.

## Release-readiness checklist (each item is separate)

| # | Item | Status |
|---|---|---|
| 1 | Billing: guideline 3.1.1 / 3.1.3(b) risk | **Unresolved risk — accepted business model, approval not assured** (§1) |
| 2 | Encryption export-compliance answer | **Decision** for the product owner (§2) |
| 3 | Privacy policy covering the app's data + privacy label | In-app link done; **policy text gap** — proposed wording in `APP_STORE_PRIVACY_DISCLOSURES.md` (§3) |
| 4 | Account deletion | Not strictly required (no in-app account creation); public page wording updated for iOS (not deployed); linked in the app (§4) |
| 5 | App Review sign-in (WhatsApp code) | Mechanism exists; **needs a demo account and production configuration** (§5) |
| 6 | EAS project, credentials, native build, device testing | Not started (§6) |

## 1. Billing — confirmed business model and the remaining Apple risk

**Confirmed product requirement (2026-10-24):** the website is the only place
to generate the free report, choose a plan and pay. The iOS app collects no
payments and has no StoreKit / in-app purchase. Existing users sign in and use
what their account and workspace are entitled to, as on Android. The app must
not direct users to the website to buy.

### What the iOS app shows (verified in code and by `__tests__/store-compliance.test.tsx`)

| User | What they see about plans and billing |
|---|---|
| Signed out | Intro slides (feature descriptions only); sign-in screen with "Accounts are managed on the GrowwMatics AI website." (no link) and a Privacy policy link. An unknown number gets "No account found for this number. Check the number, or use the one registered to your GrowwMatics account." — the server's "Get your free report or book a demo" text is not shown on iOS. |
| Free / module not in plan | Locked screens: module name, "This feature isn't included in your current plan.", "Contact support for details." — no link or button. Lock icons in More. Billing: "<plan> plan", status badge, enabled modules, this month's usage. No cancel button without a payment method. |
| Trial | Same, plus "Trial ends in N days" banner and "Trial ends <date>" on Billing. |
| Paid | "Renews <date>", or "Ends <date> — won't renew" + "Cancellation scheduled" once cancelled; enabled modules; usage; a Cancel button (cancelling a website subscription is account management, not a purchase). |
| Payment failed | Neutral "There's a billing issue on your account." banner. |
| Any | In-app notifications from the billing system keep their status/dates but drop sentences asking to renew, reactivate or update payment (`storeSafeNotificationBody`). Server error text asking to subscribe/upgrade/buy is replaced by the screen's neutral message (`getApiErrorMessage`). |

External links in the app: privacy policy, the account-deletion instructions page, Google's photo guidelines, a
Google review link/QR for the business's customers, `tel:` / `mailto:` /
`wa.me` links to a lead, the WhatsApp Help chat ("Hi, I need help with my
GrowwMatics account"), and the single-use Google Business Profile connect
link. None goes to pricing, checkout, the free report or a demo booking. No
StoreKit, in-app purchase or payment SDK is installed (`ios-platform.test.ts`).

The free report remains a website feature (`/free-report`,
`/api/free-report/start`, unchanged); the iOS app does not mention or link to
it and does not present it as a purchase.

Server-side enforcement is unchanged: the backend still answers
`403 MODULE_LOCKED` / `UPGRADE_REQUIRED` and the app only mirrors that state.

### The unresolved guideline risk

Removing purchase links satisfies **3.1.1(a)** ("apps and their metadata may
not include buttons, external links, or other calls to action that direct
customers to purchasing mechanisms other than in-app purchase", outside the US
storefront). It does **not** resolve this:

- **3.1.1:** "If you want to unlock features or functionality within your app,
  (by way of example: subscriptions, …) you must use in-app purchase."
- **3.1.3(b) Multiplatform Services:** apps "may allow users to access content,
  subscriptions, or features they have acquired in your app on other platforms
  or your web site … provided those items are also available as in-app
  purchases within the app."

The iOS app unlocks paid modules from a subscription bought only on the
website, and offers no in-app purchase. Read literally, that is the situation
3.1.1 covers and that 3.1.3(b)'s condition is not met for. Whether App Review
accepts it is Apple's decision. Specifically, this document does **not** claim:

- that the app qualifies for an exception. 3.1.3(a) covers reader apps
  (magazines, newspapers, books, audio, music, video); 3.1.3(c) covers apps
  "sold directly by you to organizations or groups for their employees or
  students" and says "Consumer, single user, or family sales must use in-app
  purchase"; 3.1.3(f) covers companions to "VoIP, Cloud Storage, Email
  Services, or Web Hosting" tools. None has been shown to apply;
- that the Android app's acceptance on Google Play predicts Apple's decision —
  the stores' rules differ.

Possible outcomes at review: approval; rejection under 3.1.1 / 3.1.3(b) asking
for in-app purchase; or a request for more information about how customers
buy. If rejected, the options are a product decision (e.g. adding in-app
purchase — excluded from current scope — or appealing with facts about the
customer base). Review notes should describe the facts plainly: existing
business customers sign in with accounts and plans created on the website; the
app sells nothing and links to no purchase.

Intended storefront: not stated in the repo; the app defaults to India
(+91, ₹). In the US storefront, 3.1.1(a)'s link prohibition does not apply,
but 3.1.1 and 3.1.3(b) are the same.

## 2. Encryption export compliance — **Decision**

App Store Connect asks whether the app uses non-exempt encryption on every
upload unless `ITSAppUsesNonExemptEncryption` is set. From the code: the app
uses HTTPS via the OS networking stack and the iOS Keychain (expo-secure-store);
no custom cryptography was found in `src/`. Apps limited to standard OS
encryption usually answer "exempt", but this is a legal declaration. If the
owner confirms, add to `app.json`:

```json
"ios": { "config": { "usesNonExemptEncryption": false } }
```

Not set yet on purpose.

## 3. Privacy policy

- Canonical page: `https://growwmatics.com/privacy` (verified live; `www.` and
  trailing-slash variants redirect to it). Linked in the app from More → Legal
  and the sign-in screen.
- **Gap (needs owner/legal):** the policy covers "our website and services" and
  does not mention the mobile apps, phone sign-in over WhatsApp, uploaded
  photos/videos (stored at public-read URLs), location at capture, selected
  contacts, customers'/leads' data, push tokens, or website analytics.
- Verified data flows, draft App Privacy answers, open questions and proposed
  narrow policy wording: **`docs/APP_STORE_PRIVACY_DISCLOSURES.md`**. The
  policy page itself has not been edited. Don't file the App Privacy answers
  until the policy matches them.

## 4. Account deletion

- **5.1.1(v):** "If your app supports account creation, you must also offer
  account deletion within the app." The iOS app does not create accounts
  (`/api/auth/phone-login/request` answers 404 for unknown numbers;
  onboarding creates workspaces for an existing account).
- Existing flow, verified in code: website Profile → Danger Zone →
  `POST /api/user/delete-account`. It requires a signed-in session plus the
  account email (or, for free-report/phone accounts, the login phone);
  soft-deletes the user and owned workspaces; bumps `sessionEpoch` (the iOS
  bearer token is rejected on its next request, so the app signs out); removes
  push tokens; cancels the Razorpay subscription; revokes Google access; the
  purge job erases personal data and stored files after 30 days. Not executed
  against any real account.
- Public page `https://growwmatics.com/delete-account` (live, 200). Updated
  wording (not deployed): it now names "the Android and iOS apps", and the
  confirmation step mentions the login phone number for accounts asked for it
  (the page said "email" only, which was wrong for phone-only accounts).
- The iOS app links to the page from More → Legal → Delete account.

## 5. App Review sign-in (WhatsApp one-time code)

Sign-in is phone + a code delivered over WhatsApp; an App Reviewer can't
receive it, and guideline 2.1(a) asks for demo account info.

**Existing mechanism (verified):** `src/lib/reviewerAccount.ts`, used by
`/api/auth/phone-login/request` and `/verify`, tested in
`tests/integration/security/reviewer-account.test.ts`.

- Off unless both `REVIEWER_PHONE` and `REVIEWER_OTP` (exactly 6 digits) are
  set; matches that one E.164 number only.
- Applies only to a user whose role is `CLIENT` (`isReviewerUser`) — pointing
  the variable at an admin's number does nothing.
- For that user, the request step sends no WhatsApp message; the verify step
  accepts the configured code instead of a one-time code. Everything else is
  unchanged: per-IP+phone rate limits (5 requests / 8 verify attempts per
  window), and 10 wrong codes lock the account for 15 minutes. The QA bypass
  for limits (`isQaTestingMode`) cannot be on in production
  (`NODE_ENV !== 'production'` is required).
- The code does not expire and is not single-use: anyone with the number and
  code can sign in to that account until the variables are changed.

**What a reviewer can reach depends on the account's data:**

- A workspace is needed, otherwise the app opens the create-workspace wizard;
  a workspace created on/after 2026-07-23 must have its intake completed or the
  intake form is shown first.
- Modules: an account **without a subscription record** is allowed every
  module both by the server (`userCanUseModule(null)` → true) and the app.
  An account with a subscription record sees only its enabled modules. Choosing
  between these is an owner decision about billing data — not made here.
- Google-dependent screens (reviews sync, insights, posts publishing, photos)
  need a connected Google Business Profile; without one they show "Connect
  Google". A reviewer should not be asked to connect their own Google account.
- Inbox and WhatsApp agent are super-admin only; the reviewer account must
  stay `CLIENT`.

**Steps for the owner (production — not done):**

1. Create a dedicated `CLIENT` account with a demo workspace (intake complete),
   containing only demo customers/leads, and decide its module access and
   whether to connect a GrowwMatics-owned demo Google Business Profile.
2. Set `REVIEWER_PHONE` / `REVIEWER_OTP` in production to that number and a
   non-obvious 6-digit code. Do not reuse the example `9876543210 / 000000`
   from the tests.
3. In App Store Connect → App Review Information → Sign-in required: the phone
   number (with country code) and the code, plus a note: "Enter the number,
   tap Send code on WhatsApp, then enter this fixed code. It works only for
   this demo account."
4. After the review, rotate or unset the code.

## 6. Other items before submission

- Run `eas init` (new EAS project), `eas credentials -p ios` (incl. APNs key).
- First native build and on-device test (no Xcode was available while this was
  prepared).
- Screenshots (iPhone only; `supportsTablet: false`), support URL.
