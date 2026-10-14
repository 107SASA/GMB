#!/usr/bin/env bash
#
# READ-ONLY audit of the growwmatics-prod droplet. Run FROM your machine:
#
#   ssh -i ~/.ssh/gmb_do <USER>@168.144.22.255 'bash -s' < scripts/server-audit-readonly.sh | tee server-audit-$(date -u +%Y%m%dT%H%M%SZ).txt
#
# Only inspects: no restarts, no writes (other than this output), no installs,
# no firewall/service changes, no MongoDB connection, no snapshots.
# Never prints: env var values, .env contents, tokens, keys, connection strings.
# (pm2 output is reduced to an allow-list of fields; nginx/git output is redacted.)
# Some sections need root/sudo; unreadable items print "(no access)".

set -u
APP="${APP_DIR:-/var/www/gmbboost}"
S() { printf '\n===== %s =====\n' "$1"; }
R() { sed -E 's#(mongodb(\+srv)?://)[^ @/]*@#\1***@#g; s#(://)[^/@ ]+:[^/@ ]+@#\1***@#g; /(password|passwd|secret|token|api[_-]?key|private)/Id'; }

S "0. identity"; hostname; whoami; date -u +%FT%TZ

S "1. OS / kernel / uptime / CPU / RAM / swap / disk"
grep -E '^(PRETTY_NAME|VERSION)=' /etc/os-release; uname -r; uptime
nproc; lscpu | grep -E 'Model name|^CPU\(s\)|Thread|MHz' | head -5
free -m; swapon --show 2>/dev/null; cat /proc/sys/vm/swappiness
df -hT -x tmpfs -x devtmpfs; df -i / | tail -1
S "1b. disk breakdown (top level)"; du -xh --max-depth=1 / 2>/dev/null | sort -rh | head -12

S "2. memory pressure / OOM evidence"
vmstat 1 3
grep -E 'MemAvailable|SwapFree|SwapTotal|Committed_AS' /proc/meminfo
(dmesg -T 2>/dev/null || echo "(dmesg: no access)") | grep -iE 'out of memory|oom-kill|killed process' | tail -20
(journalctl -k --since '45 days ago' --no-pager 2>/dev/null || echo "(journalctl: no access)") | grep -iE 'out of memory|oom-kill|killed process' | tail -20
ps -eo pid,user,rss,pmem,pcpu,etime,args --sort=-rss | head -12 | cut -c1-160

S "3. PM2 (allow-listed fields only; no env)"
if command -v pm2 >/dev/null; then
  pm2 jlist 2>/dev/null | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception as e: print("(pm2 jlist unreadable)", e); sys.exit()
for p in d:
    e=p.get("pm2_env",{}); m=p.get("monit",{})
    print({"name":p.get("name"),"pm_id":p.get("pm_id"),"pid":p.get("pid"),"status":e.get("status"),
      "restarts":e.get("restart_time"),"unstable_restarts":e.get("unstable_restarts"),
      "uptime_ms_since":e.get("pm_uptime"),"exec_mode":e.get("exec_mode"),"instances":e.get("instances"),
      "cwd":e.get("pm_cwd"),"script":e.get("pm_exec_path"),"node":e.get("node_version"),
      "out_log":e.get("pm_out_log_path"),"err_log":e.get("pm_err_log_path"),
      "mem_MB":round((m.get("memory") or 0)/1048576),"cpu":m.get("cpu"),
      "max_memory_restart":e.get("max_memory_restart")})
'
  pm2 -v; ls -la ~/.pm2/logs 2>/dev/null | head -20; ls ~/.pm2/dump.pm2 2>&1
  echo "-- pm2 startup unit:"; systemctl list-unit-files 2>/dev/null | grep -i pm2
  echo "-- pm2 logrotate module:"; pm2 ls 2>/dev/null | grep -i logrotate || echo "(not installed/listed)"
else echo "(pm2 not on PATH for this user — try sudo -u <app-user>)"; fi

S "4. Node / npm"
node -v; npm -v; command -v node; ls /usr/lib/node_modules 2>/dev/null | head

S "5. App deployment structure / git"
ls -ld "$APP"; ls -la "$APP" 2>/dev/null | awk '{print $1,$3,$4,$5,$6,$7,$8,$9}' | head -50
git -C "$APP" rev-parse HEAD 2>&1
git -C "$APP" log -1 --format='%H %cI %an %s' 2>&1 | cut -c1-200
git -C "$APP" branch --show-current 2>&1
git -C "$APP" remote -v 2>&1 | R
echo "-- uncommitted file count:"; git -C "$APP" status --porcelain 2>/dev/null | wc -l
echo "-- .next build id / mtime:"; ls -la --time-style=long-iso "$APP/.next/BUILD_ID" 2>&1
echo "-- package.json deps check (versions only):"; grep -E '"(next|inngest|mongoose|node)"' "$APP/package.json" 2>/dev/null | head -5
echo "-- env file PRESENT? (names only, never contents):"; ls -la --time-style=long-iso "$APP"/.env* 2>&1 | awk '{print $1,$3,$4,$5,$6,$7,$9}'
echo "-- number of vars defined in .env.production (count only):"; grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$APP/.env.production" 2>/dev/null
echo "-- JOBS_/INNGEST_ keys PRESENT (names only):"; grep -oE '^(JOBS_[A-Z_]+|INNGEST_[A-Z_]+|ACCOUNT_PURGE_MODE|GBP_LIVE_WRITES_ENABLED|QA_TESTING_MODE|LEAD_ENGINE_V2)=' "$APP/.env.production" 2>/dev/null | sort -u

S "6. Nginx (redacted)"
(nginx -v) 2>&1
ls -la /etc/nginx/sites-enabled 2>/dev/null
(nginx -T 2>/dev/null || cat /etc/nginx/sites-enabled/* 2>/dev/null) | R | grep -nE 'server_name|listen|proxy_pass|upstream|limit_req|client_max_body_size|ssl_certificate |include|return|X-Forwarded|real_ip' | head -60
ls -la /etc/letsencrypt/live 2>/dev/null | head; (certbot certificates 2>/dev/null | grep -E 'Domains|Expiry') | head

S "7. Services / ports / firewall / SSH"
systemctl list-units --type=service --state=running --no-pager 2>/dev/null | awk '{print $1,$4}' | head -40
ss -tlnp 2>/dev/null | awk 'NR==1||1' | cut -c1-150
echo "-- ufw:"; (ufw status verbose 2>&1 | head -30)
echo "-- iptables (head):"; (iptables -S 2>&1 | head -15)
echo "-- fail2ban:"; (systemctl is-active fail2ban 2>&1; fail2ban-client status 2>&1 | head -5)
echo "-- sshd effective (selected):"; (sshd -T 2>/dev/null | grep -E '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|allowusers|maxauthtries|x11forwarding) ')
echo "-- users with login shells / sudo:"; grep -E '(/bin/bash|/bin/sh|/bin/zsh)$' /etc/passwd | cut -d: -f1,3,6; getent group sudo
echo "-- authorized_keys count per user (counts only):"
for h in /root /home/*; do [ -f "$h/.ssh/authorized_keys" ] && printf '%s %s\n' "$h" "$(grep -cE '^(ssh|ecdsa)' "$h/.ssh/authorized_keys")"; done
echo "-- unattended upgrades / pending reboot:"; ls /var/run/reboot-required 2>&1; systemctl is-active unattended-upgrades 2>&1
echo "-- DO agents:"; systemctl is-active do-agent droplet-agent 2>&1

S "8. cron / timers / workers"
echo "-- crontab (current user):"; crontab -l 2>&1 | R
for u in root deploy www-data; do echo "-- crontab $u:"; crontab -l -u "$u" 2>&1 | R | head -20; done
echo "-- /etc/cron.d:"; ls -la /etc/cron.d 2>&1; ls /etc/cron.daily /etc/cron.weekly 2>&1 | head -30
echo "-- systemd timers:"; systemctl list-timers --all --no-pager 2>/dev/null | head -25
echo "-- node/worker-like processes:"; ps -eo pid,user,etime,args | grep -E 'node|next|tsx|worker|mongod|redis' | grep -v grep | cut -c1-170
echo "-- redis/mongod local?"; ss -tlnp 2>/dev/null | grep -E ':6379|:27017' || echo "(none listening)"
echo "-- Inngest usage hint (route present, names only):"; ls "$APP/src/app/api/inngest" 2>&1

S "9. permissions / space for backups"
stat -c '%A %U:%G %n' "$APP" "$APP/.env.production" "$APP/.next" "$APP/node_modules" 2>&1
du -sh "$APP" --exclude=node_modules --exclude=.next 2>/dev/null
du -sh "$APP/node_modules" "$APP/.next" 2>/dev/null
df -h / /var /root /home 2>/dev/null | awk '!seen[$0]++'
ls -la /var/uploads "$APP/public/uploads" "$APP/uploads" 2>&1 | head -15

S "10. backups"
echo "-- backup-looking files (name/size/mtime only):"
find /root /home /var/backups /opt /srv /var/www -maxdepth 4 -xdev -type f \( -iname '*backup*' -o -iname '*.dump' -o -iname '*.sql' -o -iname '*.sql.gz' -o -iname '*.tar.gz' -o -iname '*.tgz' -o -iname '*.archive' -o -iname '*.bak' \) -not -path '*/node_modules/*' -not -path '*/.next/*' -not -path '*/.git/*' -printf '%TY-%Tm-%Td %TH:%TM  %10s  %p\n' 2>/dev/null | sort -r | head -30
echo "-- backup scripts:"; find /root /home /opt /usr/local/bin /etc/cron.* -maxdepth 3 -type f \( -iname '*backup*' -o -iname '*dump*' \) 2>/dev/null | head
echo "-- /var/backups:"; ls -la --time-style=long-iso /var/backups 2>&1 | head -15
echo "-- mongodump/rclone/restic/s3 tools present?"; for c in mongodump mongorestore rclone restic aws s3cmd doctl; do command -v $c >/dev/null && echo "$c: yes" || echo "$c: no"; done
echo "-- app-level backup/purge hints in cron:"; (crontab -l 2>/dev/null; cat /etc/cron.d/* 2>/dev/null) | grep -iE 'backup|dump|mongo|snapshot' || echo "(none)"
echo "-- DO droplet backups flag cannot be read from inside the droplet; check the DO dashboard."

S "END"; date -u +%FT%TZ
