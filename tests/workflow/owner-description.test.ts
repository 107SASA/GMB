/**
 * Profile optimization: the owner can write their own description instead of
 * the AI draft. Their own facts ("15 years") are not refused as unverified,
 * and it need not name a city first — but Google's rules (no links, no
 * "best" / "cheapest", 750 characters) still apply. AI drafts keep the
 * stricter checks.
 * Run: npx tsx --test tests/workflow/owner-description.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const ctx: any = { businessId: '', business: {} };
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/lib[\\/]tenant(\.ts)?$/.test(request)) {
    return { requireBusinessContext: async () => ({ ok: true, businessId: ctx.businessId, userId: '64b000000000000000000001', organizationId: null, business: ctx.business }) };
  }
  if (/lib[\\/]gbpClient(\.ts)?$/.test(request)) {
    const real = origLoad.call(this, request, ...rest);
    return { ...real, readLocationRaw: async () => ({ profile: { description: 'Old text.' }, metadata: {} }) };
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
  process.env.MONGODB_URI = memoryServer.getUri(`gm_owner_desc_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    GBPToken: (await import('../../src/models/GBPToken')).default,
    route: await import('../../src/app/api/gbp/changes/route'),
  };
  const id = new m.mongoose.Types.ObjectId();
  ctx.businessId = String(id);
  ctx.business = { _id: id, name: 'Mulsetu', category: 'Software company', city: 'Ozar' };
  await m.GBPToken.collection.insertOne({ businessId: id, locationId: 'locations/1', accountId: 'accounts/1' });
  // A paying workspace: paid actions now check the workspace's own plan (lib/planGate.ts).
  await m.mongoose.connection.collection('businesses').insertOne({ _id: id, ...ctx.business, address: 'Ozar', subscriptionStatus: 'active', createdAt: new Date() });
});

after(async () => {
  Module._load = origLoad;
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const propose = async (proposed: string, source: string) => {
  const res = await m.route.POST(new Request('http://t/api/gbp/changes', { method: 'POST', body: JSON.stringify({ kind: 'description', proposed, source, context: { tokens: ['software company', 'ozar'] } }) }));
  return res.json();
};

test("the owner's own words with their own numbers are saved for approval", async (t) => {
  if (skipReason) return t.skip(skipReason);
  const json = await propose('We build custom ERP and mobile apps for 15 years, for factories and shops across Nashik district.', 'owner');
  assert.equal(json.change?.status, 'PROPOSED', JSON.stringify(json).slice(0, 400));
});

test("Google's rules still apply to the owner's text", async (t) => {
  if (skipReason) return t.skip(skipReason);
  const json = await propose('The best software company — visit www.mulsetu.com today.', 'owner');
  assert.equal(json.change?.status, 'BLOCKED');
  assert.match(String(json.change?.error), /link/);
  assert.match(String(json.change?.error), /Promotional/);
});

test('an AI draft keeps the stricter checks (no unverified numbers)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const json = await propose('Mulsetu is a software company in Ozar with 500 happy clients.', 'recommendation');
  assert.equal(json.change?.status, 'BLOCKED');
  assert.match(String(json.change?.error), /number/);
});
