import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { listAppointmentsForBusiness } from '@/services/whatsapp-agent/appointmentService';

/**
 * ADDITIVE — professional appointment records view for business owners
 * (Feature 6). Reads ONLY the new WhatsAppAppointment collection; does not
 * touch the existing CRM Appointment/DemoBooking models or routes.
 */
export async function GET(req: Request) {
  try {
    // WhatsApp AI Agent is a Super Admin–exclusive feature.
    const authCheck = await requireSuperAdmin();
    if (!authCheck.ok) return authCheck.response;

    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();
    const url = new URL(req.url);
    const status = url.searchParams.get('status') || undefined;

    const appointments = await listAppointmentsForBusiness(ctx.businessId, status);

    return NextResponse.json({ success: true, appointments });
  } catch (error: any) {
    console.error('[whatsapp/appointments][GET]', error);
    return NextResponse.json({ success: false, error: 'Failed to load appointments' }, { status: 500 });
  }
}
