# GrowwMatics AI — iOS app

Standalone iOS app (Expo SDK 57, React Native 0.86.3, TypeScript). It is a pure
API client of the existing GrowwMatics Next.js backend in the repository root:
same API, same MongoDB, same server-side business rules, entitlements and
authorization as the web dashboard and the Android app (`../mobile`).

This project is deliberately separate from `../mobile` (the Android app). It
has its own `package.json`, lockfile, `node_modules`, Expo config, EAS project
and tests. Nothing here imports from `../mobile` or from the web app, and Metro
is configured to never resolve packages from the web app's `../node_modules`.

## Where it came from

The source was copied from `../mobile` on 2026-10-24 (Android at commit
`91af39a`) so every screen, workflow and validation rule starts identical.
iOS-specific differences from the Android app:

| Area | Android (`../mobile`) | This app |
|---|---|---|
| Billing screen | "View plans on the web" button | No pricing link (App Store rule 3.1.1(a)); plan, usage, trial banner and Cancel are unchanged — see `docs/APP_STORE_READINESS.md` for the open billing decision |
| Server wording written for the website | Shown as-is | Sentences asking to buy, renew, reactivate or pay are dropped from billing notifications and error messages; the sign-in "no account" message doesn't point to the free report or a demo (`src/lib/storeCompliance.ts`) |
| Gallery photos | Picked as-is | Requested as JPEG (`IOS_COMPATIBLE_LIBRARY_IMAGES`) — iPhone HEIC photos are rejected by the upload routes |
| App icon | `icon.png` (+ Android adaptive icon) | `icon.png` |
| Permission strings | Plugin defaults include "Always" location, Motion, Face ID | Only the permissions the app uses |
| Connect Google Business Profile | Opens `/api/auth/google` (relies on Chrome sharing the website session) | Single-use handoff link from `POST /api/auth/google/mobile-handoff`, opened in an ephemeral auth session |
| Privacy policy | — | Linked from More → Legal and the sign-in screen |
| React Native | 0.86.0 | 0.86.3 (fixes the Hermes V1 regression flagged by expo-doctor) |
| URL scheme | `mobile` | `growwmatics` |
| iPad | — | Not supported (`supportsTablet: false`) |
| OTA updates | expo-updates on the Android EAS project | Not configured yet (see below) |

Android-only code paths (camera capture recovery, clipboard preview chip,
chained date/time dialogs) are kept and are inert on iOS, so the two
codebases stay easy to compare when porting future changes.

**Keeping in sync:** a feature added to `../mobile` is not picked up here
automatically. Port it by hand and add/adjust the tests in `__tests__/`.

## How the app talks to the backend

- Login: phone + WhatsApp one-time code (`/api/auth/phone-login/request`,
  `/verify`) with the `x-client: mobile` header → `{ token, expiresAt }` (30-day
  JWT). Forgot-password uses the same endpoints as Android.
- The token lives in **SecureStore** (iOS Keychain) and is sent as
  `Authorization: Bearer <token>` with `x-business-id` (active workspace).
- Any 401 clears the session. `/api/auth/me` is re-read when the app returns to
  the foreground and whenever the server answers `403 MODULE_LOCKED`, so plan
  changes made on the web reach the app within one refresh.
- Connect Google: the in-app browser has no website session, so the app asks
  `POST /api/auth/google/mobile-handoff` for a single-use, 2-minute link and
  opens it with `openAuthSessionAsync(…, { preferEphemeralSession: true })`.
  The backend consumes it, gives that browser a 15-minute web session for the
  active workspace, and continues into the unchanged web OAuth flow.
- Push: tokens come from this app's own EAS project. The backend splits sends
  per Expo project, so users signed in on both Android and iOS get both.
- Screens use React Query; data refetches on focus/foreground, so edits made on
  the web or Android show up here on the next refresh. There is no separate
  iOS data store or entitlement logic.

## Run it

Requirements: Node 20+, **Xcode** (full app, not just Command Line Tools) with
an iOS Simulator, and CocoaPods (installed by Expo when needed).

```bash
cd ios
npm install
cp .env.example .env        # point EXPO_PUBLIC_API_URL at your backend
npm run ios                 # expo run:ios — builds the native app + starts Metro
```

Start the backend first from the repository root (`npm run dev`). The
Simulator reaches it at `http://localhost:3000`; a physical iPhone needs your
Mac's LAN IP or a tunnel URL. Env changes need a Metro restart.

Without Xcode, use an EAS cloud build for the Simulator instead:
`eas build -p ios --profile development` (see below), install the `.app`, then
`npm start`.

## Checks

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint (own eslint.config.js)
npm test            # jest (jest-expo, iOS platform)
npx expo export --platform ios   # full production JS bundle, no Xcode needed
```

## EAS, TestFlight and the App Store

This app is a **different EAS project** from the Android app on purpose:
sharing one would let `eas update` from either folder overwrite the other
app's JavaScript.

1. `npm i -g eas-cli && eas login`
2. `eas init` — creates the EAS project and writes `extra.eas.projectId` into
   `app.json`. Push notifications need this id to get an Expo push token.
3. `eas credentials -p ios` — distribution certificate, provisioning profile,
   and an APNs key for push notifications.
4. Create the app in App Store Connect (bundle id `com.growwmatics.app`) and
   put its Apple ID into `eas.json` → `submit.production.ios.ascAppId`.
5. `eas build -p ios --profile production`
6. `eas submit -p ios --profile production` → TestFlight.
7. Optional OTA updates: `npx expo install expo-updates && eas update:configure`.

Before submitting for review: privacy policy URL and in-app link, privacy
nutrition labels (contacts, photos, location, name/phone/email, device id for
push), a review demo account that can sign in without WhatsApp, review notes
explaining that subscriptions are bought only on the website, and the
export-compliance answer.

## Layout

```
src/
├── app/            # expo-router routes: (auth), (app) tabs + sections, onboarding
├── api/            # axios client + typed, zod-validated endpoint modules
├── auth/           # AuthContext — token, user, subscription
├── business/       # BusinessContext — active workspace
├── components/     # UI
├── entitlements/   # presentation-only plan gating (server enforces)
├── lib/            # helpers (phone, photo location, theme, …)
└── notifications/  # push registration + tap routing
```
