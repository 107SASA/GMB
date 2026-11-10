/**
 * Editing the business profile in Settings after onboarding updates the SEO
 * brain, like the onboarding form: added keywords lead, removed ones leave
 * every list and are never added back by a monthly audit, and new services /
 * selling point / description replace the old ones.
 * Run: npx tsx --test tests/workflow/settings-seo-brain.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

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

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_settings_brain_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    SeoPlan: (await import('../../src/models/SeoPlan')).default,
    route: await import('../../src/app/api/business/[id]/route'),
    plans: await import('../../src/services/seoPlan/seoPlanService'),
  };
  const biz = await m.Business.create({
    name: 'Sweet Crust', category: 'Bakery', address: 'Pune', userId: new m.mongoose.Types.ObjectId(), organizationId: new m.mongoose.Types.ObjectId(),
    keywords: ['bakery pune', 'cake shop pune', 'birthday cakes'], services: 'Custom cakes, Bread', description: 'A bakery in Pune.',
    intakeCompleted: true, intake: { uniqueSellingPoints: 'Fresh daily' },
  } as any);
  ctx.businessId = String(biz._id);
  await m.SeoPlan.create({
    businessId: biz._id, version: 1, status: 'active',
    primaryKeywords: ['bakery pune', 'cake shop pune', 'birthday cakes', 'pastry pune'], secondaryKeywords: ['cake shop near me'], cityAreaTerms: ['pune'],
    keywordTable: ['bakery pune', 'cake shop pune', 'birthday cakes', 'pastry pune'].map((keyword) => ({ keyword, volumeBand: 'HIGH' })),
    postThemes: [{ weekday: 'Mon', theme: 'Cakes', keyword: 'cake shop pune', postType: 'STANDARD' }],
    trackedKeywords: [{ keyword: 'cake shop pune' }, { keyword: 'bakery pune' }],
    suggestedServices: ['Custom cakes', 'Bread', 'Cookies'], suggestedDescription: 'A bakery in Pune.', uspLine: 'Fresh daily', ownerEdited: true,
  });
});

after(async () => {
  Module._load = origLoad;
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const save = async (body: Record<string, unknown>) => {
  const res = await m.route.PATCH(new Request('http://t/x', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: ctx.businessId }) });
  assert.equal(res.status, 200);
};
const active = () => m.SeoPlan.findOne({ businessId: ctx.businessId, status: 'active' }).lean();

test('Settings edit → new SEO brain version: added keyword leads, removed one is gone everywhere', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await save({
    keywords: ['bakery pune', 'birthday cakes', 'eggless cakes pune'],
    services: 'Custom cakes, Wedding cakes',
    uniqueSellingPoints: 'Organic flour, same-day delivery',
    offers: '10% off this week',
  });
  const plan = await active();
  assert.equal(plan.version, 2);
  assert.equal(plan.primaryKeywords[0], 'eggless cakes pune');
  assert.ok(!plan.primaryKeywords.includes('cake shop pune'));
  assert.ok(!plan.keywordTable.some((r: any) => r.keyword === 'cake shop pune'));
  assert.deepEqual(plan.trackedKeywords.map((r: any) => r.keyword), ['bakery pune']);
  assert.equal(plan.postThemes[0].keyword, 'eggless cakes pune', 'theme moves to the first primary keyword');
  assert.deepEqual(plan.ownerRemovedKeywords, ['cake shop pune']);
  assert.deepEqual(plan.suggestedServices, ['Custom cakes', 'Wedding cakes', 'Cookies'], 'owner services lead; the one they deleted goes; suggested ones stay');
  assert.equal(plan.uspLine, 'Organic flour, same-day delivery');
  assert.equal(plan.ownerEdited, true);
  assert.equal((await m.SeoPlan.findOne({ version: 1 }).lean()).status, 'superseded');

  const biz = await m.Business.findById(ctx.businessId).lean();
  assert.equal(biz.services, 'Custom cakes, Wedding cakes');
  assert.equal(biz.offers, '10% off this week');
  assert.equal(biz.intake.uniqueSellingPoints, 'Organic flour, same-day delivery');
  assert.equal(biz.intakeCompleted, true, 'the rest of the intake is kept');

  const content = await m.plans.resolveContentKeywords(biz);
  assert.ok(content.keywords.includes('eggless cakes pune'));
  assert.ok(!content.keywords.includes('cake shop pune'), 'AI posts stop using the removed keyword');
  assert.equal(content.uspLine, 'Organic flour, same-day delivery');
});

test('the monthly audit never adds a removed keyword back, and keeps the owner\'s edits', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await m.plans.upsertSeoPlanFromAudit({
    businessId: ctx.businessId,
    draft: { uspLine: 'AI written line', weeklyPostThemes: [{ weekday: 'Wed', theme: 'Shop', keyword: 'cake shop pune', postType: 'STANDARD' }] } as any,
    keywordTable: ['cake shop pune', 'bakery pune', 'cupcakes pune'].map((keyword) => ({ keyword, volumeBand: 'HIGH' })) as any,
    areasChecked: [],
    baseline: {} as any,
  });
  const plan = await active();
  assert.equal(plan.version, 3);
  assert.ok(!plan.primaryKeywords.includes('cake shop pune'));
  assert.ok(!plan.keywordTable.some((r: any) => r.keyword === 'cake shop pune'));
  assert.notEqual(plan.postThemes[0]?.keyword, 'cake shop pune');
  assert.deepEqual(plan.ownerRemovedKeywords, ['cake shop pune'], 'remembered across versions');
  assert.equal(plan.uspLine, 'Organic flour, same-day delivery', 'owner edit beats the AI line');
});

test('saving without touching keywords / services / selling point / description makes no new version', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await save({ phone: '+91 98765 43210', keywords: ['Bakery Pune', 'birthday cakes', 'eggless cakes pune'] }); // same keywords, other case
  assert.equal((await active()).version, 3);
});

test('adding a removed keyword again brings it back and forgets the removal', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await save({ keywords: ['bakery pune', 'birthday cakes', 'eggless cakes pune', 'cake shop pune'] });
  const plan = await active();
  assert.equal(plan.version, 4);
  assert.equal(plan.primaryKeywords[0], 'cake shop pune');
  assert.deepEqual(plan.ownerRemovedKeywords, []);
});
