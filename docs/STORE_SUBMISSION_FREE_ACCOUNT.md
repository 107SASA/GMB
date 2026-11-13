# Store submission — free accounts + visiting-card scanner

For the next App Store / Play Store release (Android `mobile/`, iOS `ios/`).
Plan: [FREE_ACCOUNT_REGISTRATION_PLAN.md](FREE_ACCOUNT_REGISTRATION_PLAN.md).

## 1. Before submitting

- [ ] Server deployed with commit `b0a25ee` or later (sign-up, free CRM, card scan APIs).
- [ ] Admin → Customers → plan limits → **Free**: Max Active CRM Leads **200**, Visiting Card Scans **50**.
- [ ] Admin → Settings: **Allow new free accounts** and **Generate free report** ticked.
- [ ] Server env: `REVIEWER_PHONE` and `REVIEWER_OTP` set, and that number has a **CLIENT** account
      (sign it up once with a real WhatsApp code, or create it from the website).
- [ ] Server env: `GEMINI_API_KEY` (or the Google `NANOBANANA_API_KEY`) — card reading.
- [ ] Privacy policy live at `/privacy` (updated Nov 2026: free accounts, visiting cards, Gemini).
- [ ] New builds — both apps changed native modules (camera/contacts text, `expo-image-manipulator`,
      `expo-file-system`), so an OTA update is not enough.

## 2. App Review notes (paste into App Store Connect → App Review Information / Play → App access)

> Growwmatics AI helps local businesses manage leads and their Google Business Profile.
>
> **Sign-in:** phone number + a one-time code sent on WhatsApp. Reviewers can't receive WhatsApp,
> so please use the demo account: phone **<REVIEWER_PHONE>**, code **<REVIEWER_OTP>** — on the
> login screen, or on "Create a free account" (it signs the demo account in).
>
> **Free account:** anyone can create a free account in the app. It includes the CRM and a
> visiting-card scanner (limits: 200 active leads, 50 card scans per month). Other features are
> part of plans our team sets up with businesses directly; **the app does not sell anything** —
> there are no purchases, prices or payment links in the app.
>
> **Visiting-card scanner:** CRM tab → "Scan card". The camera is used only when the user taps to
> take a photo; the card's details are read by AI and saved as a lead the user can edit.
> "Save to phone contacts" opens the system contact form (no contacts are read).
>
> **Account deletion:** iPhone: More → Delete account (opens our account-deletion page). Android: More → Profile → Delete account (in the app).

## 3. Data declarations

| Data | Collected | Why | Linked to user |
|---|---|---|---|
| Name, phone number | Yes | Account, sign-in (WhatsApp code) | Yes |
| Business name / category / city / Google listing | Yes | Account, free report | Yes |
| Photos (visiting cards, Google profile photos) | Yes — only photos the user takes/picks | App functionality | Yes |
| Contacts | Only contacts the user selects to import (not the address book) | App functionality | Yes |
| Other people's contact details (from scanned cards, imported contacts) | Yes | The user's own CRM | Yes |
| Precise location | Only with Google-profile photos taken in the app, if allowed; **never for visiting cards** | App functionality | Yes |
| Device ID (push token) | Yes | Notifications | Yes |
| Tracking / ads | **No** | — | — |

- Data is encrypted in transit; users can delete their account in the app.
- Third parties that process data: see `/privacy` §4 (Google incl. Gemini, Twilio/Meta WhatsApp, DigitalOcean, Groq, Inngest, Expo).

## 4. Permission texts (already in both `app.json`)

- Camera: "…take photos and videos for your Google Business Profile and scan visiting cards into your CRM."
- Contacts: "…add the ones you choose to your business CRM, and save people from scanned visiting cards to your phone…"
