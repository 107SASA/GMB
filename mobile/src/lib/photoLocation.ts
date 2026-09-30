import * as ImagePicker from 'expo-image-picker';

/**
 * Picks or takes a photo for the Google Business Profile and works out the
 * location that honestly belongs to it:
 *
 *   - Gallery photo → the photo's OWN GPS from its EXIF (where it was taken).
 *     Compressing on the phone strips EXIF from the file, so the app sends it
 *     alongside the upload. Android may hide photo locations from apps
 *     (system privacy setting) — then nothing is sent.
 *   - Photo taken in the app camera → the phone's position at that moment
 *     (iOS camera EXIF carries no GPS). Needs location permission.
 *   - The phone's CURRENT location is never attached to a gallery photo —
 *     it is not where that photo was taken.
 *
 * The server keeps GPS already inside the file first, then this location,
 * then the business's verified Google location — and records which it used.
 */

export interface PhotoLocation {
  lat: number;
  lng: number;
  source: 'photo_exif_app' | 'device_at_capture';
  accuracyM?: number;
}

export interface PickedPhoto {
  uri: string;
  mimeType: string;
  fileName: string;
  location: PhotoLocation | null;
  /** Why no location was attached (shown to the owner), or null. */
  locationNote: string | null;
}

const plausible = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** "19/1,59/1,5103/100" | "19 59 51.03" | 19.9975 → decimal degrees. */
function toDegrees(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || !v.trim()) return null;
  const parts = v.split(/[,\s]+/).filter(Boolean).map((p) => {
    const [n, d] = p.split('/').map(Number);
    return d ? n / d : n;
  });
  if (parts.some((x) => !Number.isFinite(x))) return null;
  if (parts.length === 1) return parts[0];
  return (parts[0] || 0) + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600;
}

/** GPS from an ImagePicker `exif` object — iOS nests it under "{GPS}", Android uses flat GPS* tags. */
export function gpsFromPickerExif(exif: Record<string, any> | null | undefined): { lat: number; lng: number } | null {
  if (!exif) return null;
  const ios = exif['{GPS}'];
  const lat = toDegrees(ios?.Latitude ?? exif.GPSLatitude);
  const lng = toDegrees(ios?.Longitude ?? exif.GPSLongitude);
  if (lat == null || lng == null) return null;
  const latRef = String(ios?.LatitudeRef ?? exif.GPSLatitudeRef ?? 'N').toUpperCase();
  const lngRef = String(ios?.LongitudeRef ?? exif.GPSLongitudeRef ?? 'E').toUpperCase();
  const la = Math.abs(lat) * (latRef.startsWith('S') || lat < 0 ? -1 : 1);
  const ln = Math.abs(lng) * (lngRef.startsWith('W') || lng < 0 ? -1 : 1);
  return plausible(la, ln) ? { lat: Math.round(la * 1e6) / 1e6, lng: Math.round(ln * 1e6) / 1e6 } : null;
}

/** Phone position via expo-location — null if the module is missing (older app build) or permission is denied. */
async function devicePosition(): Promise<{ lat: number; lng: number; accuracyM?: number } | null> {
  try {
    const Location = await import('expo-location');
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const { latitude, longitude, accuracy } = pos.coords;
    return plausible(latitude, longitude) ? { lat: latitude, lng: longitude, ...(accuracy != null ? { accuracyM: Math.round(accuracy) } : {}) } : null;
  } catch {
    return null;
  }
}

const asPicked = (asset: ImagePicker.ImagePickerAsset, location: PhotoLocation | null, note: string | null): PickedPhoto => ({
  uri: asset.uri,
  mimeType: asset.mimeType ?? 'image/jpeg',
  fileName: asset.fileName ?? `photo-${Date.now()}.jpg`,
  location,
  locationNote: note,
});

/** Gallery pick. Returns null when cancelled; throws Error('permission') when library access is denied. */
export async function pickPhotoFromLibrary(): Promise<PickedPhoto | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('permission');
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, exif: true });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  const gps = gpsFromPickerExif(asset.exif as Record<string, any> | null | undefined);
  return gps
    ? asPicked(asset, { ...gps, source: 'photo_exif_app' }, null)
    : asPicked(asset, null, 'This photo has no location of its own that the phone shared.');
}

/** In-app camera. The phone's position is read while the camera is open (the moment of capture). */
export async function takePhotoWithCamera(): Promise<PickedPhoto | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('permission');
  const position = devicePosition(); // started now, awaited after capture
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85, exif: true });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  const gps = gpsFromPickerExif(asset.exif as Record<string, any> | null | undefined);
  if (gps) return asPicked(asset, { ...gps, source: 'photo_exif_app' }, null);
  const pos = await position;
  return pos
    ? asPicked(asset, { lat: pos.lat, lng: pos.lng, source: 'device_at_capture', ...(pos.accuracyM != null ? { accuracyM: pos.accuracyM } : {}) }, null)
    : asPicked(asset, null, 'Location permission was not given, so no location was attached from the phone.');
}
