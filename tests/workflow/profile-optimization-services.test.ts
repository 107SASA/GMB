/**
 * "Add the services you really offer — your website already names: …" opened
 * Profile optimization with no Services section: the suggestion list was
 * Google's own (empty) list, so nothing was ever left to add. Suggestions now
 * come from the owner's services and the stored website read.
 * Run: npx tsx --test tests/workflow/profile-optimization-services.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const ctx: any = { businessId: '', business: {} };
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/lib[\\/]tenant(\.ts)?$/.test(request)) {
    return { requireBusinessContext: async () => ({ ok: true, businessId: ctx.businessId, userId: 'u1', organizationId: 'org1', business: ctx.business }) };
  }
  if (/lib[\\/]gbpClient(\.ts)?$/.test(request)) {
    // No Google calls in this test: live reads fail → the route uses the snapshot.
    const fail = async () => { throw new Error('offline'); };
    return {
      readLocationAttributes: fail, readLocationRaw: fail, listCategoryAttributes: fail, searchGbpCategories: fail,
      getCategoryServiceTypes: async () => { if (!ctx.googleServices) throw new Error('offline'); return ctx.googleServices; },
      getFoodMenus: fail, getLodging: fail, listPlaceActionTypes: fail, listPlaceActionLinks: fail,
    };
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
  process.env.MONGODB_URI = memoryServer.getUri(`gm_po_services_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Snapshot: (await import('../../src/models/GbpLocationSnapshot')).default,
    WebsiteIntelligence: (await import('../../src/models/WebsiteIntelligence')).default,
    route: await import('../../src/app/api/gbp/optimize/route'),
  };
  const id = new m.mongoose.Types.ObjectId();
  ctx.businessId = String(id);
  ctx.business = { _id: id, name: 'Mulsetu', category: 'Software company', city: 'Ozar', website: 'https://mulsetu.example', services: 'Website Development, ERP' };
  await m.Snapshot.collection.insertOne({
    businessId: id, locationId: 'locations/1',
    sections: { location: { meta: { status: 'SUCCESS' }, data: { title: 'Mulsetu', primaryCategory: { name: 'categories/gcid:software_company', displayName: 'Software company' }, address: { locality: 'Ozar' }, services: [{ displayName: 'ERP' }], metadata: { canModifyServiceList: true } } } },
  });
  await m.WebsiteIntelligence.collection.insertOne({ origin: 'https://mulsetu.example', services: [{ value: 'AI & Automation' }, { value: 'Website Development' }, { value: 'Mobile App Development' }] });
});

after(async () => {
  Module._load = origLoad;
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

test('Services section suggests the owner\'s and the website\'s services that Google does not list yet', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const res = await m.route.GET(new Request('http://t/api/gbp/optimize'));
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json).slice(0, 300));
  const names = json.services.items.map((s: any) => s.name);
  assert.deepEqual(names, ['Website Development', 'AI & Automation', 'Mobile App Development'], 'ERP is already on Google; duplicates merged');
  assert.equal(json.services.blocked, false);
});

test('Google\'s own services for the category: matching ones ticked, the rest offered unticked, existing ones skipped', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const cat = 'categories/gcid:software_company';
  ctx.googleServices = [
    { serviceTypeId: 'job_type_id:website_development', displayName: 'Website development', categoryName: cat },
    { serviceTypeId: 'job_type_id:erp', displayName: 'ERP', categoryName: cat },
    { serviceTypeId: 'job_type_id:cloud_migration', displayName: 'Cloud migration', categoryName: cat },
  ];
  try {
    const res = await m.route.GET(new Request('http://t/api/gbp/optimize'));
    const json = await res.json();
    assert.equal(res.status, 200, JSON.stringify(json).slice(0, 300));
    const byName = new Map(json.services.items.map((s: any) => [s.name, s]));
    const web: any = byName.get('Website development');
    assert.equal(web?.kind, 'google');
    assert.equal(web?.serviceTypeId, 'job_type_id:website_development');
    assert.equal(web?.preselected, true, 'the owner offers it → ticked');
    assert.equal(byName.has('Website Development'), false, 'not suggested twice in two spellings');
    assert.equal((byName.get('AI & Automation') as any)?.kind, 'custom');
    assert.equal((byName.get('Cloud migration') as any)?.preselected, false, 'Google-only service → unticked');
    assert.equal(byName.has('ERP'), false, 'already on the profile');
    assert.equal(json.capabilities.services, true);
  } finally {
    ctx.googleServices = null;
  }
});
