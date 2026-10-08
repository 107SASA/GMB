/**
 * Google error classification — pure (runs under `node --test`).
 *
 * A failed Google request must never be read as a fact about the business:
 * a 403 because the Verifications API is not enabled is NOT a suspension, and
 * a billing outage is NOT "no services". These helpers turn an HTTP status +
 * body into a category the sync and the health model can act on safely.
 */
import type { GoogleErrorCategory, SectionError } from './types.ts';

/** Thrown by the Google fetchers; carries the classification. */
export class GoogleApiRequestError extends Error {
  category: GoogleErrorCategory;
  httpStatus: number | null;
  constructor(category: GoogleErrorCategory, httpStatus: number | null, message: string) {
    super(message);
    this.name = 'GoogleApiRequestError';
    this.category = category;
    this.httpStatus = httpStatus;
  }
}

const CONFIG_PATTERNS = /SERVICE_DISABLED|has not been used in project|is disabled|BILLING_DISABLED|billing|API_KEY_SERVICE_BLOCKED|accessNotConfigured/i;

/** Classify a non-2xx Google API response. */
export function classifyGoogleError(httpStatus: number | null | undefined, body: string = ''): GoogleErrorCategory {
  const s = typeof httpStatus === 'number' ? httpStatus : null;
  if (s == null) return 'TEMPORARY'; // network / no response
  if (CONFIG_PATTERNS.test(body) && (s === 403 || s === 400 || s === 429)) return 'CONFIGURATION';
  if (s === 401) return 'AUTHENTICATION';
  if (s === 403) return 'AUTHORIZATION';
  if (s === 404) return 'NOT_FOUND';
  if (s === 429) return 'RATE_LIMIT';
  if (s === 400 || s === 422) return 'VALIDATION';
  if (s >= 500) return 'TEMPORARY';
  return 'UNKNOWN';
}

/** Short, token-free error text for storage (never logs request headers). */
export function sanitizeErrorMessage(body: string, max = 300): string {
  let msg = body;
  try {
    const j = JSON.parse(body);
    msg = j?.error?.message || j?.error_description || j?.error || body;
  } catch { /* not JSON */ }
  return String(msg)
    .replace(/ya29\.[\w.-]+/g, '[redacted]')
    .replace(/1\/\/[\w.-]+/g, '[redacted]')
    .replace(/Bearer\s+[\w.-]+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function toSectionError(err: unknown): SectionError {
  if (err instanceof GoogleApiRequestError) {
    return { category: err.category, httpStatus: err.httpStatus, message: sanitizeErrorMessage(err.message) };
  }
  const e = err as { name?: string; message?: string };
  if (e?.name === 'GBPAuthError') return { category: 'AUTHENTICATION', httpStatus: null, message: sanitizeErrorMessage(e.message || 'Google authorization failed') };
  if (e?.name === 'GbpTokenRefreshError') return { category: 'TEMPORARY', httpStatus: null, message: sanitizeErrorMessage(e.message || 'Token refresh failed') };
  return { category: 'UNKNOWN', httpStatus: null, message: sanitizeErrorMessage(String(e?.message || err)) };
}

/**
 * OAuth refresh-token failure → what it means.
 *   REVOKED       — invalid_grant: the user revoked access / token expired for good.
 *                   Only this flips the workspace to disconnected.
 *   CONFIGURATION — invalid_client / unauthorized_client: our OAuth app config,
 *                   not the customer's grant. Never disconnect customers for it.
 *   TEMPORARY     — 5xx, 429, network: retry later; keep the connection.
 */
export type TokenRefreshFailure = 'REVOKED' | 'CONFIGURATION' | 'TEMPORARY';

export function classifyTokenRefreshFailure(httpStatus: number | null | undefined, body: string = ''): TokenRefreshFailure {
  let error = '';
  try { error = String(JSON.parse(body)?.error || ''); } catch { /* not JSON */ }
  if (error === 'invalid_grant') return 'REVOKED';
  if (error === 'invalid_client' || error === 'unauthorized_client' || error === 'invalid_request') return 'CONFIGURATION';
  const s = typeof httpStatus === 'number' ? httpStatus : null;
  if (s == null || s >= 500 || s === 429) return 'TEMPORARY';
  // Any other 4xx without invalid_grant is not proof the customer revoked
  // access, so it never disconnects the workspace.
  return 'CONFIGURATION';
}
