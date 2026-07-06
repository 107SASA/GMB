/**
 * Client-side phone parsing for the paste chip and quick-add validation.
 * Mirrors the server's normalizer (src/lib/phone.ts in the backend): default
 * region India, any +country format accepted. The server re-normalizes — this
 * only decides what to offer/submit.
 */
export function parsePhoneCandidate(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  // Digits with common separators only, sane length — rejects prose, URLs, OTPs.
  if (!/^[+(]?[\d\s\-().]{7,22}$/.test(trimmed)) return null;

  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  if (hasPlus) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  digits = digits.replace(/^0+/, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return null;
}
