import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Appointment from '@/models/Appointment';
import Lead from '@/models/Lead';

export async function GET(req: NextRequest) {
  try {
    await dbConnect();
    // Populate lead details to get name/phone easily on the frontend
    const appointments = await Appointment.find()
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
    await dbConnect();
    const body = await req.json();
    const appointment = await Appointment.create(body);
    
    // Also update the lead to mark them as Booking Pending if appropriate
    if (body.leadId) {
      await Lead.findByIdAndUpdate(body.leadId, {
        status: 'Booking Pending',
        bookingInterested: true
      });
    }

    return NextResponse.json(appointment, { status: 201 });
  } catch (error) {
    console.error('Error creating appointment:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
