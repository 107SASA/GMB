/**
 * Account hard-purge, run for real against a database: everything of the
 * deleted account's workspace is removed — including Google profile change
 * proposals and plan tasks — its Google tokens (Business Profile and a
 * salesperson's Calendar) are revoked first, and another account's data and
 * platform configuration are left untouched.
 * Run: npx tsx --test tests/workflow/account-purge.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};
let db: any = null;
const ids: Record<string, any> = {};
const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-12-15T10:00:00Z');

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_account_purge_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    purge: await import('../../src/services/account/hardPurge'),
    plan: await import('../../src/services/account/purgePlan'),
  };
  db = m.mongoose.connection.db;
  const oid = () => new m.mongoose.Types.ObjectId();
  for (const k of ['user', 'biz', 'otherUser', 'otherBiz', 'audit', 'otherAudit']) ids[k] = oid();

  // The account deleted 40 days ago (past the grace period) and someone else's.
  await db.collection('users').insertMany([
    { _id: ids.user, role: 'CLIENT', email: 'owner@example.invalid', phone: '+919800000001', isDeleted: true, deletedAt: new Date(now.getTime() - 40 * DAY) },
    { _id: ids.otherUser, role: 'CLIENT', email: 'other@example.invalid', phone: '+919800000002' },
  ]);
  await db.collection('businesses').insertMany([
    { _id: ids.biz, name: 'Mulsetu', userId: ids.user, isDeleted: true, deletedAt: new Date(now.getTime() - 40 * DAY) },
    { _id: ids.otherBiz, name: 'Other', userId: ids.otherUser },
  ]);
  const both = (b: any, extra: any) => [{ businessId: ids.biz, ...extra }, { businessId: b, ...extra }];
  await db.collection('audits').insertMany([{ _id: ids.audit, businessId: ids.biz }, { _id: ids.otherAudit, businessId: ids.otherBiz }]);
  await db.collection('gbpprofilechanges').insertMany(both(ids.otherBiz, { kind: 'services', status: 'VERIFIED', before: [], proposed: [{ name: 'Web' }] }));
  // Some rows store the business id as a hex string — the purge matches both forms.
  await db.collection('gbpprofilechanges').insertOne({ businessId: String(ids.biz), kind: 'description', status: 'PROPOSED' });
  await db.collection('optimizationactions').insertMany(both(ids.otherBiz, { findingId: 'f', status: 'READY' }));
  await db.collection('profileactivities').insertMany(both(ids.otherBiz, { type: 'profile_updated' }));
  await db.collection('gbptokens').insertMany(both(ids.otherBiz, { refreshToken: 'enc-gbp' }));
  await db.collection('salespersoncalendarconnections').insertMany([
    { userId: ids.user, refreshTokenEnc: 'enc-calendar', accessTokenEnc: 'enc-access', googleEmail: 'owner@example.invalid' },
    { userId: ids.otherUser, refreshTokenEnc: 'enc-other-calendar' },
  ]);
  // Platform configuration — never purged.
  await db.collection('nurtureconfigaudits').insertOne({ version: 2, previousVersion: 1, actorUserId: String(ids.user), changes: ['delay'] });
  await db.collection('reviewfollowuppolicies').insertOne({ key: 'global', enabled: true });
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const count = (c: string, q: any = {}) => db.collection(c).countDocuments(q);

test('dry run counts what would go and changes nothing', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const r = await m.purge.purgeAccount(String(ids.user), { mode: 'dry_run', now, deps: { storage: { configured: false } as any, revokeGoogleToken: async () => { throw new Error('no revoke in a dry run'); } } });
  assert.equal(r.counts.GbpProfileChange, 2);
  assert.equal(r.counts.SalespersonCalendarConnection, 1);
  assert.equal(r.counts.OptimizationAction, 1);
  assert.equal(await count('gbpprofilechanges'), 3, 'nothing deleted');
});

test('live purge deletes the account\'s data, revokes its Google tokens first, and leaves others alone', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const revoked: string[] = [];
  const r = await m.purge.purgeAccount(String(ids.user), {
    mode: 'live',
    now,
    deps: { storage: { configured: false } as any, revokeGoogleToken: async (tok: string) => { revoked.push(tok); } },
  });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(revoked.sort(), ['enc-calendar', 'enc-gbp'], 'Business Profile and Calendar tokens revoked — not the other account\'s');

  // Every purge target is empty for this account, in either id form.
  for (const target of m.plan.PURGE_TARGETS) {
    const coll = (await import(`../../src/models/${target.model}`)).default.collection.name;
    const or = Object.entries(target.by).map(([field, key]) => ({
      [field]: { $in: key === 'businessId' ? [ids.biz, String(ids.biz)] : key === 'userId' ? [ids.user, String(ids.user)] : key === 'auditId' ? [ids.audit, String(ids.audit)] : [] },
    }));
    assert.equal(await count(coll, { $or: or }), 0, `${target.model} still holds this account's data`);
  }
  assert.equal(r.counts.GbpProfileChange, 2);
  assert.equal(r.counts.SalespersonCalendarConnection, 1);

  // The other account and platform configuration are untouched.
  assert.equal(await count('gbpprofilechanges', { businessId: ids.otherBiz }), 1);
  assert.equal(await count('optimizationactions', { businessId: ids.otherBiz }), 1);
  assert.equal(await count('profileactivities', { businessId: ids.otherBiz }), 1);
  assert.equal(await count('gbptokens', { businessId: ids.otherBiz }), 1);
  assert.equal(await count('salespersoncalendarconnections', { userId: ids.otherUser }), 1);
  assert.equal(await count('audits', { _id: ids.otherAudit }), 1);
  assert.equal(await count('nurtureconfigaudits'), 1);
  assert.equal(await count('reviewfollowuppolicies'), 1);

  // Tombstones: personal fields gone.
  const user = await db.collection('users').findOne({ _id: ids.user });
  assert.ok(user.purgedAt);
  assert.notEqual(user.email, 'owner@example.invalid');
  assert.notEqual(user.phone, '+919800000001', 'phone replaced with a unique placeholder (purgePlan NOT_PURGED.User)');
});

test('a failed Google revoke stops before the tombstone (the purge is retried, tokens never just dropped)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const uid = new m.mongoose.Types.ObjectId();
  await db.collection('users').insertOne({ _id: uid, role: 'CLIENT', email: 'x@example.invalid', isDeleted: true, deletedAt: new Date(now.getTime() - 40 * DAY) });
  await db.collection('salespersoncalendarconnections').insertOne({ userId: uid, refreshTokenEnc: 'enc-fail' });
  const r = await m.purge.purgeAccount(String(uid), { mode: 'live', now, deps: { storage: { configured: false } as any, revokeGoogleToken: async () => { throw new Error('Google revoke HTTP 503'); } } });
  assert.ok(r.errors.some((e: string) => /google calendar revoke: Google revoke HTTP 503/.test(e)));
  const user = await db.collection('users').findOne({ _id: uid });
  assert.equal(user.purgedAt, undefined, 'not marked purged — the next run retries');
});
