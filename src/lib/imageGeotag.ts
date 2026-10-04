import sharp from 'sharp';

/**
 * EXIF / GPS handling for every image GrowwMatics sends to a Google Business
 * Profile (gallery uploads, cover/logo, weekly-post images).
 *
 * Policy:
 *  - GPS already in a customer's photo is kept exactly as it is (bytes untouched).
 *  - The photo's own EXIF, when the app reports it because the file lost it,
 *    is written next.
 *  - Otherwise the business's VERIFIED Google location (the connected profile's
 *    map pin, or Google Places for its place id) is written. The employee's
 *    current phone GPS is not a substitute for that pin. It is used only when
 *    Google has not confirmed a business location. Nothing is invented.
 *  - Every result says what happened (status + coordinates + source), so it
 *    can be recorded on the asset / post.
 *  - JPEG pixels are never re-encoded to add GPS: only the EXIF segment is
 *    replaced. PNG / WebP are re-encoded (PNG losslessly, WebP at quality 95).
 *  - Videos follow the SAME precedence (the video's own recorded location →
 *    the location the app read for it → the verified business location), but
 *    the video file itself is stored unmodified: the location is recorded on
 *    the asset (status 'video_location_recorded'), not written into the file.
 *
 * Geotags are supporting metadata only. Google may strip EXIF from photos it
 * displays and does not document it as a ranking signal — never promise a
 * ranking effect.
 */

export interface GeoPoint { lat: number; lng: number }
/**
 * A location the mobile app read for THIS photo: the photo's own EXIF GPS
 * (re-compression on the phone strips it from the file), or the phone's
 * position at the moment the photo was taken in the app camera. Never the
 * phone's location for a photo picked from the gallery.
 */
export interface PhotoLocation extends GeoPoint { source: 'photo_exif_app' | 'device_at_capture'; accuracyM?: number }

export interface VerifiedLocation extends GeoPoint { source: 'gbp_location' | 'google_places'; placeId?: string; verifiedAt?: string }

export type GeotagStatus =
  | 'original_gps_preserved'
  | 'photo_location_added'
  | 'business_location_added'
  | 'none'
  /** Video: no location recorded (none in the file, none from the app, no verified business location). */
  | 'video_unmodified'
  /** Video: location recorded on the asset with the photo precedence; the file itself is not modified. */
  | 'video_location_recorded';

export interface GeotagResult {
  status: GeotagStatus;
  lat?: number;
  lng?: number;
  /** Where the coordinates came from: the photo itself, or the verified Google location. */
  source?: 'photo_exif' | 'video_metadata' | PhotoLocation['source'] | VerifiedLocation['source'];
  /** Reported accuracy (metres) of a phone-supplied location. */
  accuracyM?: number;
  /** Place id of the verified business location, when that pin was written. */
  placeId?: string;
  reason?: string;
  at: string;
}

export function isPlausibleCoord(lat: unknown, lng: unknown): lat is number {
  return typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

// ── EXIF (TIFF) parsing ─────────────────────────────────────────────────────

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
const TAG_NAMES: Record<string, Record<number, string>> = {
  IFD0: { 0x010f: 'Make', 0x0110: 'Model', 0x0112: 'Orientation', 0x011a: 'XResolution', 0x011b: 'YResolution', 0x0128: 'ResolutionUnit', 0x0131: 'Software', 0x0132: 'DateTime', 0x010e: 'ImageDescription', 0x013b: 'Artist', 0x8298: 'Copyright', 0x8769: 'ExifIFDPointer', 0x8825: 'GPSInfoIFDPointer', 0x0213: 'YCbCrPositioning' },
  EXIF: { 0x9000: 'ExifVersion', 0x9003: 'DateTimeOriginal', 0x9004: 'DateTimeDigitized', 0xa001: 'ColorSpace', 0xa002: 'PixelXDimension', 0xa003: 'PixelYDimension', 0x9101: 'ComponentsConfiguration', 0xa000: 'FlashpixVersion' },
  GPS: { 0x0000: 'GPSVersionID', 0x0001: 'GPSLatitudeRef', 0x0002: 'GPSLatitude', 0x0003: 'GPSLongitudeRef', 0x0004: 'GPSLongitude', 0x0005: 'GPSAltitudeRef', 0x0006: 'GPSAltitude', 0x0012: 'GPSMapDatum' },
  IFD1: { 0x0103: 'Compression', 0x0201: 'JPEGInterchangeFormat', 0x0202: 'JPEGInterchangeFormatLength', 0x011a: 'XResolution', 0x011b: 'YResolution', 0x0128: 'ResolutionUnit' },
};

interface Entry { tag: number; type: number; count: number; valueOffset: number }

function tiffReader(exif: Buffer) {
  const base = exif.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? 6 : 0;
  const le = exif.subarray(base, base + 2).toString('latin1') === 'II';
  const u16 = (o: number) => (le ? exif.readUInt16LE(base + o) : exif.readUInt16BE(base + o));
  const u32 = (o: number) => (le ? exif.readUInt32LE(base + o) : exif.readUInt32BE(base + o));
  const ifd = (off: number): { entries: Entry[]; next: number } => {
    if (!off || base + off + 2 > exif.length) return { entries: [], next: 0 };
    const n = u16(off);
    const entries: Entry[] = [];
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (base + e + 12 > exif.length) break;
      const type = u16(e + 2), count = u32(e + 4);
      const size = (TYPE_SIZE[type] || 1) * count;
      entries.push({ tag: u16(e), type, count, valueOffset: size <= 4 ? e + 8 : u32(e + 8) });
    }
    const nextAt = off + 2 + n * 12;
    return { entries, next: base + nextAt + 4 <= exif.length ? u32(nextAt) : 0 };
  };
  const rationals = (en: Entry) => Array.from({ length: en.count }, (_, i) => {
    const d = u32(en.valueOffset + i * 8 + 4);
    return d ? u32(en.valueOffset + i * 8) / d : 0;
  });
  const ascii = (en: Entry) => exif.subarray(base + en.valueOffset, base + en.valueOffset + en.count).toString('latin1').replace(/\0+$/, '');
  const long = (en: Entry) => (en.type === 3 ? u16(en.valueOffset) : u32(en.valueOffset));
  const ok = ['II', 'MM'].includes(exif.subarray(base, base + 2).toString('latin1'));
  return { ok, ifd, rationals, ascii, long, first: ok ? u32(4) : 0 };
}

/** Decimal GPS from a raw EXIF block (sharp `metadata().exif`), or null. Pure. */
export function parseExifGps(exif: Buffer | undefined | null): GeoPoint | null {
  if (!exif || exif.length < 14) return null;
  try {
    const t = tiffReader(exif);
    if (!t.ok) return null;
    const gpsPtr = t.ifd(t.first).entries.find((e) => e.tag === 0x8825);
    if (!gpsPtr) return null;
    const g = t.ifd(t.long(gpsPtr)).entries;
    const get = (tag: number) => g.find((e) => e.tag === tag);
    const latR = get(1), lat = get(2), lngR = get(3), lng = get(4);
    if (!lat || !lng) return null;
    const dms = (v: number[]) => (v[0] || 0) + (v[1] || 0) / 60 + (v[2] || 0) / 3600;
    const la = dms(t.rationals(lat)) * (latR && /S/i.test(t.ascii(latR)) ? -1 : 1);
    const ln = dms(t.rationals(lng)) * (lngR && /W/i.test(t.ascii(lngR)) ? -1 : 1);
    return isPlausibleCoord(la, ln) ? { lat: Math.round(la * 1e6) / 1e6, lng: Math.round(ln * 1e6) / 1e6 } : null;
  } catch {
    return null;
  }
}

/** Every EXIF tag present, by IFD (names for common tags, hex otherwise). Pure. */
export function listExifTags(exif: Buffer | undefined | null): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!exif || exif.length < 14) return out;
  try {
    const t = tiffReader(exif);
    if (!t.ok) return out;
    const name = (ifd: string, tag: number) => TAG_NAMES[ifd]?.[tag] ?? `0x${tag.toString(16).padStart(4, '0')}`;
    const ifd0 = t.ifd(t.first);
    out.IFD0 = ifd0.entries.map((e) => name('IFD0', e.tag));
    const exifPtr = ifd0.entries.find((e) => e.tag === 0x8769);
    if (exifPtr) out.EXIF = t.ifd(t.long(exifPtr)).entries.map((e) => name('EXIF', e.tag));
    const gpsPtr = ifd0.entries.find((e) => e.tag === 0x8825);
    if (gpsPtr) out.GPS = t.ifd(t.long(gpsPtr)).entries.map((e) => name('GPS', e.tag));
    if (ifd0.next) out.IFD1 = t.ifd(ifd0.next).entries.map((e) => name('IFD1', e.tag));
  } catch { /* partial result */ }
  return out;
}

/** sharp `withExif` IFD3 (GPS) strings for a point — degrees/minutes/seconds rationals. */
export function exifGpsTags(p: GeoPoint): Record<string, string> {
  const dms = (v: number) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const mFloat = (a - d) * 60;
    const m = Math.floor(mFloat);
    const s = Math.round((mFloat - m) * 60 * 10000);
    return `${d}/1 ${m}/1 ${s}/10000`;
  };
  return {
    GPSLatitudeRef: p.lat < 0 ? 'S' : 'N',
    GPSLatitude: dms(p.lat),
    GPSLongitudeRef: p.lng < 0 ? 'W' : 'E',
    GPSLongitude: dms(p.lng),
    GPSMapDatum: 'WGS-84',
  };
}

export async function readImageGps(buf: Buffer): Promise<GeoPoint | null> {
  try {
    const { exif } = await sharp(buf).metadata();
    return parseExifGps(exif);
  } catch {
    return null;
  }
}

export async function readImageExifTags(buf: Buffer): Promise<Record<string, string[]>> {
  try {
    const { exif } = await sharp(buf).metadata();
    return listExifTags(exif);
  } catch {
    return {};
  }
}

// ── JPEG segment splice (lossless GPS write) ────────────────────────────────

function jpegHeaderSegments(buf: Buffer): Array<{ marker: number; start: number; end: number }> | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const segs: Array<{ marker: number; start: number; end: number }> = [];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const len = buf.readUInt16BE(i + 2);
    segs.push({ marker, start: i, end: i + 2 + len });
    i += 2 + len;
  }
  return segs;
}

const isExifApp1 = (buf: Buffer, s: { marker: number; start: number }) =>
  s.marker === 0xe1 && buf.subarray(s.start + 4, s.start + 10).toString('latin1') === 'Exif\0\0';

/** Replace (or insert) the EXIF APP1 segment of `jpeg` with `app1` — scan data untouched. */
function spliceExif(jpeg: Buffer, app1: Buffer): Buffer | null {
  const segs = jpegHeaderSegments(jpeg);
  if (!segs) return null;
  const keep = segs.filter((s) => !isExifApp1(jpeg, s));
  const afterHeaders = segs.length ? segs[segs.length - 1].end : 2;
  const app0 = keep.find((s) => s.marker === 0xe0);
  const parts: Buffer[] = [jpeg.subarray(0, 2)];
  if (app0) parts.push(jpeg.subarray(app0.start, app0.end));
  parts.push(app1);
  for (const s of keep) if (s !== app0) parts.push(jpeg.subarray(s.start, s.end));
  parts.push(jpeg.subarray(afterHeaders));
  return Buffer.concat(parts);
}

async function jpegWithGps(buf: Buffer, p: GeoPoint): Promise<Buffer | null> {
  // Let libvips build a correct merged EXIF block (existing tags + GPS), then
  // lift only that APP1 segment into the ORIGINAL file.
  const carrier = await sharp(buf).keepMetadata().withExifMerge({ IFD3: exifGpsTags(p) }).jpeg({ quality: 30 }).toBuffer();
  const segs = jpegHeaderSegments(carrier);
  const app1 = segs?.find((s) => isExifApp1(carrier, s));
  if (!app1) return null;
  return spliceExif(buf, carrier.subarray(app1.start, app1.end));
}

// ── Video ───────────────────────────────────────────────────────────────────

/** ISO 6709 location stored by phones in MP4 (©xyz) / MOV (com.apple.quicktime.location.ISO6709). */
export function readVideoLocation(buf: Buffer): GeoPoint | null {
  const scan = (needle: Buffer, span: number) => {
    let from = 0;
    for (;;) {
      const i = buf.indexOf(needle, from);
      if (i < 0) return null;
      const m = buf.subarray(i, i + span).toString('latin1').match(/([+-]\d{1,2}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)/);
      if (m && isPlausibleCoord(Number(m[1]), Number(m[2]))) return { lat: Number(m[1]), lng: Number(m[2]) };
      from = i + needle.length;
    }
  };
  return scan(Buffer.from([0xa9, 0x78, 0x79, 0x7a]), 64) ?? scan(Buffer.from('location.ISO6709', 'latin1'), 400);
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Apply the geotag policy to one media file. Returns the bytes to store and
 * what was done. Never throws — on any processing failure the original bytes
 * are returned with status 'none' and the reason.
 */
export async function geotagMedia(buf: Buffer, mime: string, location: VerifiedLocation | null, photoLocation: PhotoLocation | null = null): Promise<{ buffer: Buffer; mime: string; geotag: GeotagResult }> {
  const at = new Date().toISOString();
  const m = mime.toLowerCase();
  const verified = location && isPlausibleCoord(location.lat, location.lng) ? location : null;
  const reported = photoLocation && isPlausibleCoord(photoLocation.lat, photoLocation.lng) ? photoLocation : null;
  const precisePhone = reported?.source === 'device_at_capture' && (reported.accuracyM ?? 0) <= 500 ? reported : null;
  const photoOwn = reported && reported.source !== 'device_at_capture' ? reported : null;

  if (m.startsWith('video/')) {
    // Same policy and validation as photos; the bytes are never changed.
    const v = readVideoLocation(buf);
    if (v) return { buffer: buf, mime, geotag: { status: 'video_location_recorded', ...v, source: 'video_metadata', reason: 'location recorded in the video by the device that filmed it', at } };
    if (photoOwn) {
      return { buffer: buf, mime, geotag: { status: 'video_location_recorded', lat: photoOwn.lat, lng: photoOwn.lng, source: photoOwn.source, ...(photoOwn.accuracyM != null ? { accuracyM: photoOwn.accuracyM } : {}), reason: 'location recorded on the media item; the video file is not modified', at } };
    }
    if (verified) {
      return { buffer: buf, mime, geotag: { status: 'video_location_recorded', lat: verified.lat, lng: verified.lng, source: verified.source, ...(verified.placeId ? { placeId: verified.placeId } : {}), reason: 'verified business location recorded on the media item; the video file is not modified', at } };
    }
    if (precisePhone) {
      return { buffer: buf, mime, geotag: { status: 'video_location_recorded', lat: precisePhone.lat, lng: precisePhone.lng, source: precisePhone.source, ...(precisePhone.accuracyM != null ? { accuracyM: precisePhone.accuracyM } : {}), reason: 'location recorded on the media item; the video file is not modified', at } };
    }
    return { buffer: buf, mime, geotag: { status: 'video_unmodified', reason: 'no location in the video, none from the app, and no verified Google location for the business', at } };
  }
  const own = await readImageGps(buf);
  if (own) return { buffer: buf, mime, geotag: { status: 'original_gps_preserved', ...own, source: 'photo_exif', at } };
  // The photo's own EXIF beats the business pin. The phone's current GPS does
  // not: a verified business location is the publishing location.
  const chosen = photoOwn
    ? { lat: photoOwn.lat, lng: photoOwn.lng, fromPhoto: true as const }
    : verified
      ? { lat: verified.lat, lng: verified.lng, fromPhoto: false as const }
      : precisePhone
        ? { lat: precisePhone.lat, lng: precisePhone.lng, fromPhoto: true as const }
        : null;
  if (!chosen) {
    return { buffer: buf, mime, geotag: { status: 'none', reason: 'no GPS in the image and no verified Google location for the business', at } };
  }
  const point = { lat: chosen.lat, lng: chosen.lng };
  const usePhoto = chosen.fromPhoto;
  try {
    let out: Buffer | null = null;
    if (m === 'image/jpeg' || m === 'image/jpg') out = await jpegWithGps(buf, point);
    else if (m === 'image/png') out = await sharp(buf).keepMetadata().withExifMerge({ IFD3: exifGpsTags(point) }).png().toBuffer();
    else if (m === 'image/webp') out = await sharp(buf).keepMetadata().withExifMerge({ IFD3: exifGpsTags(point) }).webp({ quality: 95 }).toBuffer();
    const check = out ? await readImageGps(out) : null;
    if (!out || !check || Math.abs(check.lat - point.lat) > 1e-4 || Math.abs(check.lng - point.lng) > 1e-4) {
      return { buffer: buf, mime, geotag: { status: 'none', reason: `could not write GPS into ${m}`, at } };
    }
    return {
      buffer: out,
      mime,
      geotag: usePhoto
        ? { status: 'photo_location_added', ...point, source: photoLocation!.source, ...(photoLocation!.accuracyM != null ? { accuracyM: photoLocation!.accuracyM } : {}), at }
        : { status: 'business_location_added', ...point, source: location!.source, ...(location!.placeId ? { placeId: location!.placeId } : {}), at },
    };
  } catch (err: any) {
    return { buffer: buf, mime, geotag: { status: 'none', reason: `GPS write failed: ${String(err?.message || err).slice(0, 120)}`, at } };
  }
}

/**
 * Server-side crop/resize for cover & logo that KEEPS the photo's EXIF (incl.
 * GPS). Orientation is applied to the pixels first, so the result is upright.
 */
export async function cropKeepingMetadata(buf: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(buf).rotate().resize(width, height, { fit: 'cover', position: 'centre' }).keepMetadata().jpeg({ quality: 90 }).toBuffer();
}
