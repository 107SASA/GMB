# Atlas Launch Runbook — fresh databases, new organisation

**Goal:** launch GrowwMatics (in ~3 days) on a brand-new MongoDB Atlas
**organisation owned by the GrowwMatics account**, with a **fresh, empty
production database** — none of the current test data carries over — and a
separate database for development.

Status (Sep 4 2026):
- **Part A — DONE by owner.** New org, two projects/clusters: a Production
  cluster (`growwmatics_prod`) and a Development cluster (`growwmatics_dev` +
  `growwmatics_qa`). DB users `gm_prod_app`, `gm_prod_admin`, `gm_dev_app`.
  Connection strings live only in the gitignored `.env.local` / `.env.production`.
- **Part B — DONE.** `growwmatics_prod` seeded: 7 config singletons copied
  (`--config-only`), super-admin `studysphere654@gmail.com` created, all 63
  collections + indexes built. Verified.
- `.env.local` → `growwmatics_dev`, `.env.production` → `growwmatics_prod`
  (`gm_prod_app`), both in standard (non-SRV) seedlist form.
- **Part C — PENDING (owner):** update the droplet env + rotate the other prod
  secrets, redeploy, smoke-test, launch.
- **Part E — later:** decommission the old cluster ~1 week after launch.

Decisions locked with the owner:

| Decision | Choice |
|---|---|
| Org | New Atlas org owned by the GrowwMatics Google account (not the intern) |
| Topology | **Two projects** — `Production` and `Development` — one cluster each |
| Production data | **Fresh / empty.** No copy of `test`. Only the super-admin config singletons + the super-admin login are seeded. |
| Development | New cluster hosting `growwmatics_dev` (local `npm run dev`) + `growwmatics_qa` (E2E scripts) |
| Old cluster | Left running for now; decommission after launch is stable |

## Why two projects and not one

Atlas gives you exactly **one free M0 cluster per project**, so two free
clusters *requires* two projects. It is also the correct security boundary:
DB users, network allowlists and API keys are per-project, so a dev credential —
or a fat-fingered `scripts/lead-engine-*.mjs` run — **physically cannot reach
`growwmatics_prod`**. That accident (a QA script corrupting the DB the dev app
was pointed at) is what triggered this whole migration.

```
New Atlas Org  (owner: studysphere654@gmail.com)
│
├── Project: Production
│   └── Cluster  prod-0            M0 free for launch  →  M10 when you need
│       └── database: growwmatics_prod                    backups + no auto-pause
│       ├── DB user  gm_prod_app     readWrite @ growwmatics_prod   (the droplet)
│       ├── DB user  gm_prod_admin   + dbAdmin  @ growwmatics_prod  (seeding, you)
│       ├── Network allowlist: droplet public IP /32 ONLY
│       └── Backups: enable on M10
│
└── Project: Development
    └── Cluster  dev-0             M0 free
        ├── database: growwmatics_dev   ← local `npm run dev`
        ├── database: growwmatics_qa    ← scripts/lead-engine-*.mjs (wiped freely)
        ├── DB user  gm_dev_app         readWrite on the cluster
        └── Network allowlist: your IP(s)
```

The database is chosen by the **path segment** of the connection string —
`mongodb+srv://…mongodb.net/growwmatics_dev?…` vs `…/growwmatics_qa?…` — so the
dev and QA URIs differ by one word.

---

## Part A — Atlas setup (owner, in the Atlas UI — cannot be scripted)

1. **Create the organisation.** Atlas → org switcher → *Create New Organisation*,
   name `GrowwMatics`, owner = the GrowwMatics Google account. Add the intern as
   Organisation **Member** if they still need access (not Owner).
2. **Project `Production`.**
   - Create project `Production`; build cluster `prod-0` in the droplet's region.
     M0 is fine for launch; move to M10 before meaningful customer load (unlocks
     daily backups, removes the idle auto-pause).
   - Database Access → add:
     - `gm_prod_app` — password auth, *Specific Privileges* → `readWrite` on
       `growwmatics_prod`.
     - `gm_prod_admin` — `readWrite` + `dbAdmin` on `growwmatics_prod`.
   - Network Access → add **only the droplet's public IP** as `/32`. Remove any
     `0.0.0.0/0` the wizard added.
3. **Project `Development`.**
   - Create project `Development`; cluster `dev-0` (M0).
   - Database Access → `gm_dev_app`, *Read and write to any database*.
   - Network Access → your IP(s). `0.0.0.0/0` is acceptable here (no customer
     data on this cluster).
4. **Collect 4 connection strings** (cluster → Connect → Drivers):

   | Name | User | Path segment |
   |---|---|---|
   | `PROD_APP`   | `gm_prod_app`   | `/growwmatics_prod` |
   | `PROD_ADMIN` | `gm_prod_admin` | `/growwmatics_prod` |
   | `DEV`        | `gm_dev_app`    | `/growwmatics_dev`  |
   | `QA`         | `gm_dev_app`    | `/growwmatics_qa`   |

---

## Part B — Seed the fresh production database

Nothing is migrated. Two small seeds, run from the repo root. `OLD` = the
current `.env.production` URI (only used to copy config singletons).

### B1. Copy ONLY the super-admin config singletons

These are hand-tuned settings (billing price + Razorpay plan, sales-agent
persona & knowledge, scoring rules, report/booking agent prompts, platform
settings). ~7 documents. **No** user / business / lead / conversation /
transaction data.

```bash
# dry run — lists exactly what would copy
node scripts/db-migrate.mjs copy \
  --from "OLD" --from-db test \
  --to   "PROD_ADMIN" --to-db growwmatics_prod \
  --config-only

# apply
node scripts/db-migrate.mjs copy \
  --from "OLD" --from-db test \
  --to   "PROD_ADMIN" --to-db growwmatics_prod \
  --config-only --apply
```

If you would rather start every config from its code default and re-enter
settings in `/admin`, skip B1 entirely — the app creates each singleton on
first access.

> **Check after B1:** open `/admin/subscriptions` (billing price), `/admin/sales-agent`,
> `/admin/report-agent`, `/admin/booking-agent` and confirm the values. The
> Razorpay plan id inside `billingplans` only works if the new deployment uses
> the **same Razorpay account**; if the account changes, re-save the price in
> `/admin/subscriptions` to mint a fresh plan.

### B2. Create the super-admin login

```bash
MONGODB_URI="PROD_ADMIN" SUPERADMIN_PASSWORD="<a strong new password>" \
  node scripts/seed-superadmin.mjs
```

Creates (or rotates) the `SUPER_ADMIN` user. Use the same email you log in with
today (`studysphere654@gmail.com`) unless you want to change it — set
`SUPERADMIN_EMAIL` to override.

### B3. Indexes

`src/lib/mongodb.ts` now sets `autoIndex: false` in production, so build the
indexes once against the fresh DB:

```bash
MONGODB_URI="PROD_ADMIN" npx tsx scripts/sync-indexes.ts --apply
```

(The `--config-only` copy in B1 already recreates indexes for the collections it
touches; this covers every other model so the first real signups are fast.)

---

## Part C — Deploy & launch

1. **Droplet env.** Set on the droplet (host env panel / `.env`):
   ```
   MONGODB_URI=<PROD_APP>
   ```
   and rotate the other prod secrets while you're there — they came from the
   shared setup: `JWT_SECRET`, `SESSION_SECRET`, `NEXTAUTH_SECRET`,
   `GOOGLE_TOKEN_SECRET`, `AUTOMATION_API_KEY`. See `.env.production.example`
   for the full required list.
2. **Redeploy** the app.
3. **Smoke test** (fresh DB, so expect empty lists — that's correct):
   - `GET /api/billing/plans` → 200 with the plan/price.
   - `/admin-login` → superadmin logs in → `/admin` loads (zeros everywhere).
   - Sign up a real test account end-to-end: onboarding → WhatsApp OTP →
     dashboard. Then delete it from `/admin` before launch, or keep it.
   - Connect a Google Business Profile on that account (needs the prod HTTPS
     redirect URI registered in Google Cloud — see PRODUCTION_READINESS.md).
4. **Go live.**

---

## Part D — Local dev + QA (any time, not on the launch critical path)

```bash
# .env.local
MONGODB_URI=<DEV>
TEST_DB_NAME=growwmatics_qa     # scripts/lib/localTestEnv.mjs forces this name
```

`scripts/lead-engine-e2e.mjs` / `lead-engine-testkit.mjs` already force a
dedicated DB name — with `TEST_DB_NAME=growwmatics_qa` they hit the QA database
on the dev cluster and can never touch `growwmatics_dev` or prod.

To work against realistic data locally, sign up a few accounts in dev — do **not**
copy prod customer data down.

---

## Part E — Decommission the old cluster (after launch is stable, ~1 week)

1. `node scripts/db-migrate.mjs archive --uri "OLD" --db test --out ./_db-archive`
   and the same for `gmbboost` — cold-storage dumps, git-ignored.
2. Old Atlas org → remove the app IPs from Network Access, wait 48 h, delete the
   cluster.
3. Rotate / disable the old shared DB users (the two flagged in
   `documentation/PRODUCTION_READINESS.md` §2.3 as leaked in git history).
4. Mark `documentation/PRODUCTION_READINESS.md` §2.3 and §4 resolved.

---

## 3-day timeline

| Day | Work |
|---|---|
| **1** | Part A (create org + both projects + clusters + users + allowlists), collect the 4 URIs. Part B1–B3 against `growwmatics_prod`. |
| **2** | Part C: droplet env + secret rotation, redeploy, full smoke test. Fix whatever the smoke test surfaces. Part D so local dev moves off the old cluster too. |
| **3** | Buffer / final checks (GBP redirect URI, WhatsApp templates, Razorpay live keys per PRODUCTION_READINESS.md), then go live. |

Part E happens the following week.
