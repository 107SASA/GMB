import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import DemoBooking from '@/models/DemoBooking';
import { requireSuperAdmin } from '@/lib/auth';

const connectDB = async () => {
  if (mongoose.connections[0].readyState) return;
  await mongoose.connect(process.env.MONGODB_URI!);
};

// Fetch all demo bookings for Super Admin dashboard
export async function GET() {
  try {
    const authResult = await requireSuperAdmin();
    if (!authResult.ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    await connectDB();
    
    // We populate the leadId if needed, but the core info is on DemoBooking
    const bookings = await DemoBooking.find().sort({ createdAt: -1 });
    
    return NextResponse.json({ success: true, bookings });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Update demo booking status
export async function PATCH(req: Request) {
  try {
    const authResult = await requireSuperAdmin();
    if (!authResult.ok) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    await connectDB();
    const { bookingId, status } = await req.json();

    if (!bookingId || !status) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const validStatuses = ['Pending', 'Confirmed', 'Completed', 'Cancelled', 'No Show', 'Rescheduled'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const booking = await DemoBooking.findByIdAndUpdate(
      bookingId,
      { status },
      { new: true }
    );

    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // Optionally: if status is 'Converted', we can trigger customer onboarding logic or update the Lead pipelineStage
    if (status === 'Completed') {
      const { default: Lead } = await import('@/models/Lead');
      await Lead.findByIdAndUpdate(booking.leadId, { pipelineStage: 'Demo Completed' });
    }

    return NextResponse.json({ success: true, booking });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
