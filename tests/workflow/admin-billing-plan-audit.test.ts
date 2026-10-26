/**
 * PATCH / DELETE /api/admin/billing-plan change what NEW customers pay. Each
 * change must leave an AdminActionLog row naming the super admin, with the
 * old and new terms — and a non-admin must be refused without any change.
 * Real route handlers against an in-memory MongoDB; Razorpay not configured.
 *
 * Run: npx tsx --test tests/workflow/admin-billing-plan-audit.test.ts
 */
import { fakeRequest, startMemoryDb, stopMemoryDb, signInAs, signInAsSuperAdmin, jsonReq } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

for (const k of Object.keys(process.env)) if (/^RAZORPAY_/.test(k)) delete process.env[k];

let skipReason: string | null = null;
let m: any = {};

before(async () => {
  skipReason = await startMemoryDb('billing_plan_audit');
  if (skipReason) return;
  m = {
    route: await import('../../src/app/api/admin/billing-plan/route'),
    AdminActionLog: (await import('../../src/models/AdminActionLog')).default,
    BillingPlan: (await import('../../src/models/BillingPlan')).default,
    User: (await import('../../src/models/User')).default,
  };
});

after(async () => {
  if (!skipReason) await stopMemoryDb();
});

const URL = 'http://localhost/api/admin/billing-plan';

test('a price change is audited with the admin, old and new prices', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const admin = await signInAsSuperAdmin('price-admin@example.invalid');
  const before = await (await m.route.GET()).json();
  const oldMonthly = before.data.durations.find((d: any) => d.cycle === 'monthly').priceInr;

  const durations = before.data.durations.map((d: any) => ({ cycle: d.cycle, enabled: d.enabled, priceInr: d.cycle === 'monthly' ? oldMonthly + 100 : d.priceInr }));
  const res = await m.route.PATCH(jsonReq(URL, 'PATCH', { durations }, { 'x-real-ip': '203.0.113.7' }) as any);
  assert.equal(res.status, 200);

  const log: any = await m.AdminActionLog.findOne({ action: 'billing_plan.update' }).lean();
  assert.ok(log, 'an AdminActionLog row is written');
  assert.equal(String(log.adminUserId), String(admin._id));
  assert.equal(log.adminEmail, 'price-admin@example.invalid');
  assert.equal(log.ip, '203.0.113.7');
  assert.equal(log.metadata.old.durations.find((d: any) => d.cycle === 'monthly').priceInr, oldMonthly);
  assert.equal(log.metadata.new.durations.find((d: any) => d.cycle === 'monthly').priceInr, oldMonthly + 100);
  assert.ok(!JSON.stringify(log.metadata).includes('razorpayPlanId'), 'no Razorpay ids in the audit row');
});

test('a reset to defaults is audited', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await signInAsSuperAdmin('reset-admin@example.invalid');
  const res = await m.route.DELETE(jsonReq(URL, 'DELETE') as any);
  assert.equal(res.status, 200);
  const log: any = await m.AdminActionLog.findOne({ action: 'billing_plan.reset' }).lean();
  assert.ok(log);
  assert.equal(log.adminEmail, 'reset-admin@example.invalid');
  assert.ok(log.metadata.old && log.metadata.new);
});

test('a customer cannot change the price: refused, nothing saved, nothing audited', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const client: any = await m.User.create({ fullName: 'Client', email: 'client-price@example.invalid', phone: '+919000077001', role: 'CLIENT' } as any);
  await signInAs(client);
  const logsBefore = await m.AdminActionLog.countDocuments({});
  const planBefore = await m.BillingPlan.findOne({ key: 'default' }).lean();

  const res = await m.route.PATCH(jsonReq(URL, 'PATCH', { priceInr: 1 }) as any);
  assert.ok(res.status === 401 || res.status === 403, `refused (got ${res.status})`);
  assert.equal(await m.AdminActionLog.countDocuments({}), logsBefore);
  assert.deepEqual(await m.BillingPlan.findOne({ key: 'default' }).lean(), planBefore);
  fakeRequest.headers = {};
});
