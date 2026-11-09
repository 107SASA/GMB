/**
 * End to end: a signed Razorpay "subscription.charged" webhook → the real
 * webhook route → the billing handler queues the invoice job → the job issues
 * the company invoice and emails a real PDF (Chrome) to the owner. Email and
 * the job queue are captured; nothing leaves the machine.
 * Run: npx tsx --test tests/workflow/billing-invoice-flow.test.ts
 */
import { startMemoryDb, stopMemoryDb } from '../helpers/adminRouteHarness';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

for (const k of Object.keys(process.env)) if (/^(RAZORPAY|TWILIO|META_WHATSAPP|RESEND|SENDGRID|GROQ|OPENAI|INNGEST)_/.test(k)) delete process.env[k];
const SECRET = 'whsec_invoice_flow_test';
process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;

const queued: any[] = [];
const emails: any[] = [];
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/services[\\/]inngest[\\/]client(\.ts)?$/.test(request)) {
    // The real client, with sends captured instead of delivered.
    const real = origLoad.call(this, request, ...rest);
    real.inngest.send = async (e: any) => { queued.push(...(Array.isArray(e) ? e : [e])); return { ids: [] }; };
    return real;
  }
  return origLoad.call(this, request, ...rest);
};

const captureEmail = async (to: string, subject: string, html: string, attachments?: any[]) => { emails.push({ to, subject, html, attachments }); return { success: true, messageId: 're_test_1' }; };
let skipReason: string | null = null;
let m: any = {};
before(async () => {
  skipReason = await startMemoryDb('invoice_flow');
  if (skipReason) return;
  m = {
    mongoose: (await import('mongoose')).default,
    route: await import('../../src/app/api/webhook/razorpay/route'),
    Business: (await import('../../src/models/Business')).default,
    User: (await import('../../src/models/User')).default,
    CompanyInvoice: (await import('../../src/models/CompanyInvoice')).default,
    svc: await import('../../src/services/billing/companyInvoice'),
  };
});
after(async () => {
  Module._load = origLoad;
  if (!skipReason) await stopMemoryDb();
});

const sign = (raw: string) => crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
const deliver = (raw: string, id: string) =>
  m.route.POST(new Request('https://app.example.test/api/webhook/razorpay', { method: 'POST', headers: { 'content-type': 'application/json', 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': id }, body: raw }));

test('a paid charge → company invoice GM/<FY>/1001 → PDF emailed to the owner', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const userId = new m.mongoose.Types.ObjectId();
  const b = await m.Business.create({ name: 'Mulsetu Software', category: 'Software company', address: 'Om Sai Nagar, Ozar', city: 'Ozar', state: 'Maharashtra', userId, organizationId: new m.mongoose.Types.ObjectId() } as any);
  await m.User.create({ _id: userId, fullName: 'Asha Patil', email: 'asha@mulsetu.com', phone: '+919811122233', role: 'CLIENT', businessIds: [b._id] } as any);
  const now = Math.floor(Date.now() / 1000);
  const raw = JSON.stringify({
    event: 'subscription.charged',
    created_at: now,
    payload: {
      subscription: { entity: { id: 'sub_inv', status: 'active', plan_id: 'plan_y', paid_count: 1, current_start: now, current_end: now + 365 * 86400, notes: { businessId: String(b._id), userId: String(userId), planType: 'Pro', billingCycle: 'yearly', trial: '0' } } },
      payment: { entity: { id: 'pay_inv_1', amount: 1_000_000, currency: 'INR', status: 'captured', method: 'upi', created_at: now } },
    },
  });
  assert.equal((await deliver(raw, 'evt_inv_1')).status, 200);

  const job = queued.find((e) => e.name === 'billing/invoice.issue');
  assert.ok(job, 'invoice job queued after the verified charge');
  assert.equal(job.id, 'invoice-pay_inv_1', 'one job per payment');
  assert.equal(job.data.amountPaise, 1_000_000);
  assert.equal(job.data.paymentMethod, 'upi');

  // Run the job exactly as Inngest would (issue, then email).
  const d = job.data;
  const r = await m.svc.issueInvoiceForPayment({ ...d, paidAt: new Date(d.paidAt), periodStart: d.periodStart && new Date(d.periodStart), periodEnd: d.periodEnd && new Date(d.periodEnd) });
  assert.equal(r.created, true);
  assert.match(r.invoice.invoiceNumber, /^GM\/\d{4}-\d{2}\/1001$/);
  assert.equal(r.invoice.supplier.address.includes('422206'), true, 'Ozar PIN');
  assert.match(r.invoice.description, /Pro plan — yearly subscription/);

  const sent = await m.svc.emailInvoice(String(r.invoice._id), { send: captureEmail });
  assert.equal(sent.sent, true);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, 'asha@mulsetu.com');
  assert.match(emails[0].subject, /Your GrowwMatics AI invoice GM\//);
  const pdf: Buffer = emails[0].attachments[0].content;
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-', 'a real PDF is attached');
  assert.match(emails[0].attachments[0].filename, /^Invoice-GM-\d{4}-\d{2}-1001\.pdf$/);

  // Retried job / redelivered webhook: no second invoice, no second email.
  assert.equal((await m.svc.issueInvoiceForPayment({ ...d, paidAt: new Date(d.paidAt) })).created, false);
  assert.equal((await m.svc.emailInvoice(String(r.invoice._id), { send: captureEmail })).reason, 'already emailed');
  assert.equal(emails.length, 1);
  assert.equal(await m.CompanyInvoice.countDocuments({}), 1);
});

test('a phone-only account (placeholder email) gets the invoice in Billing but no email', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const userId = new m.mongoose.Types.ObjectId();
  const b = await m.Business.create({ name: 'Phone Only Shop', category: 'Shop', address: 'Ozar', userId, organizationId: new m.mongoose.Types.ObjectId() } as any);
  await m.User.create({ _id: userId, fullName: 'Owner', email: '919800000001@shadow.growwmatics.internal', phone: '+919800000001', role: 'CLIENT', businessIds: [b._id] } as any);
  const r = await m.svc.issueInvoiceForPayment({ razorpayPaymentId: 'pay_phone_only', businessId: String(b._id), userId: String(userId), amountPaise: 500000, paidAt: new Date() });
  assert.equal(r.invoice.billedTo.email, null, 'placeholder never printed');
  const before = emails.length;
  assert.equal((await m.svc.emailInvoice(String(r.invoice._id), { send: captureEmail })).sent, false);
  assert.equal(emails.length, before);
});

test('email switched off (suppressed) or no provider: not marked sent, so it goes out later', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const inv: any = await m.CompanyInvoice.findOne({ razorpayPaymentId: 'pay_inv_1' }).lean();
  await m.CompanyInvoice.updateOne({ _id: inv._id }, { $set: { emailedAt: null } });
  const off = async () => ({ success: true, messageId: 'suppressed_1', suppressed: true });
  assert.equal((await m.svc.emailInvoice(String(inv._id), { send: off })).sent, false);
  const mock = async () => ({ success: true, messageId: 'mock_txn_id' });
  assert.equal((await m.svc.emailInvoice(String(inv._id), { send: mock })).sent, false);
  assert.equal((await m.CompanyInvoice.findById(inv._id).lean()).emailedAt, null);
  assert.equal((await m.svc.emailInvoice(String(inv._id), { send: captureEmail })).sent, true, 'sent once email works');
});
