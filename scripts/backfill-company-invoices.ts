/**
 * Company invoices for payments received BEFORE company invoices existed.
 *
 * Every Razorpay subscription a workspace ever had (Business.razorpaySubscriptionId
 * plus older ones in BillingEvent) is read from Razorpay; each PAID charge with
 * no company invoice yet gets one — oldest payment first, so numbers follow
 * the order customers paid. The invoice date is the day it is issued; the
 * payment date printed on it is the real one.
 *
 * DEFAULT IS A DRY RUN: lists what would be issued and changes nothing.
 *
 *   cd /var/www/gmbboost
 *   npx tsx --env-file=.env.production scripts/backfill-company-invoices.ts            # list only
 *   npx tsx --env-file=.env.production scripts/backfill-company-invoices.ts --apply    # issue invoices (no email)
 *   npx tsx --env-file=.env.production scripts/backfill-company-invoices.ts --apply --email   # issue + email each customer
 *
 * Safe to run more than once: a payment that already has an invoice is skipped.
 */
import mongoose from 'mongoose';

const APPLY = process.argv.includes('--apply');
const EMAIL = process.argv.includes('--email');

async function main() {
  const { default: dbConnect } = await import('../src/lib/mongodb');
  await dbConnect();
  const [{ default: Business }, { default: BillingEvent }, { default: CompanyInvoice }, { getRazorpay }, svc, { financialYearOf }] = await Promise.all([
    import('../src/models/Business'),
    import('../src/models/BillingEvent'),
    import('../src/models/CompanyInvoice'),
    import('../src/lib/billing/razorpay'),
    import('../src/services/billing/companyInvoice'),
    import('../src/services/billing/invoiceDocument'),
  ]);
  const razorpay: any = getRazorpay();
  if (!razorpay) throw new Error('Razorpay keys are not configured in this environment.');

  // businessId → every subscription id it ever had
  const subsByBusiness = new Map<string, Set<string>>();
  const add = (b: unknown, s: unknown) => {
    if (!b || !s) return;
    const key = String(b);
    if (!subsByBusiness.has(key)) subsByBusiness.set(key, new Set());
    subsByBusiness.get(key)!.add(String(s));
  };
  for (const b of await Business.find({ razorpaySubscriptionId: { $exists: true, $nin: [null, ''] } }).select('_id razorpaySubscriptionId').lean() as any[]) add(b._id, b.razorpaySubscriptionId);
  for (const e of await BillingEvent.aggregate([{ $match: { businessId: { $ne: null }, razorpaySubscriptionId: { $nin: [null, ''] } } }, { $group: { _id: { b: '$businessId', s: '$razorpaySubscriptionId' } } }])) add(e._id.b, e._id.s);

  type Charge = { businessId: string; userId: string | null; subscriptionId: string; paymentId: string; amountPaise: number; currency: string; paidAt: Date; periodStart: Date | null; periodEnd: Date | null; planType: string | null; billingCycle: string | null };
  const charges: Charge[] = [];
  const owners = new Map<string, string | null>();
  for (const [businessId, subs] of subsByBusiness) {
    if (!owners.has(businessId)) {
      const b: any = await Business.findById(businessId).select('userId').lean();
      owners.set(businessId, b?.userId ? String(b.userId) : null);
    }
    for (const subscriptionId of subs) {
      try {
        const sub: any = await razorpay.subscriptions.fetch(subscriptionId).catch(() => null);
        const list: any = await razorpay.invoices.all({ subscription_id: subscriptionId, count: 100 });
        for (const ri of list?.items ?? []) {
          if (ri.status !== 'paid' || !ri.payment_id || !(ri.amount_paid > 0)) continue;
          if (await CompanyInvoice.exists({ razorpayPaymentId: ri.payment_id })) continue;
          charges.push({
            businessId, userId: owners.get(businessId) ?? null, subscriptionId, paymentId: ri.payment_id,
            amountPaise: ri.amount_paid, currency: ri.currency || 'INR',
            paidAt: new Date((ri.paid_at || ri.created_at) * 1000),
            periodStart: ri.billing_start ? new Date(ri.billing_start * 1000) : null,
            periodEnd: ri.billing_end ? new Date(ri.billing_end * 1000) : null,
            planType: sub?.notes?.planType ?? null, billingCycle: sub?.notes?.billingCycle ?? null,
          });
        }
      } catch (err: any) {
        console.error(`  ! could not read Razorpay subscription ${subscriptionId}: ${err?.message || err}`);
      }
    }
  }
  charges.sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());

  const thisFy = financialYearOf(new Date());
  const earlier = charges.filter((c) => financialYearOf(c.paidAt) !== thisFy);
  console.log(`\n${charges.length} paid charge(s) without a company invoice (across ${subsByBusiness.size} workspace(s)).`);
  if (earlier.length) console.log(`  Note: ${earlier.length} of them were paid in an earlier financial year — ask your CA before issuing those.`);
  for (const c of charges) {
    console.log(`  ${c.paidAt.toISOString().slice(0, 10)}  ₹${(c.amountPaise / 100).toFixed(2).padStart(10)}  ${c.paymentId}  business ${c.businessId}`);
  }
  if (!APPLY) {
    console.log('\nDRY RUN — nothing was changed. Re-run with --apply to issue these invoices (add --email to also email them).');
    return;
  }

  let issued = 0;
  let emailed = 0;
  for (const c of charges) {
    const r = await svc.issueInvoiceForPayment({
      razorpayPaymentId: c.paymentId, businessId: c.businessId, userId: c.userId, razorpaySubscriptionId: c.subscriptionId,
      amountPaise: c.amountPaise, currency: c.currency, paidAt: c.paidAt, planType: c.planType, billingCycle: c.billingCycle,
      periodStart: c.periodStart, periodEnd: c.periodEnd,
    });
    if (!r?.created) continue;
    issued++;
    console.log(`  ✓ ${r.invoice.invoiceNumber}  ${c.paymentId}`);
    if (EMAIL) {
      const e = await svc.emailInvoice(String(r.invoice._id));
      if (e.sent) emailed++;
      else console.log(`    email not sent: ${e.reason}`);
    }
  }
  console.log(`\nIssued ${issued} invoice(s)${EMAIL ? `, emailed ${emailed}` : ' (not emailed — customers can download them from Billing)'}.`);
}

main()
  .catch((err) => { console.error('FAILED:', err?.message || err); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect().catch(() => {}); });
