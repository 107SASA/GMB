/**
 * Rollback of a verified Google profile change (audit, Nov 2026): the
 * rollback is never recorded as a successful edit, the plan task the change
 * had completed reopens at once — for services, categories, attributes and
 * the booking link — with the reason in its history, and nothing else moves.
 * Run: npx tsx --test tests/workflow/plan-rollback.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.GBP_LIVE_WRITES_ENABLED = 'true';
process.env.GBP_FR5_LIVE_WRITES_ENABLED = 'true';

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};
let biz = '';
const plannedAt = new Date('2026-11-01T06:00:00Z');

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_plan_rollback_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    OptimizationAction: (await import('../../src/models/OptimizationAction')).default,
    ProfileActivity: (await import('../../src/models/ProfileActivity')).default,
    store: await import('../../src/services/gbp/changes/store'),
    sync: await import('../../src/services/lifecycle/actionsSync'),
    collect: await import('../../src/services/lifecycle/collect'),
    monthly: await import('../../src/services/lifecycle/monthly'),
  };
  biz = String((await m.Business.create({ name: 'Mulsetu', category: 'Software company', address: 'Ojhar', userId: new m.mongoose.Types.ObjectId(), organizationId: new m.mongoose.Types.ObjectId(), googleLocationId: 'locations/1' } as any))._id);
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const oid = () => new m.mongoose.Types.ObjectId();
const task = (findingId: string, capability: string, extra: any = {}) =>
  m.OptimizationAction.create({ businessId: biz, findingId, capability, plannedInAuditId: oid(), plannedAt, description: findingId, requiresGbpConnection: true, status: 'READY', ...extra });
/** A verified "Apply to Google", exactly as store.ts noteVerifiedEdit logs it. */
const verifiedEdit = (changeId: string, fields: string[], at = new Date('2026-11-03T10:00:00Z')) =>
  m.ProfileActivity.create({ businessId: biz, type: 'profile_updated', title: 'Google profile change verified', detail: 'x', updatedBy: 'Owner', metadata: { liveWriteApplied: true, fields, changeId }, createdAt: at });
const change = (kind: string, proposed: unknown = null) => ({ _id: oid(), businessId: new m.mongoose.Types.ObjectId(biz), organizationId: null, kind, proposed });
const doc = (id: unknown) => m.OptimizationAction.findById(id).lean();

const cases: Array<{ name: string; findingId: string; capability: string; kind: string; proposed?: unknown; fields: string[] }> = [
  { name: 'services', findingId: 'website.services.missing_on_gbp', capability: 'update_services', kind: 'services', fields: ['services'] },
  { name: 'categories', findingId: 'profile.primary_category.missing', capability: 'update_categories', kind: 'categories', fields: ['additionalCategories'] },
  { name: 'attributes', findingId: 'gbp.attributes.none', capability: 'update_attributes', kind: 'attribute', proposed: { name: 'attributes/has_wifi' }, fields: ['attribute:has_wifi'] },
  { name: 'booking link', findingId: 'website.booking.missing_on_gbp', capability: 'update_booking_link', kind: 'attribute', proposed: { name: 'attributes/url_appointment' }, fields: ['attribute:url_appointment'] },
];

for (const c of cases) {
  test(`${c.name}: applied → Done; rolled back → reopened at once, never counted as the fix`, async (t) => {
    if (skipReason) return t.skip(skipReason);
    const a = await task(c.findingId, c.capability);
    const ch = change(c.kind, c.proposed);
    await verifiedEdit(String(ch._id), c.fields);
    await m.sync.refreshTasksLive(biz, { snapshot: null });
    assert.equal((await doc(a._id)).status, 'EXECUTED', 'the verified change completed the task');

    await m.store.noteRevertedEdit(ch, String(oid()));
    const after = await doc(a._id);
    assert.notEqual(after.status, 'EXECUTED', 'the rollback is not a successful edit');
    assert.ok(['READY', 'PLANNED'].includes(after.status));
    assert.ok(after.reopenedAt, 'shown as reopened');
    assert.equal(after.executedAt, undefined);
    assert.equal(after.executionResult, undefined);
    const reasons = after.history.map((h: any) => h.reason);
    assert.ok(reasons.includes('Reopened — the change on Google was rolled back'), 'history says why');
    assert.ok(after.history.some((h: any) => h.status === 'EXECUTED'), 'the earlier completion stays in the history');

    // The rollback row is a live write (attribution) but marked reverted.
    const row = await m.ProfileActivity.findOne({ businessId: biz, 'metadata.changeId': String(ch._id), 'metadata.reverted': true }).lean();
    assert.equal(row.title, 'Google profile change rolled back');
    assert.equal(row.metadata.liveWriteApplied, true);

    // Later refreshes do not count the undone edit or the rollback as the fix.
    await m.sync.refreshTasksLive(biz, { snapshot: null });
    assert.notEqual((await doc(a._id)).status, 'EXECUTED');
    await m.OptimizationAction.deleteOne({ _id: a._id });
  });
}

test('a confirmed (VERIFIED) task and a seen-fixed task reopen too; unrelated tasks do not move', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const confirmed = await task('website.services.missing_on_gbp', 'update_services', { status: 'VERIFIED', verifiedAt: new Date('2026-11-28'), verificationResult: 'gone' });
  const seen = await task('gbp.attributes.none', 'update_attributes', { seenFixedOnGoogleAt: new Date('2026-11-04') });
  // Hours and booking link were completed by their own verified changes.
  const hours = await task('profile.business_hours.missing', 'update_hours', { status: 'EXECUTED', executedAt: new Date('2026-11-02') });
  const booking = await task('website.booking.missing_on_gbp', 'update_booking_link', { status: 'EXECUTED', executedAt: new Date('2026-11-02') });
  await verifiedEdit(String(oid()), ['regularHours', 'specialHours']);
  await verifiedEdit(String(oid()), ['attribute:url_appointment']);

  await m.store.noteRevertedEdit(change('services'), String(oid()));
  const c = await doc(confirmed._id);
  assert.ok(c.reopenedAt);
  assert.equal(c.verifiedAt, undefined);
  assert.equal((await doc(hours._id)).status, 'EXECUTED', 'a services rollback leaves hours alone');

  // An attribute rollback reopens the attributes task, not the booking link.
  await m.store.noteRevertedEdit(change('attribute', { name: 'attributes/has_wifi' }), String(oid()));
  const s = await doc(seen._id);
  assert.ok(s.reopenedAt);
  assert.equal(s.seenFixedOnGoogleAt, null);
  assert.equal((await doc(booking._id)).status, 'EXECUTED', 'a non-link attribute is not the booking link');
});

test('monthly counts: a rolled-back change and its rollback are not optimizations', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const kept = String(oid());
  const undone = String(oid());
  await m.ProfileActivity.deleteMany({ businessId: biz });
  await verifiedEdit(kept, ['description']);
  await verifiedEdit(undone, ['services']);
  await m.store.noteRevertedEdit({ _id: undone, businessId: new m.mongoose.Types.ObjectId(biz), organizationId: null, kind: 'services', proposed: null }, String(oid()));
  const ex = await m.collect.collectExecutions(biz, new Date('2026-10-01'), new Date('2027-01-01'));
  assert.equal(ex.profileEdits.length, 3, 'all three rows are collected (attribution still sees them)');
  assert.deepEqual(m.monthly.effectiveProfileEdits(ex.profileEdits).map((e: any) => e.changeId), [kept]);
});

test('the rollback path logs a rollback, never a verified edit', () => {
  const src = fs.readFileSync('src/services/gbp/changes/store.ts', 'utf8');
  const restore = src.slice(src.indexOf('async function restorePrevious('), src.indexOf('export async function rollbackChange('));
  assert.match(restore, /await noteRevertedEdit\(claimed, actor\.userId\)/);
  assert.doesNotMatch(restore, /noteVerifiedEdit\(/);
});
