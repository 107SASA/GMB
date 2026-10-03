import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Appointment from '@/models/Appointment';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';
import mongoose from 'mongoose';
import { customerLeadFilter } from '@/services/crm/access';
import { createOrUpdateCustomerLead, logLeadActivity } from '@/services/crm/customerLeads';

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

const MEETING_STATUSES = ['Pending Confirmation', 'Scheduled', 'Completed', 'Canceled'];

/**
 * Book an appointment for a customer lead. Either `leadId` (must belong to
 * this workspace) or `phone`/`name`/`email` — the latter goes through the
 * canonical Customer CRM service (source 'Appointment', deduped by phone), so
 * a booking never creates a duplicate lead. Only known fields are accepted.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();
    const body = await req.json().catch(() => ({}));

    let lead: any = null;
    if (body.leadId) {
      const filter = customerLeadFilter(ctx, String(body.leadId));
      lead = filter ? await Lead.findOne(filter) : null;
      if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    } else if (body.phone || body.email || body.name) {
      const r = await createOrUpdateCustomerLead({
        businessId: ctx.businessId,
        organizationId: ctx.organizationId,
        name: body.name,
        phone: body.phone,
        email: body.email,
        source: 'Appointment',
        interest: typeof body.serviceInterest === 'string' ? body.serviceInterest : null,
        createdBy: ctx.userId,
      });
      if (!r.lead) return NextResponse.json({ error: r.skippedReason }, { status: 400 });
      lead = r.lead;
    } else {
      return NextResponse.json({ error: 'leadId, or a name/phone/email, is required' }, { status: 400 });
    }

    const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
    const proposed = body.proposedDate ? new Date(body.proposedDate) : null;
    const appointment = await Appointment.create({
      leadId: lead._id,
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
      tenantId: ctx.organizationId,
      date: str(body.date, 20),
      time: str(body.time, 20),
      ...(proposed && !isNaN(proposed.getTime()) ? { proposedDate: proposed } : {}),
      serviceInterest: str(body.serviceInterest),
      email: str(body.email),
      meetingType: str(body.meetingType, 60) || 'Discovery Call',
      source: str(body.source, 60) || 'Manual',
      status: MEETING_STATUSES.includes(body.status) ? body.status : 'Scheduled',
    });

    const when = [appointment.date, appointment.time].filter(Boolean).join(' ') || (proposed ? proposed.toISOString() : 'date not set');
    await logLeadActivity(lead, {
      type: 'appointment',
      content: `Appointment booked: ${appointment.meetingType} — ${when}`,
      metadata: { appointmentId: String(appointment._id), status: appointment.status },
      createdBy: ctx.userId,
    });
    lead.lastActivityAt = new Date();
    await lead.save();

    return NextResponse.json(appointment, { status: 201 });
  } catch (error) {
    console.error('Error creating appointment:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
