/**
 * Phone normalization for lead capture.
 *
 * Accepts any +country format and only assumes India for bare national
 * numbers.
 */

const DEFAULT_COUNTRY_CODE = '91'; // India — the product's default region

/**
 * Normalizes a raw phone string to E.164 (+<country><number>).
 * Returns null when the input can't be confidently interpreted as a phone
 * number (too short/long, letters, etc.).
 */
export function normalizePhoneE164(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+') || trimmed.startsWith('00');
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('00')) digits = digits.slice(2);
  if (!digits) return null;

  if (hasPlus) {
    // Caller supplied a country code — trust it.
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }

  // National formats: "09876543210" → "9876543210"
  digits = digits.replace(/^0+/, '');

  if (digits.length === 10) {
    return `+${DEFAULT_COUNTRY_CODE}${digits}`;
  }
  // Already carries the default country code without a plus (e.g. "919876543210").
  if (
    digits.length === 10 + DEFAULT_COUNTRY_CODE.length &&
    digits.startsWith(DEFAULT_COUNTRY_CODE)
  ) {
    return `+${digits}`;
  }
  // Other lengths without an explicit + are ambiguous — reject rather than guess.
  return null;
}

/**
 * Key used to decide whether two phone strings are the same lead. Uses the
 * last 10 digits so "98XXXXXX00", "+91 98XXX XXX00" and "098XXXXXX00" all
 * collide. Within a single business this is safe.
 */
export function phoneDedupeKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length < 8) return null;
  return digits.slice(-10);
}
