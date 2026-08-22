#!/usr/bin/env bash
#
# Standard deploy sequence for the growwmatics.com droplet. Run this AFTER
# the updated source files are already in place in this directory (however
# you get code onto the droplet — git pull, rsync, scp — is unchanged; this
# script only covers what happens once the files are here).
#
# Always does a FULLY CLEAN rebuild (rm -rf .next first) rather than a plain
# `npm run build`. Next.js bakes NEXT_PUBLIC_* env vars into compiled output
# at build time, including server-side code (Inngest functions, API routes) —
# and its incremental build cache can silently reuse an old compiled chunk
# with a stale/undefined value baked in, even though the live env var is
# correct. This has already caused two real bugs in production: the
# marketing site's WhatsApp number showing the old sandbox number, and the
# WhatsApp report agent's "connect your Google account" link pointing at
# localhost:3000. A plain `npm run build` does NOT reliably catch this —
# only a full `.next` wipe does.
#
# Usage: ./scripts/deploy.sh

set -euo pipefail

APP_NAME="growwmatics"
APP_URL="https://growwmatics.com"
# The build has OOM'd twice on this droplet's 1.9GB RAM with the default
# heap limit — pm2 stop (below) frees what the running app was using, and
# this raises Node's ceiling to make use of the 4GB swap already configured.
# Combined with --dns-result-order=ipv4first, already set globally via
# ~/.bashrc + `pm2 save` (see the IPv6/Inngest fix from earlier).
export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=3072"

echo "==> 1/6  Stopping the app to free RAM for the build (1.9GB total on this droplet — cutting it close otherwise)"
pm2 stop "${APP_NAME}" || true

echo "==> 2/6  Removing .next (full clean rebuild — see comment above for why)"
rm -rf .next

echo "==> 3/6  Installing dependencies (safe no-op if package.json didn't change)"
# --legacy-peer-deps: next-auth declares a nodemailer@^7 peer, but next-auth
# isn't actually imported anywhere in this codebase (rolls its own session
# auth) — the conflict is cosmetic. Real dependency mismatches would still
# fail loudly at build/runtime; this just stops npm blocking installs over
# an unused package's peer preference.
npm install --legacy-peer-deps

echo "==> 4/6  Building (NODE_OPTIONS=${NODE_OPTIONS})"
npm run build

echo "==> 5/6  Restarting PM2 process: ${APP_NAME}"
pm2 restart "${APP_NAME}"

echo "==> 6/6  Re-syncing Inngest Cloud (required whenever any Inngest function changed)"
sleep 2  # give the app a moment to finish coming up before hitting its own API
RESYNC_RESPONSE=$(curl -s -X PUT "${APP_URL}/api/inngest")
echo "    ${RESYNC_RESPONSE}"
if [[ "${RESYNC_RESPONSE}" != *'"message":"Successfully registered"'* ]]; then
  echo "    WARNING: Inngest resync did not return the expected success message — check manually:"
  echo "    curl -X PUT ${APP_URL}/api/inngest"
fi

echo ""
echo "==> Verifying no localhost/example-domain strings leaked into the build"
LEAKED=$(grep -rl "localhost:3000\|yourdomain.com" .next/server/ 2>/dev/null || true)
if [[ -n "${LEAKED}" ]]; then
  echo "    WARNING: found localhost/placeholder references in the build output:"
  echo "${LEAKED}" | sed 's/^/      /'
  echo "    This means a NEXT_PUBLIC_* var is still wrong or unset in .env.production — check it."
else
  echo "    Clean — no localhost/placeholder strings in .next/server/."
fi

echo ""
echo "Deploy complete. pm2 status:"
pm2 list
