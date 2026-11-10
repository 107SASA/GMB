/**
 * Plan tasks end to end (Phase 1 of audit → fix → proof, Nov 2026):
 * GET /api/tasks, "I've done this", the once-per-report popup, the live
 * refresh between audits (verified change → done; fixed directly in Google →
 * done; undone in Google → open again) and reopening at the next audit.
 * Run: npx tsx --test tests/workflow/plan-tasks.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.GBP_LIVE_WRITES_ENABLED = 'true';
process.env.GBP_FR5_LIVE_WRITES_ENABLED = 'true';

const ctx = { businessId: '', userId: '64b000000000000000000001' };
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/lib[\\/]tenant(\.ts)?$/.test(request)) {
    return { requireBusinessContext: async () => ({ ok: true, businessId: ctx.businessId, userId: ctx.userId, organizationId: 'org1' }) };
  }
  return origLoad.call(this, request, ...rest);
};

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};
let biz = '';
let otherBiz = '';
let auditId = '';
const ids: Record<string, string> = {};

const snapshot = (over: { services?: unknown[]; hasGoogleUpdated?: boolean; attrs?: Array<{ name: string }> } = {}) => ({
  sections: {
    location: {
      meta: { status: 'SUCCESS' },
      data: {
        primaryCategory: { name: 'gcid:software_company' }, description: 'd', primaryPhone: '+91', websiteUri: 'https://mulsetu.com',
        regularHours: [{}], services: over.services ?? [], metadata: { hasGoogleUpdated: over.hasGoogleUpdated ?? true },
      },
    },
    attributes: { meta: { status: 'SUCCESS' }, data: over.attrs ?? [] },
  },
});

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_plan_tasks_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    OptimizationAction: (await import('../../src/models/OptimizationAction')).default,
    GbpProfileChange: (await import('../../src/models/GbpProfileChange')).default,
    Audit: (await import('../../src/models/Audit')).default,
    ProfileActivity: (await import('../../src/models/ProfileActivity')).default,
    tasks: await import('../../src/app/api/tasks/route'),
    done: await import('../../src/app/api/tasks/[id]/done/route'),
    popup: await import('../../src/app/api/tasks/popup/route'),
    sync: await import('../../src/services/lifecycle/actionsSync'),
  };
  const oid = () => new m.mongoose.Types.ObjectId();
  const mkBiz = async (name: string) => String((await m.Business.create({ name, category: 'Software company', address: 'Ojhar', userId: oid(), organizationId: oid(), googleLocationId: 'locations/1' } as any))._id);
  biz = await mkBiz('Mulsetu');
  otherBiz = await mkBiz('Other Workspace');
  ctx.businessId = biz;

  const plannedAt = new Date('2026-10-28T10:00:00Z');
  auditId = String(oid());
  await m.Audit.collection.insertOne({ _id: new m.mongoose.Types.ObjectId(auditId), businessId: new m.mongoose.Types.ObjectId(biz), status: 'COMPLETED', auditKind: 'connected_baseline', createdAt: plannedAt });
  const mk = async (key: string, findingId: string, capability: string | null, extra: any = {}) => {
    const doc = await m.OptimizationAction.create({
      businessId: biz, findingId, capability, plannedInAuditId: auditId, plannedAt, description: key, priority: 'medium',
      ownerAction: 'o', growwmaticsAction: capability ? 'g' : null, requiresGbpConnection: !!capability, status: capability ? 'READY' : 'PLANNED', ...extra,
    });
    ids[key] = String(doc._id);
  };
  await mk('services', 'website.services.missing_on_gbp', 'update_services');
  await mk('attributes', 'gbp.attributes.none', 'update_attributes');
  await mk('website', 'website.gbp_services_not_on_site', null);
  await mk('googleUpdates', 'gbp.change.description', null);
  await mk('ranking', 'competitors.ahead', 'rank_tracking');
  await mk('hours', 'profile.business_hours.missing', 'update_hours', { status: 'VERIFIED', verifiedAt: new Date('2026-11-01') });
  // A drafted attribute change: the attributes task is waiting for approval.
  await m.GbpProfileChange.collection.insertOne({ businessId: new m.mongoose.Types.ObjectId(biz), kind: 'attribute', status: 'PROPOSED', createdAt: new Date() });
});

after(async () => {
  Module._load = origLoad;
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const getTasks = async () => {
  const res = await m.tasks.GET();
  assert.equal(res.status, 200);
  return res.json();
};
const statusOf = (body: any, key: string) => body.tasks.find((t: any) => t.id === ids[key])?.status;
const post = (url: string, body?: unknown) => new Request(`http://test${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

test('GET /api/tasks: statuses, quick approvals first, no measurement tasks, popup on', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const body = await getTasks();
  assert.equal(body.success, true);
  assert.ok(!body.tasks.some((x: any) => x.id === ids.ranking), 'rank tracking is not a customer task');
  assert.equal(statusOf(body, 'services'), 'open');
  assert.equal(statusOf(body, 'attributes'), 'waiting_approval');
  assert.equal(statusOf(body, 'hours'), 'confirmed');
  assert.equal(body.tasks[0].actor, 'approve');
  assert.equal(body.tasks.at(-1).id, ids.hours, 'confirmed last');
  const services = body.tasks.find((x: any) => x.id === ids.services);
  assert.equal(services.target.web, '/dashboard/profile-optimization?section=services');
  assert.equal(services.target.mobile, '/profile-optimization?section=services');
  assert.deepEqual(body.summary, { total: 5, completed: 1, open: 4 });
  assert.equal(body.report.auditId, auditId);
  assert.equal(body.showPopup, true);
});

test('popup: hidden for this report once closed; another workspace\'s report is refused', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal((await m.popup.POST(post('/api/tasks/popup', {}))).status, 400);
  ctx.businessId = otherBiz;
  assert.equal((await m.popup.POST(post('/api/tasks/popup', { auditId }))).status, 404, 'report belongs to another workspace');
  ctx.businessId = biz;
  assert.equal((await m.popup.POST(post('/api/tasks/popup', { auditId }))).status, 200);
  assert.equal((await getTasks()).showPopup, false);
});

test('"I\'ve done this": only for work outside Growwmatics AI, only in its own workspace', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const refused = await m.done.POST(post('/x'), params(ids.services));
  assert.equal(refused.status, 409, 'services update on their own');
  assert.equal((await m.done.POST(post('/x'), params('not-an-id'))).status, 404);
  ctx.businessId = otherBiz;
  assert.equal((await m.done.POST(post('/x'), params(ids.website))).status, 404, 'other workspace');
  ctx.businessId = biz;
  const ok = await m.done.POST(post('/x'), params(ids.website));
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.task.status, 'done');
  assert.match(body.task.statusReason, /Marked done by you/);
  // Pressing it twice is harmless.
  assert.equal((await m.done.POST(post('/x'), params(ids.website))).status, 200);
  assert.equal(statusOf(await getTasks(), 'website'), 'done');
});

test('live refresh: fixed directly in Google → done; undone in Google → open again', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const fixed = await m.sync.refreshTasksLive(biz, { snapshot: snapshot({ services: [{ label: 'Website Development' }], hasGoogleUpdated: false }) });
  assert.ok(fixed.updated >= 2);
  let body = await getTasks();
  assert.equal(statusOf(body, 'services'), 'done');
  assert.match(body.tasks.find((x: any) => x.id === ids.services).statusReason, /Fixed on your Google profile/);
  assert.equal(statusOf(body, 'googleUpdates'), 'done');
  await m.sync.refreshTasksLive(biz, { snapshot: snapshot({ services: [], hasGoogleUpdated: true }) });
  body = await getTasks();
  assert.equal(statusOf(body, 'services'), 'open', 'removed again on Google');
  assert.equal(statusOf(body, 'googleUpdates'), 'open');
  assert.equal(statusOf(body, 'hours'), 'confirmed', 'live refresh never touches confirmed tasks');
});

test('live refresh: a verified Profile optimization change marks its task done at once', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await m.ProfileActivity.create({ businessId: biz, type: 'profile_updated', title: 'Google profile change verified', detail: 'attribute', updatedBy: 'Owner', metadata: { liveWriteApplied: true, fields: ['attribute:has_wifi'] } });
  await m.sync.refreshTasksLive(biz, { snapshot: null });
  const doc = await m.OptimizationAction.findById(ids.attributes).lean();
  assert.equal(doc.status, 'EXECUTED');
  assert.equal(statusOf(await getTasks(), 'attributes'), 'done');
});

test('next audit: issue still there → reopened; issue gone → confirmed', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const nextAudit = String(new m.mongoose.Types.ObjectId());
  const plan = (findingId: string, executor: string) => ({ findingId, evidence: 'e', priority: 'medium' as const, action: findingId, ownerAction: 'o', growwmaticsAction: null, executor, requiresGbpConnection: false, measurement: 'm' });
  // Hours was confirmed, but the new audit finds it again; the website task was
  // marked done by the owner but is still measured. Google updates are gone.
  await m.sync.syncOptimizationActions({
    businessId: biz,
    auditId: nextAudit,
    auditAt: new Date('2026-11-28T10:00:00Z'),
    plan: [plan('profile.business_hours.missing', 'growwmatics:update_hours'), plan('website.gbp_services_not_on_site', 'owner_in_google')],
    currentFindingIds: new Set(['profile.business_hours.missing', 'website.gbp_services_not_on_site']),
    gbpConnected: true,
  });
  const body = await getTasks();
  assert.equal(statusOf(body, 'hours'), 'reopened');
  assert.match(body.tasks.find((x: any) => x.id === ids.hours).statusReason, /Found again/);
  assert.equal(statusOf(body, 'website'), 'reopened');
  assert.equal(body.tasks.find((x: any) => x.id === ids.website).canMarkDone, true, 'can be marked done again');
  assert.equal(statusOf(body, 'googleUpdates'), 'confirmed', 'not found by the new audit');
  const hours = await m.OptimizationAction.findById(ids.hours).lean();
  assert.equal(hours.verifiedAt, undefined);
  assert.ok(hours.history.some((h: any) => /Reopened/.test(h.reason)));
  assert.equal(body.tasks[0].status, 'reopened', 'reopened first');
});
