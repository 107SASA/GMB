import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Customer from '@/models/Customer';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';
import { normalizePhoneE164 } from '@/lib/phone';

/**
 * Copies CRM leads into the review-campaign customer list so review requests
 * can be sent to them. Leads and customers stay separate records — a lead is
 * a prospect in the sales pipeline, a customer is someone you can ask for a
 * review.
 *
 * Body (optional): { leadIds: string[] } — import exactly these leads.
 * Without leadIds, only CONVERTED leads (lifeCycleStage 'converted') are
 * imported — they're the ones who actually became customers.
 *
 * Only leads with a usable phone number are imported; duplicates (same phone
 * in this business) are skipped. Imported customers get the "From CRM" group
 * tag so they're easy to target in campaigns.
 */
export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();

    const body = await req.json().catch(() => ({}));
    const leadIds: string[] | undefined = Array.isArray(body.leadIds) && body.leadIds.length > 0
      ? body.leadIds.map(String)
      : undefined;

    const query: any = {
      businessId: ctx.businessId,
      phone: { $exists: true, $nin: [null, ''] }
    };
    if (leadIds) {
      query._id = { $in: leadIds };
    } else {
      query.lifeCycleStage = 'converted';
    }

    const leads = await Lead.find(query).select('name phone email').lean() as any[];

    // Normalize + dedupe up front (both against each other — two leads
    // resolving to the same phone must only import once — and against
    // already-imported customers), then do ONE existence check and ONE
    // insert instead of a query-then-create pair per lead. That was
    // previously up to 2x `leads.length` sequential DB round-trips for a
    // batch import that can run to hundreds of leads.
    let skipped = 0;
    const candidates = new Map<string, { name?: string; email?: string }>();
    for (const lead of leads) {
      const phone = normalizePhoneE164(lead.phone);
      if (!phone) { skipped++; continue; }
      if (candidates.has(phone)) { skipped++; continue; } // duplicate within this batch
      candidates.set(phone, { name: lead.name, email: lead.email });
    }

    const existing = await Customer.find({
      businessId: ctx.businessId,
      phone: { $in: Array.from(candidates.keys()) },
    }).select('phone').lean();
    for (const c of existing) {
      if (candidates.delete((c as any).phone)) skipped++;
    }

    let imported = 0;
    if (candidates.size > 0) {
      const docs = Array.from(candidates.entries()).map(([phone, lead]) => ({
        tenantId: ctx.organizationId,
        businessId: ctx.businessId,
        name: lead.name || phone,
        phone,
        email: lead.email || undefined,
        tags: ['From CRM'],
      }));
      // unordered — one bad doc (e.g. a last-instant duplicate from a
      // concurrent import) shouldn't stop the rest of the batch.
      const result = await Customer.insertMany(docs, { ordered: false });
      imported = result.length;
    }

    return NextResponse.json({ success: true, imported, skipped, totalLeads: leads.length });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
