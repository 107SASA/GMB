import { z } from 'zod';
import { api } from '../client';

/**
 * GET /api/user/businesses returns the user's populated Business documents.
 * Only the fields the app renders are validated; extra fields pass through.
 */
export const businessSchema = z.object({
  _id: z.string(),
  name: z.string().catch('Unnamed business'),
  category: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
});
export type Business = z.infer<typeof businessSchema>;

const businessesResponseSchema = z.array(
  // Mongoose lean docs serialize _id as a string; be tolerant of nulls in the
  // populated array (deleted businesses leave holes).
  businessSchema.nullable()
);

export async function fetchBusinesses(): Promise<Business[]> {
  const { data } = await api.get('/api/user/businesses');
  return businessesResponseSchema
    .parse(data)
    .filter((b): b is Business => b !== null);
}
