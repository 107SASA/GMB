# Infrastructure Audit

Status: **codebase portion complete; server portion PENDING** (no SSH host/user provided, no Atlas or DigitalOcean access). Everything in "Server" is unknown — do not infer it.

## Codebase findings (verified by reading the repo)

| Area | Finding |
|---|---|
| Background platform | Inngest Cloud, single app id `gmb-optimization-platform`, served at `/api/inngest`. 50 exported functions: 23 cron, 27 event (2 dual-trigger). `npm run jobs:inventory` lists them |
| Producers | ~41 `inngest.send(...)` sites in API routes/services + ~10 `step.sendEvent` in functions |
| Durable features used | `step.run`, `step.sleep`, `step.sleepUntil`, `step.sendEvent`, one `cancelOn` pair, one keyed concurrency (`gbp-sync-worker`: global 5, per-business 1) |
| Retry policy | explicit on 18 functions (retries 1–3); the rest rely on Inngest's default of 4 retries |
| Other queues | none (no Redis/BullMQ/Agenda). Mongo-backed patterns: `ScheduledAction` (+ `nurtureSchedulerTick`), `MessageQueue`, `ProcessedWebhookEvent` |
| Event types | 7 event names used by functions are absent from the typed `Events` map in `client.ts` (type-safety gap, not a runtime bug) |
| Deploy | `scripts/deploy.sh`: `pm2 stop growwmatics` → `rm -rf .next` → `npm install --legacy-peer-deps` → `npm run build` (heap 3072 MB, 4 GB swap) → `pm2 restart` → `PUT /api/inngest` resync. **Web app is down for the whole build.** |
| Process manager | PM2 app `growwmatics` (`next start`). No ecosystem file existed before this change |
| Reverse proxy | Nginx → `127.0.0.1:3000`; config guidance in `documentation/deployment/nginx-rate-limiting.md` (port 3000 must not be public — **verify**) |
| DB | MongoDB Atlas via Mongoose; pool `maxPoolSize 10`, `autoIndex:false` in production (so new indexes need explicit creation — the queue creates its own) |
| Env validation | `src/lib/env.ts` at boot (rejects `INNGEST_DEV` in production) |
| Safety switches that bound blast radius | `GBP_LIVE_WRITES_ENABLED` (live GBP writes off by default), `QA_SUPPRESS_OUTBOUND_SENDS` (staging-only outbound send suppression; `QA_TESTING_MODE` is a different, onboarding-gate flag), `ACCOUNT_PURGE_MODE` (dry-run default), `LEAD_ENGINE_V2` |
| Monitoring/backup in repo | none found beyond logs. No alerting, no backup scripts (`scripts/db-migrate.mjs` is a migration toolkit) |
| Docs drift | `documentation/deployment/scaling-guide.md` still says "Vercel"; production-deployment.md was corrected Sep 2026 |

## Operational risks (from the code)

1. **Single droplet, single web process** — no HA; builds stop the site.
2. **Build OOM history** on ~1.9 GB RAM; a long-running worker on the same box competes with builds.
3. **At-least-once** everywhere: external side-effects are protected only by in-handler guards (not by the queue).
4. **Inngest plan concurrency limit 5** is hard-coded into `gbp-sync-worker` — native removes the vendor limit but also its built-in throttling; Groq/DataForSEO rate limits then depend on worker concurrency.
5. Wide import graph: the worker loads `functions.ts` (≈5.5k lines + the app service graph). RSS of that process is **unmeasured**.
6. Secrets: `.env.local`, `.env.local.bak`, `.env.production` sit in the working tree (git-ignored — **confirm `.gitignore`/history** before any backup/archiving).

## Server (PENDING — checklist of read-only commands to run once access is granted)

```bash
hostnamectl; lsb_release -a; nproc; free -m; swapon --show; df -h; uptime
top -bn1 | head -20; ps aux --sort=-%mem | head -15
pm2 list; pm2 describe growwmatics; pm2 conf 2>/dev/null | head
systemctl list-units --type=service --state=running | head -40
sudo ufw status verbose; sudo ss -tlnp; sudo sshd -T | grep -Ei 'permitroot|passwordauth'
sudo nginx -T 2>/dev/null | grep -nE 'server_name|proxy_pass|listen|limit_req'
crontab -l; ls /etc/cron.d; ls -la ~/.pm2/logs | head; cat /etc/logrotate.d/pm2* 2>/dev/null
node -v; git -C <app> rev-parse HEAD; ls -la <app> | head -30
```
Plus DigitalOcean dashboard: droplet plan, backups on/off, snapshots, firewall, monitoring agent. Plus Atlas: tier, backup, network access, connection count (Metrics).

## Plan recommendation (unchanged from the proposal)

Regular 2 vCPU / 4 GB (~$24/mo, **price to be confirmed in the DO dashboard**), CPU/RAM-only resize (keep the disk to preserve rollback). Premium variants only if monitoring shows CPU-bound jobs. Decision deferred until the server baseline exists.
