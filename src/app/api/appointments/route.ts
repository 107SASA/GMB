import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Appointment from '@/models/Appointment';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';
import mongoose from 'mongoose';

export async function GET(_req: NextRequest) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();
    const appointments = await Appointment.find({
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
    })
      .populate('leadId', 'name phone businessType')
      .sort({ date: 1, time: 1 });

    return NextResponse.json(appointments);
  } catch (error) {
    console.error('Error fetching appointments:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();
    const body = await req.json();

    const appointment = await Appointment.create({
      ...body,
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
      tenantId: ctx.organizationId,
    });

    if (body.leadId) {
      await Lead.findOneAndUpdate(
        { _id: body.leadId, businessId: ctx.businessId },
        { status: 'Booking Pending' }
      );
    }

    return NextResponse.json(appointment, { status: 201 });
  } catch (error) {
    console.error('Error creating appointment:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
