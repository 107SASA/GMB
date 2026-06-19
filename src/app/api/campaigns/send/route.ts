import { NextResponse } from 'next/server';
import { inngest } from '@/services/inngest/client';
import dbConnect from '@/lib/mongodb';
import Customer from '@/models/Customer';

export async function POST(req: Request) {
  try {
    await dbConnect();
    const { customerId, businessId, tenantId, channel = 'whatsapp' } = await req.json();

    const customer = await Customer.findOne({ _id: customerId, businessId });
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    if (customer.optedOut) {
      return NextResponse.json({ error: 'Customer has opted out' }, { status: 400 });
    }

    // Fire Inngest Background Worker for the multi-step drip campaign
    await inngest.send({
      name: 'campaigns/review.request.start',
      data: {
        customerId,
        businessId,
        tenantId,
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
