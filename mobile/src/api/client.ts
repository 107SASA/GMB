import axios, { AxiosError } from 'axios';

/**
 * Axios instance shared by every endpoint module.
 *
 * Every request carries:
 *   - Authorization: Bearer <jwt>   (session token, set by AuthContext)
 *   - x-business-id: <id>           (active workspace, set by BusinessContext)
 *   - x-client: mobile              (tells the backend to return tokens in the
 *                                    body instead of setting cookies)
 *
 * On a 401 from any authenticated endpoint the registered unauthorized
 * handler runs (AuthContext clears the stored token and routes to login).
 */

const baseURL = process.env.EXPO_PUBLIC_API_URL;

if (!baseURL) {
  // Fail loudly in development — a missing base URL otherwise surfaces as
  // confusing "Network Error" messages on the login screen.
  console.warn(
    'EXPO_PUBLIC_API_URL is not set. Copy .env.example to .env and point it at your Next.js server.'
  );
}

export const api = axios.create({
  baseURL,
  timeout: 30_000,
  headers: { 'x-client': 'mobile' },
});

// --- Mutable request context (kept in module scope so interceptors are sync) ---

let authToken: string | null = null;
let activeBusinessId: string | null = null;
let onUnauthorized: (() => void) | null = null;
let onModuleLocked: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** For non-axios consumers that must authenticate (e.g. <Image> headers). */
export function getAuthToken(): string | null {
  return authToken;
}

export function setActiveBusinessIdHeader(businessId: string | null): void {
  activeBusinessId = businessId;
}

/** AuthContext registers its logout handler here. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/**
 * AuthContext registers a refresh handler here: a 403 MODULE_LOCKED means
 * this client's entitlements are stale (e.g. plan changed on the website) —
 * re-pulling /api/auth/me makes the locked UI take over.
 */
export function setModuleLockedHandler(handler: (() => void) | null): void {
  onModuleLocked = handler;
}

/** True when the error is the server's machine-readable module gate. */
export function isModuleLockedError(error: unknown): boolean {
  return (
    axios.isAxiosError(error) &&
    error.response?.status === 403 &&
    (error.response.data as { error?: string } | undefined)?.error === 'MODULE_LOCKED'
  );
}

api.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.set('Authorization', `Bearer ${authToken}`);
  }
  if (activeBusinessId) {
    config.headers.set('x-business-id', activeBusinessId);
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const status = error.response?.status;
    const url = error.config?.url ?? '';
    // A 401 from login just means bad credentials — only an expired/revoked
    // session on other endpoints should force a logout.
    if (status === 401 && !url.includes('/api/auth/login')) {
      onUnauthorized?.();
    }
    if (isModuleLockedError(error)) {
      onModuleLocked?.();
    }
    return Promise.reject(error);
  }
);

/** Extracts the backend's `{ error: string }` message when present. */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    // Neutral locked copy (store compliance) instead of the raw code.
    if (isModuleLockedError(error)) {
      return "This feature isn't included in your current plan.";
    }
    const data = error.response?.data as { error?: string } | undefined;
    if (data?.error) return data.error;
    if (!error.response) return 'Cannot reach the server. Check your connection and API URL.';
  }
  return fallback;
}
