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
 *      Records written before this change have no key. If two records the app
 *      already keyed share a key (possible only while the index is missing),
 *      the script stops before building the index and changes nothing. Only this index is created; no index is dropped (unlike
 *      scripts/sync-indexes.ts). If an index with this name or key pattern
 *      exists with different options, the script stops without writing.
 *   2. Backfills openKey on existing open proposals (PROPOSED, APPROVED),
 *      following scripts/open-proposal-plan.ts (the same plan the read-only
 *      scripts/fr5-open-proposal-diagnostic.ts explains record by record).
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
import { BACKFILL_STATUSES, keyIntegrity, planOpenProposalKeys, readOpenProposalState } from './open-proposal-plan.ts';

const { ObjectId } = mongoose.Types;

const INDEX_NAME = 'open_proposal_key';
const INDEX_KEY = { businessId: 1, openKey: 1 } as const;
const INDEX_OPTIONS = { name: INDEX_NAME, unique: true, partialFilterExpression: { openKey: { $type: 'string' } } };

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

  // One read-only snapshot drives the plan (shared with the diagnostic).
  const state = await readOpenProposalState(col);
  const integrity = keyIntegrity(state.keyed);
  if (apply && !existing && integrity.sameKeyHeldTwice.length) {
    throw new Error(`Two records already hold the same open key, so the unique index cannot be built: ${JSON.stringify(integrity.sameKeyHeldTwice)}. Nothing was changed. Run scripts/fr5-open-proposal-diagnostic.ts for details.`);
  }
  if (apply && !existing) await col.createIndex(INDEX_KEY, INDEX_OPTIONS);

  const plan = planOpenProposalKeys(state.candidates, state.keyed);
  const byId = new Map(state.candidates.map((r) => [r.id, r]));
  const row = (id: string) => {
    const r = byId.get(id)!;
    return { id, businessId: r.businessId, kind: r.kind, status: r.status, createdAt: r.createdAt ?? '' };
  };
  let keyed = 0;
  let alreadyHeld = plan.decisions.filter((d) => d.action === 'held').length;
  const duplicates: Array<{ id: string; businessId: string; kind: string; status: string; createdAt: string; duplicateOf: string }> = plan.decisions
    .filter((d) => d.action !== 'key')
    .map((d) => ({ ...row(d.id), duplicateOf: (d as { of: string }).of }));
  for (const d of plan.decisions) {
    if (d.action !== 'key') continue;
    if (!apply) { keyed += 1; continue; }
    try {
      // Only this one field is set, only on a still-open, still-unkeyed record.
      const res = await col.updateOne(
        { _id: new ObjectId(d.id), status: { $in: BACKFILL_STATUSES }, openKey: { $not: { $type: 'string' } } },
        { $set: { openKey: d.key } },
      );
      keyed += res.modifiedCount;
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      alreadyHeld += 1;
      duplicates.push({ ...row(d.id), duplicateOf: '(keyed by the live app during this run)' });
    }
  }

  return {
    mode: apply ? 'APPLY' : 'DRY RUN',
    index: existing ? 'present' : apply ? 'created' : 'missing (would be created)',
    openRecordsByStatus: state.byStatus,
    backfillCandidates: state.candidates.length,
    [apply ? 'keyed' : 'wouldKey']: keyed,
    keyAlreadyHeldByAnotherRecord: alreadyHeld,
    duplicateOpenProposalsLeftUnchanged: duplicates.length,
    duplicates: duplicates.slice(0, 50),
    executingNotKeyed: state.executingNotKeyed,
    existingKeyProblems: integrity,
  };
}

if (process.argv[1] && /migrate-open-proposal-keys\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
