/**
 * Open-proposal key migration for GbpProfileChange (FR-5 duplicate guard).
 *
 *   Dry run (default, read-only):
 *     MONGODB_URI="<uri with /<dbName>>" npx tsx scripts/migrate-open-proposal-keys.ts
 *   Apply (only after reviewing the dry run for the SAME target):
 *     MONGODB_URI="<uri>" npx tsx scripts/migrate-open-proposal-keys.ts --apply --confirm-db=<dbName>
 *
 * Target safety:
 *   - No .env file is read; the URI must be passed explicitly.
 *   - The URI must name a database (`.../<dbName>?...`); without one the driver
 *     would silently use `test`.
 *   - The target (host and database, never credentials) is printed first.
 *   - --apply refuses to run unless --confirm-db equals that database name.
 *
 * --apply does two things, in this order:
 *   1. Creates the partial unique index `open_proposal_key`
 *      ({ businessId: 1, openKey: 1 }, unique, where openKey is a string).
 *      Records written before this change have no key, so the build cannot
 *      fail on them. Only this index is created; no index is dropped (unlike
 *      scripts/sync-indexes.ts). If an index with this name or key pattern
 *      exists with different options, the script stops without writing.
 *   2. Backfills openKey on existing open proposals (PROPOSED, APPROVED).
 *      Within a group of identical open proposals (same business, kind,
 *      current value and proposed value) only the newest (createdAt, then
 *      _id) gets the key; the others are listed and left exactly as they are.
 *      EXECUTING records are not keyed (with live writes off, a record left in
 *      EXECUTING is a stranded claim) and are listed for review.
 *      Each write is guarded by `{ _id, status: open, openKey: not a string }`;
 *      a duplicate-key error (the live app keyed it first) is skipped. Safe to
 *      run beside the app and safe to re-run.
 * Nothing else on any record is changed: no status, approval, history or
 * timestamp (updatedAt is not touched).
 */
import mongoose from 'mongoose';
import { canonicalFingerprint, openProposalKey } from '../src/services/gbp/changes/policy.ts';

const INDEX_NAME = 'open_proposal_key';
const INDEX_KEY = { businessId: 1, openKey: 1 } as const;
const INDEX_OPTIONS = { name: INDEX_NAME, unique: true, partialFilterExpression: { openKey: { $type: 'string' } } };
/** Backfilled statuses. EXECUTING also holds a key in the app, but is not backfilled (see above). */
const BACKFILL_STATUSES = ['PROPOSED', 'APPROVED'];

/** Host and database of a MongoDB URI, without credentials. */
export function describeTarget(uri: string): { hosts: string; db: string | null } {
  const afterScheme = uri.replace(/^mongodb(\+srv)?:\/\//, '');
  const afterCreds = afterScheme.includes('@') ? afterScheme.slice(afterScheme.lastIndexOf('@') + 1) : afterScheme;
  const [hosts, rest = ''] = afterCreds.split('/');
  const db = decodeURIComponent(rest.split('?')[0] || '') || null;
  return { hosts, db };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const confirm = (process.argv.find((a) => a.startsWith('--confirm-db=')) || '').slice('--confirm-db='.length);
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI must be set explicitly for this script.');
    process.exit(1);
  }
  const target = describeTarget(uri);
  console.log(`Target hosts: ${target.hosts}`);
  console.log(`Target database: ${target.db ?? '(none)'}`);
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN (read-only)'}\n`);
  if (!target.db) {
    console.error('The URI does not name a database. Add /<dbName> before the query string.');
    process.exit(1);
  }
  if (apply && confirm !== target.db) {
    console.error(`--apply needs --confirm-db=${target.db} (got "${confirm || 'nothing'}"). Nothing was changed.`);
    process.exit(1);
  }
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false, dbName: target.db });
  try {
    const summary = await migrateOpenProposalKeys(mongoose.connection.db!, apply);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

export async function migrateOpenProposalKeys(db: import('mongodb').Db, apply: boolean) {
  const col = db.collection('gbpprofilechanges');
  const indexes = await col.indexes().catch(() => [] as Array<Record<string, any>>);
  const sameName = indexes.find((ix) => ix.name === INDEX_NAME);
  const samePattern = indexes.find((ix) => JSON.stringify(ix.key) === JSON.stringify(INDEX_KEY));
  const existing = sameName || samePattern;
  if (existing) {
    const matches = existing.name === INDEX_NAME
      && JSON.stringify(existing.key) === JSON.stringify(INDEX_KEY)
      && existing.unique === true
      && JSON.stringify(existing.partialFilterExpression) === JSON.stringify(INDEX_OPTIONS.partialFilterExpression);
    if (!matches) throw new Error(`An index conflicts with ${INDEX_NAME}: ${JSON.stringify(existing)}. Nothing was changed.`);
  }
  if (apply && !existing) await col.createIndex(INDEX_KEY, INDEX_OPTIONS);

  const byStatus = await col.aggregate<{ _id: string; n: number }>([
    { $match: { status: { $in: [...BACKFILL_STATUSES, 'EXECUTING'] } } },
    { $group: { _id: { $concat: ['$status', { $cond: [{ $eq: [{ $type: '$openKey' }, 'string'] }, ':keyed', ':unkeyed'] }] }, n: { $sum: 1 } } },
  ]).toArray();
  const executing = await col
    .find({ status: 'EXECUTING' }, { projection: { _id: 1, businessId: 1, kind: 1, executedAt: 1, openKey: 1 } })
    .sort({ executedAt: 1, _id: 1 })
    .limit(50)
    .toArray();

  const open = await col
    .find({ status: { $in: BACKFILL_STATUSES }, openKey: { $not: { $type: 'string' } } })
    .project({ businessId: 1, kind: 1, status: 1, beforeFingerprint: 1, proposed: 1, createdAt: 1 })
    .sort({ createdAt: -1, _id: -1 })
    .toArray();

  const keeper = new Map<string, string>();
  let keyed = 0;
  let alreadyHeld = 0;
  const duplicates: Array<{ id: string; businessId: string; kind: string; status: string; createdAt: string; duplicateOf: string }> = [];
  for (const doc of open) {
    const key = openProposalKey(String(doc.kind), String(doc.beforeFingerprint ?? canonicalFingerprint(String(doc.kind), null)), doc.proposed);
    const scope = `${String(doc.businessId)}|${key}`;
    const row = { id: String(doc._id), businessId: String(doc.businessId), kind: String(doc.kind), status: String(doc.status), createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : '' };
    if (keeper.has(scope)) {
      duplicates.push({ ...row, duplicateOf: keeper.get(scope)! });
      continue;
    }
    const holder = await col.findOne({ businessId: doc.businessId, openKey: key }, { projection: { _id: 1 } });
    if (holder) {
      keeper.set(scope, String(holder._id));
      alreadyHeld += 1;
      duplicates.push({ ...row, duplicateOf: String(holder._id) });
      continue;
    }
    keeper.set(scope, String(doc._id));
    if (!apply) { keyed += 1; continue; }
    try {
      const res = await col.updateOne(
        { _id: doc._id, status: { $in: BACKFILL_STATUSES }, openKey: { $not: { $type: 'string' } } },
        { $set: { openKey: key } },
      );
      keyed += res.modifiedCount;
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      alreadyHeld += 1;
      duplicates.push({ ...row, duplicateOf: '(keyed by the live app during this run)' });
    }
  }

  return {
    mode: apply ? 'APPLY' : 'DRY RUN',
    index: existing ? 'present' : apply ? 'created' : 'missing (would be created)',
    openRecordsByStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.n]).sort()),
    backfillCandidates: open.length,
    [apply ? 'keyed' : 'wouldKey']: keyed,
    keyAlreadyHeldByAnotherRecord: alreadyHeld,
    duplicateOpenProposalsLeftUnchanged: duplicates.length,
    duplicates: duplicates.slice(0, 50),
    executingNotKeyed: executing.filter((d) => typeof d.openKey !== 'string').map((d) => ({ id: String(d._id), businessId: String(d.businessId), kind: String(d.kind), executedAt: d.executedAt ? new Date(d.executedAt).toISOString() : null })),
  };
}

if (process.argv[1] && /migrate-open-proposal-keys\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
