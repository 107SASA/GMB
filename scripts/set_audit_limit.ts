// One-off: sets maxAuditsPerBusiness=1 on any LIVE PlanConfig override docs
// (Free/Pro) — the DB override, when one exists, takes precedence over the
// hardcoded PLAN_DEFAULTS fallback in lib/planDefaults.ts (already updated
// to 1 in code), so this closes the gap for a plan a superadmin has ever
// edited via Admin -> Customers' plan-limits editor. Deliberately does NOT
// upsert — a plan with no DB override yet already gets 1 from the code
// default alone; creating a partial doc here without the other required
// PlanConfig fields would fail validation anyway.
// Run: npx -y tsx scripts/set_audit_limit.ts

import fs from 'fs';
import path from 'path';

const envCandidates = ['.env.production', '.env.local'];
const envPath = envCandidates.map((f) => path.resolve(process.cwd(), f)).find((p) => fs.existsSync(p));
if (!envPath) {
  console.error(`No .env.production or .env.local found in ${process.cwd()} — run this from the GMBBoost-audit-engine directory.`);
  process.exit(1);
}
console.log(`Loading env from ${path.basename(envPath)}`);
for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1].trim() in process.env)) process.env[m[1].trim()] = v;
}

async function main() {
  const dbConnect = (await import('../src/lib/mongodb')).default;
  const PlanConfig = (await import('../src/models/PlanConfig')).default;

  await dbConnect();

  for (const plan of ['Free', 'Pro']) {
    const existing = await PlanConfig.findOne({ plan });
    if (!existing) {
      console.log(`${plan}: no DB override exists — already using the code default (1) as-is. Nothing to do.`);
      continue;
    }
    if (existing.maxAuditsPerBusiness === 1) {
      console.log(`${plan}: DB override already set to 1. Nothing to do.`);
      continue;
    }
    const before = existing.maxAuditsPerBusiness;
    existing.maxAuditsPerBusiness = 1;
    existing.updatedBy = 'script:set_audit_limit';
    await existing.save();
    console.log(`${plan}: updated DB override maxAuditsPerBusiness ${before} -> 1.`);
  }

  console.log('Done.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
