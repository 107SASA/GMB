/**
 * Outbound-message suppression — one rule for every external messaging
 * provider (Twilio + Meta WhatsApp, Resend/SendGrid email, Expo push). No
 * imports, so tests can load it under plain Node.
 *
 *   QA_SUPPRESS_WHATSAPP_SENDS   Twilio and Meta WhatsApp
 *   QA_SUPPRESS_EMAIL_SENDS      Resend and SendGrid email
 *   QA_SUPPRESS_PUSH_SENDS       Expo push notifications
 *
 * "true" suppresses, "false" sends. Unset: suppressed everywhere except
 * NODE_ENV=production — a local or test process never messages a real person
 * by accident, and production (where these are unset) sends as before. A
 * deliberate local round-trip test sets the flag to "false".
 *
 * Suppressed senders return success without contacting the provider, so the
 * callers' own bookkeeping runs exactly as on a real send.
 */

export type OutboundChannel = 'whatsapp' | 'email' | 'push';

const FLAGS: Record<OutboundChannel, string> = {
  whatsapp: 'QA_SUPPRESS_WHATSAPP_SENDS',
  email: 'QA_SUPPRESS_EMAIL_SENDS',
  push: 'QA_SUPPRESS_PUSH_SENDS',
};

export function outboundSuppressed(channel: OutboundChannel): boolean {
  const value = process.env[FLAGS[channel]]?.trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}
