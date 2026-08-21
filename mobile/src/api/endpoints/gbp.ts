import { z } from 'zod';
import { api } from '../client';

/**
 * Google Business Profile media (photos/logo/cover) for the active
 * workspace — mirrors src/app/api/gbp/media/{,upload/,[id]/,[id]/publish}
 * route.ts on the web. As of the Aug 2026 CRUD rebuild, this is backed by a
 * local staged→published→failed record (GbpMediaAsset), not a direct live
 * Google read — `status` tells you which. Uploading only ever stages a
 * photo now; publishing to Google is the separate `publishGbpMedia` call
 * below (previously upload could push live automatically).
 */

export const gbpMediaItemSchema = z.object({
  _id: z.string(),
  category: z.enum(['PROFILE', 'COVER', 'ADDITIONAL', 'LOGO']).catch('ADDITIONAL'),
  url: z.string().catch(''),
  status: z.enum(['staged', 'published', 'failed']).catch('staged'),
  googleMediaName: z.string().optional(),
  publishedAt: z.string().optional(),
  failureReason: z.string().optional(),
  createdAt: z.string().optional(),
  /** Future auto-publish date — only meaningful while status is 'staged'. */
  scheduledFor: z.string().nullable().optional(),
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
  // Previously this failure was only a server console.warn — invisible to
  // the app, so a business whose Google reconciliation was failing on every
  // single request saw the same unchanging photo list forever with no way
  // to tell why (Aug 2026 bug report: "still only 4 photos after refresh").
  liveSyncError: z.string().nullable().catch(null),
});

/** GET /api/gbp/media — every staged/published/failed photo for this business. */
export async function fetchGbpMedia(): Promise<{
  media: GbpMediaItem[];
  liveWritesEnabled: boolean;
  liveSyncError: string | null;
}> {
  const { data } = await api.get('/api/gbp/media');
  const parsed = mediaResponseSchema.parse(data);
  if (!parsed.connected) {
    throw new GbpNotConnectedError(parsed.error ?? 'Connect your Google Business Profile to manage media.');
  }
  return { media: parsed.media, liveWritesEnabled: parsed.liveWritesEnabled, liveSyncError: parsed.liveSyncError };
}

export type GbpMediaCategory = 'PROFILE' | 'COVER' | 'ADDITIONAL' | 'LOGO';

const assetResponseSchema = z.object({ success: z.literal(true), asset: gbpMediaItemSchema });

/**
 * POST /api/gbp/media/upload — multipart upload. Always just STAGES the
 * photo (stores it, creates a local record) — it no longer pushes to Google
 * here; call publishGbpMedia with the returned asset's _id when ready.
 */
export async function uploadGbpMedia(params: {
  uri: string;
  mimeType: string;
  fileName: string;
  category: GbpMediaCategory;
}): Promise<GbpMediaItem> {
  const form = new FormData();
  // React Native's FormData accepts this {uri,name,type} shape in place of a Blob.
  form.append('file', { uri: params.uri, name: params.fileName, type: params.mimeType } as unknown as Blob);
  form.append('category', params.category);

  const { data } = await api.post('/api/gbp/media/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return assetResponseSchema.parse(data).asset;
}

/** POST /api/gbp/media/[id]/publish — pushes a staged photo to the live profile. */
export async function publishGbpMedia(assetId: string): Promise<{ asset: GbpMediaItem; liveWriteApplied: boolean }> {
  const { data } = await api.post(`/api/gbp/media/${assetId}/publish`);
  return z
    .object({ success: z.literal(true), asset: gbpMediaItemSchema, liveWriteApplied: z.boolean().catch(false), note: z.string().optional() })
    .parse(data);
}

/** DELETE /api/gbp/media/[id] — removes a photo (local-only if staged, real Google delete if published). */
export async function deleteGbpMedia(assetId: string): Promise<void> {
  await api.delete(`/api/gbp/media/${assetId}`);
}

/**
 * POST /api/gbp/media/[id]/schedule — sets (date) or clears (null) a staged
 * photo's future auto-publish date. Actually publishing it when that date
 * arrives happens server-side (publishScheduledMediaCron), not from the app.
 */
export async function scheduleGbpMedia(assetId: string, date: Date | null): Promise<GbpMediaItem> {
  const { data } = await api.post(`/api/gbp/media/${assetId}/schedule`, {
    scheduledFor: date ? date.toISOString() : null,
  });
  return z.object({ success: z.literal(true), asset: gbpMediaItemSchema }).parse(data).asset;
}

/** POST /api/gbp/disconnect — removes the stored OAuth token for this workspace. */
export async function disconnectGoogle(): Promise<void> {
  await api.post('/api/gbp/disconnect');
}

// --- Profile activity feed ---------------------------------------------------------

export const profileActivitySchema = z.object({
  _id: z.string(),
  type: z.enum(['profile_updated', 'photo_published']),
  title: z.string().catch(''),
  detail: z.string().optional(),
  updatedBy: z.string().catch('You'),
  createdAt: z.string(),
});
export type ProfileActivity = z.infer<typeof profileActivitySchema>;

/** GET /api/gbp/activity — recent real profile-change events (last 10). */
export async function fetchProfileActivity(): Promise<ProfileActivity[]> {
  const { data } = await api.get('/api/gbp/activity');
  return z
    .object({ success: z.literal(true), activity: z.array(profileActivitySchema).catch([]) })
    .parse(data).activity;
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
