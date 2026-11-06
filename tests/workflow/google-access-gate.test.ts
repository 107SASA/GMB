/**
 * "Signed in" is not "Google allowed it" (Michelle Costar, Nov 2026): Google
 * returned 403 on every request, yet the first report ran and AI posts were
 * scheduled. Nothing Google-dependent may start until a sync confirms access,
 * and posts must be held — not failed — while Google refuses.
 * Run: npx tsx --test tests/workflow/google-access-gate.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};
let bizId = '';
let legacyId = '';

const at = new Date('2026-11-06T06:00:00Z').toISOString();
const okLocation = { meta: { status: 'SUCCESS', fetchedAt: at, lastSuccessfulFetchAt: at, error: null }, data: { metadata: { hasVoiceOfMerchant: true, canOperateLocalPost: true, canModifyServiceList: true } } };
const refusedLocation = { meta: { status: 'FAILED', fetchedAt: at, lastSuccessfulFetchAt: null, error: { category: 'AUTHORIZATION', httpStatus: 403, message: 'The caller does not have permission' } }, data: null };

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_google_access_${Date.now()}`);
  delete process.env.GOOGLE_ACCESS_GATE_ENABLED;
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    GBPToken: (await import('../../src/models/GBPToken')).default,
    Snapshot: (await import('../../src/models/GbpLocationSnapshot')).default,
    Post: (await import('../../src/models/Post')).default,
    access: await import('../../src/lib/googleAccess'),
    record: await import('../../src/services/gbp/access/record'),
    audit: await import('../../src/lib/auditAutopilot'),
    content: await import('../../src/lib/contentAutopilot'),
    publish: await import('../../src/services/content/publishPost'),
  };
  const oid = () => new m.mongoose.Types.ObjectId();
  const base = { category: 'Beauty salon', address: 'Pune', organizationId: oid(), userId: oid(), googleConnected: true, googleLocationId: 'locations/9', subscriptionStatus: 'active', keywords: ['salon pune'] };
  bizId = String((await m.Business.create({ name: 'Michelle Costar', ...base } as any))._id);
  legacyId = String((await m.Business.create({ name: 'Connected last month', ...base } as any))._id);
  await m.GBPToken.collection.insertOne({ businessId: new m.mongoose.Types.ObjectId(bizId), locationId: 'locations/9', accountId: 'accounts/1', googleEmail: 'owner@example.com' });
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const access = async (id = bizId) => (await m.Business.findById(id).select('googleAccess autopilotNextRunAt auditAutopilotNextRunAt').lean());
const setSnapshot = (location: any) => m.Snapshot.collection.updateOne(
  { businessId: new m.mongoose.Types.ObjectId(bizId) },
  { $set: { locationId: 'locations/9', sections: { location, verification: { meta: { status: 'NOT_FETCHED' }, data: null } } } },
  { upsert: true },
);

test('just signed in: state is checking and neither the first report nor posts start', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await m.record.markGoogleAccessChecking(bizId);
  await m.audit.maybeStartAuditAutopilot(bizId);
  await m.content.maybeStartContentAutopilot(bizId);
  const b = await access();
  assert.equal(b.googleAccess.state, 'checking');
  assert.equal(b.auditAutopilotNextRunAt, undefined, 'no first report');
  assert.equal(b.autopilotNextRunAt, undefined, 'no AI posts');
});

test('Google refuses (403): blocked, owner told once, every cron query skips the business', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await setSnapshot(refusedLocation);
  const notices: string[] = [];
  const deps = { notify: async (_id: string, v: any) => { notices.push(v.reason); }, onVerified: async () => { throw new Error('must not start'); } };
  const r1 = await m.record.checkGoogleAccessAfterSync(bizId, {}, { deps });
  const r2 = await m.record.checkGoogleAccessAfterSync(bizId, {}, { deps }); // next 6-hourly sync
  assert.equal(r1.state, 'blocked');
  assert.equal(r1.verdict.reason, 'no_permission');
  assert.deepEqual(notices, ['no_permission'], 'one notice, not one per sync');
  assert.equal(r2.noticeSent, false);

  await m.audit.maybeStartAuditAutopilot(bizId);
  await m.content.maybeStartContentAutopilot(bizId);
  assert.equal((await access()).auditAutopilotNextRunAt, undefined);

  const ready = await m.Business.find({ isDeleted: { $ne: true }, ...m.access.googleAccessReadyFilter() }).select('_id').lean();
  assert.deepEqual(ready.map((b: any) => String(b._id)), [legacyId], 'blocked excluded; connected-before-the-check still runs');
  assert.deepEqual([...(await m.access.businessesWithGoogleAccess([bizId, legacyId]))], [legacyId]);
});

test('a Google outage during a later sync changes nothing', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await setSnapshot({ meta: { status: 'FAILED', fetchedAt: at, error: { category: 'TEMPORARY', httpStatus: 503, message: 'backend error' } }, data: null });
  const r = await m.record.checkGoogleAccessAfterSync(bizId, {}, { deps: { notify: async () => { throw new Error('no notice'); } } });
  assert.equal(r.verdict, null);
  assert.equal((await access()).googleAccess.state, 'blocked');
});

test('a scheduled post refused by Google is held as scheduled, not failed', async (t) => {
  if (skipReason) return t.skip(skipReason);
  process.env.GBP_LIVE_WRITES_ENABLED = 'true';
  // State unknown (e.g. connected before the access check shipped): the publish itself discovers the refusal.
  await m.Business.updateOne({ _id: legacyId }, { $unset: { googleAccess: '' } });
  const post = await m.Post.create({ businessId: legacyId, content: 'Diwali offer', title: 'Offer', status: 'scheduled', scheduledDate: new Date(Date.now() - 3_600_000) } as any);
  const refuse = async () => { throw Object.assign(new Error('reconnect'), { httpStatus: 403 }); };
  const r = await m.publish.publishPost(String(post._id), { holdOnAccessRefused: true, deps: { writesEnabled: () => true, createLocalPost: refuse } });
  assert.equal(r.outcome, 'held');
  assert.equal((await m.Post.findById(post._id).lean()).status, 'scheduled');
  assert.equal((await access(legacyId)).googleAccess.state, 'blocked', 'nothing else is attempted until a sync re-checks');
  // The owner's own "Publish now" still reports the failure directly.
  const manual = await m.Post.create({ businessId: legacyId, content: 'x', status: 'scheduled', scheduledDate: new Date() } as any);
  assert.equal((await m.publish.publishPost(String(manual._id), { deps: { writesEnabled: () => true, createLocalPost: refuse } })).outcome, 'failed');
});

test('owner fixes it in Google + Check again: verified, report and posts start, held posts spread out', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const overdue = await m.Post.create({ businessId: bizId, content: 'a', status: 'scheduled', scheduledDate: new Date(Date.now() - 2 * 86_400_000) } as any);
  const overdue2 = await m.Post.create({ businessId: bizId, content: 'b', status: 'scheduled', scheduledDate: new Date(Date.now() - 86_400_000) } as any);
  await setSnapshot(okLocation);
  const started: string[] = [];
  const r = await m.record.checkGoogleAccessAfterSync(bizId, {}, {
    deps: { onVerified: async (id: string) => { started.push(id); await m.record.releaseHeldPosts(id); } },
  });
  assert.equal(r.state, 'verified');
  assert.equal(r.becameVerified, true);
  assert.deepEqual(started, [bizId]);
  const b = await access();
  assert.equal(b.googleAccess.problemSince, null);
  assert.equal(b.googleAccess.noticeReason, null, 'a later problem notifies again');
  const [p1, p2] = await Promise.all([m.Post.findById(overdue._id).lean(), m.Post.findById(overdue2._id).lean()]);
  assert.ok(p1.scheduledDate > new Date() && p2.scheduledDate > p1.scheduledDate, 'one per day from tomorrow, in order');
  assert.ok(m.access.hasGoogleAccess(await m.Business.findById(bizId).lean()));

  // Already verified: the next sync does not start anything again.
  const again = await m.record.checkGoogleAccessAfterSync(bizId, {}, { deps: { onVerified: async () => { throw new Error('twice'); } } });
  assert.equal(again.becameVerified, false);
});

test('kill switch GOOGLE_ACCESS_GATE_ENABLED=false restores googleConnected-only', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await m.Business.updateOne({ _id: legacyId }, { $set: { 'googleAccess.state': 'blocked' } });
  process.env.GOOGLE_ACCESS_GATE_ENABLED = 'false';
  try {
    assert.equal((await m.access.businessesWithGoogleAccess([legacyId])).has(legacyId), true);
  } finally {
    delete process.env.GOOGLE_ACCESS_GATE_ENABLED;
  }
  assert.equal((await m.access.businessesWithGoogleAccess([legacyId])).has(legacyId), false);
});
