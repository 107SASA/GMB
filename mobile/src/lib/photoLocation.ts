import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

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

/**
 * Asks for location permission up front — BEFORE the camera opens. Asking
 * while the camera was opening put two system screens up at once, and Android
 * can then drop the camera result (the photo was taken but never came back).
 */
async function ensureLocationPermission(): Promise<boolean> {
  try {
    const Location = await import('expo-location');
    const current = await Location.getForegroundPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    return (await Location.requestForegroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Phone position via expo-location — null if the module is missing (older app build) or permission is denied. */
async function devicePosition(): Promise<{ lat: number; lng: number; accuracyM?: number } | null> {
  try {
    const Location = await import('expo-location');
    const perm = await Location.getForegroundPermissionsAsync();
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
  const hasLocation = await ensureLocationPermission();
  const position = hasLocation ? devicePosition() : Promise.resolve(null); // started now, awaited after capture
  await markPendingCapture('photo');
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85, exif: true });
  await clearPendingCapture();
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  const gps = gpsFromPickerExif(asset.exif as Record<string, any> | null | undefined);
  if (gps) return asPicked(asset, { ...gps, source: 'photo_exif_app' }, null);
  const pos = await position;
  return pos
    ? asPicked(asset, { lat: pos.lat, lng: pos.lng, source: 'device_at_capture', ...(pos.accuracyM != null ? { accuracyM: pos.accuracyM } : {}) }, null)
    : asPicked(asset, null, 'Location permission was not given, so no location was attached from the phone.');
}

// ── Video — the SAME location rules as photos ─────────────────────────────
//   - Gallery video → only its OWN location, which phones record inside the
//     file; the server reads it from the upload. The phone's current location
//     is never attached (it is not where that video was filmed).
//   - Video recorded in the app camera → the phone's position at that moment.
// The server then applies one policy for photos and videos and records the
// result on the media item.

/** Google Business Profile limits for video (also enforced by the server). */
export const MAX_VIDEO_BYTES = 75 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 30;

export interface PickedVideo extends PickedPhoto {
  durationMs: number | null;
  fileSize: number | null;
}

/** Only MP4 / MOV are accepted by the server; infer from the file name when the picker gives no type. */
function videoMime(asset: ImagePicker.ImagePickerAsset): string | null {
  const t = (asset.mimeType || '').toLowerCase();
  if (t === 'video/mp4' || t === 'video/quicktime') return t;
  const name = (asset.fileName || asset.uri).toLowerCase();
  if (name.endsWith('.mp4') || name.endsWith('.m4v')) return 'video/mp4';
  if (name.endsWith('.mov')) return 'video/quicktime';
  return null;
}

/** Why a video can't be uploaded (shown to the owner), or null when it is fine. */
export function videoProblem(v: PickedVideo): string | null {
  if (!v.mimeType) return 'Only MP4 or MOV videos can be uploaded.';
  if (v.fileSize != null && v.fileSize > MAX_VIDEO_BYTES) return 'This video is larger than 75 MB. Please choose a shorter or smaller video.';
  if (v.durationMs != null && v.durationMs > MAX_VIDEO_SECONDS * 1000 + 500) return `Google accepts videos up to ${MAX_VIDEO_SECONDS} seconds. Please choose a shorter video.`;
  return null;
}

const asPickedVideo = (asset: ImagePicker.ImagePickerAsset, location: PhotoLocation | null, note: string | null): PickedVideo => {
  const mime = videoMime(asset);
  return {
    uri: asset.uri,
    mimeType: mime ?? '',
    fileName: asset.fileName ?? `video-${Date.now()}.${mime === 'video/quicktime' ? 'mov' : 'mp4'}`,
    location,
    locationNote: note,
    durationMs: asset.duration ?? null,
    fileSize: asset.fileSize ?? null,
  };
};

/** Gallery video. Returns null when cancelled; throws Error('permission') when library access is denied. */
export async function pickVideoFromLibrary(): Promise<PickedVideo | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('permission');
  // iOS exports gallery videos with the Passthrough preset by default: the original
  // file, including the location the camera recorded in it, is kept.
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
  if (result.canceled || result.assets.length === 0) return null;
  return asPickedVideo(result.assets[0], null, 'A location the phone recorded inside the video is kept.');
}

/** In-app camera video. The phone's position is read while the camera is open (the moment of capture). */
export async function recordVideoWithCamera(): Promise<PickedVideo | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('permission');
  const hasLocation = await ensureLocationPermission();
  const position = hasLocation ? devicePosition() : Promise.resolve(null); // started now, awaited after recording
  await markPendingCapture('video');
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: MAX_VIDEO_SECONDS });
  await clearPendingCapture();
  if (result.canceled || result.assets.length === 0) return null;
  const pos = await position;
  return pos
    ? asPickedVideo(result.assets[0], { lat: pos.lat, lng: pos.lng, source: 'device_at_capture', ...(pos.accuracyM != null ? { accuracyM: pos.accuracyM } : {}) }, null)
    : asPickedVideo(result.assets[0], null, 'Location permission was not given, so no location was attached from the phone.');
}


// ── Android: recover a capture after the app was closed by the system ─────
// While the camera app is open, Android may close this app to free memory.
// The photo/video is then delivered on the NEXT start via
// ImagePicker.getPendingResultAsync() — without collecting it, the owner took
// a photo and nothing happened. A small marker (set just before the camera
// opens) says it came from the Photos & Videos upload, so nothing else is
// ever uploaded by mistake.

const PENDING_CAPTURE_KEY = 'gbp-media-pending-capture';
const PENDING_MAX_AGE_MS = 15 * 60 * 1000;

async function markPendingCapture(kind: 'photo' | 'video') {
  if (Platform.OS !== 'android') return;
  try { await AsyncStorage.setItem(PENDING_CAPTURE_KEY, JSON.stringify({ kind, at: Date.now() })); } catch { /* best-effort */ }
}
async function clearPendingCapture() {
  if (Platform.OS !== 'android') return;
  try { await AsyncStorage.removeItem(PENDING_CAPTURE_KEY); } catch { /* best-effort */ }
}

export type RecoveredCapture = { kind: 'photo'; picked: PickedPhoto } | { kind: 'video'; picked: PickedVideo };

/** A photo/video taken in the app camera before Android restarted the app, or null. Android only. */
export async function recoverPendingCapture(): Promise<RecoveredCapture | null> {
  if (Platform.OS !== 'android') return null;
  let marker: { kind: 'photo' | 'video'; at: number } | null = null;
  try {
    const raw = await AsyncStorage.getItem(PENDING_CAPTURE_KEY);
    marker = raw ? JSON.parse(raw) : null;
  } catch { /* ignore */ }
  if (!marker || Date.now() - marker.at > PENDING_MAX_AGE_MS) {
    await clearPendingCapture();
    return null;
  }
  const result = await ImagePicker.getPendingResultAsync().catch(() => null);
  await clearPendingCapture();
  if (!result || !('assets' in result) || result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  // The app restarted seconds after the capture — the phone is still where it was taken.
  const pos = await devicePosition();
  const atCapture = pos ? { lat: pos.lat, lng: pos.lng, source: 'device_at_capture' as const, ...(pos.accuracyM != null ? { accuracyM: pos.accuracyM } : {}) } : null;
  if (marker.kind === 'video' || asset.type === 'video') {
    return { kind: 'video', picked: asPickedVideo(asset, atCapture, atCapture ? null : 'No location was attached from the phone.') };
  }
  const gps = gpsFromPickerExif(asset.exif as Record<string, any> | null | undefined);
  return {
    kind: 'photo',
    picked: gps ? asPicked(asset, { ...gps, source: 'photo_exif_app' }, null) : asPicked(asset, atCapture, atCapture ? null : 'No location was attached from the phone.'),
  };
}
