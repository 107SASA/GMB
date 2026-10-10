/**
 * FR-5 open-proposal diagnostic — READ-ONLY. Safe to run against production.
 *
 *   MONGODB_URI="<uri with /<dbName>>" npx tsx scripts/fr5-open-proposal-diagnostic.ts
 *
 * Uses the app's own MongoDB driver (through mongoose) and the URI you pass.
 * No in-memory server, no .env file, no index builds, no writes of any kind:
 * the reader is typed to find / aggregate / indexes only.
 *
 * Reports, without proposal content (ids, kinds, statuses and dates only):
 *   - the target database and whether the `open_proposal_key` index exists;
 *   - open proposals by status, keyed vs unkeyed;
 *   - every group of identical open proposals and what the migration would do
 *     with each member (key it, or leave it unchanged and why);
 *   - problems with keys the app already wrote (a shared key would stop the
 *     index build);
 *   - unkeyed EXECUTING records.
 */
import mongoose from 'mongoose';
import { describeTarget } from './migrate-open-proposal-keys.ts';
import { keyIntegrity, planOpenProposalKeys, readOpenProposalState, type ReadOnlyCollection } from './open-proposal-plan.ts';

const INDEX_NAME = 'open_proposal_key';

export async function diagnoseOpenProposals(col: ReadOnlyCollection) {
  const indexes = await col.indexes().catch(() => [] as Array<Record<string, any>>);
  const index = indexes.find((ix) => ix.name === INDEX_NAME) || null;
  const state = await readOpenProposalState(col);
  const plan = planOpenProposalKeys(state.candidates, state.keyed);
  const integrity = keyIntegrity(state.keyed);
  const count = (a: string) => plan.decisions.filter((d) => d.action === a).length;
  const held = plan.decisions.filter((d) => d.action === 'held').map((d) => {
    const record = state.candidates.find((r) => r.id === d.id)!;
    const holder = state.keyed.find((r) => r.id === (d as { of: string }).of)!;
    return {
      id: d.id,
      status: record.status,
      kind: record.kind,
      businessId: record.businessId,
      createdAt: record.createdAt,
      heldBy: { id: holder.id, status: holder.status, createdAt: holder.createdAt, source: holder.source },
      reason: `Identical to ${holder.id} (same business, kind, current value and proposed value). That record already holds the open key, set by the app when it was created, so this one stays unkeyed and unchanged.`,
    };
  });
  return {
    index: index ? { present: true, unique: index.unique === true, partialFilterExpression: index.partialFilterExpression ?? null } : { present: false },
    openRecordsByStatus: state.byStatus,
    migrationWould: {
      key: count('key'),
      leaveUnchangedAsDuplicate: count('duplicate'),
      leaveUnchangedKeyHeldElsewhere: count('held'),
      deleteOrRewrite: 0,
    },
    keyHeldElsewhere: held,
    duplicateGroups: plan.groups,
    existingKeyProblems: integrity,
    indexBuildWouldFail: !index && integrity.sameKeyHeldTwice.length > 0,
    executingNotKeyed: state.executingNotKeyed,
  };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI must be set explicitly for this script.');
    process.exit(1);
  }
  const target = describeTarget(uri);
  console.log(`Target hosts: ${target.hosts}`);
  console.log(`Target database: ${target.db ?? '(none)'}`);
  console.log('Mode: READ-ONLY DIAGNOSTIC\n');
  if (!target.db) {
    console.error('The URI does not name a database. Add /<dbName> before the query string.');
    process.exit(1);
  }
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false, dbName: target.db });
  try {
    const col: ReadOnlyCollection = mongoose.connection.db!.collection('gbpprofilechanges');
    console.log(JSON.stringify(await diagnoseOpenProposals(col), null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && /fr5-open-proposal-diagnostic\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
