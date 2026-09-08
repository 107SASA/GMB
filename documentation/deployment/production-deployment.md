# Production Deployment

> **Corrected Sep 2026.** The previous version of this file described a Vercel
> deployment. Production is **not** on Vercel — it is a **DigitalOcean droplet**
> running the Next.js app under **PM2**, behind **Nginx**, with **Inngest Cloud**
> for background jobs and **MongoDB Atlas** for data. The authoritative deploy
> sequence is `scripts/deploy.sh`.

## Architecture

```
Internet ──HTTPS──> Nginx (:443)  ──proxy_pass──> Node / next start (127.0.0.1:3000)  ──> MongoDB Atlas
                                                        │
                                                        ├── Inngest Cloud  (cron + background workers, via /api/inngest)
                                                        ├── Twilio / Meta  (WhatsApp send + inbound webhook)
                                                        ├── Groq           (audit + agent LLM)
                                                        ├── DataForSEO     (keyword volume + Maps rank)
                                                        ├── Google APIs    (Places, GBP, OAuth, Static Maps)
                                                        └── Razorpay       (subscription webhook)
```

- **Server:** DigitalOcean droplet, ~1.9 GB RAM + 4 GB swap, domain `growwmatics.com`.
- **Process manager:** PM2, process name `growwmatics` (`pm2 list`, `pm2 logs growwmatics`).
- **Runtime:** `next start` (so `NODE_ENV=production` is set automatically). Node ≥ 20.9.
- **Build heap:** `NODE_OPTIONS=--max-old-space-size=3072` (droplet) — see `deploy.sh`.

## Deploy sequence

Get the code onto the droplet (`git pull` / rsync / scp), then:

```bash
./scripts/deploy.sh
```

which: stops PM2 → `rm -rf .next` (mandatory full clean — Next bakes
`NEXT_PUBLIC_*` into compiled chunks and the incremental cache can reuse a
stale one) → `npm install` → `npm run build` → `pm2 restart` → re-sync Inngest
(`curl -X PUT https://growwmatics.com/api/inngest`) → verify no
`localhost`/placeholder strings leaked into `.next/server/`.

## MongoDB Atlas

- `src/lib/mongodb.ts` sets `autoIndex: false` when `NODE_ENV=production`, so
  the app never rebuilds indexes on a cold start. **After any deploy that
  changed a schema index, run `scripts/sync-indexes.ts`** — see
  `documentation/security/data-retention.md` §Rollout and
  `documentation/security/index-verification.md`.
- Atlas Network Access must allow the droplet's IP (or `0.0.0.0/0`).

## Nginx

The reverse-proxy config (client-IP headers, HTTPS, the mandatory
"port 3000 not publicly reachable" requirement, optional `limit_req` burst
guard) is in **`documentation/deployment/nginx-rate-limiting.md`**.

## Inngest Cloud

`INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` in `.env.production`. Every deploy
that touches an Inngest function must re-run `PUT /api/inngest` (deploy.sh
does this) so Inngest re-reads the function list.

## Twilio / Meta (WhatsApp)

Inbound webhook URL (Twilio console / Meta app): `https://growwmatics.com/api/whatsapp/webhook`
(the legacy `/api/webhook/twilio` also works — it delegates to the same handler).

## Environment variables

See `.env.production.example` for the full list. New in the Sep 2026 security
pass: `AUTOMATION_TRIGGER_SECRET`, `TRUSTED_PROXY_COUNT` (optional, defaults 1).
