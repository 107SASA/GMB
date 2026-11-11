/**
 * Review customers can be uploaded from Excel (.xlsx) as well as CSV; phone
 * numbers in common Indian formats are kept (+91 added), not dropped.
 * Run: npx tsx --test tests/workflow/review-upload-excel.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { normalizePhoneE164 } from '../../src/lib/phone';

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/lib[\\/]tenant(\.ts)?$/.test(request)) {
    return { requireBusinessContext: async () => ({ ok: true, businessId: 'b1', userId: 'u1', organizationId: 'o1' }) };
  }
  // No database in this test: treat the workspace as paying (the plan check has its own tests).
  if (/lib[\\/]planGate(\.ts)?$/.test(request)) {
    return { requireWorkspacePlan: async () => ({ ok: true }) };
  }
  return origLoad.call(this, request, ...rest);
};

test('an .xlsx with the usual headers is read row by row', async () => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Customers');
  sheet.addRow(['Full Name', 'Mobile Number', 'Email']);
  sheet.addRow(['Ravi Sharma', '98765 43210', 'ravi@example.com']);
  sheet.addRow(['Priya Patel', '+91 98765-43211', '']);
  sheet.addRow(['Number Only', 9876543212, '']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const { POST } = await import('../../src/app/api/campaigns/parse-file/route');
  const body = new FormData();
  body.append('file', new File([buf], 'customers.xlsx'));
  const res = await POST(new Request('http://t/api/campaigns/parse-file', { method: 'POST', body }));
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.rows.length, 3);
  assert.deepEqual(json.rows.map((r: any) => normalizePhoneE164(String(r['Mobile Number']))), ['+919876543210', '+919876543211', '+919876543212']);
});

test('old .xls and fake files get a clear message', async () => {
  const { POST } = await import('../../src/app/api/campaigns/parse-file/route');
  for (const [name, content, re] of [['old.xls', 'x', /\.xls files are not supported/], ['fake.xlsx', 'not a zip', /does not look like a valid \.xlsx/]] as const) {
    const body = new FormData();
    body.append('file', new File([content], name));
    const res = await POST(new Request('http://t/x', { method: 'POST', body }));
    assert.equal(res.status, 400);
    assert.match((await res.json()).message, re);
  }
});
