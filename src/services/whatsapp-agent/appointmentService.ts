import mongoose from 'mongoose';
import WhatsAppAppointment, { IWhatsAppAppointment } from '@/models/WhatsAppAppointment';
import { WorkingHoursConfig, suggestAlternativeSlots, validateSlot } from './businessHours';
import { zonedTimeToUtc } from './dateTimeUtils';

export interface BookAppointmentInput {
  tenantId: string;
  businessId: string;
  leadId?: string;
  customerId?: string;
  customerName: string;
  phone: string;
  email?: string | null;
  serviceRequested?: string | null;
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:mm"
  timezone: string;
  source?: string;
}

export type AppointmentResult =
  | { ok: true; appointment: IWhatsAppAppointment }
  | { ok: false; reason: 'slot_taken'; alternatives: Array<{ date: string; time: string }> }
  | { ok: false; reason: 'invalid'; message: string };

/** Is there already an active (Pending/Confirmed) appointment for this business at this exact slot? */
export async function isSlotTaken(businessId: string, date: string, time: string, excludeAppointmentId?: string) {
  const query: any = {
    businessId,
    date,
    time,
    status: { $in: ['Pending', 'Confirmed'] },
  };
  if (excludeAppointmentId) query._id = { $ne: excludeAppointmentId };
  const existing = await WhatsAppAppointment.findOne(query).lean();
  return !!existing;
}

/**
 * Books an appointment after re-validating both business hours and
 * slot availability at write time (avoids race conditions between the
 * initial check and the customer's confirmation reply).
 */
export async function bookAppointment(
  config: WorkingHoursConfig,
  input: BookAppointmentInput
): Promise<AppointmentResult> {
  const validation = validateSlot(config, input.date, input.time);
  if (!validation.valid) {
    return { ok: false, reason: 'invalid', message: validation.friendlyMessage || 'That slot is not available.' };
  }

  const taken = await isSlotTaken(input.businessId, input.date, input.time);
  if (taken) {
    const alternatives = suggestAlternativeSlots(config, input.date, [input.time], 3);
    return { ok: false, reason: 'slot_taken', alternatives };
  }

  const scheduledAt = zonedTimeToUtc(input.date, input.time, input.timezone);

  const appointment = await WhatsAppAppointment.create({
    tenantId: input.tenantId,
    businessId: input.businessId,
    leadId: input.leadId,
    customerId: input.customerId,
    customerName: input.customerName,
    phone: input.phone,
    email: input.email || undefined,
    serviceRequested: input.serviceRequested || undefined,
    date: input.date,
    time: input.time,
    scheduledAt,
    status: 'Confirmed',
    source: input.source || 'WhatsApp AI Agent',
    history: [{ action: 'created', newDate: input.date, newTime: input.time, at: new Date() }],
  });

  return { ok: true, appointment };
}

/** Most recent active (not cancelled/completed) appointment for a lead, used to resolve "cancel/reschedule my appointment". */
export async function findActiveAppointmentForLead(leadId: string) {
  return WhatsAppAppointment.findOne({
    leadId,
    status: { $in: ['Pending', 'Confirmed'] },
  })
    .sort({ scheduledAt: 1 })
    .exec();
}

export async function findAppointmentById(appointmentId: string) {
  if (!mongoose.isValidObjectId(appointmentId)) return null;
  return WhatsAppAppointment.findById(appointmentId).exec();
}

export async function cancelAppointment(appointmentId: string, reason?: string) {
  const appt = await WhatsAppAppointment.findById(appointmentId);
  if (!appt) return null;
  appt.status = 'Cancelled';
  appt.cancelledAt = new Date();
  appt.cancelReason = reason;
  appt.history.push({ action: 'cancelled', previousDate: appt.date, previousTime: appt.time, note: reason, at: new Date() } as any);
  await appt.save();
  return appt;
}

export async function rescheduleAppointment(
  config: WorkingHoursConfig,
  appointmentId: string,
  newDate: string,
  newTime: string,
  timezone: string
): Promise<AppointmentResult> {
  const appt = await WhatsAppAppointment.findById(appointmentId);
  if (!appt) return { ok: false, reason: 'invalid', message: `I couldn't find that appointment anymore.` };

  const validation = validateSlot(config, newDate, newTime);
  if (!validation.valid) {
    return { ok: false, reason: 'invalid', message: validation.friendlyMessage || 'That slot is not available.' };
  }

  const taken = await isSlotTaken(appt.businessId.toString(), newDate, newTime, appointmentId);
  if (taken) {
    const alternatives = suggestAlternativeSlots(config, newDate, [newTime], 3);
    return { ok: false, reason: 'slot_taken', alternatives };
  }

  const previousDate = appt.date;
  const previousTime = appt.time;

  appt.date = newDate;
  appt.time = newTime;
  appt.scheduledAt = zonedTimeToUtc(newDate, newTime, timezone);
  appt.status = 'Confirmed';
  appt.history.push({
    action: 'rescheduled',
    previousDate,
    previousTime,
    newDate,
    newTime,
    at: new Date(),
  } as any);
  await appt.save();

  return { ok: true, appointment: appt };
}

/** Business-owner-facing list, most recent first, with optional status filter. Preserves full history for auditability. */
export async function listAppointmentsForBusiness(businessId: string, status?: string) {
  const query: any = { businessId };
  if (status) query.status = status;
  return WhatsAppAppointment.find(query).sort({ scheduledAt: -1 }).exec();
}

export async function listAppointmentsForLead(leadId: string) {
  return WhatsAppAppointment.find({ leadId }).sort({ scheduledAt: -1 }).exec();
}
