/**
 * Small helpers for turning a stored lead/customer phone string into
 * click-to-call / click-to-chat targets. Kept separate from lib/phone.ts
 * (server-side E.164 normalization for dedupe) so client components can
 * import it without pulling anything heavy.
 */
import { normalizePhoneE164 } from '@/lib/phone';

/** `tel:` href for a raw phone string, or null when it can't be parsed. */
export function telHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e164 = normalizePhoneE164(raw);
  if (e164) return `tel:${e164}`;
  // Fall back to the digits we have — a partial national number still
  // dials on mobile even if we couldn't confidently add a country code.
  const digits = raw.replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : null;
}

/** wa.me deep link (used only where an external WhatsApp handoff is wanted). */
export function waHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e164 = normalizePhoneE164(raw);
  if (!e164) return null;
  return `https://wa.me/${e164.replace('+', '')}`;
}

/** Human-friendly display form — E.164 when we can, else the raw string. */
export function waDisplay(raw: string | null | undefined): string {
  if (!raw) return '';
  return normalizePhoneE164(raw) ?? raw;
}
