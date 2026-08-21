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
  // Google Places id — powers the direct-to-review-page QR code (see
  // components/review-qr-modal.tsx). googlePlaceId is set once GBP is
  // properly connected; placeId is the earlier, pre-connection value from
  // onboarding's Places search. Either is usable for the review-page link.
  googlePlaceId: z.string().nullable().optional(),
  placeId: z.string().nullable().optional(),
  // The business's published Google Business Profile logo, when one exists
  // (see GbpMediaAsset on the backend) — the header/avatar shows this
  // instead of initials whenever it's present.
  logoUrl: z.string().nullable().optional(),
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

/**
 * POST /api/business/delete-workspace — soft-deletes a workspace. The server
 * moves the active-workspace pointer and returns the next one to select (null
 * when none remain).
 */
export async function deleteWorkspace(businessId: string): Promise<{ nextActiveBusinessId: string | null }> {
  const { data } = await api.post('/api/business/delete-workspace', { businessId });
  return z
    .object({ nextActiveBusinessId: z.string().nullable().catch(null) })
    .parse(data);
}
