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

    let imported = 0;
    let skipped = 0;

    for (const lead of leads) {
      const phone = normalizePhoneE164(lead.phone);
      if (!phone) { skipped++; continue; }

      const exists = await Customer.exists({ businessId: ctx.businessId, phone });
      if (exists) { skipped++; continue; }

      await Customer.create({
        tenantId: ctx.organizationId,
        businessId: ctx.businessId,
        name: lead.name || phone,
        phone,
        email: lead.email || undefined,
        tags: ['From CRM'],
      });
      imported++;
    }

    return NextResponse.json({ success: true, imported, skipped, totalLeads: leads.length });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
