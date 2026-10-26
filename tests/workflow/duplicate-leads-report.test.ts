/**
 * The read-only duplicate-lead report (scripts/report-duplicate-leads.mjs)
 * against an in-memory MongoDB: groups by tenant + normalised phone, and
 * changes nothing.
 *
 * Run: npx tsx --test tests/workflow/duplicate-leads-report.test.ts
 */
import { startMemoryDb, stopMemoryDb } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

let skipReason: string | null = null;
let db: any;
let report: any;

before(async () => {
  skipReason = await startMemoryDb('dup_leads');
  if (skipReason) return;
  db = (await import('mongoose')).default.connection.db;
  report = await import('../../scripts/report-duplicate-leads.mjs');
});
after(stopMemoryDb);

test('groups same-tenant leads whose phones normalise to one number; other tenants never match; nothing is written', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const P = 'gmbboost-internal';
  await db.collection('leads').insertMany([
    { tenantId: P, phone: '+919876500001', name: 'A1', createdAt: new Date('2026-01-01') },
    { tenantId: P, phone: '+919876500001', name: 'A2', createdAt: new Date('2026-02-01') }, // exact duplicate
    { tenantId: P, phone: '+919876500002', name: 'B1' },
    { tenantId: P, phone: '09876500002', name: 'B2' }, // format variant
    { tenantId: P, phone: '98765 00002', name: 'B3' }, // format variant
    { tenantId: 'customer-1', phone: '+919876500001', name: 'Other tenant' }, // same phone, different tenant
    { tenantId: P, phone: '+919876500003', name: 'Unique' },
    { tenantId: P, name: 'No phone' },
  ]);
  const before = await db.collection('leads').find().sort({ _id: 1 }).toArray();

  const r = await report.duplicateLeadReport(db, {});
  assert.equal(r.scanned, 8);
  assert.equal(r.noPhone, 1);
  assert.equal(r.groups, 2);
  assert.equal(r.extraLeads, 3);
  const b = r.duplicates.find((g: any) => g.phone === '+919876500002');
  assert.equal(b.count, 3);
  assert.equal(b.kind, 'format-variant');
  const a = r.duplicates.find((g: any) => g.phone === '+919876500001');
  assert.equal(a.kind, 'exact');
  assert.equal(a.tenantId, P);
  assert.deepEqual(a.leads.map((l: any) => l.name), ['A1', 'A2'], 'oldest first');

  assert.equal((await report.duplicateLeadReport(db, { tenant: 'customer-1' })).groups, 0);
  assert.deepEqual(await db.collection('leads').find().sort({ _id: 1 }).toArray(), before, 'read-only');
  assert.equal(report.normalizePhone('whatsapp:+919876500001'), '+919876500001');
  assert.equal(report.normalizePhone('12'), null);
});
