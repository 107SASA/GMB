/**
 * Existing (paying / free-trial) customers: their plan tasks were saved
 * before Nov 2026 with capability null for services, categories, hours,
 * attributes and the booking link. From the first dashboard visit after the
 * release they must already get "Fix now", tick Done when the approved change
 * is verified, and reopen on a rollback — without any migration: the stored
 * documents keep capability null until their next report re-syncs them.
 * Run: npx tsx --test tests/workflow/plan-tasks-existing-customers.test.ts
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
const ids: Record<string, string> = {};
const plannedAt = new Date('2026-10-28T06:00:00Z');

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_existing_customers_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    OptimizationAction: (await import('../../src/models/OptimizationAction')).default,
    ProfileActivity: (await import('../../src/models/ProfileActivity')).default,
    tasks: await import('../../src/app/api/tasks/route'),
    done: await import('../../src/app/api/tasks/[id]/done/route'),
    sync: await import('../../src/services/lifecycle/actionsSync'),
    store: await import('../../src/services/gbp/changes/store'),
  };
  ctx.businessId = String((await m.Business.create({ name: 'Mulsetu', category: 'Software company', address: 'Ojhar', userId: new m.mongoose.Types.ObjectId(), organizationId: new m.mongoose.Types.ObjectId(), googleLocationId: 'locations/1', subscriptionStatus: 'trial_active' } as any))._id);
  // Exactly as an October report saved them: owner tasks, capability null.
  const legacy = async (key: string, findingId: string) => {
    const doc = await m.OptimizationAction.collection.insertOne({
      businessId: new m.mongoose.Types.ObjectId(ctx.businessId), findingId, capability: null, requiresGbpConnection: false,
      plannedInAuditId: new m.mongoose.Types.ObjectId(), plannedAt, description: findingId, priority: 'medium', status: 'PLANNED',
      ownerAction: 'Add the services you really offer in Google Business Profile.', growwmaticsAction: null, history: [],
    });
    ids[key] = String(doc.insertedId);
  };
  await legacy('services', 'website.services.missing_on_gbp');
  await legacy('attributes', 'gbp.attributes.none');
  await legacy('booking', 'website.booking.not_on_listing');
  await legacy('website', 'website.gbp_services_not_on_site'); // genuinely owner work
});

after(async () => {
  Module._load = origLoad;
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const list = async () => (await (await m.tasks.GET()).json()).tasks;
const view = async (key: string) => (await list()).find((t: any) => t.id === ids[key]);
const stored = (key: string) => m.OptimizationAction.findById(ids[key]).lean();

test('first visit after the release: Fix now into Profile optimization, not "do it in Google"', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const services = await view('services');
  assert.equal(services.actor, 'approve');
  assert.equal(services.target.web, '/dashboard/profile-optimization?section=services');
  assert.equal(services.target.mobile, '/profile-optimization?section=services');
  assert.equal(services.canMarkDone, false, 'detected automatically — no "I\'ve done this"');
  assert.equal((await view('attributes')).target.section, 'attributes');
  assert.equal((await view('booking')).target.section, 'links');
  const website = await view('website');
  assert.equal(website.target.screen, 'instructions', 'real owner work keeps its steps');
  assert.equal(website.canMarkDone, true);
  // "I've done this" is refused for the services task, as for new ones.
  const res = await m.done.POST(new Request('http://t/x', { method: 'POST' }), { params: Promise.resolve({ id: ids.services }) });
  assert.equal(res.status, 409);
  assert.equal((await stored('services')).capability, null, 'no migration: the stored task is unchanged');
});

test('approving the change ticks the old task Done at once; a rollback reopens it', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const changeId = new m.mongoose.Types.ObjectId();
  await m.ProfileActivity.create({ businessId: ctx.businessId, type: 'profile_updated', title: 'Google profile change verified', detail: 'services', updatedBy: 'Owner', metadata: { liveWriteApplied: true, fields: ['services'], changeId: String(changeId) }, createdAt: new Date(Date.now() - 60_000) });
  await m.sync.refreshTasksLive(ctx.businessId, { snapshot: null });
  assert.equal((await view('services')).status, 'done');
  assert.equal((await stored('services')).status, 'EXECUTED');

  await m.store.noteRevertedEdit({ _id: changeId, businessId: new m.mongoose.Types.ObjectId(ctx.businessId), organizationId: null, kind: 'services', proposed: null }, ctx.userId);
  assert.equal((await view('services')).status, 'reopened');
});

test('fixed directly in Google: the 6-hourly sync ticks the old attributes task', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await m.sync.refreshTasksLive(ctx.businessId, {
    snapshot: { sections: { location: { meta: { status: 'SUCCESS' }, data: { primaryCategory: null, description: null, primaryPhone: null, websiteUri: null, regularHours: null, services: [], metadata: { hasGoogleUpdated: false } } }, attributes: { meta: { status: 'SUCCESS' }, data: [{ name: 'attributes/has_wifi' }] } } },
  });
  assert.equal((await view('attributes')).status, 'done');
  assert.match((await view('attributes')).statusReason, /Fixed on your Google profile/);
});
