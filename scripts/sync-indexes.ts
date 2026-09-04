/**
 * Reconcile MongoDB indexes with the current Mongoose schemas.
 *
 * src/lib/mongodb.ts sets `autoIndex: false` when NODE_ENV=production, so the
 * live app never rebuilds indexes on a cold start against production data.
 * After a deploy whose schema changes add or alter an index, run this ONCE:
 *
 *   Dry run (shows the diff, no writes):
 *     npx tsx scripts/sync-indexes.ts
 *   Apply:
 *     npx tsx scripts/sync-indexes.ts --apply
 *
 * Against prod, prefix with the prod URI:
 *   MONGODB_URI="<prod uri>" npx tsx scripts/sync-indexes.ts --apply
 *
 * Safe and idempotent. syncIndexes() also DROPS indexes no longer in a schema,
 * so review the dry-run diff before applying to prod.
 */
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1].trim() in process.env)) process.env[m[1].trim()] = v;
  }
}

const APPLY = process.argv.includes('--apply');
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set (put it in .env.local or prefix the command).');
  process.exit(1);
}

async function main() {
  // Register every model with the default mongoose connection.
  const modelsDir = path.resolve(process.cwd(), 'src', 'models');
  for (const f of fs.readdirSync(modelsDir)) {
    if (f.endsWith('.ts')) await import(pathToFileURL(path.join(modelsDir, f)).href);
  }

  await mongoose.connect(uri as string);
  const names = Object.keys(mongoose.models).sort();
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${names.length} models registered\n`);

  let changes = 0;
  for (const name of names) {
    const Model = mongoose.models[name];
    try {
      const diff = await Model.diffIndexes();
      const create = diff.toCreate ?? [];
      const drop = diff.toDrop ?? [];
      if (create.length || drop.length) {
        changes++;
        console.log(`  ${name}: +${create.length} create, -${drop.length} drop`);
        if (create.length) console.log(`      create: ${JSON.stringify(create)}`);
        if (drop.length) console.log(`      drop:   ${JSON.stringify(drop)}`);
      } else {
        console.log(`  ${name}: up to date`);
      }
      // Always syncIndexes() in apply mode, even when diffIndexes() reported no
      // change — on a collection that doesn't exist yet (fresh DB) diffIndexes
      // can under-report, and syncIndexes() is the authoritative reconcile.
      if (APPLY) await Model.syncIndexes();
    } catch (e: any) {
      console.warn(`  ${name}: ${e.message}`);
    }
  }

  console.log(`\n${changes} model(s) with a reported diff.${APPLY ? ' syncIndexes() ran for every model.' : ' Re-run with --apply to write.'}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
