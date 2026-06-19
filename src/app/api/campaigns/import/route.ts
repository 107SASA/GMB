import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Customer from '@/models/Customer';
import Lead from '@/models/Lead';
import mongoose from 'mongoose';

export async function POST(req: Request) {
  try {
    await dbConnect();
    const { customers, businessId, tenantId } = await req.json();

    if (!customers || !Array.isArray(customers) || customers.length === 0) {
      return NextResponse.json({ error: 'No valid customers provided' }, { status: 400 });
    }

    const bid = new mongoose.Types.ObjectId(businessId);
    let imported = 0;
    let leadsCreated = 0;

    for (const c of customers) {
      // Upsert Customer
      const query = c.phone 
        ? { businessId: bid, phone: c.phone }
        : { businessId: bid, email: c.email };

      const customer = await Customer.findOneAndUpdate(
        query,
        {
          $set: {
            tenantId,
            name: c.name,
            phone: c.phone,
            email: c.email,
            service: c.service,
            tags: c.tags || [],
            notes: c.notes,
            ...(c.serviceDate && { serviceDate: new Date(c.serviceDate) })
          }
        },
        { upsert: true, new: true }
      );
      imported++;

      // Sync to CRM if Lead doesn't exist
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

    return NextResponse.json({ 
      success: true, 
      imported, 
      leadsCreated 
    });

  } catch (error: any) {
    console.error('Import Customers Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
