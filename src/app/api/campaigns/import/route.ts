import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Customer from '@/models/Customer';
import Lead from '@/models/Lead';
import mongoose from 'mongoose';
import { requireBusinessContext } from '@/lib/tenant';

const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const { customers } = await req.json();

    if (!customers || !Array.isArray(customers) || customers.length === 0) {
      return NextResponse.json({ error: 'No valid customers provided' }, { status: 400 });
    }

    const bid = new mongoose.Types.ObjectId(ctx.businessId);
    const tenantId = ctx.organizationId;
    let imported = 0;
    let leadsCreated = 0;

    for (const c of customers) {
      // Silently null the phone field if it fails E.164 validation
      const phone = c.phone && PHONE_REGEX.test(c.phone) ? c.phone : null;

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

      const leadExists = await Lead.exists(query);
      if (!leadExists) {
        await Lead.create({
          tenantId,
          businessId: bid,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          source: 'Import',
          pipelineStage: 'Converted',
          aiScore: 100
        });
        leadsCreated++;
      }
    }

    return NextResponse.json({ success: true, imported, leadsCreated });
  } catch (error: any) {
    console.error('Import Customers Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
