import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { getRazorpay } from '@/lib/billing/razorpay';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export const dynamic = 'force-dynamic';

/**
 * Lists this workspace's paid invoices, straight from Razorpay — there is
 * no local Payment/Invoice model (the webhook only ever updated
 * subscription status, never persisted individual charges). Razorpay
 * Subscriptions auto-generates one Invoice entity per successful charge,
 * each carrying a `short_url` — a Razorpay-hosted page the customer can
 * view and download the invoice from directly, so nothing needs
 * generating or storing on our side.
 */
export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  const razorpaySubscriptionId = ctx.business.razorpaySubscriptionId;
  if (!razorpaySubscriptionId) {
    return NextResponse.json({ success: true, invoices: [] });
  }

  const razorpay = getRazorpay();
  if (!razorpay) {
    return NextResponse.json({ success: false, error: 'Billing is not configured.' }, { status: 503 });
  }

  try {
    const result = await razorpay.invoices.all({ subscription_id: razorpaySubscriptionId, count: 50 });

    const invoices = result.items
      .filter((inv) => inv.status === 'paid')
      .map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        amount: (inv.amount_paid ?? inv.gross_amount ?? 0) / 100, // paise -> rupees
        currency: inv.currency ?? 'INR',
        paidAt: inv.paid_at ? new Date(inv.paid_at * 1000).toISOString() : null,
        downloadUrl: inv.short_url ?? null,
      }))
      .sort((a, b) => (b.paidAt ?? '').localeCompare(a.paidAt ?? ''));

    return NextResponse.json({ success: true, invoices });
  } catch (err: any) {
    console.error('[billing/invoices] Razorpay fetch failed:', err);
    return NextResponse.json({ success: false, error: toFriendlyMessage(err) }, { status: 500 });
  }
}
