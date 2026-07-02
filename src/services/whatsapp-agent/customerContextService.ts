import Customer from '@/models/Customer';
import { listAppointmentsForLead } from './appointmentService';
import { getCurrentSummary } from './summaryService';
import { getRecentChatHistory } from './chatHistoryService';

/**
 * Feature 9/10 — Shared Customer Context Layer.
 *
 * Reads (never writes) existing CRM data — `Customer` — plus the WhatsApp
 * module's own appointment/summary/chat-history collections, and combines
 * them into a single lightweight context object the AI can use to
 * personalize replies. Nothing here mutates Customer, Lead, or any other
 * non-WhatsApp collection.
 */

export interface WhatsAppCustomerContext {
  customerName?: string;
  totalSpend: number;
  isReturningCustomer: boolean;
  lastAppointment?: { date: string; time: string; status: string; service?: string };
  upcomingAppointment?: { date: string; time: string; service?: string };
  serviceInterests: string[];
  preferredTimes: string[];
  importantNotes: string[];
  lastInteractionAt?: Date;
}

export async function buildCustomerContext(params: {
  leadId: string;
  businessId: string;
  phone: string;
}): Promise<WhatsAppCustomerContext> {
  const { leadId, businessId, phone } = params;

  const [customer, appointments, summary, recentHistory] = await Promise.all([
    Customer.findOne({ businessId, phone }).lean().catch(() => null),
    listAppointmentsForLead(leadId).catch(() => []),
    getCurrentSummary(leadId).catch(() => null),
    getRecentChatHistory(leadId, 1).catch(() => []),
  ]);

  const now = Date.now();
  const past = appointments
    .filter((a: any) => a.scheduledAt.getTime() <= now || a.status === 'Completed' || a.status === 'Cancelled')
    .sort((a: any, b: any) => b.scheduledAt.getTime() - a.scheduledAt.getTime());
  const upcoming = appointments
    .filter((a: any) => a.scheduledAt.getTime() > now && (a.status === 'Confirmed' || a.status === 'Pending'))
    .sort((a: any, b: any) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  return {
    customerName: (customer as any)?.name || summary?.customerName,
    totalSpend: (customer as any)?.totalSpend || 0,
    isReturningCustomer: appointments.length > 0 || recentHistory.length > 0,
    lastAppointment: past[0]
      ? { date: past[0].date, time: past[0].time, status: past[0].status, service: past[0].serviceRequested }
      : undefined,
    upcomingAppointment: upcoming[0]
      ? { date: upcoming[0].date, time: upcoming[0].time, service: upcoming[0].serviceRequested }
      : undefined,
    serviceInterests: summary?.interestedServices || [],
    preferredTimes: summary?.preferredTimes || [],
    importantNotes: summary?.importantNotes || [],
    lastInteractionAt: summary?.lastInteractionAt,
  };
}

/** Renders the context as a compact block to inject into the AI system prompt. */
export function formatContextForPrompt(ctx: WhatsAppCustomerContext): string {
  const lines: string[] = [];
  if (ctx.isReturningCustomer) {
    lines.push(`This is a RETURNING customer${ctx.customerName ? ` (${ctx.customerName})` : ''}.`);
  } else {
    lines.push('This appears to be a NEW customer.');
  }
  if (ctx.totalSpend > 0) lines.push(`Lifetime spend: ${ctx.totalSpend}.`);
  if (ctx.lastAppointment) {
    lines.push(
      `Last appointment: ${ctx.lastAppointment.date} at ${ctx.lastAppointment.time} (${ctx.lastAppointment.status})${
        ctx.lastAppointment.service ? ` for ${ctx.lastAppointment.service}` : ''
      }.`
    );
  }
  if (ctx.upcomingAppointment) {
    lines.push(
      `Upcoming appointment: ${ctx.upcomingAppointment.date} at ${ctx.upcomingAppointment.time}${
        ctx.upcomingAppointment.service ? ` for ${ctx.upcomingAppointment.service}` : ''
      }.`
    );
  }
  if (ctx.serviceInterests.length) lines.push(`Previously showed interest in: ${ctx.serviceInterests.join(', ')}.`);
  if (ctx.preferredTimes.length) lines.push(`Preferred appointment times: ${ctx.preferredTimes.join(', ')}.`);
  if (ctx.importantNotes.length) lines.push(`Notes from earlier chats: ${ctx.importantNotes.join('; ')}.`);
  return lines.join('\n');
}
