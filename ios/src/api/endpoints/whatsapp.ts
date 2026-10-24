import { z } from 'zod';
import { api } from '../client';

/**
 * WhatsApp AI agent configuration + bookings. Conversations themselves live
 * in the Inbox tab — this module covers the web WhatsApp page's other three
 * tabs: AI settings (inbox config), booking hours, and appointments.
 * None of these routes are module-gated server-side.
 */

// --- AI settings (/api/inbox/config) ----------------------------------------

export const inboxConfigSchema = z.object({
  systemPrompt: z.string().catch(''),
  salesRules: z.string().catch(''),
  aiEnabled: z.boolean().catch(true),
  aiPersonality: z.string().catch('friendly'),
  tone: z.string().catch('professional'),
  maxResponseLength: z.number().catch(300),
});
export type InboxConfig = z.infer<typeof inboxConfigSchema>;

export async function fetchInboxConfig(): Promise<InboxConfig> {
  const { data } = await api.get('/api/inbox/config');
  return z.object({ config: inboxConfigSchema }).parse(data).config;
}

/** POST /api/inbox/config — upsert; aiTone mirrors the web's composed field. */
export async function saveInboxConfig(config: InboxConfig): Promise<void> {
  await api.post('/api/inbox/config', {
    ...config,
    aiTone: `${config.aiPersonality} / ${config.tone}`,
  });
}

// --- Booking hours (/api/whatsapp/business-hours) ----------------------------

export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const businessHoursSchema = z.object({
  bookingEnabled: z.boolean().catch(false),
  timezone: z.string().catch('Asia/Kolkata'),
  workingDays: z
    .record(z.string(), z.boolean().catch(false))
    .catch({})
    .transform((days) => {
      const full = {} as Record<Weekday, boolean>;
      for (const day of WEEKDAYS) full[day] = days[day] ?? false;
      return full;
    }),
  openingTime: z.string().catch('09:00'),
  closingTime: z.string().catch('18:00'),
  slotDurationMinutes: z.number().catch(30),
});
export type BusinessHours = z.infer<typeof businessHoursSchema>;

export async function fetchBusinessHours(): Promise<BusinessHours> {
  const { data } = await api.get('/api/whatsapp/business-hours');
  return z.object({ settings: businessHoursSchema }).parse(data).settings;
}

export async function saveBusinessHours(settings: BusinessHours): Promise<void> {
  await api.put('/api/whatsapp/business-hours', settings);
}

// --- Appointments (/api/whatsapp/appointments) --------------------------------

export const APPOINTMENT_STATUSES = ['Pending', 'Confirmed', 'Cancelled', 'Completed'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const appointmentSchema = z.object({
  _id: z.string(),
  customerName: z.string().catch('Customer'),
  phone: z.string().nullable().catch(null),
  serviceRequested: z.string().nullable().catch(null),
  date: z.string().catch(''),
  time: z.string().catch(''),
  status: z.enum(APPOINTMENT_STATUSES).catch('Pending'),
  source: z.string().nullable().catch(null),
  cancelReason: z.string().nullable().catch(null),
  createdAt: z.string().optional(),
});
export type Appointment = z.infer<typeof appointmentSchema>;

/** GET /api/whatsapp/appointments — optionally filtered by status. */
export async function fetchAppointments(status?: AppointmentStatus): Promise<Appointment[]> {
  const { data } = await api.get('/api/whatsapp/appointments', {
    params: status ? { status } : {},
  });
  return z
    .object({ appointments: z.array(appointmentSchema.nullable().catch(null)).catch([]) })
    .parse(data)
    .appointments.filter((a): a is Appointment => a !== null);
}

export async function cancelAppointment(appointmentId: string, reason: string): Promise<void> {
  await api.post(`/api/whatsapp/appointments/${appointmentId}/cancel`, { reason });
}
