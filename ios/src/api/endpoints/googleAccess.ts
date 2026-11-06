import { z } from 'zod';
import { api } from '../client';

/**
 * GET /api/gbp/access — does Google really let GrowwMatics manage the
 * connected profile? Signed in ≠ allowed: an account that isn't Owner /
 * Manager, or an unverified profile, is refused by Google. Background work
 * (report, posts, reminders) runs only for `verified`.
 */
export const googleAccessSchema = z.object({
  status: z.enum(['not_connected', 'checking', 'verified', 'limited', 'blocked']).catch('verified'),
  reason: z.string().nullable().optional().catch(null),
  detail: z.string().nullable().optional().catch(null),
  googleEmail: z.string().nullable().optional().catch(null),
  checkedAt: z.string().nullable().optional().catch(null),
  reconnect: z.boolean().optional().catch(false),
  copy: z
    .object({
      title: z.string(),
      body: z.string(),
      steps: z.array(z.string()).catch([]),
      reconnect: z.boolean().catch(false),
    })
    .nullable()
    .optional()
    .catch(null),
});
export type GoogleAccess = z.infer<typeof googleAccessSchema>;

export async function fetchGoogleAccess(): Promise<GoogleAccess> {
  const { data } = await api.get('/api/gbp/access');
  return googleAccessSchema.parse(data);
}

/** "Check again" — POST /api/gbp/sync re-runs the Google sync, which re-checks access. */
export async function recheckGoogleAccess(): Promise<void> {
  await api.post('/api/gbp/sync');
}
