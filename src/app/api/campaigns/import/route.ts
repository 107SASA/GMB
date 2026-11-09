import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Customer from '@/models/Customer';
import { buildCustomerLeadIndex, createOrUpdateCustomerLead } from '@/services/crm/customerLeads';
import mongoose from 'mongoose';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';
import { normalizePhoneE164 } from '@/lib/phone';


export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  // ADDITIVE (Sep 2026) — marketing_automation was never actually enforced
  // server-side; see lib/moduleGating.ts.
  const gate = await requireModule(ctx.userId, 'marketing_automation');
  if (!gate.ok) return gate.response;

  try {
    await dbConnect();
    const { customers } = await req.json();

    if (!customers || !Array.isArray(customers) || customers.length === 0) {
      return NextResponse.json({ error: 'No valid customers provided' }, { status: 400 });
    }

    const bid = new mongoose.Types.ObjectId(ctx.businessId);
    const tenantId = ctx.organizationId;
    const index = await buildCustomerLeadIndex(ctx.businessId);
    let imported = 0;
    let leadsCreated = 0;
    let withoutPhone = 0;
    // Customers that can get a WhatsApp review request ("Send to all" next).
    const reachableIds: string[] = [];

    for (const c of customers) {
      // "+91 98765 43210", "98765-43210" and "9876543210" all become
      // +919876543210 — these used to be dropped silently and the customer
      // saved without a phone (never reachable).
      const phone = c.phone ? normalizePhoneE164(String(c.phone)) : null;
      if (!phone) withoutPhone++;

      // Skip if no valid contact method after phone nulling
      if (!phone && !c.email) continue;

      const query = phone
        ? { businessId: bid, phone }
        : { businessId: bid, email: c.email };

      const customer = await Customer.findOneAndUpdate(
        query,
        {
          $set: {
            tenantId,
            name: c.name,
            ...(phone ? { phone } : { phone: undefined }),
            email: c.email || undefined,
            service: c.service || undefined,
            tags: c.tags || [],
            notes: c.notes || undefined,
            ...(c.serviceDate && { serviceDate: new Date(c.serviceDate) })
          }
        },
        { upsert: true, new: true }
      );
      imported++;
      if (phone && !customer.optedOut) reachableIds.push(String(customer._id));

      // Canonical Customer CRM path (valid 'Campaign Import' source, schema
      // validated, deduped by normalized phone/email in this workspace). Past
      // customers are NOT marked Won: a conversion needs a real deal value,
      // and fabricating one would distort revenue/ROI. They are tagged instead.
      const r = await createOrUpdateCustomerLead({
        businessId: ctx.businessId,
        organizationId: ctx.organizationId,
        name: customer.name,
        phone: customer.phone || null,
        email: customer.email || null,
        source: 'Campaign Import',
        tags: ['Past customer'],
        createdBy: ctx.userId,
        bulk: true,
      }, { index });
      if (r.created) leadsCreated++;
    }

    return NextResponse.json({ success: true, imported, leadsCreated, withoutPhone, customerIds: reachableIds });
  } catch (error: any) {
    console.error('Import Customers Error:', error);
    return NextResponse.json({ error: toFriendlyMessage(error) }, { status: 500 });
  }
}
