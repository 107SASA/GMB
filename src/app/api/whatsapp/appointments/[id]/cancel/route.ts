import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import WhatsAppAppointment from '@/models/WhatsAppAppointment';
import { cancelAppointment } from '@/services/whatsapp-agent/appointmentService';

/**
 * ADDITIVE — lets a business owner cancel a WhatsApp-booked appointment
 * from the dashboard (as opposed to the customer cancelling via chat,
 * which is handled by the appointmentAgent service). Never hard-deletes;
 * status flips to 'Cancelled' and history is preserved (Feature 4).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // WhatsApp AI Agent is a Super Admin–exclusive feature.
    const authCheck = await requireSuperAdmin();
    if (!authCheck.ok) return authCheck.response;

    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    const { id } = await params;
    await dbConnect();

    const appointment = await WhatsAppAppointment.findById(id);
    if (!appointment) {
      return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
    }
    if (appointment.businessId.toString() !== ctx.businessId) {
      return NextResponse.json({ success: false, error: 'Not authorized to modify this appointment' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const updated = await cancelAppointment(id, body?.reason || 'Cancelled by business owner');

    return NextResponse.json({ success: true, appointment: updated });
  } catch (error: any) {
    console.error('[whatsapp/appointments/:id/cancel][POST]', error);
    return NextResponse.json({ success: false, error: 'Failed to cancel appointment' }, { status: 500 });
  }
}
