import { z } from 'zod';
import { api } from '../client';

/**
 * Live Google Business Profile media (photos/logo/cover) for the active
 * workspace — mirrors src/app/api/gbp/media/{,upload/}route.ts on the web.
 */

export const gbpMediaItemSchema = z.object({
  name: z.string().catch(''),
  category: z.enum(['PROFILE', 'COVER', 'ADDITIONAL', 'LOGO']).catch('ADDITIONAL'),
  url: z.string().catch(''),
  thumbnailUrl: z.string().catch(''),
});
export type GbpMediaItem = z.infer<typeof gbpMediaItemSchema>;

/** Thrown when the workspace has no Google Business Profile connected. */
export class GbpNotConnectedError extends Error {}

const mediaResponseSchema = z.object({
  success: z.boolean(),
  connected: z.boolean().catch(false),
  liveWritesEnabled: z.boolean().catch(false),
  media: z.array(gbpMediaItemSchema).catch([]),
  error: z.string().optional(),
});

/** GET /api/gbp/media — the profile's current live photos/logo/cover. */
export async function fetchGbpMedia(): Promise<{ media: GbpMediaItem[]; liveWritesEnabled: boolean }> {
  const { data } = await api.get('/api/gbp/media');
  const parsed = mediaResponseSchema.parse(data);
  if (!parsed.connected) {
    throw new GbpNotConnectedError(parsed.error ?? 'Connect your Google Business Profile to manage media.');
  }
  return { media: parsed.media, liveWritesEnabled: parsed.liveWritesEnabled };
}

export type GbpMediaCategory = 'PROFILE' | 'COVER' | 'ADDITIONAL' | 'LOGO';

/**
 * POST /api/gbp/media/upload — multipart upload. Stores the file on
 * DigitalOcean Spaces and, when GBP_LIVE_WRITES_ENABLED is on, pushes it to
 * the live profile; otherwise `liveWriteApplied` comes back false and `note`
 * explains it was only stored.
 */
export async function uploadGbpMedia(params: {
  uri: string;
  mimeType: string;
  fileName: string;
  category: GbpMediaCategory;
}): Promise<{ url: string; liveWriteApplied: boolean; note?: string }> {
  const form = new FormData();
  // React Native's FormData accepts this {uri,name,type} shape in place of a Blob.
  form.append('file', { uri: params.uri, name: params.fileName, type: params.mimeType } as unknown as Blob);
  form.append('category', params.category);

  const { data } = await api.post('/api/gbp/media/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return z
    .object({
      success: z.literal(true),
      url: z.string(),
      liveWriteApplied: z.boolean().catch(false),
      note: z.string().optional(),
    })
    .parse(data);
}

/** POST /api/gbp/disconnect — removes the stored OAuth token for this workspace. */
export async function disconnectGoogle(): Promise<void> {
  await api.post('/api/gbp/disconnect');
}

// --- Live profile (name/description/phone/website) --------------------------------

export const gbpProfileSchema = z.object({
  locationName: z.string().catch(''),
  title: z.string().catch(''),
  description: z.string().catch(''),
  primaryPhone: z.string().catch(''),
  website: z.string().catch(''),
  primaryCategory: z.string().catch(''),
  address: z.string().catch(''),
});
export type GbpProfile = z.infer<typeof gbpProfileSchema>;

const profileResponseSchema = z.object({
  success: z.boolean(),
  connected: z.boolean().catch(false),
  liveWritesEnabled: z.boolean().catch(false),
  profile: gbpProfileSchema.optional(),
  error: z.string().optional(),
});

/** GET /api/gbp/profile — the live business profile (name, description, phone, website…). */
export async function fetchGbpProfile(): Promise<{ profile: GbpProfile; liveWritesEnabled: boolean }> {
  const { data } = await api.get('/api/gbp/profile');
  const parsed = profileResponseSchema.parse(data);
  if (!parsed.connected || !parsed.profile) {
    throw new GbpNotConnectedError(parsed.error ?? 'Connect your Google Business Profile to edit it.');
  }
  return { profile: parsed.profile, liveWritesEnabled: parsed.liveWritesEnabled };
}

export interface GbpProfileEdits {
  title?: string;
  description?: string;
  primaryPhone?: string;
  website?: string;
}

/**
 * PATCH /api/gbp/profile — always saves to our Business doc; only pushes to
 * the live Google profile when GBP_LIVE_WRITES_ENABLED is on.
 */
export async function updateGbpProfile(edits: GbpProfileEdits): Promise<{ liveWriteApplied: boolean }> {
  const { data } = await api.patch('/api/gbp/profile', edits);
  return z
    .object({ success: z.literal(true), liveWriteApplied: z.boolean().catch(false) })
    .parse(data);
}
