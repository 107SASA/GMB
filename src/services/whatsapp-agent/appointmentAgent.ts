import { WorkingHoursConfig, formatSlotsForMessage, resolveWorkingHoursConfig, suggestAlternativeSlots, validateSlot } from './businessHours';
import { friendlyDateLabel, friendlyTimeLabel } from './dateTimeUtils';
import { classifyAppointmentIntent, classifyConfirmation } from './intentClassifier';
import {
  bookAppointment,
  cancelAppointment,
  findActiveAppointmentForLead,
  isSlotTaken,
  rescheduleAppointment,
} from './appointmentService';

/**
 * Feature 2-6 — conversational appointment lifecycle (book / cancel /
 * reschedule) with working-hours validation, conflict prevention,
 * alternative-slot suggestions, and an explicit "ask before acting"
 * confirmation step, as required by the spec's AI conversation examples.
 *
 * State for an in-flight action lives on `thread.pendingAction` (see
 * ConversationThread model) so the flow survives across the async,
 * one-message-at-a-time nature of WhatsApp.
 */

type ProposalAction = 'book' | 'reschedule';
type ProposalStage = 'collecting' | 'confirming' | 'choosing_alternative';

interface ProposalPayload {
  kind: 'proposal';
  action: ProposalAction;
  appointmentId?: string; // required for reschedule
  date: string | null;
  time: string | null;
  service: string | null;
  customerName: string;
  phone: string;
  email?: string | null;
  stage: ProposalStage;
}

interface CancelConfirmPayload {
  kind: 'cancel_confirm';
  appointmentId: string;
  date: string;
  time: string;
}

type PendingPayload = ProposalPayload | CancelConfirmPayload;

export interface AppointmentAgentInput {
  tenantId: string;
  businessId: string;
  leadId: string;
  business: any; // Business mongoose doc (needs whatsappBookingSettings, whatsappBookingSettings.timezone)
  thread: any; // ConversationThread mongoose doc — read/write pendingAction, then caller persists via thread.save()
  customerName: string;
  phone: string;
  email?: string | null;
  incomingMessage: string;
  conversationContext?: string;
}

export interface AppointmentAgentResult {
  handled: boolean;
  reply?: string;
}

function pendingTypeFor(payload: PendingPayload): 'book_appointment' | 'cancel_appointment' | 'reschedule_appointment' {
  if (payload.kind === 'cancel_confirm') return 'cancel_appointment';
  return payload.action === 'book' ? 'book_appointment' : 'reschedule_appointment';
}

function setPending(thread: any, payload: PendingPayload) {
  thread.pendingAction = { type: pendingTypeFor(payload), payload, createdAt: new Date() };
}

function clearPending(thread: any) {
  thread.pendingAction = null;
}

function slotSummary(date: string, time: string, service?: string | null) {
  return `${friendlyDateLabel(date)} at ${friendlyTimeLabel(time)}${service ? ` for ${service}` : ''}`;
}

/** Validates + checks availability for a proposed slot without writing anything. */
async function evaluateProposedSlot(config: WorkingHoursConfig, businessId: string, date: string, time: string, excludeAppointmentId?: string) {
  const validation = validateSlot(config, date, time);
  if (!validation.valid) return { ok: false as const, message: validation.friendlyMessage! };

  const taken = await isSlotTaken(businessId, date, time, excludeAppointmentId);
  if (taken) {
    const alternatives = suggestAlternativeSlots(config, date, [time], 3);
    return { ok: false as const, alternatives };
  }
  return { ok: true as const };
}

async function handleProposalUpdate(
  config: WorkingHoursConfig,
  input: AppointmentAgentInput,
  payload: ProposalPayload,
  extracted: { date: string | null; time: string | null; service: string | null }
): Promise<AppointmentAgentResult> {
  const { thread, businessId } = input;

  const date = extracted.date || payload.date;
  const time = extracted.time || payload.time;
  const service = extracted.service || payload.service;

  if (!date || !time) {
    setPending(thread, { ...payload, date, time, service, stage: 'collecting' });
    const missing = !date && !time ? 'a day and time' : !date ? 'a day' : 'a time';
    return { handled: true, reply: `Sure — what ${missing} works for you?` };
  }

  const evaluation = await evaluateProposedSlot(config, businessId, date, time, payload.action === 'reschedule' ? payload.appointmentId : undefined);

  if (!evaluation.ok && 'alternatives' in evaluation && evaluation.alternatives) {
    if (evaluation.alternatives.length === 0) {
      clearPending(thread);
      return { handled: true, reply: `That slot is already booked and I couldn't find another opening nearby. Could you suggest a different day?` };
    }
    setPending(thread, { ...payload, date, time, service, stage: 'choosing_alternative' });
    return {
      handled: true,
      reply: `That slot is already booked.\n\nAvailable times:\n${formatSlotsForMessage(evaluation.alternatives, date)}\n\nWhich would you like?`,
    };
  }

  if (!evaluation.ok) {
    setPending(thread, { ...payload, date: null, time: null, service, stage: 'collecting' });
    return { handled: true, reply: (evaluation as any).message };
  }

  setPending(thread, { ...payload, date, time, service, stage: 'confirming' });
  const verb = payload.action === 'book' ? 'confirm your appointment' : 'confirm the change';
  return {
    handled: true,
    reply: `That time is available. Would you like me to ${verb} for ${slotSummary(date, time, service)}?`,
  };
}

async function commitProposal(config: WorkingHoursConfig, input: AppointmentAgentInput, payload: ProposalPayload): Promise<AppointmentAgentResult> {
  const { thread, tenantId, businessId, leadId } = input;
  if (!payload.date || !payload.time) {
    clearPending(thread);
    return { handled: true, reply: `Sorry, something went wrong on my end — could you tell me the day and time again?` };
  }

  if (payload.action === 'book') {
    const result = await bookAppointment(config, {
      tenantId,
      businessId,
      leadId,
      customerName: payload.customerName,
      phone: payload.phone,
      email: payload.email,
      serviceRequested: payload.service,
      date: payload.date,
      time: payload.time,
      timezone: config.timezone,
    });

    if (result.ok) {
      clearPending(thread);
      return { handled: true, reply: `Your appointment has been successfully booked for ${slotSummary(payload.date, payload.time, payload.service)}.` };
    }
    if (result.reason === 'slot_taken') {
      if (result.alternatives.length === 0) {
        clearPending(thread);
        return { handled: true, reply: `Sorry, that slot was just taken and I couldn't find another opening nearby. Could you suggest a different day?` };
      }
      setPending(thread, { ...payload, date: null, time: null, stage: 'choosing_alternative' });
      return {
        handled: true,
        reply: `That slot was just booked by someone else.\n\nAvailable times:\n${formatSlotsForMessage(result.alternatives, payload.date)}\n\nWhich would you like?`,
      };
    }
    clearPending(thread);
    return { handled: true, reply: result.message };
  }

  // reschedule
  if (!payload.appointmentId) {
    clearPending(thread);
    return { handled: true, reply: `Sorry, I lost track of which appointment to move. Could you say that again?` };
  }
  const result = await rescheduleAppointment(config, payload.appointmentId, payload.date, payload.time, config.timezone);
  if (result.ok) {
    clearPending(thread);
    return { handled: true, reply: `Done. Your appointment has been rescheduled to ${slotSummary(payload.date, payload.time, payload.service)}.` };
  }
  if (result.reason === 'slot_taken') {
    if (result.alternatives.length === 0) {
      clearPending(thread);
      return { handled: true, reply: `Sorry, that slot was just taken. Could you suggest a different day?` };
    }
    setPending(thread, { ...payload, date: null, time: null, stage: 'choosing_alternative' });
    return {
      handled: true,
      reply: `That slot is unavailable.\n\nAvailable times:\n${formatSlotsForMessage(result.alternatives, payload.date)}\n\nWhich would you like?`,
    };
  }
  clearPending(thread);
  return { handled: true, reply: result.message };
}

async function handlePendingProposal(
  config: WorkingHoursConfig,
  input: AppointmentAgentInput,
  payload: ProposalPayload
): Promise<AppointmentAgentResult> {
  const { thread, incomingMessage } = input;

  if (payload.stage === 'collecting' || payload.stage === 'choosing_alternative') {
    const extracted = await classifyAppointmentIntent(incomingMessage, config.timezone, input.conversationContext);
    return handleProposalUpdate(config, input, payload, { date: extracted.date, time: extracted.time, service: extracted.service || payload.service });
  }

  // stage === 'confirming'
  const confirmation = await classifyConfirmation(incomingMessage);
  if (confirmation.decision === 'yes') {
    return commitProposal(config, input, payload);
  }
  if (confirmation.decision === 'no') {
    clearPending(thread);
    return {
      handled: true,
      reply: payload.action === 'book' ? `No problem — let me know whenever you'd like to book.` : `No problem — your appointment stays as is.`,
    };
  }
  // unclear — maybe they proposed a different time instead of a plain yes/no
  const extracted = await classifyAppointmentIntent(incomingMessage, config.timezone, input.conversationContext);
  if (extracted.date || extracted.time) {
    return handleProposalUpdate(config, input, payload, { date: extracted.date, time: extracted.time, service: extracted.service || payload.service });
  }
  return { handled: true, reply: `Just to confirm — should I go ahead? (yes/no)` };
}

async function handlePendingCancel(input: AppointmentAgentInput, payload: CancelConfirmPayload): Promise<AppointmentAgentResult> {
  const { thread, incomingMessage } = input;
  const confirmation = await classifyConfirmation(incomingMessage);

  if (confirmation.decision === 'yes') {
    await cancelAppointment(payload.appointmentId, 'Cancelled via WhatsApp AI Agent at customer request');
    clearPending(thread);
    return { handled: true, reply: `Your appointment has been cancelled successfully.` };
  }
  if (confirmation.decision === 'no') {
    clearPending(thread);
    return { handled: true, reply: `Got it — your appointment on ${friendlyDateLabel(payload.date)} at ${friendlyTimeLabel(payload.time)} stays as is.` };
  }
  return {
    handled: true,
    reply: `Just to confirm — would you like me to cancel your appointment on ${friendlyDateLabel(payload.date)} at ${friendlyTimeLabel(payload.time)}? (yes/no)`,
  };
}

export async function processAppointmentIntent(input: AppointmentAgentInput): Promise<AppointmentAgentResult> {
  const config = resolveWorkingHoursConfig(input.business?.whatsappBookingSettings);

  // Opt-in only — businesses that haven't configured/enabled booking see
  // zero behavior change; the caller falls back to the existing generic
  // AI sales flow untouched.
  if (!config.bookingEnabled) return { handled: false };

  const { thread, leadId, incomingMessage } = input;

  if (thread.pendingAction && thread.pendingAction.payload) {
    const payload = thread.pendingAction.payload as PendingPayload;
    if (payload.kind === 'proposal') return handlePendingProposal(config, input, payload);
    if (payload.kind === 'cancel_confirm') return handlePendingCancel(input, payload);
  }

  const intent = await classifyAppointmentIntent(incomingMessage, config.timezone, input.conversationContext);

  if (intent.intent === 'none') return { handled: false };

  if (intent.intent === 'book') {
    return handleProposalUpdate(
      config,
      input,
      {
        kind: 'proposal',
        action: 'book',
        date: null,
        time: null,
        service: null,
        customerName: input.customerName,
        phone: input.phone,
        email: input.email,
        stage: 'collecting',
      },
      { date: intent.date, time: intent.time, service: intent.service }
    );
  }

  if (intent.intent === 'cancel') {
    const appt = await findActiveAppointmentForLead(leadId);
    if (!appt) {
      return { handled: true, reply: `I couldn't find any upcoming appointment for you to cancel.` };
    }
    setPending(thread, { kind: 'cancel_confirm', appointmentId: appt._id.toString(), date: appt.date, time: appt.time });
    return {
      handled: true,
      reply: `I found your appointment on ${friendlyDateLabel(appt.date)} at ${friendlyTimeLabel(appt.time)}.\n\nWould you like me to cancel it?`,
    };
  }

  if (intent.intent === 'reschedule') {
    const appt = await findActiveAppointmentForLead(leadId);
    if (!appt) {
      return { handled: true, reply: `I couldn't find any upcoming appointment for you to reschedule.` };
    }
    return handleProposalUpdate(
      config,
      input,
      {
        kind: 'proposal',
        action: 'reschedule',
        appointmentId: appt._id.toString(),
        date: null,
        time: null,
        service: appt.serviceRequested || null,
        customerName: input.customerName,
        phone: input.phone,
        email: input.email,
        stage: 'collecting',
      },
      { date: intent.date, time: intent.time, service: intent.service }
    );
  }

  return { handled: false };
}
