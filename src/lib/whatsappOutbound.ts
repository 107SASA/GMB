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

/**
 * Longest {{2}} the notification template accepts. Meta caps a template body
 * at 1024 characters including the fixed text ("Hi {{1}}, Here's an update
 * from GrowwMatics: … If you have any questions, simply reply to this
 * message." ≈ 100 chars), so a longer {{2}} is refused here instead of by
 * Twilio after the call.
 */
export const NOTIFICATION_BODY_MAX = 900;

/** Any single Content variable — Meta's limit, checked before every Twilio Content send. */
export const TEMPLATE_VARIABLE_MAX = 1024;

/**
 * A free-text message rewritten for the notification template's {{2}}.
 * The template already says "Hi {{1}}," and closes with its own line, so a
 * leading greeting ("Hi Mulsetu," on its own line, or inline "Hi Rahul 👋 …")
 * and a "— Team Growwmatics" sign-off are dropped — otherwise the recipient
 * reads the greeting twice. The greeting's name is returned so {{1}} has a
 * value even when no lead record names the recipient (owner notifications).
 * Line breaks cannot be sent inside a template variable, so lines are joined
 * with a space; message copy is written to read well that way. A line that is
 * only a *bold heading* is followed by " — " so it does not run into the
 * sentence after it.
 */
export function notificationBodyForTemplate(body: string): { name: string; text: string } {
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n');
  let name = '';
  while (lines.length && !lines[0].trim()) lines.shift();
  const own = lines[0]?.trim().match(/^(?:hi|hello|hey|dear)\s+([^,!?.\n]{1,60}?)\s*[,!]$/i);
  if (own && lines.length > 1) {
    name = own[1];
    lines.shift();
  } else if (lines.length) {
    const inline = lines[0].match(/^\s*(?:hi|hello|hey)\s+([^,!\n]{1,40}?)\s*(?:[,!]|👋)+\s*/iu);
    if (inline) {
      name = inline[1];
      lines[0] = lines[0].slice(inline[0].length);
    }
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length && /^[—–-]\s*Team Growwmatics\.?$/i.test(lines[lines.length - 1].trim())) lines.pop();
  const kept = lines.map((l) => l.trim()).filter(Boolean);
  const text = sanitizeWhatsAppTemplateVariable(
    kept.map((l, i) => (i < kept.length - 1 && /^\*[^*]+\*$/.test(l) ? `${l} —` : l)).join(' ')
  );
  return { name: sanitizeWhatsAppTemplateVariable(name), text };
}

/** Absolute app link for WhatsApp copy, or null when NEXT_PUBLIC_APP_URL / APP_URL is not an absolute URL. */
export function appLink(path: string): string | null {
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
  return /^https?:\/\//.test(base) ? `${base}${path}` : null;
}

/**
 * The house style for a business-owner WhatsApp: greeting, one short
 * paragraph, one link (or a plain pointer when no absolute link is
 * available), sign-off. Reads well as free text and, flattened, as the
 * notification template's {{2}} (notificationBodyForTemplate drops the
 * greeting and sign-off there).
 */
export function composeOwnerMessage(input: {
  name: string;
  body: string;
  linkLabel: string;
  link: string | null;
  noLinkText: string;
}): string {
  return [
    `Hi ${input.name},`,
    '',
    input.body,
    '',
    input.link ? `${input.linkLabel}: ${input.link}` : input.noLinkText,
    '',
    '— Team Growwmatics',
  ].join('\n');
}

export function buildNotificationVariables(
  name: string,
  message: string,
  /** true: use `name` as given (a business name, or the name the message's own greeting used); false: a person's first name. */
  verbatimName = false
):
  | { ok: true; variables: Record<'1' | '2', string> }
  | { ok: false; error: string } {
  const first = sanitizeWhatsAppTemplateVariable(verbatimName ? name : recipientFirstName(name) || name);
  const line = sanitizeWhatsAppTemplateVariable(message);
  if (!first) return { ok: false, error: 'Notification template variable {{1}} is empty.' };
  if (!line) return { ok: false, error: 'Notification template variable {{2}} is empty.' };
  if (/[\r\n\t]/.test(line)) {
    return { ok: false, error: 'Notification template variable {{2}} is not a single line.' };
  }
  if (line.length > NOTIFICATION_BODY_MAX) {
    return { ok: false, error: `Notification template variable {{2}} is ${line.length} characters (max ${NOTIFICATION_BODY_MAX}).` };
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
    // Meta rejects more than four consecutive spaces (Twilio 21656).
    if (/ {5,}/.test(value)) return `Template variable {{${key}}} has more than four consecutive spaces.`;
    if (value.length > TEMPLATE_VARIABLE_MAX) return `Template variable {{${key}}} is longer than ${TEMPLATE_VARIABLE_MAX} characters.`;
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
