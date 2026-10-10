/**
 * FR-5 OPEN-PROPOSAL DEDUPLICATION CHECK — throwaway in-memory MongoDB.
 *
 *   npx tsx scripts/fr5-proposal-dedupe-check.ts
 *
 * Exercises the real model, unique index, store functions and migration.
 * Both live-write flags are OFF, the Google client is a counting stub, no
 * .env file is read, and storage credentials are removed. Exits 1 on failure.
 */
process.env.GBP_LIVE_WRITES_ENABLED = 'false';
process.env.GBP_FR5_LIVE_WRITES_ENABLED = 'false';
for (const k of Object.keys(process.env)) if (k.startsWith('DO_SPACES_')) delete process.env[k];

const googleCalls: string[] = [];
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/lib[\\/]gbpClient(\.ts)?$/.test(request)) {
    const stub = (name: string) => async () => { googleCalls.push(name); throw new Error('stubbed Google client'); };
    return {
      mirrorVerifiedProfile: stub('mirrorVerifiedProfile'),
      patchLocationAttributes: stub('patchLocationAttributes'),
      patchLocationRaw: stub('patchLocationRaw'),
      readLocationAttributes: stub('readLocationAttributes'),
      readLocationRaw: stub('readLocationRaw'),
      updateLocationProfile: stub('updateLocationProfile'),
    };
  }
  return origLoad.call(this, request, ...rest);
};

let failures = 0;
const check = (name: string, pass: boolean, detail = '') => {
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function main() {
  const { MongoMemoryServer } = await import('mongodb-memory-server' as string);
  const mem = await MongoMemoryServer.create({ instance: { launchTimeout: 90_000 } });
  process.env.MONGODB_URI = mem.getUri('growwmatics_fr5_dedupe_check');
  try { await run(); } finally {
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect().catch(() => {});
    await mem.stop({ doCleanup: true, force: true }).catch(() => {});
  }
}

async function run() {
  const mongoose = (await import('mongoose')).default;
  const GbpProfileChange = (await import('../src/models/GbpProfileChange')).default;
  const GBPToken = (await import('../src/models/GBPToken')).default;
  const store = await import('../src/services/gbp/changes/store');
  const { openProposalKey, canonicalFingerprint } = await import('../src/services/gbp/changes/policy');
  const { attributeBatchRequestId } = await import('../src/app/dashboard/profile-optimization/requestId');
  const { migrateOpenProposalKeys } = await import('./migrate-open-proposal-keys');
  const dbConnect = (await import('../src/lib/mongodb')).default;
  await dbConnect();
  await GbpProfileChange.init();
  const col = GbpProfileChange.collection;
  const oid = () => new mongoose.Types.ObjectId();

  const bizA = String(oid());
  const bizB = String(oid());
  const userId = String(oid());
  const locationId = 'accounts/1/locations/dedupe-1';
  for (const b of [bizA, bizB]) {
    await GBPToken.collection.insertOne({ businessId: new mongoose.Types.ObjectId(b), organizationId: oid(), googleAccountId: 'c', googleEmail: 'c@example.test', accessToken: 'x', refreshToken: 'x', expiresAt: new Date(Date.now() + 3_600_000), locationId });
  }
  const input = (over: Partial<Parameters<typeof store.createProposal>[0]> = {}) => ({
    businessId: bizA, locationId, kind: 'description', fields: ['description'], source: 'owner',
    before: 'Old text.', proposed: 'New text for Nashik.', validation: { valid: true, violations: [] }, requestedBy: userId, ...over,
  });
  const count = (filter: Record<string, unknown>) => GbpProfileChange.countDocuments(filter);

  // --- Index exists and is enforced by the database itself
  const ix = (await col.indexes()).find((i) => i.name === 'open_proposal_key');
  check('index open_proposal_key exists, unique, partial on string keys', !!ix && ix.unique === true && JSON.stringify(ix.partialFilterExpression) === JSON.stringify({ openKey: { $type: 'string' } }), JSON.stringify(ix));
  const rawDoc = (key: string) => ({ businessId: new mongoose.Types.ObjectId(bizB), locationId, kind: 'title', fields: [], source: 'raw', beforeFingerprint: 'x', status: 'PROPOSED', validation: { valid: true, violations: [] }, requestedBy: 'raw', openKey: key });
  await col.insertOne(rawDoc('raw-key'));
  let rawDup: any = null;
  try { await col.insertOne(rawDoc('raw-key')); } catch (err) { rawDup = err; }
  check('raw insert of a second identical open key is rejected by MongoDB (E11000)', rawDup?.code === 11000);
  await col.insertMany([{ ...rawDoc('x'), openKey: null }, { ...rawDoc('x'), openKey: null }]);
  check('records without a key are outside the index (two null keys allowed)', (await count({ source: 'raw', openKey: null })) === 2);
  await col.deleteMany({ source: 'raw' });

  // --- Concurrent identical creation
  const N = 25;
  const burst = await Promise.all(Array.from({ length: N }, () => store.createProposal(input())));
  const ids = new Set(burst.map((r) => String(r.change._id)));
  check(`concurrent identical creation (${N} at once) stores exactly one`, (await count({ businessId: bizA, kind: 'description' })) === 1);
  check('every concurrent caller gets the same proposal', ids.size === 1);
  check('exactly one caller reports created, the rest reused', burst.filter((r) => r.outcome === 'created').length === 1 && burst.filter((r) => r.outcome === 'reused').length === N - 1);
  const first = burst[0].change;
  check('stored key is the documented key', first.openKey === openProposalKey('description', canonicalFingerprint('description', 'Old text.'), 'New text for Nashik.'));

  // --- What is and is not a duplicate
  const otherBiz = await store.createProposal(input({ businessId: bizB }));
  check('same change for a different business is stored separately', otherBiz.outcome === 'created' && String(otherBiz.change._id) !== String(first._id));
  const otherValue = await store.createProposal(input({ proposed: 'Different text for Nashik.' }));
  check('different proposed value is a new proposal', otherValue.outcome === 'created');
  const otherBefore = await store.createProposal(input({ before: 'Edited on Google meanwhile.' }));
  check('same proposed value but changed current value is a new proposal', otherBefore.outcome === 'created');
  const otherKind = await store.createProposal(input({ kind: 'title', fields: ['title'], before: 'Old text.', proposed: 'New text for Nashik.' }));
  check('same values under a different kind is a new proposal', otherKind.outcome === 'created');
  const objA = await store.createProposal(input({ kind: 'hours', fields: ['hours'], before: null, proposed: { regularHours: { periods: [{ openDay: 'MONDAY', closeDay: 'MONDAY', openTime: { hours: 9, minutes: 0 }, closeTime: { hours: 18, minutes: 0 } }] } } }));
  const objB = await store.createProposal(input({ kind: 'hours', fields: ['hours'], before: null, proposed: { regularHours: { periods: [{ closeTime: { minutes: 0, hours: 18 }, openTime: { minutes: 0, hours: 9 }, closeDay: 'MONDAY', openDay: 'MONDAY' }] } } }));
  check('key ignores object key order (same hours, different JSON order)', objB.outcome === 'reused' && String(objB.change._id) === String(objA.change._id));
  const invalid1 = await store.createProposal(input({ proposed: 'bad', validation: { valid: false, violations: [{ code: 'x', message: 'Bad.' }] } }));
  const invalid2 = await store.createProposal(input({ proposed: 'bad', validation: { valid: false, violations: [{ code: 'x', message: 'Bad.' }] } }));
  check('invalid proposals are stored BLOCKED without a key (audit trail kept)', invalid1.change.status === 'BLOCKED' && invalid2.change.status === 'BLOCKED' && !invalid1.change.openKey && String(invalid1.change._id) !== String(invalid2.change._id));
  const wrapper = await store.createChange(input());
  check('createChange (profile route, SEO plan) returns the existing open proposal', String(wrapper._id) === String(first._id));

  // --- Request ids keep their replay semantics
  const keyed = await store.createProposal(input({ proposed: 'Keyed text.', clientRequestId: 'req-1' }));
  const replay = await store.createProposal(input({ proposed: 'Keyed text.', clientRequestId: 'req-1' }));
  check('same request id replays the same record', replay.outcome === 'reused' && String(replay.change._id) === String(keyed.change._id));
  const otherReq = await store.createProposal(input({ proposed: 'Keyed text.', clientRequestId: 'req-2' }));
  check('new request id for an identical open proposal returns the open one', otherReq.outcome === 'reused' && String(otherReq.change._id) === String(keyed.change._id));
  let conflict: unknown = null;
  try { await store.createProposal(input({ proposed: 'Other text.', clientRequestId: 'req-1' })); } catch (err) { conflict = err; }
  check('same request id with a different proposal is still a conflict', conflict instanceof store.ProposalConflictError);

  // --- Approval keeps the key; Apply with writes off keeps it
  const actor = { userId, businessId: bizA };
  const approved = await store.approveChange(String(first._id), actor);
  const afterApprove = await GbpProfileChange.findById(first._id).lean();
  check('approve keeps the key (APPROVED is open)', approved.ok && afterApprove?.status === 'APPROVED' && afterApprove?.openKey === first.openKey);
  const dupOfApproved = await store.createProposal(input());
  check('identical proposal while APPROVED returns the approved one', dupOfApproved.outcome === 'reused' && dupOfApproved.change.status === 'APPROVED');
  const applied = await store.executeChange(String(first._id), actor);
  const afterApply = await GbpProfileChange.findById(first._id).lean();
  check('apply with writes off: refused, still APPROVED, key kept', !applied.ok && afterApply?.status === 'APPROVED' && afterApply?.openKey === first.openKey);

  // --- Every closing transition releases the key (document saves)
  for (const status of ['BLOCKED', 'FAILED', 'CONFLICT', 'UNRESOLVED', 'VERIFIED', 'REVERTED', 'APPLIED']) {
    const made = (await store.createProposal(input({ kind: 'phone', fields: ['phone'], before: '+91 1', proposed: `+91 ${status}` }))).change;
    const doc = await GbpProfileChange.findById(made._id);
    doc!.status = status as any;
    await doc!.save();
    const saved = await GbpProfileChange.findById(made._id).lean();
    check(`save to ${status} releases the key`, made.openKey != null && saved?.openKey == null);
  }
  // ...update queries
  const q1 = (await store.createProposal(input({ kind: 'website', fields: ['website'], before: 'a', proposed: 'https://q1.example' }))).change;
  await GbpProfileChange.findOneAndUpdate({ _id: q1._id }, { $set: { status: 'FAILED' } });
  check('findOneAndUpdate to FAILED releases the key', (await GbpProfileChange.findById(q1._id).lean())?.openKey == null);
  const q2 = (await store.createProposal(input({ kind: 'website', fields: ['website'], before: 'a', proposed: 'https://q2.example' }))).change;
  await GbpProfileChange.updateOne({ _id: q2._id }, { $set: { status: 'CONFLICT' } });
  check('updateOne to CONFLICT releases the key', (await GbpProfileChange.findById(q2._id).lean())?.openKey == null);
  const q3 = (await store.createProposal(input({ kind: 'website', fields: ['website'], before: 'a', proposed: 'https://q3.example' }))).change;
  await GbpProfileChange.findOneAndUpdate({ _id: q3._id }, { $set: { status: 'EXECUTING' } });
  check('claim to EXECUTING keeps the key (Apply in flight)', (await GbpProfileChange.findById(q3._id).lean())?.openKey === q3.openKey);
  await GbpProfileChange.findOneAndUpdate({ _id: q3._id }, { $set: { status: 'APPROVED' } });
  check('hand-back EXECUTING → APPROVED keeps the key', (await GbpProfileChange.findById(q3._id).lean())?.openKey === q3.openKey);
  await GbpProfileChange.updateOne({ _id: q3._id }, { $set: { error: 'note only' } });
  check('an update without a status leaves the key alone', (await GbpProfileChange.findById(q3._id).lean())?.openKey === q3.openKey);

  // --- Re-proposal after a proposal closed
  const blockedFirst = await GbpProfileChange.findById(first._id);
  blockedFirst!.status = 'BLOCKED';
  blockedFirst!.error = 'test close';
  await blockedFirst!.save();
  const reproposed = await store.createProposal(input());
  check('identical change can be proposed again after the open one is BLOCKED', reproposed.outcome === 'created' && reproposed.change.status === 'PROPOSED' && String(reproposed.change._id) !== String(first._id));
  check('the BLOCKED record is kept (history intact)', (await GbpProfileChange.findById(first._id).lean())?.status === 'BLOCKED');

  // --- Attributes batch
  const row = { name: 'attributes/has_wheelchair_accessible_entrance', valid: true, attribute: { name: 'attributes/has_wheelchair_accessible_entrance', valueType: 'BOOL', values: [true] }, violations: [] };
  const items = [{ name: row.name, value: true }];
  const batchArgs = async (clientRequestId: string) => ({ businessId: bizA, locationId, requestedBy: userId, clientRequestId, current: [], rows: [row, { name: 'attributes/bogus', valid: false, attribute: null, violations: [{ code: 'x', message: 'Not in the catalog.' }] }] });
  const k1 = await attributeBatchRequestId(items);
  const k2 = await attributeBatchRequestId(items);
  check('two submissions of the same selection get different request ids (same content prefix)', k1 !== k2 && k1.slice(0, 29) === k2.slice(0, 29) && k1.length <= 80);
  const b1 = await store.proposeAttributeBatch(await batchArgs(k1));
  check('batch stores the valid row and reports the invalid one unstored', b1[0].stored && b1[0].status === 'PROPOSED' && !b1[1].stored);
  const b1dup = await store.proposeAttributeBatch(await batchArgs(k2));
  check('second identical batch while open reuses the open proposal', b1dup[0].stored && b1dup[0].reused && b1dup[0].changeId === b1[0].changeId);
  const blockAttr = await GbpProfileChange.findById(b1[0].changeId);
  blockAttr!.status = 'BLOCKED';
  await blockAttr!.save();
  const k3 = await attributeBatchRequestId(items);
  const b2 = await store.proposeAttributeBatch(await batchArgs(k3));
  check('after BLOCKED, the identical attribute can be proposed again (new record)', b2[0].stored && b2[0].status === 'PROPOSED' && !b2[0].reused && b2[0].changeId !== b1[0].changeId);
  const b1replay = await store.proposeAttributeBatch(await batchArgs(k1));
  check('replaying the old request id still returns its own (blocked) record', !b1replay[0].stored && b1replay[0].changeId === b1[0].changeId);
  check('one open attribute proposal remains', (await count({ businessId: bizA, kind: 'attribute', status: 'PROPOSED' })) === 1);

  // --- Tenant isolation
  const cross = await store.approveChange(String(reproposed.change._id), { userId, businessId: bizB });
  check('another business cannot approve this proposal', !cross.ok);

  // --- Migration: legacy open duplicates without keys
  const legacyBiz = oid();
  const legacy = (minutesAgo: number, status: string, proposed: string) => ({ businessId: legacyBiz, locationId, kind: 'description', fields: [], source: 'owner', before: 'L', proposed, beforeFingerprint: canonicalFingerprint('description', 'L'), status, validation: { valid: true, violations: [] }, requestedBy: 'legacy', createdAt: new Date(Date.now() - minutesAgo * 60000), updatedAt: new Date() });
  await col.insertMany([legacy(3, 'PROPOSED', 'Same.'), legacy(2, 'APPROVED', 'Same.'), legacy(1, 'PROPOSED', 'Same.'), legacy(1, 'BLOCKED', 'Same.'), legacy(1, 'PROPOSED', 'Unique.'), legacy(5, 'EXECUTING', 'Stranded.')]);
  const newestSame = (await col.find({ businessId: legacyBiz, proposed: 'Same.', status: { $in: ['PROPOSED', 'APPROVED'] } }).sort({ createdAt: -1 }).limit(1).toArray())[0];
  const before = await col.find({ businessId: legacyBiz }).sort({ createdAt: 1 }).toArray();
  const dry = await migrateOpenProposalKeys(mongoose.connection.db!, false);
  check('migration dry run writes nothing', (await count({ businessId: legacyBiz, openKey: { $type: 'string' } })) === 0 && (dry as any).wouldKey === 2);
  check('dry run lists the stranded EXECUTING record and does not plan to key it', (dry as any).executingNotKeyed.some((e: any) => e.kind === 'description'));
  const applyRun = await migrateOpenProposalKeys(mongoose.connection.db!, true);
  const keyedLegacy = await col.find({ businessId: legacyBiz, openKey: { $type: 'string' } }).toArray();
  check('migration keys the newest of each identical open group and the unique one', keyedLegacy.length === 2 && (applyRun as any).duplicateOpenProposalsLeftUnchanged === 2, JSON.stringify({ keyed: (applyRun as any).keyed, dups: (applyRun as any).duplicateOpenProposalsLeftUnchanged }));
  check('the key went to the newest open record of the duplicate group', keyedLegacy.some((d) => String(d._id) === String(newestSame._id)));
  check('EXECUTING is not keyed by the migration', (await col.countDocuments({ businessId: legacyBiz, status: 'EXECUTING', openKey: { $type: 'string' } })) === 0);
  // An incompatible index under the same name stops the migration before any write.
  const otherDb = mongoose.connection.getClient().db('fr5_conflicting_index');
  await otherDb.collection('gbpprofilechanges').createIndex({ businessId: 1, openKey: 1 }, { name: 'open_proposal_key' });
  await otherDb.collection('gbpprofilechanges').insertOne({ businessId: oid(), kind: 'description', status: 'PROPOSED', beforeFingerprint: '"a"', proposed: 'b', createdAt: new Date() });
  let conflictErr: unknown = null;
  try { await migrateOpenProposalKeys(otherDb, true); } catch (err) { conflictErr = err; }
  check('an incompatible existing index stops the migration without writing', conflictErr instanceof Error && (await otherDb.collection('gbpprofilechanges').countDocuments({ openKey: { $type: 'string' } })) === 0);

  // CLI target guard (runs the real script against this in-memory server).
  const { spawnSync } = await import('node:child_process');
  const base = String(process.env.MONGODB_URI).replace(/\/[^/?]*(\?|$)/, '/$1');
  const cli = (uri: string, args: string[]) => spawnSync('npx', ['--no-install', 'tsx', 'scripts/migrate-open-proposal-keys.ts', ...args], { env: { ...process.env, MONGODB_URI: uri }, encoding: 'utf8', shell: process.platform === 'win32' });
  const noDb = cli(base, []);
  check('CLI refuses a URI without a database name', noDb.status === 1 && /does not name a database/.test(noDb.stderr));
  const cliTarget = `${base.replace(/\/(\?|$)/, '/growwmatics_fr5_dedupe_check$1')}`;
  const unconfirmed = cli(cliTarget, ['--apply']);
  check('CLI --apply without --confirm-db is refused', unconfirmed.status === 1 && /needs --confirm-db=growwmatics_fr5_dedupe_check/.test(unconfirmed.stderr));
  const wrong = cli(cliTarget, ['--apply', '--confirm-db=growwmatics_prod']);
  check('CLI --apply with the wrong database name is refused', wrong.status === 1);
  const dryCli = cli(cliTarget, []);
  check('CLI dry run prints the target database and no credentials', dryCli.status === 0 && /Target database: growwmatics_fr5_dedupe_check/.test(dryCli.stdout) && /DRY RUN/.test(dryCli.stdout), dryCli.stderr.slice(0, 200));
  const after = await col.find({ businessId: legacyBiz }).sort({ createdAt: 1 }).toArray();
  check('migration leaves statuses and all other fields unchanged', before.every((b, i) => b.status === after[i].status && b.proposed === after[i].proposed && String(b.updatedAt) === String(after[i].updatedAt)));
  const rerun = await migrateOpenProposalKeys(mongoose.connection.db!, true);
  check('migration is idempotent', (rerun as any).keyed === 0);
  const afterMigration = await store.createProposal({ ...input(), businessId: String(legacyBiz), before: 'L', proposed: 'Same.' });
  check('after migration, a new identical proposal returns the legacy open one', afterMigration.outcome === 'reused' && keyedLegacy.some((d) => String(d._id) === String(afterMigration.change._id)));

  check('no Google call in the whole run', googleCalls.length === 0, googleCalls.join(','));

  // --- Control: without the index, the lookup alone does not stop races
  await col.dropIndex('open_proposal_key');
  const ctlBiz = String(oid());
  await Promise.all(Array.from({ length: N }, () => store.createProposal(input({ businessId: ctlBiz }))));
  const ctlCount = await count({ businessId: ctlBiz });
  console.log(`INFO  control without the unique index: ${N} concurrent identical requests stored ${ctlCount} record(s)${ctlCount > 1 ? ' — the index, not the lookup, is what enforces uniqueness' : ' (race not reproduced this run)'}`);
}

main().then(() => {
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});

export {};
