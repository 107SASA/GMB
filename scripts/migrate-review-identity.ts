/**
 * Review identity migration: global `providerReviewId` uniqueness →
 * per-workspace uniqueness on { businessId, providerReviewId }.
 *
 * WHY: with a global unique index, two workspaces linked to the same Google
 * location cannot both store its reviews (the second gets E11000 and the sync
 * skips them — see services/reviews/syncReviews.ts). Per-workspace identity
 * lets each workspace hold its own copy and never moves a review between them.
 *
 * ORDER (each step is safe on its own; nothing deletes review documents):
 *   1. ensure unique { businessId, providerReviewId } (partial: providerReviewId is a string)
 *      — cannot fail while step 2 has not run (global uniqueness implies pair uniqueness)
 *   2. drop the global unique index `providerReviewId_1`
 *   3. recreate `providerReviewId_1` as a plain (non-unique, sparse) index for lookups
 *
 * REQUIRES the matching schema change in the SAME release, otherwise
 * scripts/sync-indexes.ts (and autoIndex in non-production) would recreate the
 * global unique index. src/models/Review.ts must read:
 *     providerReviewId: { type: String, index: true, sparse: true },
 * `--apply` refuses to run until it does.
 *
 *   Dry run (read-only — lists indexes, checks duplicates, prints the plan):
 *     npx tsx scripts/migrate-review-identity.ts
 *   Apply:
 *     npx tsx scripts/migrate-review-identity.ts --apply
 *   Against a specific database:
 *     MONGODB_URI="<uri>" npx tsx scripts/migrate-review-identity.ts [--apply]
 */
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

const APPLY = process.argv.includes('--apply');
const COMPOUND_NAME = 'businessId_1_providerReviewId_1';
const FIELD_NAME = 'providerReviewId_1';
const PARTIAL = { providerReviewId: { $type: 'string' } };

// Same env loading as scripts/sync-indexes.ts; explicit MONGODB_URI wins.
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  // Split on CRLF too: a trailing \r stops the line regex below from matching
  // (this repo's .env.local uses CRLF line endings).
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1].trim() in process.env)) process.env[m[1].trim()] = v;
  }
}

function schemaIsMigrated(): boolean {
  const src = fs.readFileSync(path.resolve(process.cwd(), 'src/models/Review.ts'), 'utf-8');
  const line = src.split('\n').find((l) => /^\s*providerReviewId:\s*\{/.test(l)) || '';
  return !/unique:\s*true/.test(line);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const reviews = db.collection('reviews');
  console.log(`Database: ${db.databaseName}  Mode: ${APPLY ? 'APPLY' : 'DRY RUN (read-only)'}`);

  const indexes = await reviews.indexes();
  console.log('\nCurrent Review indexes:');
  for (const ix of indexes) console.log(`  ${ix.name}  ${JSON.stringify(ix.key)}${ix.unique ? '  unique' : ''}${ix.sparse ? '  sparse' : ''}${ix.partialFilterExpression ? `  partial=${JSON.stringify(ix.partialFilterExpression)}` : ''}`);

  const field = indexes.find((ix) => ix.name === FIELD_NAME);
  const compound = indexes.find((ix) => ix.name === COMPOUND_NAME);
  const globalUnique = !!field?.unique;
  const compoundOk = !!compound?.unique && JSON.stringify(compound.partialFilterExpression) === JSON.stringify(PARTIAL);
  console.log(`\nproviderReviewId globally unique: ${globalUnique ? 'YES' : 'no'}`);
  console.log(`unique { businessId, providerReviewId } present: ${compoundOk ? 'yes' : 'NO'}`);

  // Pre-flight checks (read-only).
  const [total, withoutId, dupPairs, sharedIds] = await Promise.all([
    reviews.countDocuments({}),
    reviews.countDocuments({ providerReviewId: { $not: { $type: 'string' } } }),
    reviews.aggregate([
      { $match: PARTIAL },
      { $group: { _id: { b: '$businessId', p: '$providerReviewId' }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $count: 'pairs' },
    ]).toArray(),
    reviews.aggregate([
      { $match: PARTIAL },
      { $group: { _id: '$providerReviewId', businesses: { $addToSet: '$businessId' } } },
      { $match: { 'businesses.1': { $exists: true } } },
      { $count: 'ids' },
    ]).toArray(),
  ]);
  const duplicatePairs = dupPairs[0]?.pairs ?? 0;
  console.log(`\nReviews: ${total} (without a provider id: ${withoutId})`);
  console.log(`Duplicate { businessId, providerReviewId } pairs: ${duplicatePairs}  (must be 0)`);
  console.log(`Provider ids held by more than one business: ${sharedIds[0]?.ids ?? 0}`);

  const plan: string[] = [];
  if (!compoundOk) plan.push(`${compound ? `drop non-matching ${COMPOUND_NAME}, then ` : ''}create unique ${COMPOUND_NAME} (partial: providerReviewId is a string)`);
  if (globalUnique) plan.push(`drop unique ${FIELD_NAME}`, `create non-unique sparse ${FIELD_NAME}`);
  console.log(`\nPlan:\n${plan.length ? plan.map((p, i) => `  ${i + 1}. ${p}`).join('\n') : '  nothing to do — already migrated'}`);

  if (!APPLY || !plan.length) {
    await mongoose.disconnect();
    return;
  }
  if (duplicatePairs > 0) throw new Error('Refusing: duplicate { businessId, providerReviewId } pairs exist — resolve them first.');
  if (globalUnique && !schemaIsMigrated()) {
    throw new Error('Refusing: src/models/Review.ts still declares providerReviewId as unique. Change it to `{ type: String, index: true, sparse: true }` in the same release, or sync-indexes would recreate the global index.');
  }

  // 1. Per-workspace uniqueness first, so identity is protected throughout.
  if (!compoundOk) {
    if (compound) await reviews.dropIndex(COMPOUND_NAME);
    await reviews.createIndex({ businessId: 1, providerReviewId: 1 }, { name: COMPOUND_NAME, unique: true, partialFilterExpression: PARTIAL });
    console.log(`created unique ${COMPOUND_NAME}`);
  }
  // 2 + 3. Replace the global unique index with a plain lookup index.
  if (globalUnique) {
    await reviews.dropIndex(FIELD_NAME);
    console.log(`dropped unique ${FIELD_NAME}`);
    await reviews.createIndex({ providerReviewId: 1 }, { name: FIELD_NAME, sparse: true });
    console.log(`created non-unique ${FIELD_NAME}`);
  }
  console.log('\nDone. Re-run without --apply to confirm the final state.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err?.message || err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
