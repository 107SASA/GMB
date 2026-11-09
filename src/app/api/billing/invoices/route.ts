import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import { getRazorpay } from '@/lib/billing/razorpay';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import CompanyInvoice from '@/models/CompanyInvoice';

export const dynamic = 'force-dynamic';

/**
 * This workspace's invoices, newest first:
 *  - company invoices (MULSETU AGROTECH PRIVATE LIMITED, numbered
 *    GM/<FY>/<serial>) — downloaded as our own PDF
 *  - payments from before company invoices existed, which only have
 *    Razorpay's own receipt page
 */
export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const own: any[] = await CompanyInvoice.find({ businessId: ctx.businessId })
      .sort({ issuedAt: -1 })
      .select('invoiceNumber amount currency paidAt issuedAt razorpayPaymentId emailedAt')
      .lean();
    const invoices: any[] = own.map((inv) => ({
      id: String(inv._id),
      invoiceNumber: inv.invoiceNumber,
      amount: inv.amount,
      currency: inv.currency ?? 'INR',
      paidAt: inv.paidAt ? new Date(inv.paidAt).toISOString() : null,
      downloadUrl: `/api/billing/invoices/${inv._id}/pdf`,
      source: 'company',
      emailed: !!inv.emailedAt,
    }));

    // Older charges (before company invoices) — Razorpay's receipt only.
    const razorpaySubscriptionId = ctx.business.razorpaySubscriptionId;
    const razorpay = razorpaySubscriptionId ? getRazorpay() : null;
    if (razorpay && razorpaySubscriptionId) {
      try {
        const covered = new Set(own.map((i) => i.razorpayPaymentId));
        const result = await razorpay.invoices.all({ subscription_id: razorpaySubscriptionId, count: 50 });
        for (const inv of result.items) {
          if (inv.status !== 'paid' || (inv.payment_id && covered.has(inv.payment_id))) continue;
          invoices.push({
            id: inv.id,
            invoiceNumber: inv.invoice_number || inv.id,
            amount: (inv.amount_paid ?? inv.gross_amount ?? 0) / 100, // paise -> rupees
            currency: inv.currency ?? 'INR',
            paidAt: inv.paid_at ? new Date(inv.paid_at * 1000).toISOString() : null,
            downloadUrl: inv.short_url ?? null,
            source: 'razorpay',
          });
        }
      } catch (err: any) {
        console.error('[billing/invoices] Razorpay fetch failed:', err?.message);
      }
    }

    invoices.sort((a, b) => (b.paidAt ?? '').localeCompare(a.paidAt ?? ''));
    return NextResponse.json({ success: true, invoices });
  } catch (err: any) {
    console.error('[billing/invoices] failed:', err);
    return NextResponse.json({ success: false, error: toFriendlyMessage(err) }, { status: 500 });
  }
}
