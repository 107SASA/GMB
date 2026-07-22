# Production Readiness — GMBBoost @ growwmatics.com

**Status as of 2026-07-22:** Deployed and serving at https://growwmatics.com.
Infrastructure is healthy. **Not yet safe or complete as a commercial SaaS** —
4 security holes are live on the public internet, and the two things customers
pay for (GBP publishing, WhatsApp messaging) are currently mocked or sandboxed.

---

## 1. What is verified WORKING in production

Probed live on 2026-07-22:

| Check | Result |
|---|---|
| DNS `growwmatics.com` + `www` | → `168.144.22.255` |
| HTTP → HTTPS | 301 redirect ✅ |
| TLS certificate | Valid, verifies cleanly ✅ |
| Web server | nginx/1.24.0 (Ubuntu) ✅ |
| Next.js app | Serving, `x-nextjs-cache: HIT` ✅ |
| Security headers | All 5 from `next.config.ts`, exactly once each (no Nginx duplication) ✅ |
| MongoDB Atlas from droplet | `/api/billing/plans` → 200 with live plan data ✅ |
| Session auth | `/api/auth/me` → 401 unauthenticated ✅ |
| Build used correct env | Zero `localhost` in served HTML → `NEXT_PUBLIC_*` inlined correctly ✅ |
| Secret file exposure | `/.env`, `/.env.production`, `/.git/config`, `/.git/HEAD` → all 404 ✅ |
| Meta webhook handshake | Correct token → echoes challenge (200); wrong token → 403 ✅ |

The deployment itself was done correctly. Everything below is application and
account configuration, not server work.

---

## 2. P0 — Live security holes

> **STATUS 2026-07-22: all fixed in code. Not yet deployed — the droplet is
> still running the vulnerable build until you pull and rebuild (see §2.6).**
> Item 2.3 additionally requires rotating the passwords in Atlas by hand; the
> code change alone does not invalidate the credentials already in Git history.

### 2.1 `/api/automation/trigger` is unauthenticated
`src/app/api/automation/trigger/route.ts:12` — the `return` inside the auth
check is commented out, so the `if` body is empty and execution always falls
through:

```ts
if (authHeader !== `Bearer ${process.env.JWT_SECRET}`) {
  // return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
}
```

Anyone can `POST https://growwmatics.com/api/automation/trigger` in a loop and
drive `checkScheduledPosts()` — burning Groq and SerpAPI credits and hammering
Atlas. **Fix: uncomment the return.**

### 2.2 `/api/posts/[id]` PUT and DELETE are unauthenticated
`src/app/api/posts/[id]/route.ts` calls `Post.findByIdAndUpdate` / delete with
no session check and no tenant scoping. Any post ObjectId can be rewritten or
destroyed by anyone, across tenants. **Fix: add `requireBusinessContext()` and
scope the query by `businessId`.**

### 2.3 Live Atlas credentials in Git history
Five tracked files contain hardcoded connection strings for **two clusters**:

| File | User |
|---|---|
| `scripts/debug_business.ts:2` | `ishantoraskar07_db_user` |
| `scripts/find_user.ts:2` | same |
| `scripts/test_demo.ts:2` | same |
| `scripts/test_desun.ts:2` | same |
| `scripts/seed-superadmin.mjs:9` | `vaishnavinimse8797_db_user` — **this is the live production DB** |

They are in the GitHub history at `107SASA/GMB`. Deleting the files does not
remove them from history. **Fix: rotate both passwords in Atlas, update
`.env.production`, strip the literals, redeploy.**

### 2.4 Google Places routes are unauthenticated — FIXED (rate limited)
`/api/google/autocomplete`, `/api/google/place-details`,
`/api/google/resolve-gbp-url` are public and spend `GOOGLE_MAPS_API_KEY` quota.

These **cannot** require a session: `/onboarding` is a public signup wizard and
`StepBusiness` (step 4 of 9) calls them before the account is created. Adding
auth would break signup. Fixed with per-IP rate limiting instead — 60 req /
5 min for autocomplete and place-details, 30 req / 5 min for resolve-gbp-url —
using the existing `checkRateLimit` / `getClientIp` helpers.

**Still required: restrict the key by HTTP referrer + API in Cloud Console.**

### 2.5 SSRF in `/api/google/resolve-gbp-url` — FIXED (found during the fix)
Not in the original audit. `isShortUrl()` tested its regex against the whole URL
string unanchored, so `http://169.254.169.254/?x=maps.app.goo.gl` counted as a
Google short link and was fetched server-side — and `expandUrl` used
`redirect: 'follow'`, so even a legitimate `goo.gl` link could bounce the server
to an internal address. On a DigitalOcean droplet `169.254.169.254` serves
instance metadata. Reachable unauthenticated from the public internet.

Fixed by matching on the parsed **hostname**, and following redirects manually
(max 5 hops) with the hostname re-validated against an allowlist at every hop.

### 2.6 Deploying the fixes

```bash
ssh deploy@168.144.22.255
cd /var/www/gmbboost
git pull origin dev
npm ci
npm run build
pm2 restart gmbboost
pm2 logs gmbboost --lines 30 --nostream | grep -F '[env]'
```

Then verify from your machine — this must return 401, not 200:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://growwmatics.com/api/automation/trigger
```

---

## 3. P1 — The product does not actually work yet

The infrastructure is fine; the paid features are not connected.

### 3.1 GBP publishing is MOCKED
`GBP_LIVE_WRITES_ENABLED=false` in `.env.production`. Per `src/lib/gbpSafety.ts`
every publish and review-reply path writes only to our own database and never
calls Google. **A customer can pay, schedule posts, see them marked published —
and nothing reaches their Google Business Profile.** This flag was correct as a
safety measure during development; it must be verified on a test GBP account and
then flipped before selling.

### 3.2 WhatsApp is on the Twilio sandbox
`META_WHATSAPP_ACCESS_TOKEN` and `META_WHATSAPP_PHONE_NUMBER_ID` are empty, so
`src/services/whatsapp/send.ts` silently falls back to Twilio — and
`TWILIO_WHATSAPP_NUMBER=+14155238886` is Twilio's **shared sandbox**, which only
delivers to numbers that have manually opted in. Review campaigns and the AI
appointment agent cannot reach real customers. Also `META_APP_SECRET` is empty,
so inbound webhook signature verification will reject all incoming messages.

### 3.3 Razorpay cannot collect money
`RAZORPAY_KEY_ID=rzp_test_...` — test mode, no real payments.
`RAZORPAY_WEBHOOK_SECRET` is empty, so even successful payments would fail
signature verification at `src/app/api/webhook/razorpay/route.ts:44` and
subscriptions would never activate.

### 3.4 Google OAuth consent screen is still in Testing
Every customer's refresh token expires after **7 days**, so all GBP connections
break weekly. Moving to production requires Google verification of the GBP
scopes, which takes **days to weeks** and requires a published privacy policy
and terms page. **This is the longest lead time item — start it first.**

### 3.5 Email is partly unconfigured
- Resend: `growwmatics.com` must be verified (DKIM/SPF/DMARC at the registrar),
  and the API key currently belongs to the intern's personal account.
- `SENDGRID_API_KEY` is empty → review-request emails are silently mocked.

### 3.6 `AUTOMATION_API_KEY` is missing from every env file
All 4 `/api/n8n/*` routes return HTTP 500.

---

## 4. P2 — SaaS hardening

| Item | Why it matters |
|---|---|
| **Prod and dev share one Atlas cluster** | `MONGODB_URI` points at the same cluster as local dev. One stray `scripts/cleanup-*.js` run destroys customer data. Highest-consequence infrastructure risk. |
| **`www` and apex both serve 200** | No canonical redirect. The Google OAuth redirect URI is registered for the apex only, so anyone arriving via `www` hits `redirect_uri_mismatch`. Add a 301 `www` → apex in Nginx. |
| **Rate limiting covers 2 of 146 routes** | Only login and forgot-password. OTP verify, registration, and every AI-spending endpoint are unthrottled. In-memory (`src/lib/rateLimit.ts`), so it also blocks horizontal scaling. |
| **No Content-Security-Policy** | Deliberately deferred; needs per-page testing with Razorpay + Google Maps. |
| **`autoIndex` enabled in production** | Mongoose rebuilds indexes on every cold start against live data. |
| **No error tracking** | No Sentry or equivalent. Production failures are only visible in `pm2 logs`. |
| **No uptime monitoring / Atlas backups** | Neither configured. |
| **No PM2 log rotation** | `pm2 install pm2-logrotate` — disk fills otherwise. |
| **`ecosystem.config.js` not in repo** | Deployment config lives only on the droplet. |

---

## 5. P3 — Commercial completeness

- **Legal pages**: privacy policy, terms of service, refund/cancellation policy.
  Not optional — Google OAuth verification requires the first two, and Razorpay
  requires a refund policy for Indian merchants.
- **`package.json` name is `"temp-app"`**; no `engines` field pinning Node.
- **`node-cron`** is installed but never imported — dead dependency.
- **Mobile app** (`mobile/`): `EXPO_PUBLIC_API_URL` is set for production but the
  app has not been built or submitted.
- **Superadmin** needs seeding with rotated credentials.
- **`main` is 5 commits behind `dev`** — production is deployed from `dev`.

---

## 6. Recommended order

1. **Today** — §2.1, §2.2 (code, ~1 hour), then rotate Atlas passwords (§2.3)
   and restrict the Maps key (§2.4). Redeploy.
2. **Day 1** — Start Google OAuth verification (§3.4). It gates the core feature
   and has the longest wait. Publish privacy policy + terms first, since
   verification requires them.
3. **Week 1** — Separate the production Atlas cluster (§4). Fill Meta WhatsApp
   keys (§3.2). Razorpay live keys + webhook secret (§3.3). Resend domain (§3.5).
4. **Week 2** — Verify GBP writes on a test account, then enable
   `GBP_LIVE_WRITES_ENABLED` (§3.1). Extend rate limiting. Add Sentry, uptime
   monitoring, Atlas backups.
5. **Before first paying customer** — legal pages, refund policy, and an
   end-to-end rehearsal: signup → OTP → GBP connect → audit → schedule post →
   verify it appears on a real Google profile → WhatsApp campaign → paid
   subscription → webhook activation.

---

## 7. Honest assessment

The engineering quality is above average for this stage. Webhook signatures are
verified with constant-time comparison across all three providers, GBP tokens
are encrypted at rest with AES-256-GCM, the Mongoose pool is properly tuned,
boot-time env validation catches misconfiguration, and `gbpSafety.ts` is a
genuinely good piece of defensive design. The deployment is clean.

But **this cannot take a paying customer today.** Four endpoints are exploitable,
the flagship GBP-publishing feature writes to nothing, WhatsApp cannot reach real
phone numbers, and Razorpay cannot charge a card. Realistically **2–3 weeks** of
work plus the Google verification wait, which runs in parallel and is the
critical path.
