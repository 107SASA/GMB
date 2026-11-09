/**
 * Company invoices (MULSETU AGROTECH PRIVATE LIMITED, not GST-registered):
 * numbered GM/<FY>/<serial> from 1001, consecutive with no gaps, one per
 * payment, kept after account deletion, emailed as PDF.
 * Run: npx tsx --test tests/workflow/company-invoice.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { amountInWords, financialYearOf, formatInvoiceNumber, renderInvoiceHtml } from '../../src/services/billing/invoiceDocument';

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};
let bizId = '';
let userId = '';

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_invoice_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    Business: (await import('../../src/models/Business')).default,
    CompanyInvoice: (await import('../../src/models/CompanyInvoice')).default,
    svc: await import('../../src/services/billing/companyInvoice'),
  };
  const uid = new m.mongoose.Types.ObjectId();
  userId = String(uid);
  await m.mongoose.connection.db.collection('users').insertOne({ _id: uid, fullName: 'Ravi Sharma', email: 'ravi@example.in', phone: '+919876543210' });
  bizId = String((await m.Business.create({ name: 'Sweet Crust Bakery', category: 'Bakery', address: 'Shop 4, MG Road, Pune', city: 'Pune', state: 'Maharashtra', userId: uid, organizationId: new m.mongoose.Types.ObjectId() } as any))._id);
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

const pay = (id: string, extra: Record<string, unknown> = {}) => m.svc.issueInvoiceForPayment({
  razorpayPaymentId: id, businessId: bizId, userId, razorpaySubscriptionId: 'sub_1', amountPaise: 1_000_000,
  currency: 'INR', paymentMethod: 'upi', paidAt: new Date(), planType: 'Pro', billingCycle: 'yearly',
  periodStart: new Date('2026-11-09T00:00:00Z'), periodEnd: new Date('2027-11-09T00:00:00Z'), ...extra,
});

test('financial year, number format and amount in words', () => {
  assert.equal(financialYearOf(new Date('2026-03-31T18:00:00Z')), '2025-26', '31 Mar 23:30 IST');
  assert.equal(financialYearOf(new Date('2026-03-31T18:31:00Z')), '2026-27', '1 Apr 00:01 IST');
  assert.equal(formatInvoiceNumber('2026-27', 1001), 'GM/2026-27/1001');
  assert.equal(amountInWords(10000), 'Rupees Ten Thousand Only');
  assert.equal(amountInWords(250000), 'Rupees Two Lakh Fifty Thousand Only');
  assert.equal(amountInWords(12500000), 'Rupees One Crore Twenty Five Lakh Only');
  assert.equal(amountInWords(1234.5), 'Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only');
});

test('the first invoice is GM/<FY>/1001; then 1002; the same payment never gets a second number', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const fy = financialYearOf(new Date());
  const a = await pay('pay_A');
  assert.equal(a.created, true);
  assert.equal(a.invoice.invoiceNumber, `GM/${fy}/1001`);
  assert.equal(a.invoice.amount, 10000);
  assert.equal(a.invoice.taxAmount, 0);
  assert.equal(a.invoice.supplier.legalName, 'MULSETU AGROTECH PRIVATE LIMITED');
  assert.equal(a.invoice.supplier.pan, 'AASCM3695C');
  assert.equal(a.invoice.supplier.gstin, null);
  assert.equal(a.invoice.billedTo.businessName, 'Sweet Crust Bakery');
  assert.equal(a.invoice.billedTo.address, 'Shop 4, MG Road, Pune, Maharashtra', 'city not repeated');

  const again = await pay('pay_A');
  assert.equal(again.created, false);
  assert.equal(again.invoice.invoiceNumber, `GM/${fy}/1001`);

  // Two deliveries of the same payment at the same moment, plus a new one.
  const [x, y] = await Promise.all([pay('pay_B'), pay('pay_B')]);
  const c = await pay('pay_C');
  const numbers = [x, y].filter(Boolean).map((r: any) => r.invoice.invoiceNumber);
  assert.ok(numbers.every((n: string) => n === `GM/${fy}/1002`), JSON.stringify(numbers));
  assert.equal(c.invoice.invoiceNumber, `GM/${fy}/1003`, 'no gap');
  assert.equal(await m.CompanyInvoice.countDocuments({}), 3);
});

test('nothing is invoiced for a zero amount (trial authorisation)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal(await pay('pay_zero', { amountPaise: 0 }), null);
});

test('the document: INVOICE (not Tax Invoice), company identity, not-registered note, escaped customer text', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const inv: any = await m.CompanyInvoice.findOne({ razorpayPaymentId: 'pay_A' }).lean();
  const html = renderInvoiceHtml(m.svc.invoiceView({ ...inv, billedTo: { ...inv.billedTo, name: '<script>x</script>' } }));
  assert.match(html, /<h1>INVOICE<\/h1>/);
  assert.doesNotMatch(html, /TAX INVOICE/);
  for (const must of ['MULSETU AGROTECH PRIVATE LIMITED', 'U47990MH2024PTC429632', 'AASCM3695C', 'not registered under the Goods and Services Tax', 'Rupees Ten Thousand Only', 'computer-generated invoice', 'pay_A', 'GM/']) {
    assert.ok(html.includes(must), must);
  }
  assert.ok(!html.includes('NSKM16602F'), 'TAN is not printed on sales invoices');
  assert.ok(!html.includes('<script>x</script>'), 'customer text is escaped');
});

test('no email address on the account → recorded, nothing sent', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const inv: any = await m.CompanyInvoice.findOne({ razorpayPaymentId: 'pay_C' }).lean();
  await m.CompanyInvoice.updateOne({ _id: inv._id }, { $set: { 'billedTo.email': null } });
  const r = await m.svc.emailInvoice(String(inv._id));
  assert.equal(r.sent, false);
  assert.match(String((await m.CompanyInvoice.findById(inv._id).lean()).emailError), /No email/);
});
