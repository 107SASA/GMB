# Server Audit Report — `growwmatics-prod` (Item 1)

Status: **BLOCKED — SSH access not granted. No server data collected.**
Date: 2026-10-14. Scope: only the droplet `growwmatics-prod`; read-only.

## Access attempt (the only thing actually done)

| Item | Result |
|---|---|
| Host documented in repo | `168.144.22.255` (`docs/LEAD_SALES_PRODUCTION_RUNTIME_VERIFICATION.md`, `documentation/PRODUCTION_READINESS.md`, memory notes). Hostname `growwmatics-prod`, app path `/var/www/gmbboost`, env file present — **as documented at that earlier date, not re-verified today** |
| Username | **Conflicting docs**: `root` (verification doc says it "succeeded with the existing local identity") vs `deploy` (older deploy instructions in PRODUCTION_READINESS.md) |
| Key | `~/.ssh/gmb_do` (exists locally). `~/.ssh` also has `id_rsa`, not tried |
| Attempt 1 | `root@168.144.22.255` with `gmb_do`, `BatchMode`, `StrictHostKeyChecking=yes` → **Permission denied (publickey)** |
| Attempt 2 | `deploy@168.144.22.255` with `gmb_do` → **Permission denied (publickey)** |
| Host key | accepted by the strict check, i.e. the IP is in local `known_hosts` (so the network path and server identity matched) |

Only `hostname; whoami` was ever attempted (and both attempts were rejected before any command ran). I did not try `id_rsa` or other users: the instruction was to use the `gmb_do` configuration and not guess. No other host was contacted.

## What is NOT known (everything in items 1–10)

OS/kernel/uptime/CPU/RAM/swap/disk, OOM evidence, PM2 state and restart counts, Node/npm versions, git commit, nginx, ports/firewall/SSH config, cron/workers, permissions/space, and backup evidence are all **unavailable**. Nothing is inferred.

Previously *documented* (not verified now): nginx/1.24.0 on Ubuntu, app `/var/www/gmbboost`, PM2 process `growwmatics` (deploy.sh) / `gmbboost` (PRODUCTION_READINESS.md — **name conflict to resolve**), ~1.9 GB RAM + 4 GB swap (deploy.sh, production-deployment.md).

## How to complete the audit

Prepared `scripts/server-audit-readonly.sh` (read-only; allow-listed pm2 fields; env values, tokens, keys and connection strings are never printed; nginx/git output is redacted). Run it from your machine with whichever identity works:

```bash
ssh -i ~/.ssh/<working-key> <working-user>@168.144.22.255 'bash -s' \
  < scripts/server-audit-readonly.sh | tee server-audit-$(date -u +%Y%m%dT%H%M%SZ).txt
```

Then give me the output file (or tell me which user/key works and I will run it), and I will turn it into the confirmed-vs-assumed report with risks.

## Open questions for you

1. Which user and key currently works for this droplet (`root`/`deploy`, `gmb_do`/`id_rsa`/other)? Was `gmb_do` authorised for this droplet, or was it for a different/test droplet?
2. Is the PM2 app named `growwmatics` or `gmbboost`?
3. Do you want me to try `id_rsa` against `root@168.144.22.255`, or would you rather run the script yourself?
