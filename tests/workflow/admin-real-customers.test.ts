/**
 * Super-admin lists vs free-report shadow accounts (real case, Nov 2026):
 * customers who came from the free report and then started a trial or paid
 * were hidden from Customers / Businesses / Overview, because the shadow flag
 * is never cleared. They must be listed with their real plan; unclaimed
 * free-report leads stay hidden. The CRM "Free trial" segment counts trials.
 * Run: npx tsx --test tests/workflow/admin-real-customers.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/lib[\\/]superAdminAuth(\.ts)?$/.test(request)) {
    return { requireSuperAdmin: async () => ({ ok: true, userId: '64b000000000000000000001', user: { email: 'admin@example.invalid' } }) };
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
  process.env.MONGODB_URI = memoryServer.getUri(`gm_admin_real_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    User: (await import('../../src/models/User')).default,
    Business: (await import('../../src/models/Business')).default,
    customers: await import('../../src/app/api/admin/customers/route'),
    businesses: await import('../../src/app/api/admin/businesses/route'),
    stats: await import('../../src/app/api/admin/stats/route'),
  };
  const mk = async (name: string, shadow: boolean, status?: string, trialEndsAt?: Date) => {
    const userId = new m.mongoose.Types.ObjectId();
    await m.User.create({ _id: userId, fullName: name, email: `${name.replace(/\W/g, '').toLowerCase()}@example.invalid`, phone: `+9198${Math.floor(Math.random() * 1e8)}`, role: 'CLIENT', ...(shadow ? { isShadowAccount: true } : {}) } as any);
    await m.Business.create({ name, category: 'Store', address: 'Nashik', userId, organizationId: new m.mongoose.Types.ObjectId(), ...(shadow ? { provisionedVia: 'free_report' } : {}), ...(status ? { subscriptionStatus: status } : {}), ...(trialEndsAt ? { trialEndsAt } : {}) } as any);
  };
  await mk('Reviewer Demo', false, 'active');
  await mk('Automation Network', true, 'trial_active', new Date('2027-02-03'));
  await mk('Michelles Foods', true, 'active');
  await mk('Resign Perfume', true, 'trial_active', new Date('2027-02-03'));
  await mk('Unclaimed Lead', true);
});

after(async () => {
  Module._load = origLoad;
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const get = async (route: any, url: string) => (await (await route.GET(new Request(url) as any)).json());

test('Customers: free-report customers on a trial or paid are listed with their real plan; unclaimed leads stay hidden', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const j = await get(m.customers, 'http://x/api/admin/customers');
  const byName = Object.fromEntries(j.data.users.map((u: any) => [u.business?.name, u]));
  assert.deepEqual(Object.keys(byName).sort(), ['Automation Network', 'Michelles Foods', 'Resign Perfume', 'Reviewer Demo']);
  assert.equal(byName['Automation Network'].workspacePlan, 'Free trial');
  assert.ok(byName['Automation Network'].trialEndsAt);
  assert.equal(byName['Michelles Foods'].workspacePlan, 'Paid');
  assert.ok(!byName['Unclaimed Lead']);
  const all = await get(m.customers, 'http://x/api/admin/customers?includeShadow=true');
  assert.equal(all.data.users.length, 5, 'includeShadow still shows everyone');
});

test('Customers search still works together with the shadow filter', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const j = await get(m.customers, 'http://x/api/admin/customers?search=resign');
  assert.deepEqual(j.data.users.map((u: any) => u.business?.name), ['Resign Perfume']);
  const none = await get(m.customers, 'http://x/api/admin/customers?search=unclaimed');
  assert.equal(none.data.users.length, 0);
});

test('Businesses: trial and paid free-report workspaces are listed; the unclaimed one is not', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const j = await get(m.businesses, 'http://x/api/admin/businesses');
  const names = (j.data?.businesses || j.businesses || j.data || []).map((b: any) => b.name).sort();
  assert.deepEqual(names, ['Automation Network', 'Michelles Foods', 'Resign Perfume', 'Reviewer Demo']);
});

test('Overview: customer count and recent signups include them, with "Free trial" / "Paid"', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const j = await get(m.stats, 'http://x/api/admin/stats');
  const d = j.data || j;
  assert.equal(d.totalUsers ?? d.stats?.totalUsers, 4);
  const plans = Object.fromEntries((d.recentSignups || []).map((u: any) => [u.fullName, u.workspacePlan]));
  assert.equal(plans['Automation Network'], 'Free trial');
  assert.equal(plans['Michelles Foods'], 'Paid');
});

test('CRM: a lead on a running trial is "Free trial" (even if its stage was set to CUSTOMER) and counts in the Free trial segment', async () => {
  const { currentFunnelStage, SEGMENTS } = await import('../../src/lib/admin/leadMilestones');
  const trial = { currentStage: 'NURTURING', currentAgent: 'SALES', trial: { status: 'active', endsAt: new Date('2027-02-03') } } as any;
  const handSetCustomer = { ...trial, currentStage: 'CUSTOMER' };
  const paid = { currentStage: 'CUSTOMER', currentAgent: 'IN_HOUSE', trial: { status: 'converted', endsAt: new Date('2027-02-03') } } as any;
  assert.equal(currentFunnelStage(trial), 'Free trial');
  assert.equal(currentFunnelStage(handSetCustomer), 'Free trial');
  assert.equal(currentFunnelStage(paid), 'Customer');
  const seg = (lead: any) => SEGMENTS.freeTrial.test({ lead, reached: new Set() } as any);
  assert.deepEqual([seg(trial), seg(handSetCustomer), seg(paid)], [true, true, false]);
});
