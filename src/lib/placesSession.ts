/**
 * Google Places Autocomplete session tokens (client side).
 *
 * Without a session token, Google bills every autocomplete request made
 * while the visitor types (Autocomplete – Per Request, $2.83/1k). With one,
 * the keystrokes up to and including the Place Details call that ends the
 * session are billed as a session, and the autocomplete requests themselves
 * are free (Autocomplete Session Usage). A token must be used for exactly
 * one session, so it is rotated once Place Details has been requested.
 */
export function newPlacesSessionToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** Returns the current token (to send with Place Details) and starts a new session. */
export function rotatePlacesSession(ref: { current: string }): string {
  const token = ref.current;
  ref.current = newPlacesSessionToken();
  return token;
}

/** Server side: accept only a plausible token (never forward arbitrary input to Google). */
export function sanitizeSessionToken(raw: string | null | undefined): string | undefined {
  const t = (raw || '').trim();
  return /^[A-Za-z0-9-]{8,64}$/.test(t) ? t : undefined;
}
