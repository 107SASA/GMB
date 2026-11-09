/**
 * scripts/migrate-keyword-set.ts end to end (docs/KEYWORD_SYSTEM_PLAN.md §11),
 * run as the real script against an in-memory MongoDB: the dry run writes
 * nothing; --apply trims owner lists over 20 into legacyKeywords and seeds a
 * keyword list for active plans that have none; a second run is a no-op.
 * Run: npx tsx --test tests/workflow/keyword-migration.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

let memoryServer: any = null;
let skipReason: string | null = null;
let uri = '';
let m: any = {};

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  uri = memoryServer.getUri(`gm_kw_migrate_${Date.now()}`);
  process.env.MONGODB_URI = uri;
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    SeoPlan: (await import('../../src/models/SeoPlan')).default,
  };
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const runScript = (...args: string[]) =>
  execFileSync('npx', ['tsx', path.join(process.cwd(), 'scripts/migrate-keyword-set.ts'), ...args], {
    env: { ...process.env, MONGODB_URI: uri },
    encoding: 'utf8',
    timeout: 120_000,
  });

test('dry run changes nothing; --apply trims and seeds; a second run is a no-op', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const oid = () => new m.mongoose.Types.ObjectId();
  const longList = Array.from({ length: 24 }, (_, i) => `dental service ${i} kolkata`);
  const big = await m.Business.create({ name: 'Smilewell Dental', category: 'Dentist', city: 'Kolkata', address: 'Kolkata', services: 'Dental implants, Braces', keywords: longList, intakeCompleted: true, userId: oid(), organizationId: oid() } as any);
  const withPlan = await m.Business.create({ name: 'Bright Smile', category: 'Dentist', city: 'Kolkata', address: 'Kolkata', services: 'Dental implants', keywords: ['dental implants kolkata'], intakeCompleted: true, userId: oid(), organizationId: oid() } as any);
  await m.SeoPlan.create({
    businessId: withPlan._id, version: 1, status: 'active',
    keywordTable: [{ keyword: 'dental implants kolkata', rank: 6, found: true, rankStatus: 'ok', searchVolume: 590, demandStatus: 'measured' }],
  } as any);

  const dry = runScript();
  assert.match(dry, /DRY RUN — nothing written/);
  assert.match(dry, /Smilewell Dental .*keep 20, move 4/);
  assert.equal((await m.Business.findById(big._id).lean()).keywords.length, 24, 'dry run wrote nothing');
  assert.equal((await m.SeoPlan.findOne({ businessId: withPlan._id }).lean()).keywordSet.length, 0);

  const applied = runScript('--apply');
  assert.match(applied, /Applied: 1 keyword list\(s\) trimmed, 1 plan\(s\) seeded/);
  const b = await m.Business.findById(big._id).lean();
  assert.equal(b.keywords.length, 20);
  assert.deepEqual(b.legacyKeywords, longList.slice(20));
  const plan = await m.SeoPlan.findOne({ businessId: withPlan._id }).lean();
  const row = plan.keywordSet.find((k: any) => k.keyword === 'dental implants kolkata');
  assert.equal(row.rank.avg, 6);
  assert.equal(row.volume.country, 590);
  assert.equal(row.role, 'core');

  const again = runScript('--apply');
  assert.match(again, /Applied: 0 keyword list\(s\) trimmed, 0 plan\(s\) seeded/);
});
