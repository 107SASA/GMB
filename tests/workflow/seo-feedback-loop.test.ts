/**
 * SEO feedback loop against an in-memory MongoDB: action statuses refreshed
 * before planning, SEO plan versions remembering tracked keywords / focus /
 * history, the incomplete-audit guard, and tenant isolation.
 * Run: npx tsx --test tests/workflow/seo-feedback-loop.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

for (const k of Object.keys(process.env)) if (/^(GBP_LIVE_WRITES_ENABLED|GROQ|OPENAI)/.test(k)) delete process.env[k];

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_seo_loop_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    SeoPlan: (await import('../../src/models/SeoPlan')).default,
    OptimizationAction: (await import('../../src/models/OptimizationAction')).default,
    Business: (await import('../../src/models/Business')).default,
    svc: await import('../../src/services/seoPlan/seoPlanService'),
    sync: await import('../../src/services/lifecycle/actionsSync'),
  };
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const oid = () => new m.mongoose.Types.ObjectId();
async function biz() {
  const b = await m.Business.create({ name: `Clinic ${Math.random()}`, category: 'Dentist', address: 'Nashik', userId: oid(), organizationId: oid() } as any);
  return String(b._id);
}
const row = (keyword: string, rank: number | null) => ({ keyword, rank, mapsRank: rank, found: rank != null, rankStatus: 'ok', searchVolume: null, volumeBand: null, demandStatus: 'unavailable', estimated: true });
const tracking = (over: any = {}) => ({
  trackedKeywords: [{ id: 'kw:dental-implants-nashik', keyword: 'Dental implants Nashik', serviceId: 'svc:dental-implants', service: 'Dental implants', intent: 'local', source: 'service_cluster', addedAt: '2026-11-04T00:00:00.000Z', reason: 'r' }],
  keywordChanges: [{ id: 'kw:dental-implants-nashik', keyword: 'Dental implants Nashik', change: 'added', reason: 'r' }],
  measurements: [{ id: 'kw:dental-implants-nashik', keyword: 'Dental implants Nashik', serviceId: 'svc:dental-implants', service: 'Dental implants', areaId: 'area:address', area: 'Around your address', scope: 'address_tracked', points: 3, okCount: 3, foundCount: 0, bestRank: null, avgRank: null, status: 'measured', searchVolume: null }],
  serviceVisibility: [{ serviceId: 'svc:dental-implants', service: 'Dental implants', status: 'not_visible', keywords: [{ keyword: 'Dental implants Nashik', avgRank: null, status: 'measured' }] }],
  matrix: [{ serviceId: 'svc:dental-implants', service: 'Dental implants', areaId: 'a', area: 'Panchavati', keyword: 'Dental implants Panchavati', status: 'not_in_top_20', rank: null, change: null }],
  serviceAreas: ['Panchavati'],
  history: { previousPlanVersion: 1 },
  ...over,
});

test('plan version remembers tracked keywords, focus, service areas, history and what changed', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const id = await biz();
  await m.svc.upsertSeoPlanFromAudit({ businessId: id, keywordTable: [row('dentist nashik', 6)], areasChecked: [], baseline: {}, draft: { weeklyPostThemes: [{ weekday: 'Mon', theme: 'A', keyword: 'x', postType: 'service' }] } as any });
  const v2 = await m.svc.upsertSeoPlanFromAudit({ businessId: id, keywordTable: [row('dentist nashik', 4), row('dental clinic nashik', 9)], areasChecked: [], baseline: {}, tracking: tracking(), rankingComplete: true, draft: { weeklyPostThemes: [{ weekday: 'Mon', theme: 'B', keyword: 'x', postType: 'service' }] } as any });
  assert.equal(v2.version, 2);
  assert.equal(v2.trackedKeywords.length, 1);
  assert.deepEqual(v2.serviceAreas, ['Panchavati']);
  assert.deepEqual(v2.focus.services.map((s: any) => s.service), ['Dental implants']);
  assert.deepEqual(v2.focus.areas, [{ area: 'Panchavati', services: ['Dental implants'] }]);
  assert.ok(v2.keywordTable.some((r: any) => r.keyword === 'Dental implants Nashik' && r.source === 'tracked'), 'tracked rows readable by content');
  assert.deepEqual(v2.changesFromPrevious.added, ['dental clinic nashik']);
  assert.equal(v2.changesFromPrevious.themesChanged, true);
  assert.equal(v2.dataQuality.rankingComplete, true);
  const v1: any = await m.SeoPlan.findOne({ businessId: id, version: 1 }).lean();
  assert.equal(v1.status, 'superseded', 'previous version preserved, not deleted');
});

test('an audit whose ranking failed keeps the previous measured keywords (never overwritten with empty data)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const id = await biz();
  await m.svc.upsertSeoPlanFromAudit({ businessId: id, keywordTable: [row('dentist nashik', 4)], areasChecked: [], baseline: {}, tracking: tracking(), rankingComplete: true });
  const v2 = await m.svc.upsertSeoPlanFromAudit({ businessId: id, keywordTable: [], areasChecked: [], baseline: {}, rankingComplete: false });
  assert.deepEqual(v2.primaryKeywords, ['dentist nashik']);
  assert.ok(v2.keywordTable.length >= 1);
  assert.equal(v2.trackedKeywords.length, 1, 'tracked set carried over');
  assert.equal(v2.dataQuality.rankingComplete, false);
  assert.match(v2.dataQuality.note, /previous measured keywords were kept/);
});

test('owner intake keeps the tracked set and focus', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const id = await biz();
  await m.svc.upsertSeoPlanFromAudit({ businessId: id, keywordTable: [row('dentist nashik', 4)], areasChecked: [], baseline: {}, tracking: tracking(), rankingComplete: true });
  const v = await m.svc.mergeIntakeIntoSeoPlan(id, { keywords: ['root canal nashik'] });
  assert.equal(v.trackedKeywords.length, 1);
  assert.deepEqual(v.serviceAreas, ['Panchavati']);
});

test('action statuses refresh before planning: done, re-measured and blocked actions get current statuses (only this business)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a = await biz();
  const b = await biz();
  const planned = new Date('2026-10-01T00:00:00Z');
  const mk = (businessId: string, findingId: string, capability: string | null) => m.OptimizationAction.create({
    businessId, findingId, plannedInAuditId: oid(), description: findingId, capability, requiresGbpConnection: !!capability, plannedAt: planned, status: 'PLANNED', history: [],
  });
  await mk(a, 'owner_fix_resolved', null);
  await mk(a, 'owner_fix_open', null);
  await mk(a, 'update_title_x', 'update_title');
  await mk(b, 'other_tenant', null);
  const views = await m.sync.refreshActionStatuses({ businessId: a, auditId: String(oid()), auditAt: new Date(), currentFindingIds: new Set(['owner_fix_open', 'update_title_x']), gbpConnected: true });
  const st = Object.fromEntries(views.map((v: any) => [v.findingId, v.status]));
  assert.deepEqual(st, { owner_fix_resolved: 'VERIFIED', owner_fix_open: 'PLANNED', update_title_x: 'BLOCKED' });
  assert.ok(views.every((v: any) => v.plannedAt), 'dates returned for outcome evaluation');
  const stored: any = await m.OptimizationAction.findOne({ businessId: a, findingId: 'owner_fix_resolved' }).lean();
  assert.equal(stored.status, 'VERIFIED', 'persisted before the plan is generated');
  const other: any = await m.OptimizationAction.findOne({ businessId: b }).lean();
  assert.equal(other.status, 'PLANNED', 'another business is never touched');
  // A second refresh is idempotent (no duplicate history).
  await m.sync.refreshActionStatuses({ businessId: a, auditId: String(oid()), auditAt: new Date(), currentFindingIds: new Set(['owner_fix_open', 'update_title_x']), gbpConnected: true });
  const again: any = await m.OptimizationAction.findOne({ businessId: a, findingId: 'owner_fix_resolved' }).lean();
  assert.equal(again.history.length, 1);
});

test('plans are isolated per business', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const a = await biz();
  const b = await biz();
  await m.svc.upsertSeoPlanFromAudit({ businessId: a, keywordTable: [row('dentist nashik', 4)], areasChecked: [], baseline: {}, tracking: tracking(), rankingComplete: true });
  await m.svc.upsertSeoPlanFromAudit({ businessId: b, keywordTable: [row('bakery pune', 2)], areasChecked: [], baseline: {} });
  const pa = await m.svc.getActiveSeoPlan(a);
  const pb = await m.svc.getActiveSeoPlan(b);
  assert.equal(pa.version, 1);
  assert.equal(pb.version, 1);
  assert.deepEqual(pb.trackedKeywords, []);
  assert.deepEqual(pb.primaryKeywords, ['bakery pune']);
});
