import { NextResponse } from 'next/server';
import { inngest } from '@/services/inngest/client';
import dbConnect from '@/lib/mongodb';
import Customer from '@/models/Customer';
import { requireBusinessContext } from '@/lib/tenant';

export async function POST(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    await dbConnect();
    const { customerId, channel = 'whatsapp' } = await req.json();

    // Verify customer belongs to this business
    const customer = await Customer.findOne({ _id: customerId, businessId: ctx.businessId });
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    if (customer.optedOut) {
      return NextResponse.json({ error: 'Customer has opted out' }, { status: 400 });
    }

    await inngest.send({
      name: 'campaigns/review.request.start',
      data: {
        customerId,
        businessId: ctx.businessId,
        tenantId: ctx.organizationId,
        channel
      }
    });

    customer.reviewStatus = 'Requested';
    await customer.save();

    return NextResponse.json({ success: true, message: 'Review campaign started' });
  } catch (error: any) {
    console.error('Send Campaign Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
