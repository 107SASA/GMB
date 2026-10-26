/**
 * Pure rules for sending an approved WhatsApp template to selected leads
 * (Super Admin → Leads & Pipeline → Send WhatsApp). No database, no sending.
 */
import { normalizePhoneE164 } from './phone.ts';
import { usablePersonName } from './personName.ts';
import { NOTIFICATION_BODY_MAX, sanitizeWhatsAppTemplateVariable } from './whatsappOutbound.ts';

/** Most leads one send may go to — a larger list is split by the team. */
export const CAMPAIGN_MAX_RECIPIENTS = 1000;
/** A lead messaged by a campaign this recently is left out (unless the sender says otherwise). */
export const CAMPAIGN_COOLDOWN_DAYS = 7;

export type CampaignSkipReason =
  | 'no-phone'
  | 'opted-out'
  | 'do-not-contact'
  | 'customer'
  | 'recently-messaged'
  | 'already-in-campaign';

export const SKIP_LABEL: Record<CampaignSkipReason, string> = {
  'no-phone': 'No valid WhatsApp number',
  'opted-out': 'Opted out of messages',
  'do-not-contact': 'Marked Do not contact',
  customer: 'Already a customer',
  'recently-messaged': `Got a campaign message in the last ${CAMPAIGN_COOLDOWN_DAYS} days`,
  'already-in-campaign': 'Already in this send',
};

/** Why this lead must not get the message, or null when it may. */
export function campaignSkipReason(
  lead: { phone?: string | null; nurtureStatus?: string | null; currentStage?: string | null; currentAgent?: string | null },
  opts: { lastCampaignAt?: Date | string | null; skipRecent?: boolean; now?: Date } = {}
): CampaignSkipReason | null {
  if (!lead.phone || !normalizePhoneE164(lead.phone)) return 'no-phone';
  if (lead.nurtureStatus === 'OPTED_OUT' || lead.nurtureStatus === 'STOPPED') return 'opted-out';
  if (lead.currentStage === 'DO_NOT_CONTACT') return 'do-not-contact';
  if (lead.currentStage === 'CUSTOMER' || lead.currentAgent === 'IN_HOUSE') return 'customer';
  if (opts.skipRecent !== false && opts.lastCampaignAt) {
    const now = opts.now || new Date();
    if (now.getTime() - new Date(opts.lastCampaignAt).getTime() < CAMPAIGN_COOLDOWN_DAYS * 86_400_000) return 'recently-messaged';
  }
  return null;
}

/** The {{n}} numbers a template body uses, in order — e.g. [1, 2]. */
export function templatePlaceholders(body: string | null | undefined): number[] {
  const found = new Set<number>();
  for (const match of String(body || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)) found.add(Number(match[1]));
  return [...found].sort((a, b) => a - b);
}

/**
 * A template the Leads send can fill: {{1}} = the lead's first name, and
 * optionally {{2}} = the message typed by the team. Anything else is refused,
 * so a template is never sent with a blank the system cannot fill.
 */
export function templateShapeError(placeholders: number[]): string | null {
  const shape = placeholders.join(',');
  if (shape === '1' || shape === '1,2') return null;
  if (!placeholders.length) return null; // fixed text only — sent as written
  return `This template uses ${placeholders.map((n) => `{{${n}}}`).join(', ')}. Leads can be sent templates with {{1}} (first name) and optionally {{2}} (your message).`;
}

/** {{1}} for one lead: their first name, or "there" when no real name is saved. */
export function firstNameFor(name: string | null | undefined): string {
  const usable = usablePersonName(name || '');
  const first = usable.split(/\s+/)[0] || '';
  return sanitizeWhatsAppTemplateVariable(first) || 'there';
}

/** The typed message as one WhatsApp-safe line ({{2}} may not hold line breaks). */
export function campaignMessageLine(message: string | null | undefined): { ok: true; line: string } | { ok: false; error: string } {
  const line = sanitizeWhatsAppTemplateVariable(String(message || '').replace(/\s*[\r\n]+\s*/g, ' '));
  if (!line) return { ok: false, error: 'Type the message to send.' };
  if (line.length > NOTIFICATION_BODY_MAX) return { ok: false, error: `The message is ${line.length} characters — keep it under ${NOTIFICATION_BODY_MAX}.` };
  return { ok: true, line };
}

/** The variables for one lead, matching the template's placeholders. */
export function campaignVariables(placeholders: number[], leadName: string | null | undefined, line: string): Record<string, string> {
  const vars: Record<string, string> = {};
  if (placeholders.includes(1)) vars['1'] = firstNameFor(leadName);
  if (placeholders.includes(2)) vars['2'] = line;
  return vars;
}

/** What the lead will read: the template body with this lead's values filled in. */
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return String(body || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => vars[n] ?? `{{${n}}}`);
}
