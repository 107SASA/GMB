import { cropKeepingMetadata, geotagMedia, isPlausibleCoord, type GeotagResult, type PhotoLocation, type VerifiedLocation } from '@/lib/imageGeotag';

/**
 * Server-side processing for a Photos-section upload before it is stored:
 * cover/logo are cropped to Google's sizes here (keeping EXIF, incl. GPS —
 * the old browser canvas crop stripped it), then the geotag policy runs.
 * The stored bytes are exactly what Google later fetches when the asset is
 * published or used in a post.
 */

// Google's recommended sizes (same values the browser crop used).
export const COVER_SIZE = { width: 1024, height: 576 };
export const LOGO_SIZE = { width: 720, height: 720 };

export async function prepareGalleryMedia(input: {
  buffer: Buffer;
  mime: string;
  category: 'PROFILE' | 'COVER' | 'ADDITIONAL' | 'LOGO';
  location: VerifiedLocation | null;
  /** From the mobile app (photo EXIF / in-app camera position). */
  photoLocation?: PhotoLocation | null;
}): Promise<{ buffer: Buffer; mime: string; geotag: GeotagResult; cropped: boolean }> {
  let { buffer, mime } = input;
  let cropped = false;
  if (mime.startsWith('image/') && (input.category === 'COVER' || input.category === 'LOGO')) {
    const size = input.category === 'COVER' ? COVER_SIZE : LOGO_SIZE;
    try {
      buffer = await cropKeepingMetadata(buffer, size.width, size.height);
      mime = 'image/jpeg';
      cropped = true;
    } catch (err: any) {
      console.warn('[mediaUpload] crop failed — storing the original:', err?.message);
    }
  }
  const g = await geotagMedia(buffer, mime, input.location, input.photoLocation ?? null);
  return { ...g, cropped };
}

/** Parse the optional photo-location form fields sent by the mobile app. */
export function photoLocationFromForm(form: FormData): PhotoLocation | null {
  const lat = Number(form.get('photoLat'));
  const lng = Number(form.get('photoLng'));
  const source = String(form.get('photoLocationSource') || '');
  if (!isPlausibleCoord(lat, lng) || (source !== 'photo_exif_app' && source !== 'device_at_capture')) return null;
  const acc = Number(form.get('photoLocationAccuracy'));
  return { lat, lng, source, ...(Number.isFinite(acc) && acc > 0 ? { accuracyM: Math.round(acc) } : {}) };
}
