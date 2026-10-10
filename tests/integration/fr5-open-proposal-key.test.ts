/**
 * Open-proposal deduplication: key identity and write-path audit. Pure.
 * The database behaviour (unique index, races, transitions, migration) is
 * exercised against MongoDB by scripts/fr5-proposal-dedupe-check.ts.
 * Run: node --experimental-strip-types --test tests/integration/fr5-open-proposal-key.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPEN_KEY_STATUSES, canonicalFingerprint, openProposalKey } from '../../src/services/gbp/changes/policy.ts';
import { attributeBatchRequestId } from '../../src/app/dashboard/profile-optimization/requestId.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('the key is the same for the same kind, current value and proposed value', () => {
  const before = canonicalFingerprint('description', 'Old.');
  assert.equal(openProposalKey('description', before, 'New.'), openProposalKey('description', before, 'New.'));
  assert.notEqual(openProposalKey('description', before, 'New.'), openProposalKey('description', before, 'Newer.'));
  assert.notEqual(openProposalKey('description', before, 'New.'), openProposalKey('title', before, 'New.'));
  assert.notEqual(openProposalKey('description', before, 'New.'), openProposalKey('description', canonicalFingerprint('description', 'Edited.'), 'New.'));
  assert.equal(openProposalKey('hours', 'x', { a: 1, b: { c: 2, d: 3 } }), openProposalKey('hours', 'x', { b: { d: 3, c: 2 }, a: 1 }));
  assert.match(openProposalKey('description', before, 'New.'), /^[0-9a-f]{64}$/);
});

test('only PROPOSED, APPROVED and an in-flight EXECUTING hold the key', () => {
  assert.deepEqual([...OPEN_KEY_STATUSES].sort(), ['APPROVED', 'EXECUTING', 'PROPOSED']);
  for (const closed of ['APPLIED', 'VERIFIED', 'FAILED', 'REVERTED', 'BLOCKED', 'CONFLICT', 'UNRESOLVED']) {
    assert.equal(OPEN_KEY_STATUSES.has(closed), false, closed);
  }
});

test('each attribute-batch submission gets its own request id', async () => {
  const items = [{ name: 'attributes/has_wifi', value: true }];
  const a = await attributeBatchRequestId(items);
  const b = await attributeBatchRequestId(items);
  assert.notEqual(a, b);
  assert.equal(a.slice(0, 29), b.slice(0, 29));
  assert.equal(await attributeBatchRequestId(items, 'fixed-nonce'), await attributeBatchRequestId(items, 'fixed-nonce'));
  assert.ok(a.length >= 8 && a.length <= 80);
});

test('the model declares the partial unique index and releases the key on close', () => {
  const model = read('src/models/GbpProfileChange.ts');
  assert.match(model, /\{ businessId: 1, openKey: 1 \},\s*\{ name: 'open_proposal_key', unique: true, partialFilterExpression: \{ openKey: \{ \$type: 'string' \} \} \}/);
  assert.match(model, /pre\('save'[\s\S]*?OPEN_KEY_STATUSES\.has\(this\.status\)\) this\.openKey = null/);
  assert.match(model, /pre\(\['findOneAndUpdate', 'updateOne', 'updateMany'\]/);
});

test('every proposal status write in the store goes through a path the release hooks cover', () => {
  const store = read('src/services/gbp/changes/store.ts');
  // No hook-bypassing writes.
  for (const bypass of ['.collection.', 'insertMany(', 'bulkWrite(', 'replaceOne(', 'findOneAndReplace(', '$unset']) {
    assert.equal(store.includes(bypass), false, bypass);
  }
  // Query-style status writes are only the approval and the two EXECUTING claims (all key-holding).
  const queryWrites = [...store.matchAll(/\$set: \{ status: '([A-Z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(queryWrites.sort(), ['APPROVED', 'EXECUTING', 'EXECUTING']);
  // The key is only ever written when a proposal is created.
  assert.equal([...store.matchAll(/openKey(,|:)/g)].length, 1);
  assert.match(store, /GbpProfileChange\.create\(\{[\s\S]*?status,\s*openKey,/);
});

test('a failed pre-write read hands the claim back instead of marking an unresolved write', () => {
  const store = read('src/services/gbp/changes/store.ts');
  const execute = store.slice(store.indexOf('export async function executeChange'), store.indexOf('async function restorePrevious'));
  const readAt = execute.indexOf('current = await readKind(');
  const handBackAt = execute.indexOf('return handBack(PRE_WRITE_READ_FAILED)', readAt);
  const patchAt = execute.indexOf('applyAndVerify(');
  assert.ok(readAt > 0 && handBackAt > readAt && patchAt > handBackAt, 'the read failure is handled before any write is possible');
  const handBack = execute.slice(execute.indexOf('const handBack'), execute.indexOf('const guard'));
  assert.match(handBack, /claimed\.status = 'APPROVED';\s*claimed\.executedAt = pending\.executedAt \?\? null;/);
  assert.equal(handBack.includes('openKey'), false, 'the hand-back keeps the open-proposal key');
  assert.match(execute, /if \(!guard\.ok\) return handBack\(guard\.error\);/);
  assert.match(execute, /if \(!fr5ProfileMutationAllowed\(\)\) return handBack\(LIVE_WRITES_DISABLED, false\);/);
});

test('the migration names its target without credentials and refuses a URI without a database', async () => {
  const { describeTarget } = await import('../../scripts/migrate-open-proposal-keys.ts');
  assert.deepEqual(describeTarget('mongodb+srv://user:p%40ss@cluster0.abc.mongodb.net/growwmatics_dev?retryWrites=true'), { hosts: 'cluster0.abc.mongodb.net', db: 'growwmatics_dev' });
  assert.deepEqual(describeTarget('mongodb://u:p@h1:27017,h2:27017/growwmatics_prod?replicaSet=x'), { hosts: 'h1:27017,h2:27017', db: 'growwmatics_prod' });
  assert.equal(describeTarget('mongodb://localhost:27017').db, null);
  assert.equal(describeTarget('mongodb://localhost:27017/?x=1').db, null);
  assert.equal(JSON.stringify(describeTarget('mongodb://user:secret@h/db')).includes('secret'), false);
  const src = read('scripts/migrate-open-proposal-keys.ts');
  assert.equal(/dropIndex|syncIndexes|deleteMany|deleteOne|\$unset/.test(src), false, 'the migration never drops or deletes');
  assert.equal(/readFileSync|dotenv|['"`/]\.env/.test(src), false, 'the migration reads no env file');
  assert.match(read('scripts/open-proposal-plan.ts'), /export const BACKFILL_STATUSES = \['PROPOSED', 'APPROVED'\];/);
});

test('every proposal creation path goes through createProposal', () => {
  const callers = [
    'src/app/api/gbp/changes/route.ts',
    'src/app/api/gbp/changes/attributes/route.ts',
    'src/app/api/gbp/profile/route.ts',
    'src/services/seoPlan/applyPlan.ts',
  ];
  for (const file of callers) {
    const src = read(file);
    assert.match(src, /createProposal\(|createChange\(|proposeAttributeBatch\(/, file);
    assert.equal(src.includes('GbpProfileChange.create'), false, file);
  }
  const store = read('src/services/gbp/changes/store.ts');
  assert.match(store, /export async function createChange\([^)]*\)[^{]*\{\s*return \(await createProposal\(input\)\)\.change;/);
  assert.match(store, /proposeAttributeBatch[\s\S]*?await createProposal\(/);
});
