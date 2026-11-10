/**
 * Company invoices: one numbered invoice from MULSETU AGROTECH PRIVATE
 * LIMITED for every captured Razorpay payment, emailed to the customer as a
 * PDF and downloadable from Billing.
 *
 * Called from the billing event handler (services/billing/billingEvents.ts)
 * through the `billing/invoice.issue` background job, and from a daily
 * safety-net sweep for payments whose webhook never arrived.
 *
 * Numbering: GM/<financial year>/<serial>, serials from 1001 in each
 * financial year, consecutive with no gaps — a number is taken only by the
 * call that actually creates the invoice for that payment.
 */
import dbConnect from '@/lib/mongodb';
import { COMPANY } from '@/lib/companyInfo';
import { INVOICE_SERIAL_START, financialYearOf, formatInvoiceNumber, renderInvoiceHtml, formatInr, type InvoiceView } from './invoiceDocument';

export interface IssueInvoiceInput {
  razorpayPaymentId: string;
  businessId: string;
  userId?: string | null;
  razorpaySubscriptionId?: string | null;
  /** Amount captured, in paise (Razorpay's unit). */
  amountPaise: number;
  currency?: string | null;
  paymentMethod?: string | null;
  paidAt: Date;
  planType?: string | null;
  billingCycle?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
}

/** "Om Sai Nagar, Ozar, Maharashtra" — city / state added only when the address doesn't already name them. */
export function joinAddress(...parts: Array<string | null | undefined>): string {
  const out: string[] = [];
  for (const p of parts.map((x) => String(x || '').trim()).filter(Boolean)) {
    if (!out.some((o) => o.toLowerCase().includes(p.toLowerCase()))) out.push(p);
  }
  return out.join(', ');
}

const CYCLE: Record<string, string> = { monthly: 'monthly', quarterly: 'quarterly', halfyearly: 'half-yearly', yearly: 'yearly' };

function describe(planType?: string | null, billingCycle?: string | null): string {
  const plan = planType === 'Enterprise' || !planType ? 'Pro' : planType;
  const cycle = billingCycle && CYCLE[billingCycle] ? ` — ${CYCLE[billingCycle]} subscription` : ' — subscription';
  return `GrowwMatics AI ${plan} plan${cycle} (Google Business Profile management software)`;
}

/**
 * Create the invoice for one payment, once. Returns the stored invoice (the
 * existing one when it was already issued). Never issues for a zero amount.
 */
export async function issueInvoiceForPayment(input: IssueInvoiceInput): Promise<{ invoice: any; created: boolean } | null> {
  if (!input.razorpayPaymentId || !(input.amountPaise > 0)) return null;
  await dbConnect();
  const [{ default: CompanyInvoice }, { default: InvoiceCounter }, { default: Business }, { default: User }] = await Promise.all([
    import('@/models/CompanyInvoice'), import('@/models/InvoiceCounter'), import('@/models/Business'), import('@/models/User'),
  ]);

  const existing = await CompanyInvoice.findOne({ razorpayPaymentId: input.razorpayPaymentId }).lean();
  if (existing) return { invoice: existing, created: false };

  const [business, user]: any[] = await Promise.all([
    Business.findById(input.businessId).select('name address city state phone userId').lean(),
    input.userId ? User.findById(input.userId).select('fullName email phone').lean() : null,
  ]);
  const owner: any = user ?? (business?.userId ? await User.findById(business.userId).select('fullName email phone').lean() : null);
  // Phone-only signups carry a placeholder ("<phone>@shadow.growwmatics.internal") — never email or print it.
  const realEmail = owner?.email && !/\.(internal|invalid|local|test)$/i.test(String(owner.email).trim()) ? String(owner.email).trim() : null;

  const issuedAt = new Date();
  const financialYear = financialYearOf(issuedAt);
  // Claim this payment before taking a number, so two concurrent calls for
  // the same payment can never consume two serials (no gaps).
  const { default: mongoose } = await import('mongoose');
  const lock = mongoose.connection.db!.collection('companyinvoicelocks');
  try {
    await lock.insertOne({ _id: input.razorpayPaymentId as any, at: issuedAt });
  } catch (err: any) {
    if (err?.code === 11000) {
      const other = await CompanyInvoice.findOne({ razorpayPaymentId: input.razorpayPaymentId }).lean();
      return other ? { invoice: other, created: false } : null; // the other call is still issuing it
    }
    throw err;
  }

  try {
    // New financial year → the series starts at INVOICE_SERIAL_START (first
    // invoice START + 1). Then one atomic +1 per invoice.
    await InvoiceCounter.updateOne({ financialYear }, { $setOnInsert: { seq: INVOICE_SERIAL_START } }, { upsert: true })
      .catch((e: any) => { if (e?.code !== 11000) throw e; });
    const counter: any = await InvoiceCounter.findOneAndUpdate({ financialYear }, { $inc: { seq: 1 } }, { new: true }).lean();
    const serial: number = counter.seq;
    const invoice = await CompanyInvoice.create({
      invoiceNumber: formatInvoiceNumber(financialYear, serial),
      financialYear,
      serial,
      issuedAt,
      businessId: input.businessId,
      userId: owner?._id ?? input.userId ?? null,
      razorpayPaymentId: input.razorpayPaymentId,
      razorpaySubscriptionId: input.razorpaySubscriptionId ?? null,
      paymentMethod: input.paymentMethod ?? null,
      paidAt: input.paidAt,
      currency: input.currency || 'INR',
      amount: Math.round(input.amountPaise) / 100,
      taxAmount: 0, // not GST-registered: no tax charged
      description: describe(input.planType, input.billingCycle),
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      supplier: {
        legalName: COMPANY.legalName.toUpperCase(),
        brand: COMPANY.name,
        address: COMPANY.address,
        cin: COMPANY.cin,
        pan: COMPANY.pan,
        gstin: COMPANY.gstin,
        email: COMPANY.supportEmail,
        website: COMPANY.domain,
      },
      billedTo: {
        name: owner?.fullName || '',
        businessName: business?.name || '',
        address: joinAddress(business?.address, business?.city, business?.state),
        email: realEmail,
        phone: owner?.phone || business?.phone || null,
      },
    });
    return { invoice: invoice.toObject(), created: true };
  } catch (err) {
    await lock.deleteOne({ _id: input.razorpayPaymentId as any }).catch(() => {});
    throw err;
  }
}

export function invoiceView(inv: any): InvoiceView {
  return {
    invoiceNumber: inv.invoiceNumber,
    issuedAt: inv.issuedAt,
    paidAt: inv.paidAt,
    amount: inv.amount,
    taxAmount: inv.taxAmount ?? 0,
    currency: inv.currency || 'INR',
    description: inv.description,
    periodStart: inv.periodStart,
    periodEnd: inv.periodEnd,
    paymentMethod: inv.paymentMethod,
    razorpayPaymentId: inv.razorpayPaymentId,
    supplier: inv.supplier,
    billedTo: inv.billedTo,
  };
}

/** A4 PDF of a stored invoice (headless Chrome, same as the report PDFs). */
export async function invoicePdf(inv: any): Promise<Buffer> {
  const { launchBrowser } = await import('@/lib/pdf/browser');
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(renderInvoiceHtml(invoiceView(inv)), { waitUntil: 'load' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' } });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}

export const invoiceFileName = (inv: { invoiceNumber: string }) => `Invoice-${inv.invoiceNumber.replace(/\//g, '-')}.pdf`;

/** Email the invoice PDF to the customer, once. Records the result on the invoice. */
export async function emailInvoice(
  invoiceId: string,
  deps: { send?: (to: string, subject: string, html: string, attachments: Array<{ filename: string; content: Buffer }>) => Promise<any> } = {},
): Promise<{ sent: boolean; reason?: string }> {
  await dbConnect();
  const { default: CompanyInvoice } = await import('@/models/CompanyInvoice');
  const inv: any = await CompanyInvoice.findById(invoiceId).lean();
  if (!inv) return { sent: false, reason: 'invoice not found' };
  if (inv.emailedAt) return { sent: true, reason: 'already emailed' };
  const to = inv.billedTo?.email;
  if (!to) {
    await CompanyInvoice.updateOne({ _id: inv._id }, { $set: { emailError: 'No email address on the account' } });
    return { sent: false, reason: 'no email address' };
  }
  const pdf = await invoicePdf(inv);
  const send = deps.send ?? (await import('@/services/email')).sendTransactionalEmail;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${COMPANY.domain}`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.5">
    <p>Hi ${inv.billedTo?.name ? String(inv.billedTo.name).split(' ')[0].replace(/[<>&]/g, '') : 'there'},</p>
    <p>Thank you for your payment of <b>${formatInr(inv.amount)}</b> for GrowwMatics AI. Your invoice <b>${inv.invoiceNumber}</b> is attached.</p>
    <p>You can also download all your invoices any time from <a href="${appUrl}/dashboard/billing">Billing</a> in your dashboard.</p>
    <p style="color:#6b7280;font-size:12px">${COMPANY.name} is a product of ${COMPANY.legalName}. Questions about this invoice? Reply to ${COMPANY.supportEmail}.</p>
  </div>`;
  const res: any = await send(to, `Your GrowwMatics AI invoice ${inv.invoiceNumber}`, html, [{ filename: invoiceFileName(inv), content: pdf }]);
  // A mocked (no provider) or suppressed (sending switched off) email is NOT
  // marked sent, so the invoice still goes out once email works again.
  if (res?.success && !res.suppressed && !/^(mock|suppressed)/.test(String(res.messageId || ''))) {
    await CompanyInvoice.updateOne({ _id: inv._id }, { $set: { emailedAt: new Date(), emailTo: to, emailError: null } });
    return { sent: true };
  }
  await CompanyInvoice.updateOne({ _id: inv._id }, { $set: { emailError: String(res?.error || 'Email not sent').slice(0, 300) } });
  return { sent: false, reason: res?.error || 'email not sent' };
}

/**
 * Safety net: paid Razorpay invoices of recently active subscriptions that
 * have no company invoice yet (webhook lost). Last `days` days only.
 */
export async function issueMissingInvoices(days = 3): Promise<{ checked: number; issued: number }> {
  await dbConnect();
  const [{ default: Business }, { default: CompanyInvoice }, { getRazorpay }] = await Promise.all([
    import('@/models/Business'), import('@/models/CompanyInvoice'), import('@/lib/billing/razorpay'),
  ]);
  const razorpay: any = getRazorpay();
  if (!razorpay) return { checked: 0, issued: 0 };
  const since = new Date(Date.now() - days * 86_400_000);
  const businesses: any[] = await Business.find({ razorpaySubscriptionId: { $exists: true, $nin: [null, ''] }, updatedAt: { $gte: since } })
    .select('_id userId razorpaySubscriptionId').limit(200).lean();
  let issued = 0;
  for (const b of businesses) {
    try {
      const list: any = await razorpay.invoices.all({ subscription_id: b.razorpaySubscriptionId, count: 10 });
      for (const ri of list?.items ?? []) {
        if (ri.status !== 'paid' || !ri.payment_id || !(ri.amount_paid > 0)) continue;
        if (ri.paid_at && ri.paid_at * 1000 < since.getTime()) continue;
        if (await CompanyInvoice.exists({ razorpayPaymentId: ri.payment_id })) continue;
        const sub: any = await razorpay.subscriptions.fetch(b.razorpaySubscriptionId).catch(() => null);
        const r = await issueInvoiceForPayment({
          razorpayPaymentId: ri.payment_id,
          businessId: String(b._id),
          userId: b.userId ? String(b.userId) : null,
          razorpaySubscriptionId: b.razorpaySubscriptionId,
          amountPaise: ri.amount_paid,
          currency: ri.currency,
          paidAt: ri.paid_at ? new Date(ri.paid_at * 1000) : new Date(),
          planType: sub?.notes?.planType ?? null,
          billingCycle: sub?.notes?.billingCycle ?? null,
          periodStart: ri.billing_start ? new Date(ri.billing_start * 1000) : null,
          periodEnd: ri.billing_end ? new Date(ri.billing_end * 1000) : null,
        });
        if (r?.created) {
          issued++;
          await emailInvoice(String(r.invoice._id)).catch((e) => console.error('[invoice] email failed', e?.message));
        }
      }
    } catch (err: any) {
      console.error(`[invoice] sweep failed for business ${b._id}:`, err?.message);
    }
  }
  return { checked: businesses.length, issued };
}
