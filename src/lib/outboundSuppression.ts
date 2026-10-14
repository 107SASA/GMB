/**
 * QA / staging outbound-send suppression — single switch for every channel a
 * migration test can trigger.
 *
 *   QA_SUPPRESS_OUTBOUND_SENDS=true   suppress WhatsApp (Twilio + Meta), push, email
 *   QA_SUPPRESS_WHATSAPP_SENDS=true   legacy flag: WhatsApp only (kept for existing QA scripts)
 *
 * Both are absent from every production env file; with neither set this
 * module changes nothing. The gate sits at the lowest layer that performs the
 * network call (Twilio REST, Meta Graph fetch, Expo push fetch, SMTP/Resend),
 * so no caller can reach a real provider by taking another route.
 *
 * Logging records ONLY channel + kind — never recipients, message text or
 * credentials. The check is read at call time so tests can flip it.
 */
export type OutboundChannel = 'whatsapp' | 'push' | 'email';

export function isOutboundSuppressed(channel: OutboundChannel, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.QA_SUPPRESS_OUTBOUND_SENDS === 'true') return true;
  return channel === 'whatsapp' && env.QA_SUPPRESS_WHATSAPP_SENDS === 'true';
}

let suppressedCount: Record<string, number> = {};

/** Returns true (and logs, rate-limited per channel) when the send must NOT happen. */
export function suppressOutbound(channel: OutboundChannel, kind: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isOutboundSuppressed(channel, env)) return false;
  const n = (suppressedCount[channel] = (suppressedCount[channel] ?? 0) + 1);
  if (n <= 3 || n % 100 === 0) {
    console.warn(`[outbound-suppressed] channel=${channel} kind=${kind} count=${n} (QA suppression is ON — nothing was sent)`);
  }
  return true;
}

/** Test helper. */
export function _resetSuppressionCounters() {
  suppressedCount = {};
}
