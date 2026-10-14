# Backup and Recovery

Status: **PLAN ONLY — no backup has been taken, verified or restored by this work.** Phase 2 is gated on approval and on server/Atlas access I do not have yet. Nothing below is claimed as done.

## What this change does and does not touch

The native queue only **adds** collections (`native_jobs`, `native_job_cron_state`, `native_job_locks`, `native_job_workers`). It does not modify existing collections. Therefore queue state is *not* the primary reason to back up, but the **cutover and the droplet resize** are production-impacting and require restore points first.

## Items and owners

| Item | How | Owner | Status |
|---|---|---|---|
| MongoDB Atlas automated backup / PIT config | Atlas UI → Cluster → Backup (tier, continuous backup, retention, latest snapshot) | owner (needs Atlas access) | **PENDING** |
| Pre-migration Atlas snapshot | Atlas → Backup → "Take snapshot now" (M10+). On M0/M2/M5 no snapshots exist → `mongodump` instead | owner | **PENDING** |
| Manual dump (if tier lacks snapshots) | `mongodump --uri="$MONGODB_URI" --gzip --archive=pre-cutover-<date>.gz` run from a trusted host; store encrypted, mode 600 | needs approval | **PENDING** |
| DigitalOcean droplet snapshot | DO control panel → Droplet → Snapshots (power-off for a consistent disk, or live snapshot with risk) | owner (manual dashboard) | **PENDING** |
| DO automated backups enabled? | Droplet → Backups tab | owner | **PENDING** |
| App/config archive | tar of app dir minus `node_modules`/`.next`, `.env.production`, PM2 `dump.pm2`, nginx `sites-enabled`, crontab; **`gpg -c` or `age`-encrypt, chmod 600; never print env values** | needs approval | **PENDING** |
| Git commit / release id | record `git rev-parse HEAD` on the droplet | read-only | **PENDING** |

Note: a DO snapshot **does not** include MongoDB Atlas data (Atlas is external). Both are required.

## Provisional exact commands (for the approval step; not executed)

```bash
# On the droplet — config/app archive (secrets: written to an encrypted file only)
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
cd /path/to/app                                   # PENDING: real path
git rev-parse HEAD > /root/backup-$STAMP.commit
pm2 save && cp ~/.pm2/dump.pm2 /root/backup-$STAMP.pm2
tar --exclude=node_modules --exclude=.next -czf - . \
    /etc/nginx/sites-enabled ~/.pm2/dump.pm2 \
  | gpg --symmetric --cipher-algo AES256 -o /root/backup-$STAMP.tar.gz.gpg
chmod 600 /root/backup-$STAMP.*
sha256sum /root/backup-$STAMP.tar.gz.gpg > /root/backup-$STAMP.sha256
```

## Verification (required before any production change)

1. **Atlas**: snapshot status `Completed`, timestamp ≥ the start of the maintenance window; note the snapshot id.
2. **Dump** (if used): `gzip -t file`, `mongorestore --dryRun` against a *scratch* cluster/DB (never prod), compare collection counts for `users`, `businesses`, `leads`, `posts`, `audits`, `subscriptions` against live `countDocuments`.
3. **Archive**: `sha256sum -c`, decrypt to a temp dir and list; confirm `.env.production` present (do not `cat`).
4. **Droplet snapshot**: shows `available` in the DO UI with size ≈ used disk.
5. Record: location, timestamp, contents, verification result in this file's "Record" table (below) **before** proceeding.

## Restore

| Scenario | Procedure |
|---|---|
| Bad cutover | `rollback-procedure.md` — no restore needed, additive only |
| Droplet corrupted after resize | DO → create droplet from snapshot (new IP; update DNS/Atlas IP allow-list) — **resize rollback**: only possible if the disk was not enlarged |
| Data damaged in Atlas | Atlas PIT/snapshot restore **to a new cluster**, validate, then repoint `MONGODB_URI`. **Never restore over the live cluster.** |
| Lost config | decrypt archive to a temp dir, copy individual files back; never overwrite `.env.production` blindly |

## Record (fill in at Phase 2)

| Artifact | Location | Timestamp | Contents | Verified by / result |
|---|---|---|---|---|
| Atlas snapshot | — | — | — | — |
| DO snapshot | — | — | — | — |
| Config archive | — | — | — | — |
| Mongo dump (if needed) | — | — | — | — |

## Recovery risks

* Atlas tier unknown (affects snapshot availability) — **PENDING**.
* Snapshot of a running droplet may be crash-consistent only.
* Restoring a droplet snapshot rolls back app files **and** any worker state, but not Atlas; native queue documents in Atlas would then be newer than the restored code — stop the worker before restoring.
