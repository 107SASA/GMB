import { z } from 'zod';
import { api } from '../client';

/** Subscription module map — mirrors the backend ModuleKey union. */
export const moduleKeySchema = z.enum([
  'google_ranking_agent',
  'reputation_agent',
  'sales_agent',
  'content_studio',
  'marketing_automation',
]);
export type ModuleKey = z.infer<typeof moduleKeySchema>;

const moduleStateSchema = z.object({
  enabled: z.boolean(),
  activatedAt: z.string().nullable().optional(),
});

export const subscriptionSchema = z.object({
  planType: z.string().nullable().optional(),
  billingStatus: z.string().nullable().optional(),
  // The API returns an object here ({ isActive, endsAt }) — the earlier
  // string type would have failed parsing for any user with a real
  // Subscription doc.
  trialStatus: z
    .object({
      isActive: z.boolean().catch(false),
      endsAt: z.string().nullable().optional(),
    })
    .nullable()
    .catch(null),
  modules: z.record(z.string(), moduleStateSchema).nullable().optional(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const currentUserSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  email: z.string(),
  role: z.string(),
  organizationId: z.string().nullable(),
  activeBusinessId: z.string().nullable(),
  businessIds: z.array(z.string()),
  subscription: subscriptionSchema.nullable(),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

const loginResponseSchema = z.object({
  success: z.literal(true),
  token: z.string(),
  expiresAt: z.string(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

const meResponseSchema = z.object({
  success: z.literal(true),
  user: currentUserSchema,
});

/**
 * POST /api/auth/login — the x-client: mobile header (set globally on the
 * axios instance) makes the backend return the JWT in the body.
 */
export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await api.post('/api/auth/login', { email, password });
  return loginResponseSchema.parse(data);
}

/** GET /api/auth/me — hydrates the signed-in user + subscription state. */
export async function fetchCurrentUser(): Promise<CurrentUser> {
  const { data } = await api.get('/api/auth/me');
  return meResponseSchema.parse(data).user;
}

// --- Forgot password (public, no auth header needed) ------------------------------

/**
 * POST /api/auth/forgot-password — always resolves with a generic message,
 * whether or not the email is registered (the server never leaks that).
 */
export async function requestPasswordResetOtp(email: string): Promise<void> {
  await api.post('/api/auth/forgot-password', { email });
}

/**
 * POST /api/auth/verify-reset-otp — exchanges the emailed OTP for a
 * short-lived (10 min) reset token used by resetPassword below.
 */
export async function verifyResetOtp(email: string, otp: string): Promise<string> {
  const { data } = await api.post('/api/auth/verify-reset-otp', { email, otp });
  return z.object({ success: z.literal(true), resetToken: z.string() }).parse(data).resetToken;
}

/** POST /api/auth/reset-password — sets the new password using the reset token. */
export async function resetPassword(params: {
  resetToken: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<void> {
  await api.post('/api/auth/reset-password', params);
}
