import { z } from 'zod';
import { api } from '../client';

/**
 * Account-level surfaces: business settings, notification preferences,
 * integration status, billing/usage, and the user profile. All plain
 * request/response — none of these routes are module-gated.
 */

// --- Business settings -------------------------------------------------------

export const businessDetailSchema = z.object({
  _id: z.string(),
  name: z.string().catch(''),
  category: z.string().nullable().catch(null),
  description: z.string().nullable().catch(null),
  phone: z.string().nullable().catch(null),
  website: z.string().nullable().catch(null),
  address: z.string().nullable().catch(null),
  googleMapsUrl: z.string().nullable().catch(null),
  keywords: z.array(z.string().catch('')).catch([]),
  googleConnected: z.boolean().catch(false),
  integrations: z
    .object({ whatsappNumber: z.string().nullable().catch(null) })
    .nullable()
    .catch(null),
});
export type BusinessDetail = z.infer<typeof businessDetailSchema>;

/** GET /api/business — the active business's full document. */
export async function fetchBusinessDetail(): Promise<BusinessDetail> {
  const { data } = await api.get('/api/business');
  return businessDetailSchema.parse(data);
}

export interface BusinessPatch {
  name: string;
  category: string;
  description: string;
  phone: string;
  website: string;
  address: string;
  keywords: string[];
  'integrations.whatsappNumber': string;
}

/** PATCH /api/business/[id] — ownership checked by id in the path. */
export async function updateBusinessDetail(
  businessId: string,
  patch: BusinessPatch
): Promise<void> {
  await api.patch(`/api/business/${businessId}`, patch);
}

// --- Notification preferences -------------------------------------------------

export const NOTIFICATION_PREFS = [
  { key: 'newLeadWhatsApp', label: 'New lead — WhatsApp' },
  { key: 'newLeadEmail', label: 'New lead — email' },
  { key: 'newReviewEmail', label: 'New review — email' },
  { key: 'criticalReviewWhatsApp', label: 'Critical review — WhatsApp' },
  { key: 'weeklyDigestEmail', label: 'Weekly digest — email' },
  { key: 'campaignCompletedEmail', label: 'Campaign completed — email' },
  { key: 'schedulerLowBufferEmail', label: 'Low post buffer — email' },
] as const;
export type NotificationPrefKey = (typeof NOTIFICATION_PREFS)[number]['key'];
export type NotificationPrefs = Record<NotificationPrefKey, boolean>;

const prefsSchema = z
  .record(z.string(), z.boolean().catch(false))
  .catch({})
  .transform((prefs) => {
    const full = {} as NotificationPrefs;
    for (const { key } of NOTIFICATION_PREFS) full[key] = prefs[key] ?? false;
    return full;
  });

export async function fetchNotificationPrefs(): Promise<NotificationPrefs> {
  const { data } = await api.get('/api/user/notifications');
  return z.object({ preferences: prefsSchema }).parse(data).preferences;
}

export async function updateNotificationPrefs(preferences: NotificationPrefs): Promise<void> {
  await api.patch('/api/user/notifications', { preferences });
}

// --- Integrations status -------------------------------------------------------

export const integrationsSchema = z.object({
  serpapi: z.boolean().catch(false),
  twilio: z.boolean().catch(false),
  groq: z.boolean().catch(false),
  googlePlaces: z.boolean().catch(false),
});
export type IntegrationsStatus = z.infer<typeof integrationsSchema>;

export async function fetchIntegrationsStatus(): Promise<IntegrationsStatus> {
  const { data } = await api.get('/api/integrations/status');
  return integrationsSchema.parse(data);
}

// --- Billing -------------------------------------------------------------------

export const billingStatusSchema = z.object({
  planType: z.string().catch('Free'),
  billingStatus: z.string().catch('Active'),
  trialStatus: z
    .object({
      isActive: z.boolean().catch(false),
      endsAt: z.string().nullable().catch(null),
    })
    .nullable()
    .catch(null),
  modules: z
    .record(z.string(), z.object({ enabled: z.boolean().catch(false) }).nullable().catch(null))
    .catch({}),
  hasPaymentMethod: z.boolean().catch(false),
  currentPeriodEnd: z.string().nullable().catch(null),
});
export type BillingStatus = z.infer<typeof billingStatusSchema>;

export async function fetchBillingStatus(): Promise<BillingStatus> {
  const { data } = await api.get('/api/billing/status');
  return z.object({ subscription: billingStatusSchema }).parse(data).subscription;
}

/** POST /api/billing/cancel — the webhook applies the actual downgrade. */
export async function cancelSubscription(): Promise<void> {
  await api.post('/api/billing/cancel');
}

export const usageSchema = z.object({
  plan: z.string().catch('Free'),
  limits: z.object({
    maxAuditsPerBusiness: z.number().catch(0),
    maxPostsPerMonth: z.number().catch(0),
    maxWhatsAppMessagesPerDay: z.number().catch(0),
    maxAIGenerations: z.number().catch(0),
  }),
  usage: z.object({
    auditsUsed: z.number().catch(0),
    postsUsed: z.number().catch(0),
    whatsappUsed: z.number().catch(0),
    aiGenerationsUsed: z.number().catch(0),
  }),
});
export type Usage = z.infer<typeof usageSchema>;

/** GET /api/user/usage — per-business monthly usage vs plan limits. */
export async function fetchUsage(): Promise<Usage> {
  const { data } = await api.get('/api/user/usage');
  return z.object({ data: usageSchema }).parse(data).data;
}

// --- Profile --------------------------------------------------------------------

export const profileSchema = z.object({
  fullName: z.string().catch(''),
  email: z.string().catch(''),
  phone: z.string().nullable().catch(null),
  companyName: z.string().nullable().catch(null),
  isEmailVerified: z.boolean().catch(false),
  subscriptionPlan: z.string().nullable().catch(null),
  lastLoginAt: z.string().nullable().catch(null),
  createdAt: z.string().nullable().catch(null),
});
export type Profile = z.infer<typeof profileSchema>;

export async function fetchProfile(): Promise<Profile> {
  const { data } = await api.get('/api/user/profile');
  return z.object({ user: profileSchema }).parse(data).user;
}

/** PATCH /api/user/profile — phone must be E.164 (server-validated). */
export async function updateProfile(patch: {
  fullName: string;
  phone: string;
  companyName: string;
}): Promise<void> {
  await api.patch('/api/user/profile', patch);
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<void> {
  await api.post('/api/user/change-password', input);
}
