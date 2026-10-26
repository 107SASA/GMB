/**
 * Super Admin → Customer Leads (tenant CRM monitor): business names (also for
 * older leads linked only by tenantId), "new today" from midnight India time,
 * one Open bar. In-memory MongoDB.
 *
 * Run: npx tsx --test tests/workflow/admin-crm-monitor.test.ts
 */
import { signInAsSuperAdmin, startMemoryDb, stopMemoryDb } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let skipReason: string | null = null;
let m: any = {};

before(async () => {
  skipReason = await startMemoryDb('crm_monitor');
  if (skipReason) return;
  m = {
    mongoose: (await import('mongoose')).default,
    route: await import('../../src/app/api/admin/crm-monitor/route'),
    Business: (await import('../../src/models/Business')).default,
    Lead: (await import('../../src/models/Lead')).default,
  };
  await signInAsSuperAdmin('crm-monitor-admin@example.invalid');
});
after(stopMemoryDb);

test('names for new and older leads, one Open bar, top businesses named', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const org = new m.mongoose.Types.ObjectId();
  const b = await m.Business.create({ name: 'Mulsetu Realty', category: 'Real estate', address: 'Pune', userId: new m.mongoose.Types.ObjectId(), organizationId: org } as any);
  const lead = (extra: Record<string, unknown>) => m.Lead.create({ leadType: 'Client Prospect', name: 'L', phone: `+91980000${Math.floor(Math.random() * 9000 + 1000)}`, source: 'Manual', ...extra } as any);
  await lead({ tenantId: String(org), businessId: b._id, lifeCycleStage: 'active' });
  await lead({ tenantId: String(org), lifeCycleStage: 'converted' }); // older: no businessId
  await lead({ tenantId: String(b._id), lifeCycleStage: 'initial' });  // older: tenantId is the business id
  await m.Lead.collection.insertOne({ leadType: 'Client Prospect', tenantId: String(org), name: 'No stage', phone: '+919800001111', createdAt: new Date() });

  const json = await (await m.route.GET()).json();
  assert.equal(json.success, true);
  assert.ok(json.data.recentLeads.every((l: any) => l.businessName === 'Mulsetu Realty'), JSON.stringify(json.data.recentLeads.map((l: any) => l.businessName)));
  assert.deepEqual(json.data.topBusinessesByLeads.map((r: any) => [r.businessName, r.totalLeads]), [['Mulsetu Realty', 4]], 'one row for the business');
  const open = json.data.pipelineBreakdown.filter((r: any) => r.stage === 'Open');
  assert.equal(open.length, 1, 'one Open bar');
  assert.equal(open[0].count, 2);
  assert.equal(json.data.stats.newLeadsToday, 4);
});
