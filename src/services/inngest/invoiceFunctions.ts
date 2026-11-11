import { inngest } from './client';
import type { IssueInvoiceInput } from '@/services/billing/companyInvoice';

type InvoiceEventData = Omit<IssueInvoiceInput, 'paidAt' | 'periodStart' | 'periodEnd'> & { paidAt: string; periodStart?: string | null; periodEnd?: string | null };

/**
 * Company invoice for a captured charge: issue it (numbered once per
 * payment), then email the PDF. Retries never create a second invoice or a
 * second email (both steps are idempotent per payment / per invoice).
 */
export const issueCompanyInvoice = inngest.createFunction(
  { id: 'billing-issue-company-invoice', retries: 4, triggers: [{ event: 'billing/invoice.issue' }] },
  async ({ event, step }) => {
    const d = event.data as InvoiceEventData;
    const issued = await step.run('issue-invoice', async () => {
      const { issueInvoiceForPayment } = await import('@/services/billing/companyInvoice');
      const r = await issueInvoiceForPayment({
        ...d,
        paidAt: new Date(d.paidAt),
        periodStart: d.periodStart ? new Date(d.periodStart) : null,
        periodEnd: d.periodEnd ? new Date(d.periodEnd) : null,
      });
      return r ? { id: String(r.invoice._id), number: r.invoice.invoiceNumber as string, created: r.created } : null;
    });
    if (!issued) return { skipped: 'nothing to invoice' };
    const email = await step.run('email-invoice', async () => {
      const { emailInvoice } = await import('@/services/billing/companyInvoice');
      return emailInvoice(issued.id);
    });
    // Growth Partner commission for this payment (once per payment id; the
    // daily sweep below catches anything missed). Never affects the invoice.
    const commission = await step.run('partner-commission', async () => {
      const { createCommissionForInvoice } = await import('@/services/partners/partnerCommissions');
      return createCommissionForInvoice(issued.id).catch((err: any) => ({ created: false, reason: `error: ${err?.message}` }));
    });
    return { invoice: issued.number, email, commission };
  },
);

/** Daily safety net: paid charges of the last 3 days that have no company invoice (lost webhook). */
export const companyInvoiceSweep = inngest.createFunction(
  { id: 'billing-company-invoice-sweep', triggers: [{ cron: '0 3 * * *' }] }, // 08:30 IST
  async ({ step }) => {
    const r = await step.run('issue-missing-invoices', async () => {
      const { issueMissingInvoices } = await import('@/services/billing/companyInvoice');
      return issueMissingInvoices(3);
    });
    const commissions = await step.run('partner-commissions-sweep', async () => {
      const { sweepMissingCommissions } = await import('@/services/partners/partnerCommissions');
      return sweepMissingCommissions(7);
    });
    return { success: true, ...r, commissions };
  },
);
