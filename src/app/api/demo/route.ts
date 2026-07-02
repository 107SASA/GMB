import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import DemoBooking from '@/models/DemoBooking';
import Lead from '@/models/Lead';
import Activity from '@/models/Activity';
import { inngest } from '@/services/inngest/client';

const connectDB = async () => {
  if (mongoose.connections[0].readyState) return;
  await mongoose.connect(process.env.MONGODB_URI!);
};

export async function POST(req: NextRequest) {
  try {
    await connectDB();
    const body = await req.json();
    const { 
      name, email, phone, company, businessType, 
      location, website, monthlyLeads, challenges, 
      date, timeSlot 
    } = body;

    // Validate required fields
    if (!name || !email || !phone || !company || !businessType || !location || !date || !timeSlot) {
      return NextResponse.json(
        { error: 'Required fields are missing.' },
        { status: 400 }
      );
    }

    const tenantId = 'gmbboost-internal';

    // 1. Create or Find internal Lead
    let lead = await Lead.findOne({ email, tenantId });
    if (!lead) {
      lead = await Lead.findOne({ phone, tenantId });
    }

    if (!lead) {
      lead = await Lead.create({
        tenantId,
        name,
        email,
        phone,
        source: 'Demo Booking',
        leadType: 'Platform Prospect',
        pipelineStage: 'New Request',
        status: 'active',
        aiLeadScore: 85 // Can be scored asynchronously via AI
      });
    } else {
      // Update existing lead pipeline stage if it was previously lost or new
      lead.pipelineStage = 'New Request';
      lead.source = 'Demo Booking';
      await lead.save();
    }

    // 2. Create Activity for CRM Timeline
    await Activity.create({
      tenantId,
      leadId: lead._id,
      type: 'Demo',
      content: `Booked a Demo for ${date} at ${timeSlot}.`
    });

    // 3. Create Demo Booking Record
    const booking = await DemoBooking.create({
      leadId: lead._id,
      name, email, phone, company, businessType, 
      location, website, monthlyLeads, challenges, 
      date, timeSlot,
      status: 'Pending'
    });

    // 4. Dispatch Async Job (Notifications)
    await inngest.send({
      name: 'demo/booked',
      data: {
        bookingId: booking._id.toString()
      }
    });

    return NextResponse.json({ success: true, booking });

  } catch (error: any) {
    console.error('Demo booking error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}