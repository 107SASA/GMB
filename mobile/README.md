# GMB Boost — Mobile App (Expo)

React Native client for the GMB Boost backend. The app is a pure API client:
all business logic lives in the Next.js monolith one directory up, and the app
talks to the same API and MongoDB as the web dashboard.

## Stack

- Expo SDK 57 (managed workflow, TypeScript)
- expo-router — file-based navigation (routes live in `src/app/`)
- @tanstack/react-query — server state
- axios — API client (`src/api/client.ts`)
- expo-secure-store — auth token storage (never AsyncStorage)
- nativewind 4 + tailwindcss 3.4 — styling (dark SaaS theme)
- zod — response validation on critical payloads

## How auth works

- Login: `POST /api/auth/login` with the `x-client: mobile` header → the
  backend returns `{ token, expiresAt }` in the body (a 30-day HS256 JWT, the
  same token format the web puts in the `session` cookie).
- The token is stored in **SecureStore** and attached to every request as
  `Authorization: Bearer <token>` by the axios interceptor, along with
  `x-business-id` (active workspace) and `x-client: mobile`.
- On launch, `AuthContext` restores the token from SecureStore and hydrates
  the user via `GET /api/auth/me`. Any 401 on an authenticated endpoint clears
  the token and returns to the login screen.
- Logout is purely local (clear SecureStore) — the mobile JWT is stateless;
  `POST /api/auth/logout` only clears the web cookie.

## Workspace (business) selection

- `BusinessContext` fetches `GET /api/user/businesses` after login.
- Selection order: persisted choice → the server-side `activeBusinessId` from
  `/api/auth/me` → auto-select when there's exactly one business → otherwise a
  picker screen is shown before the tabs.
- The choice is persisted (SecureStore) and drives the `x-business-id` header.
  Switch anytime from the **More** tab.

## Running against local dev

1. Start the Next.js server in the repo root: `npm run dev`.
2. The server must be reachable **from the device** — `localhost` won't work
   from a physical phone. Either:
   - Use your machine's LAN IP (same Wi-Fi): find it with `ipconfig`
     (Windows) and use `http://<lan-ip>:3000`, or
   - Tunnel: `ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000`
     and use the HTTPS URL it prints.
3. `cp .env.example .env` and set `EXPO_PUBLIC_API_URL` to that URL
   (no trailing slash). Env changes require restarting `expo start`.
4. Install and start:

   ```bash
   npm install
   npx expo start
   ```

   Scan the QR code with Expo Go (Android) or the Camera app (iOS), or press
   `a`/`i` for an emulator/simulator.

Note for Android emulator users: `http://10.0.2.2:3000` reaches the host
machine's localhost.

## Project layout

```
src/
├── app/                    # expo-router routes
│   ├── _layout.tsx         # providers (react-query, auth, business) + splash gate
│   ├── index.tsx           # redirect → /dashboard or /login
│   ├── (auth)/login.tsx    # email+password sign-in
│   └── (app)/              # authed tab bar: Dashboard, Inbox, Leads, Reviews, More
├── api/
│   ├── client.ts           # axios instance, headers, 401 interceptor
│   └── endpoints/          # typed + zod-validated functions per domain
├── auth/AuthContext.tsx    # token + user + subscription state
├── business/BusinessContext.tsx  # active workspace + switcher logic
└── components/             # shared UI (dark theme primitives)
```

Inbox / Leads / Reviews / Dashboard screens are placeholder stubs — they get
implemented in later phases. There is no OTP screen because the current
backend login flow doesn't require one. The app intentionally contains no
pricing, checkout, or upgrade links (web-only billing model); it only reads
subscription state from `/api/auth/me` to lock/unlock features.

## Lead capture, privacy & store compliance (Phase 4B)

Three capture paths feed the same `Lead` collection the web CRM uses:

1. **Manual / paste** — "Add lead" on the Leads tab; `POST /api/leads/quick-add`
   normalizes the phone to E.164 (default region IN) and dedupes by number
   within the business.
2. **Contacts import** — "From contacts" uses `expo-contacts`. Permission is
   requested only after the user taps the feature AND accepts the in-app
   consent sheet. Only user-selected entries are sent
   (`POST /api/leads/bulk-import`, max 200); the full address book is NEVER
   uploaded automatically.
3. **Call logging (Plan A)** — calls started from a lead's Call button prompt
   "How did the call go?" on return to the app and write a `call` Activity;
   the "Log a call" quick action creates/updates a lead with source
   "Phone Call". No call-log permission involved.

### Plan B (Android call-log capture) — OFF, read before enabling

- Gated behind the remote flag `androidCallLogCapture`
  (`GET /api/mobile/flags`, server env `MOBILE_FLAG_ANDROID_CALL_LOG`) **and**
  `Platform.OS === 'android'`. The flag defaults OFF and the current build
  contains no call-log code or permission.
- Google Play requires a **Permissions Declaration Form** for
  `READ_CALL_LOG`/`READ_PHONE_STATE` and rejects most non-dialer apps that
  request them. Ship releases WITHOUT these permissions in the merged
  manifest (verify with `npx expo prebuild` + inspect
  `android/app/src/main/AndroidManifest.xml` after any native-dep change);
  only add the permission in a later build if the declaration is filed and
  approved.
- iOS provides no call-log access to any app — iOS keeps Plan A only, no
  workarounds.
- If ever implemented: show recent calls locally, create leads only for
  entries the user explicitly taps, never upload the raw call log.

### Store declarations to file

- **Play Data Safety form**: Contacts (name, phone number) — collected,
  user-initiated only, purpose "App functionality" (CRM), shared with no
  third parties beyond the app's own backend; data is user-deletable via the
  CRM.
- **App Store privacy labels**: "Contacts" — Linked to the user, used for App
  Functionality. `NSContactsUsageDescription` is set in app.json via the
  expo-contacts plugin.
- The in-app consent sheet (`src/components/consent-sheet.tsx`, shown once
  before first contacts/call capture) documents the same promise in-product.
