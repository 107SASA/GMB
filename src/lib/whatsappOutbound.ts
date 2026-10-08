import { sessionWindowOpen } from '../services/inbox/inboxRules.ts';
import { NOTIFICATION_TEMPLATE_KEYS } from './whatsappTemplates.ts';

/**
 * Pure WhatsApp send rules. No Twilio client and no database.
 * A website-form `role: 'lead'` line is not an inbound WhatsApp message.
 */

export function sanitizeWhatsAppTemplateVariable(value: string): string {
  return String(value ?? '')
    .replace(/\r\n|\r|\n|\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** Asia/Kolkata is the platform demo timezone and is shown as IST. */
export function displayTimezone(timezone?: string | null): string {
  if (!timezone || timezone === 'Asia/Kolkata') return 'IST';
  return timezone;
}

export function recipientFirstName(name?: string | null): string {
  return (name || '').trim().split(/\s+/)[0] || '';
}

export type LeadMessageStamp = {
  role?: string;
  at?: Date | string | null;
  /** Set only when the line was stored from the WhatsApp webhook. */
  via?: string | null;
};

/**
 * Latest genuine inbound WhatsApp timestamp.
 * `lastLeadReplyAt` is written only by the webhook.
 * A lead line counts only when `via` is `whatsapp` — a form seed does not.
 */
export function realInboundAtFromMessages(
  messages: LeadMessageStamp[] | null | undefined,
  lastLeadReplyAt?: Date | string | null
): Date | null {
  let best: number | null = null;
  const consider = (value: Date | string | null | undefined) => {
    if (!value) return;
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return;
    if (best === null || time > best) best = time;
  };
  consider(lastLeadReplyAt);
  for (const message of messages || []) {
    if (message.role === 'lead' && message.via === 'whatsapp') consider(message.at);
  }
  return best === null ? null : new Date(best);
}

export function outboundChannel(
  lastRealInboundAt: Date | string | null | undefined,
  now = new Date()
): 'free-form' | 'template' {
  return sessionWindowOpen(lastRealInboundAt, now) ? 'free-form' : 'template';
}

export function buildNotificationVariables(
  name: string,
  message: string
):
  | { ok: true; variables: Record<'1' | '2', string> }
  | { ok: false; error: string } {
  const first = sanitizeWhatsAppTemplateVariable(recipientFirstName(name) || name);
  const line = sanitizeWhatsAppTemplateVariable(message);
  if (!first) return { ok: false, error: 'Notification template variable {{1}} is empty.' };
  if (!line) return { ok: false, error: 'Notification template variable {{2}} is empty.' };
  if (/[\r\n\t]/.test(line)) {
    return { ok: false, error: 'Notification template variable {{2}} is not a single line.' };
  }
  const variables = { '1': first, '2': line };
  const keys = Object.keys(variables);
  const expected = [...NOTIFICATION_TEMPLATE_KEYS];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return { ok: false, error: 'Notification template variables must be exactly {{1}} and {{2}}.' };
  }
  return { ok: true, variables };
}

/** Refuses a Twilio Content send whose variables are empty or still contain a newline or tab. */
export function unsafeTemplateVariableReason(variables: Record<string, string> | null | undefined): string | null {
  if (!variables || typeof variables !== 'object') return 'ContentVariables are missing.';
  for (const [key, value] of Object.entries(variables)) {
    if (typeof value !== 'string' || !value.trim()) return `Template variable {{${key}}} is empty.`;
    if (/[\r\n\t]/.test(value)) return `Template variable {{${key}}} must be a single line.`;
  }
  return null;
}

export function shouldRetryFreeformAsTemplate(input: {
  errorCode?: string | null;
  alreadyTemplate: boolean;
  alreadyRetried: boolean;
}): boolean {
  if (input.alreadyTemplate || input.alreadyRetried) return false;
  return input.errorCode === '63016';
}

export function demoConfirmationText(input: {
  whenLabel: string;
  meetingLink: string;
  timezone?: string | null;
}): string {
  const tz = displayTimezone(input.timezone);
  return `Your GrowwMatics demo is confirmed for ${input.whenLabel} (${tz}).\n\nYou'll meet with our team via Google Meet.\n\nJoin here: ${input.meetingLink}\n\nWe'll remind you before the demo. Reply here anytime to reschedule or cancel.`;
}

export function shouldDispatchConfirmation(input: {
  calendarConfirmed: boolean;
  meetingLink?: string | null;
  alreadySentAt?: Date | string | null;
}): boolean {
  if (input.alreadySentAt) return false;
  if (!input.calendarConfirmed) return false;
  return typeof input.meetingLink === 'string' && input.meetingLink.startsWith('https://');
}

/** WhatsApp delivery does not change a booking that Calendar already confirmed. */
export function bookingAfterWhatsAppResult<T extends { status: string; calendarEventId?: string | null }>(
  booking: T,
  send: { success: boolean }
): T & { rollback: false; whatsappDelivered: boolean } {
  return { ...booking, rollback: false, whatsappDelivered: send.success };
}
