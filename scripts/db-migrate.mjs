/**
 * Database migration toolkit — moving GrowwMatics off the shared intern-owned
 * Atlas cluster onto a new organisation (Production project + Development
 * project). Pure Node driver, no mongodump/mongorestore needed.
 *
 * SUBCOMMANDS
 *
 *   node scripts/db-migrate.mjs archive --uri "<SRC>" --db gmbboost --out ./_db-archive
 *       Dump every collection of a DB to ./_db-archive/<db>/<collection>.json
 *       (extended-JSON). Use before dropping anything.
 *
 *   node scripts/db-migrate.mjs copy \
 *       --from "<SRC_URI>" --from-db test \
 *       --to   "<DEST_URI>" --to-db growwmatics_prod \
 *       [--drop-target] [--only users,businesses | --config-only] [--apply]
 *       Copy collections + their indexes. Dry-run (counts only) unless --apply.
 *       Normalises the User.role enum on the way (USER/BusinessOwner/Admin/
 *       TeamMember -> CLIENT, super_admin -> SUPER_ADMIN).
 *       Refuses a non-empty target unless --drop-target.
 *         --config-only : copy ONLY the super-admin config singletons
 *                         (billing plan, agent prompts, scoring, platform
 *                         settings) — no user/business/lead/transaction data.
 *                         Use this for a fresh launch DB.
 *
 *   node scripts/db-migrate.mjs verify \
 *       --from "<SRC_URI>" --from-db test --to "<DEST_URI>" --to-db growwmatics_prod
 *       Compare collection lists + document counts + a random _id spot-check.
 *
 * SAFETY
 *   - Nothing writes without --apply (copy) — archive/verify are always read-only
 *     on the source.
 *   - A destination URI whose db name contains "prod" is allowed (that's the
 *     point) but the script prints it in red and waits 5s so you can Ctrl-C.
 *   - Never point --to at the OLD cluster.
 */
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { EJSON } from 'bson';

// ---- arg parsing ------------------------------------------------------------
const [sub, ...rest] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else { flags[key] = next; i++; }
  }
}

const BATCH = 1000;
const ROLE_REMAP = { USER: 'CLIENT', BusinessOwner: 'CLIENT', Admin: 'CLIENT', TeamMember: 'CLIENT', super_admin: 'SUPER_ADMIN' };
const VALID_ROLES = new Set(['SUPER_ADMIN', 'CLIENT']);

function die(msg) { console.error('ERROR: ' + msg); process.exit(1); }
function redirects(name) { return name.startsWith('system.'); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(uri, label) {
  if (!uri || uri === true) die(`missing --${label} connection URI`);
  const c = new MongoClient(uri);
  await c.connect();
  return c;
}

// ---- archive --------------------------------------------------------------
async function archive() {
  const { uri, db: dbName, out = './_db-archive' } = flags;
  if (!dbName || dbName === true) die('archive needs --db');
  const client = await connect(uri, 'uri');
  try {
    const db = client.db(dbName);
    const cols = (await db.listCollections().toArray()).map((c) => c.name).filter((n) => !redirects(n));
    const dir = path.resolve(out, dbName);
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Archiving ${cols.length} collections of "${dbName}" -> ${dir}`);
    for (const name of cols) {
      const docs = await db.collection(name).find({}).toArray();
      fs.writeFileSync(path.join(dir, `${name}.json`), EJSON.stringify(docs, { relaxed: false }, 2));
      console.log(`  ${String(docs.length).padStart(7)}  ${name}.json`);
    }
    console.log('Done. Keep this folder somewhere safe (it is git-ignored).');
  } finally { await client.close(); }
}

// ---- copy ----------------------------------------------------------------
// Config singletons a super-admin has hand-tuned — safe to carry into a fresh
// launch DB. NO user / business / lead / conversation / billing-transaction
// data. Missing collections are skipped silently.
const CONFIG_COLLECTIONS = [
  'billingplans', 'planconfigs', 'plans', 'platformsettings',
  'orchestrationconfigs', 'salesagentconfigs', 'scoringruleconfigs',
  'reportagentconfigs', 'bookingagentconfigs',
];

async function copy() {
  const { from, 'from-db': fromDb, to, 'to-db': toDb } = flags;
  const apply = !!flags.apply;
  const dropTarget = !!flags['drop-target'];
  const configOnly = !!flags['config-only'];
  const only = configOnly
    ? new Set(CONFIG_COLLECTIONS)
    : (typeof flags.only === 'string' ? new Set(flags.only.split(',').map((s) => s.trim())) : null);
  if (!fromDb || fromDb === true) die('copy needs --from-db');
  if (!toDb || toDb === true) die('copy needs --to-db');
  if (from === to && fromDb === toDb) die('source and destination are identical');

  const src = await connect(from, 'from');
  const dst = await connect(to, 'to');
  try {
    const sdb = src.db(fromDb);
    const ddb = dst.db(toDb);

    console.log(`\n  FROM  ${maskUri(from)}  db=${fromDb}`);
    console.log(`  TO    \x1b[33m${maskUri(to)}  db=${toDb}\x1b[0m`);
    console.log(`  mode  ${apply ? '\x1b[31mAPPLY (writing)\x1b[0m' : 'DRY RUN'}   drop-target=${dropTarget}\n`);
    if (apply) { console.log('  starting in 5s — Ctrl-C to abort'); await sleep(5000); }

    let srcCols = (await sdb.listCollections().toArray()).map((c) => c.name).filter((n) => !redirects(n));
    if (only) srcCols = srcCols.filter((n) => only.has(n));
    srcCols.sort();

    const existingTarget = (await ddb.listCollections().toArray()).map((c) => c.name).filter((n) => !redirects(n));
    if (existingTarget.length && !dropTarget && apply) {
      die(`target db "${toDb}" already has ${existingTarget.length} collections. Re-run with --drop-target to overwrite, or --only to add specific ones.`);
    }

    const report = [];
    for (const name of srcCols) {
      const srcCount = await sdb.collection(name).estimatedDocumentCount();
      let roleFixes = 0;

      if (apply) {
        if (dropTarget) await ddb.collection(name).drop().catch(() => {});
        const target = ddb.collection(name);

        // copy documents in batches
        const cursor = sdb.collection(name).find({});
        let buf = [];
        for await (const doc of cursor) {
          if (name === 'users' && doc.role && !VALID_ROLES.has(doc.role)) {
            doc.role = ROLE_REMAP[doc.role] || 'CLIENT';
            roleFixes++;
          }
          buf.push(doc);
          if (buf.length >= BATCH) { await target.insertMany(buf, { ordered: false }); buf = []; }
        }
        if (buf.length) await target.insertMany(buf, { ordered: false });

        // recreate indexes (skip the implicit _id_ index)
        const idx = await sdb.collection(name).indexes();
        for (const ix of idx) {
          if (ix.name === '_id_') continue;
          const { key, name: ixName, v, ns, background, ...opts } = ix;
          try { await target.createIndex(key, { name: ixName, ...opts }); }
          catch (e) { console.warn(`    ! index ${ixName} on ${name}: ${e.message}`); }
        }
      }

      const dstCount = apply ? await ddb.collection(name).estimatedDocumentCount() : 0;
      report.push({ name, srcCount, dstCount, roleFixes });
      console.log(
        `  ${name.padEnd(28)} src=${String(srcCount).padStart(7)}` +
        (apply ? `  dst=${String(dstCount).padStart(7)}${dstCount !== srcCount ? '  <-- MISMATCH' : ''}` : '') +
        (roleFixes ? `  (role fixes: ${roleFixes})` : '')
      );
    }

    const mism = report.filter((r) => apply && r.srcCount !== r.dstCount);
    console.log(`\n  ${srcCols.length} collections${apply ? `, ${mism.length} mismatch(es)` : ' (dry run)'}`);
    if (mism.length) process.exitCode = 2;
    if (!apply) console.log('  Re-run with --apply to copy.');
  } finally { await src.close(); await dst.close(); }
}

// ---- verify --------------------------------------------------------------
async function verify() {
  const { from, 'from-db': fromDb, to, 'to-db': toDb } = flags;
  const src = await connect(from, 'from');
  const dst = await connect(to, 'to');
  try {
    const sdb = src.db(fromDb);
    const ddb = dst.db(toDb);
    const sCols = new Set((await sdb.listCollections().toArray()).map((c) => c.name).filter((n) => !redirects(n)));
    const dCols = new Set((await ddb.listCollections().toArray()).map((c) => c.name).filter((n) => !redirects(n)));

    let problems = 0;
    for (const name of [...sCols].sort()) {
      if (!dCols.has(name)) { console.log(`  MISSING in target: ${name}`); problems++; continue; }
      const s = await sdb.collection(name).countDocuments();
      const d = await ddb.collection(name).countDocuments();
      let spot = 'ok';
      if (s > 0) {
        const sample = await sdb.collection(name).find({}).limit(20).toArray();
        for (const doc of sample) {
          const hit = await ddb.collection(name).findOne({ _id: doc._id });
          if (!hit) { spot = `MISSING _id ${doc._id}`; problems++; break; }
        }
      }
      const flag = s === d ? '' : '  <-- COUNT MISMATCH';
      if (flag || spot !== 'ok') problems++;
      console.log(`  ${name.padEnd(28)} src=${String(s).padStart(7)} dst=${String(d).padStart(7)}${flag}  ${spot === 'ok' ? '' : spot}`);
    }
    for (const name of [...dCols].sort()) if (!sCols.has(name)) console.log(`  extra in target (not in source): ${name}`);

    // role sanity on target
    if (dCols.has('users')) {
      const bad = await ddb.collection('users').countDocuments({ role: { $nin: ['SUPER_ADMIN', 'CLIENT'] } });
      console.log(`\n  target users with invalid role: ${bad}`);
      if (bad) problems++;
    }
    console.log(problems ? `\n  ${problems} problem(s) — DO NOT cut over yet.` : '\n  All good. Safe to cut over.');
    process.exitCode = problems ? 2 : 0;
  } finally { await src.close(); await dst.close(); }
}

function maskUri(u) {
  return String(u).replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}

const table = { archive, copy, verify };
if (!table[sub]) die(`unknown subcommand "${sub || ''}". Use: archive | copy | verify`);
table[sub]().catch((e) => { console.error(e); process.exit(1); });
