/**
 * WhatsApp send diagnostics — pure, so tests load it directly.
 *
 * Every failed send reports WHY in a form that stays distinguishable:
 * missing template configuration, an invalid Content SID, a template not
 * approved for the sender's language, invalid Content Variables, a recipient
 * problem, an authentication problem, a rate limit, the 24h window, or Meta
 * refusing a marketing message. Log lines carry the feature, the expected
 * template, a short SID reference, the Twilio error code and a correlation id
 * (the MessageQueue row) — never a full phone number, an OTP, message text,
 * credentials or secrets.
 */

export type WhatsAppErrorKind =
  | 'TEMPLATE_CONFIG_MISSING'
  | 'PROVIDER_CONFIG_MISSING'
  | 'CONTENT_SID_INVALID'
  | 'TEMPLATE_NOT_APPROVED_FOR_LOCALE'
  | 'CONTENT_VARIABLES_INVALID'
  | 'OUTSIDE_SESSION_WINDOW'
  | 'RECIPIENT_INVALID'
  | 'RECIPIENT_UNAVAILABLE'
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMITED'
  | 'META_DECLINED_MARKETING'
  | 'SEND_FAILED';

/**
 * Twilio error code → kind. Only codes whose meaning is established in this
 * codebase's own history or Twilio's documented WhatsApp errors are mapped;
 * anything else stays SEND_FAILED with its code, never guessed.
 */
const TWILIO_CODE_KIND: Record<string, WhatsAppErrorKind> = {
  '20003': 'AUTHENTICATION_FAILED', // authentication error
  '20429': 'RATE_LIMITED', // too many requests
  '63018': 'RATE_LIMITED', // WhatsApp rate limit for the sender
  '21211': 'RECIPIENT_INVALID', // invalid 'To' number
  '21614': 'RECIPIENT_INVALID', // 'To' is not a valid mobile number
  '63024': 'RECIPIENT_INVALID', // invalid message recipient
  '63003': 'RECIPIENT_UNAVAILABLE', // channel could not find the destination
  '21655': 'CONTENT_SID_INVALID', // ContentSid is invalid
  '21656': 'CONTENT_VARIABLES_INVALID', // ContentVariables invalid
  '63027': 'TEMPLATE_NOT_APPROVED_FOR_LOCALE', // template does not exist for the language/locale
  '63016': 'OUTSIDE_SESSION_WINDOW', // free-form outside the 24h window
  '63049': 'META_DECLINED_MARKETING', // Meta chose not to deliver a marketing message
};

export function classifyTwilioError(code: string | number | null | undefined): WhatsAppErrorKind {
  if (code === null || code === undefined || code === '') return 'SEND_FAILED';
  return TWILIO_CODE_KIND[String(code)] ?? 'SEND_FAILED';
}

/** +91******7980 — enough to tell numbers apart in a log, not enough to contact anyone. */
export function redactPhone(phone: string | null | undefined): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 4) return '[redacted]';
  const plus = String(phone).trim().startsWith('+') ? '+' : '';
  const keepHead = digits.length > 10 ? digits.length - 10 : 0;
  return `${plus}${digits.slice(0, keepHead)}${'*'.repeat(Math.max(0, digits.length - keepHead - 4))}${digits.slice(-4)}`;
}

/** HX955e07… — identifies the template in a log without the full Content SID. */
export function safeSidRef(sid: string | null | undefined): string {
  const s = String(sid || '');
  if (!s) return '(none)';
  return s.length > 8 ? `${s.slice(0, 8)}…` : s;
}

/** Twilio's error message can contain the recipient's number — strip anything phone-like. */
export function redactText(text: string | null | undefined): string {
  return String(text || '').replace(/\+?\d[\d\s-]{7,}\d/g, (m) => redactPhone(m)).slice(0, 300);
}

export interface WhatsAppDiagnostic {
  event: 'whatsapp_send_failed' | 'whatsapp_template_config_missing' | 'whatsapp_send_recovered';
  feature: string;
  kind: WhatsAppErrorKind | 'RECOVERED_AS_TEMPLATE';
  template?: string;
  sidRef?: string;
  errorCode?: string;
  correlationId?: string;
  recipient?: string;
  detail?: string;
}

/** One structured, redacted log line per diagnostic. */
export function logWhatsAppDiagnostic(d: WhatsAppDiagnostic): void {
  const line = JSON.stringify({ ...d, detail: d.detail ? redactText(d.detail) : undefined });
  if (d.event === 'whatsapp_send_recovered') console.warn(`[whatsapp] ${line}`);
  else console.error(`[whatsapp] ${line}`);
}

/** A required template is not configured: an explicit, visible failure — nothing is sent instead. */
export function templateConfigMissing(input: {
  feature: string;
  template: string;
  envKey: string;
  recipient?: string | null;
}): { success: false; error: string; errorKind: 'TEMPLATE_CONFIG_MISSING' } {
  const error = `TEMPLATE_CONFIG_MISSING: ${input.feature} needs the approved Twilio template "${input.template}" — set ${input.envKey}.`;
  logWhatsAppDiagnostic({
    event: 'whatsapp_template_config_missing',
    feature: input.feature,
    kind: 'TEMPLATE_CONFIG_MISSING',
    template: input.template,
    detail: input.envKey,
    ...(input.recipient ? { recipient: redactPhone(input.recipient) } : {}),
  });
  return { success: false, error, errorKind: 'TEMPLATE_CONFIG_MISSING' };
}
