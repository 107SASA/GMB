import { z } from 'zod';
import { api } from '../client';

const handoffSchema = z.object({
  url: z.string().url(),
  expiresAt: z.string(),
});

/**
 * POST /api/auth/google/mobile-handoff — a single-use, 2-minute link that
 * starts Google Business Profile OAuth for the active workspace in an in-app
 * browser (which has no web session of its own). Uses the bearer token and
 * x-business-id like every other request.
 */
export async function createGoogleConnectLink(): Promise<string> {
  const { data } = await api.post('/api/auth/google/mobile-handoff');
  return handoffSchema.parse(data).url;
}
