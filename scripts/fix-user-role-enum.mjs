/**
 * One-time repair: User documents whose `role` is not one of the current
 * schema enum values (['SUPER_ADMIN', 'CLIENT']).
 *
 * How they got there: older QA seed scripts (lead-engine-testkit.mjs /
 * lead-engine-e2e.mjs) inserted shadow users straight through the native
 * driver with `role: 'USER'`, bypassing Mongoose validation. Any later code
 * path that loads such a doc and calls `user.save()` (Mongoose validates the
 * WHOLE document) then 500s on the stale `role` — even though it never touched
 * `role`. This maps every out-of-enum role to 'CLIENT' (the schema default).
 *
 * Also normalises the pre-prod-split legacy enum values if present:
 *   'BusinessOwner' | 'Admin' | 'TeamMember' -> 'CLIENT'
 *   'super_admin'                             -> 'SUPER_ADMIN'
 *
 * SAFETY:
 *  - Dry-run by default. Pass --apply to actually write.
 *  - Operates ONLY on the database named in the connection URI (i.e. whatever
 *    .env.local's MONGODB_URI points at). Pass --uri "mongodb+srv://.../<db>"
 *    to target a different one.
 *  - Refuses a URI whose db name contains "prod" unless --allow-prod is set.
 *
 * Run:
 *   node scripts/fix-user-role-enum.mjs            # dry run, .env.local DB
 *   node scripts/fix-user-role-enum.mjs --apply    # write
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ALLOW_PROD = args.includes('--allow-prod');
const uriArg = (() => {
  const i = args.indexOf('--uri');
  return i >= 0 ? args[i + 1] : null;
})();

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/^\s*export\s+/, '');
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '');
    v = v.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnvFile(path.join(ROOT, '.env.local'));
loadEnvFile(path.join(ROOT, '.env.production'));

const VALID = ['SUPER_ADMIN', 'CLIENT'];
const REMAP = {
  USER: 'CLIENT',
  BusinessOwner: 'CLIENT',
  Admin: 'CLIENT',
  TeamMember: 'CLIENT',
  super_admin: 'SUPER_ADMIN',
};

async function main() {
  const uri = uriArg || process.env.MONGODB_URI;
  if (!uri) {
    console.error('No MONGODB_URI in env and no --uri passed.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const dbName = db.databaseName;

  if (/prod/i.test(dbName) && !ALLOW_PROD) {
    console.error(`Refusing to run against "${dbName}" (looks like production). Re-run with --allow-prod if you really mean it.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Target database: ${dbName}   mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN'}`);
  const users = db.collection('users');

  const offenders = await users
    .find({ role: { $nin: VALID } }, { projection: { role: 1, email: 1, phone: 1 } })
    .toArray();

  if (offenders.length === 0) {
    console.log('No documents with an invalid role. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  console.log(`\nFound ${offenders.length} document(s) with an out-of-enum role:`);
  const unknown = new Set();
  for (const d of offenders) {
    const target = REMAP[d.role] || 'CLIENT';
    if (!REMAP[d.role]) unknown.add(String(d.role));
    console.log(`  ${d._id}  ${JSON.stringify(d.role)} -> ${target}   ${d.email ?? ''} ${d.phone ?? ''}`);
  }
  if (unknown.size) {
    console.log(`\nNote: role value(s) ${[...unknown].map((r) => JSON.stringify(r)).join(', ')} had no explicit remap — defaulting them to 'CLIENT'.`);
  }

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write these changes.');
    await mongoose.disconnect();
    return;
  }

  let modified = 0;
  for (const [from, to] of Object.entries(REMAP)) {
    const res = await users.updateMany({ role: from }, { $set: { role: to } });
    modified += res.modifiedCount;
  }
  // Anything still out of enum (unmapped values) -> CLIENT.
  const rest = await users.updateMany({ role: { $nin: VALID } }, { $set: { role: 'CLIENT' } });
  modified += rest.modifiedCount;

  console.log(`\nDone. ${modified} document(s) updated.`);
  const remaining = await users.countDocuments({ role: { $nin: VALID } });
  console.log(`Remaining invalid-role documents: ${remaining}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
