#!/usr/bin/env node
/**
 * Copies the whole app database (every collection, its documents and indexes)
 * into another database, e.g. production → growwmatics_dev. Read-only on the
 * source. Refuses to write into a database that already has data.
 *
 * The source is MONGODB_URI (from the environment, else .env.production /
 * .env.local in the current directory — the same file the app reads).
 *
 *   node scripts/db/copy-database.js --to growwmatics_dev
 *       copy into another database on the SAME cluster
 *   TARGET_MONGODB_URI="mongodb+srv://…/growwmatics_dev" node scripts/db/copy-database.js
 *       copy into a database on ANOTHER cluster (recommended for dev)
 *
 * The target must be empty. To overwrite an existing copy (e.g. an old
 * growwmatics_dev), add --replace --confirm-replace <target database name>:
 * the target database is dropped first. The source is never written to.
 *
 * Prints counts only — no document content.
 */
const { loadEnvConfig } = require('@next/env');
const { MongoClient } = require('mongodb');

const BATCH = 1000;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Host + database name, never the user or password. */
function describe(uri, dbName) {
  const host = String(uri).replace(/^[a-z+]+:\/\/([^@]*@)?/, '').split('/')[0].split('?')[0];
  return `${host} / ${dbName}`;
}

(async () => {
  const { combinedEnv } = loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const sourceUri = process.env.MONGODB_URI || combinedEnv.MONGODB_URI;
  if (!sourceUri) throw new Error('MONGODB_URI is not set.');
  const targetUri = process.env.TARGET_MONGODB_URI || sourceUri;
  const toName = arg('--to');

  const source = new MongoClient(sourceUri);
  const target = targetUri === sourceUri ? source : new MongoClient(targetUri);
  await source.connect();
  if (target !== source) await target.connect();

  const sourceDb = source.db();
  const targetDb = toName ? target.db(toName) : target.db();
  if (target === source && !toName) throw new Error('Give --to <database name>, or set TARGET_MONGODB_URI.');
  if (target === source && targetDb.databaseName === sourceDb.databaseName) throw new Error('Source and target are the same database.');

  console.log(`From: ${describe(sourceUri, sourceDb.databaseName)}`);
  console.log(`To:   ${describe(targetUri, targetDb.databaseName)}`);

  const existing = await targetDb.listCollections({}, { nameOnly: true }).toArray();
  let targetHasData = false;
  for (const { name } of existing) {
    if (await targetDb.collection(name).estimatedDocumentCount()) { targetHasData = true; break; }
  }
  if (targetHasData) {
    if (!process.argv.includes('--replace')) {
      throw new Error(`The target already has data. Choose an empty database name, or overwrite it with --replace --confirm-replace ${targetDb.databaseName}.`);
    }
    if (arg('--confirm-replace') !== targetDb.databaseName) {
      throw new Error(`--confirm-replace must be exactly "${targetDb.databaseName}".`);
    }
    await targetDb.dropDatabase();
    console.log(`Old data in ${targetDb.databaseName} removed (--replace).`);
  }

  const collections = (await sourceDb.listCollections({ type: 'collection' }).toArray())
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'))
    .sort();

  let mismatches = 0;
  for (const name of collections) {
    const from = sourceDb.collection(name);
    const to = targetDb.collection(name);
    let batch = [];
    let copied = 0;
    for await (const doc of from.find({}, { batchSize: BATCH })) {
      batch.push(doc);
      if (batch.length >= BATCH) { await to.insertMany(batch, { ordered: false }); copied += batch.length; batch = []; }
    }
    if (batch.length) { await to.insertMany(batch, { ordered: false }); copied += batch.length; }
    if (!copied) await targetDb.createCollection(name).catch(() => {});

    const indexes = (await from.indexes()).filter((ix) => ix.name !== '_id_');
    for (const ix of indexes) {
      const { key, v: _v, ns: _ns, ...options } = ix;
      await to.createIndex(key, options).catch((err) => console.warn(`  index ${name}.${ix.name} not copied: ${err.message}`));
    }

    const [a, b] = await Promise.all([from.countDocuments(), to.countDocuments()]);
    if (a !== b) mismatches++;
    console.log(`${a === b ? 'ok ' : 'DIFF'} ${name.padEnd(36)} ${String(a).padStart(7)} → ${b}`);
  }

  console.log(mismatches
    ? `\nDone with ${mismatches} collection(s) whose counts differ — something was written to the source while copying. Run it again into a new, empty database.`
    : `\nDone. ${collections.length} collections copied, every count matches.`);
  await source.close();
  if (target !== source) await target.close();
  process.exit(mismatches ? 1 : 0);
})().catch((err) => { console.error('Copy failed:', err.message); process.exit(1); });
