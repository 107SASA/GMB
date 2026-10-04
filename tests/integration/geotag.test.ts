/**
 * EXIF / GPS handling for images sent to Google Business Profile.
 * Run: node --experimental-strip-types --test tests/integration/geotag.test.ts
 * A–D refer to the requested cases: gallery with GPS, gallery without GPS,
 * generated image, resize/compression. (The end-to-end upload → storage →
 * post pipeline is exercised in scripts/content-check.ts.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { geotagMedia, readImageGps, readImageExifTags, exifGpsTags, cropKeepingMetadata, parseExifGps, readVideoLocation, isPlausibleCoord } from '../../src/lib/imageGeotag.ts';
import { watermarkImageBuffer, brandedGraphic } from '../../src/lib/imageWatermark.ts';

const CAMERA = { lat: 19.99751, lng: 73.78982 }; // where the owner's phone took the photo
const BUSINESS = { lat: 20.00588, lng: 73.76323, source: 'gbp_location' as const }; // verified Google pin
const near = (a: { lat: number; lng: number } | null, b: { lat: number; lng: number }) => !!a && Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4;

const plainJpeg = () => sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 120, g: 60, b: 30 } } }).jpeg({ quality: 88 }).toBuffer();
const cameraJpeg = async () => sharp(await plainJpeg()).withExif({ IFD0: { Make: 'TestCam', Model: 'T1' }, IFD3: exifGpsTags(CAMERA) }).jpeg({ quality: 88 }).toBuffer();
const pixels = async (b: Buffer) => sharp(b).raw().toBuffer();
const scanData = (b: Buffer) => b.subarray(b.indexOf(Buffer.from([0xff, 0xda])));

// ── A. Gallery photo that already has GPS ──────────────────────────────────

test('A: GPS in a customer photo is preserved byte-for-byte, never overwritten by the business pin', async () => {
  const cam = await cameraJpeg();
  assert.ok(near(await readImageGps(cam), CAMERA), 'fixture carries camera GPS');
  const r = await geotagMedia(cam, 'image/jpeg', BUSINESS);
  assert.equal(r.geotag.status, 'original_gps_preserved');
  assert.equal(r.geotag.source, 'photo_exif');
  assert.ok(r.buffer.equals(cam), 'bytes untouched');
  assert.ok(near(await readImageGps(r.buffer), CAMERA));
  const tags = await readImageExifTags(r.buffer);
  assert.ok(tags.IFD0?.includes('Make') && tags.IFD0?.includes('Model'), 'other EXIF (camera make/model) kept too');
});

test('A: cover/logo crop happens server-side and keeps the photo GPS (upright pixels)', async () => {
  const cam = await sharp(await plainJpeg()).withExif({ IFD0: { Orientation: '6' }, IFD3: exifGpsTags(CAMERA) }).jpeg().toBuffer();
  const out = await cropKeepingMetadata(cam, 1024, 576);
  const m = await sharp(out).metadata();
  assert.equal(m.width, 1024);
  assert.equal(m.height, 576);
  assert.ok(!m.orientation || m.orientation === 1, `orientation applied to pixels (tag ${m.orientation})`);
  assert.ok(near(await readImageGps(out), CAMERA), 'GPS survives the crop/resize');
  const r = await geotagMedia(out, 'image/jpeg', BUSINESS);
  assert.equal(r.geotag.status, 'original_gps_preserved');
});

// ── B. Gallery photo without GPS ───────────────────────────────────────────

test('B: no GPS + no verified location → image unchanged, NO coordinates invented', async () => {
  const img = await plainJpeg();
  const r = await geotagMedia(img, 'image/jpeg', null);
  assert.equal(r.geotag.status, 'none');
  assert.match(r.geotag.reason!, /no verified Google location/);
  assert.ok(r.buffer.equals(img));
  assert.equal(await readImageGps(r.buffer), null);
  assert.equal((await sharp(r.buffer).metadata()).width, 640, 'still a valid image');
});

test('B: no GPS + verified Google location → that exact location added, recorded, pixels untouched (lossless)', async () => {
  const img = await plainJpeg();
  const r = await geotagMedia(img, 'image/jpeg', BUSINESS);
  assert.equal(r.geotag.status, 'business_location_added');
  assert.equal(r.geotag.source, 'gbp_location');
  assert.deepEqual([r.geotag.lat, r.geotag.lng], [BUSINESS.lat, BUSINESS.lng]);
  assert.ok(near(await readImageGps(r.buffer), BUSINESS));
  assert.ok(scanData(r.buffer).equals(scanData(img)), 'JPEG scan data identical — only the EXIF segment changed');
  assert.ok((await pixels(r.buffer)).equals(await pixels(img)), 'decoded pixels identical');
});

test('B: implausible or null-island coordinates are never written', async () => {
  const img = await plainJpeg();
  for (const bad of [{ lat: 0, lng: 0 }, { lat: 91, lng: 10 }, { lat: NaN, lng: 10 }]) {
    const r = await geotagMedia(img, 'image/jpeg', { ...bad, source: 'gbp_location' });
    assert.equal(r.geotag.status, 'none');
    assert.equal(await readImageGps(r.buffer), null);
  }
  assert.equal(isPlausibleCoord(0, 0), false);
});

test('B: PNG and WebP uploads can carry the verified location too', async () => {
  const base = await plainJpeg();
  for (const [mime, buf] of [['image/png', await sharp(base).png().toBuffer()], ['image/webp', await sharp(base).webp().toBuffer()]] as const) {
    const r = await geotagMedia(buf, mime, BUSINESS);
    assert.equal(r.geotag.status, 'business_location_added', `${mime}: ${r.geotag.reason ?? ''}`);
    assert.ok(near(await readImageGps(r.buffer), BUSINESS), mime);
  }
});

// ── C. Generated image: exactly what metadata it contains ──────────────────

test('C: generated image leaves the watermark step with NO EXIF at all; geotag step adds only GPS', async () => {
  // A generator output that itself carried metadata — the pipeline must not pass it through.
  const generated = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 30, g: 90, b: 200 } } })
    .withExif({ IFD0: { Software: 'SomeImageModel', Make: 'x' } }).png().toBuffer();
  const logo = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 220, g: 20, b: 60, alpha: 1 } } }).png().toBuffer();
  const { buffer, mime } = await watermarkImageBuffer(generated, logo);
  assert.equal(mime, 'image/jpeg');
  assert.deepEqual(await readImageExifTags(buffer), {}, 'no EXIF after the customer-logo composite');
  const r = await geotagMedia(buffer, mime, BUSINESS);
  assert.equal(r.geotag.status, 'business_location_added');
  const tags = await readImageExifTags(r.buffer);
  assert.deepEqual(tags.GPS?.slice().sort(), ['GPSLatitude', 'GPSLatitudeRef', 'GPSLongitude', 'GPSLongitudeRef', 'GPSMapDatum']);
  const ifd0 = tags.IFD0 ?? [];
  assert.ok(!ifd0.includes('Make') && !ifd0.includes('Model') && !ifd0.includes('Software') && !ifd0.includes('DateTime'), `no camera/software identity: ${ifd0.join(',')}`);
  console.log('[C] generated image EXIF after geotag:', JSON.stringify(tags));
});

test('C: branded fallback graphic gets the same treatment', async () => {
  const { buffer, mime } = await brandedGraphic({ headline: 'Tile installation', subline: 'Sahyadri Tile Works', colors: ['#0a7d4f', '#f2a900'] });
  assert.deepEqual(await readImageExifTags(buffer), {});
  const r = await geotagMedia(buffer, mime, BUSINESS);
  assert.ok(near(await readImageGps(r.buffer), BUSINESS));
});

// ── D. Resize / compression ────────────────────────────────────────────────

test('D: a plain sharp resize/re-encode strips EXIF (why every path geotags AFTER processing)', async () => {
  const cam = await cameraJpeg();
  assert.equal(await readImageGps(await sharp(cam).resize(320).jpeg({ quality: 70 }).toBuffer()), null, 'sharp default drops metadata');
  assert.equal(await readImageGps((await watermarkImageBuffer(cam, null)).buffer), null, 'the post-image resize also drops it');
  assert.ok(near(await readImageGps(await sharp(cam).resize(320).keepMetadata().jpeg().toBuffer()), CAMERA), 'keepMetadata keeps it');
});

// ── Parser + video ─────────────────────────────────────────────────────────

test('EXIF parser: southern/western hemispheres and garbage input', async () => {
  const img = await sharp(await plainJpeg()).withExif({ IFD3: exifGpsTags({ lat: -33.86785, lng: -151.20732 }) }).jpeg().toBuffer();
  assert.ok(near(await readImageGps(img), { lat: -33.86785, lng: -151.20732 }));
  assert.equal(parseExifGps(Buffer.from('not exif at all')), null);
  assert.equal(parseExifGps(null), null);
});

test('video: same precedence as photos, bytes NEVER modified — own location → verified business location → phone GPS only if unverified → none', async () => {
  const withLoc = Buffer.concat([Buffer.from('....ftypmp42....moov....udta'), Buffer.from([0, 0, 0, 30, 0xa9, 0x78, 0x79, 0x7a, 0, 18, 0x15, 0xc7]), Buffer.from('+19.9975+073.7898/'), Buffer.from('mdat....')]);
  const bare = Buffer.from('....ftypqt  ....moov....mdat....');
  assert.ok(near(readVideoLocation(withLoc), { lat: 19.9975, lng: 73.7898 }));
  // 1. The video's own recorded location wins (even over the app's and the business pin).
  const own = await geotagMedia(withLoc, 'video/mp4', BUSINESS, { ...CAMERA, lat: 10, lng: 10, source: 'device_at_capture', accuracyM: 5 });
  assert.equal(own.geotag.status, 'video_location_recorded');
  assert.equal(own.geotag.source, 'video_metadata');
  assert.ok(near({ lat: own.geotag.lat!, lng: own.geotag.lng! }, { lat: 19.9975, lng: 73.7898 }));
  assert.ok(own.buffer.equals(withLoc), 'bytes untouched');
  // 2. The phone's current GPS does not replace a verified business location.
  const cam = await geotagMedia(bare, 'video/quicktime', BUSINESS, { ...CAMERA, source: 'device_at_capture', accuracyM: 12 });
  assert.deepEqual([cam.geotag.status, cam.geotag.source, cam.geotag.lat, cam.geotag.lng], ['video_location_recorded', 'gbp_location', BUSINESS.lat, BUSINESS.lng]);
  assert.ok(cam.buffer.equals(bare), 'bytes untouched');
  const phoneOnly = await geotagMedia(bare, 'video/quicktime', null, { ...CAMERA, source: 'device_at_capture', accuracyM: 12 });
  assert.deepEqual([phoneOnly.geotag.status, phoneOnly.geotag.source, phoneOnly.geotag.lat, phoneOnly.geotag.lng, phoneOnly.geotag.accuracyM], ['video_location_recorded', 'device_at_capture', CAMERA.lat, CAMERA.lng, 12]);
  // Same validation as photos: an imprecise phone fix (> 500 m) is not used → business pin.
  const vague = await geotagMedia(bare, 'video/mp4', BUSINESS, { ...CAMERA, source: 'device_at_capture', accuracyM: 900 });
  assert.equal(vague.geotag.source, 'gbp_location');
  // 3. Otherwise the business's VERIFIED Google location.
  const biz = await geotagMedia(bare, 'video/mp4', BUSINESS);
  assert.deepEqual([biz.geotag.status, biz.geotag.source, biz.geotag.lat, biz.geotag.lng], ['video_location_recorded', 'gbp_location', BUSINESS.lat, BUSINESS.lng]);
  assert.ok(biz.buffer.equals(bare));
  // 4. Nothing verified → nothing recorded, never invented. Implausible app coords ignored.
  const none = await geotagMedia(bare, 'video/mp4', null, { lat: 0, lng: 0, source: 'device_at_capture' });
  assert.equal(none.geotag.status, 'video_unmodified');
  assert.equal(none.geotag.lat, undefined);
  assert.match(none.geotag.at, /^\d{4}-\d{2}-\d{2}T/);
});

// ── Location sent by the mobile app ────────────────────────────────────────

test('app-reported photo EXIF location is written when the phone stripped it; recorded as such', async () => {
  const img = await plainJpeg();
  const r = await geotagMedia(img, 'image/jpeg', BUSINESS, { ...CAMERA, source: 'photo_exif_app' });
  assert.equal(r.geotag.status, 'photo_location_added');
  assert.equal(r.geotag.source, 'photo_exif_app');
  assert.ok(near(await readImageGps(r.buffer), CAMERA), 'photo location wins over the business pin');
});

test('in-app camera: phone position does not replace a verified business location; an imprecise fix is ignored', async () => {
  const img = await plainJpeg();
  const good = await geotagMedia(img, 'image/jpeg', BUSINESS, { ...CAMERA, source: 'device_at_capture', accuracyM: 12 });
  assert.equal(good.geotag.status, 'business_location_added');
  assert.ok(near(await readImageGps(good.buffer), BUSINESS));
  const phoneOnly = await geotagMedia(img, 'image/jpeg', null, { ...CAMERA, source: 'device_at_capture', accuracyM: 12 });
  assert.equal(phoneOnly.geotag.status, 'photo_location_added');
  assert.equal(phoneOnly.geotag.accuracyM, 12);
  const vague = await geotagMedia(img, 'image/jpeg', BUSINESS, { ...CAMERA, source: 'device_at_capture', accuracyM: 2500 });
  assert.equal(vague.geotag.status, 'business_location_added');
  assert.ok(near(await readImageGps(vague.buffer), BUSINESS));
});

test('GPS already inside the file always wins over anything the app reports', async () => {
  const cam = await cameraJpeg();
  const r = await geotagMedia(cam, 'image/jpeg', BUSINESS, { lat: 18.5, lng: 73.8, source: 'device_at_capture', accuracyM: 5 });
  assert.equal(r.geotag.status, 'original_gps_preserved');
  assert.ok(r.buffer.equals(cam));
});
