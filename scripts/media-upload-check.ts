/**
 * Photos & Media upload — photo + video through the REAL upload route on a
 * throwaway in-memory MongoDB. Storage is intercepted (nothing leaves the
 * machine); the verified business location comes from the cached field (no
 * Google call).
 *   npx tsx scripts/media-upload-check.ts
 */
import path from 'path';
import sharp from 'sharp';

for (const k of Object.keys(process.env)) if (k.startsWith('DO_SPACES_')) delete process.env[k];

const stored: Array<{ bytes: Buffer; mime: string; prefix: string }> = [];
let ctx: any = null;
const esm = (o: Record<string, unknown>) => { const m: any = { __esModule: true, ...o }; m.default = m; return m; };
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/lib[\\/]storage(\.ts)?$/.test(request)) {
    return esm({
      isStorageConfigured: () => true,
      uploadPublicObject: async (bytes: Buffer, mime: string, prefix: string) => { stored.push({ bytes, mime, prefix }); return `https://cdn.example.invalid/${prefix}/${stored.length}`; },
      rehostImageFromUrl: async () => { throw new Error('disabled'); },
      deleteObject: async () => {},
      keyFromPublicUrl: () => null,
    });
  }
  if (/lib[\\/]tenant(\.ts)?$/.test(request)) return esm({ requireBusinessContext: async () => ctx });
  return origLoad.call(this, request, ...rest);
};
for (const rel of ['src/lib/storage.ts', 'src/lib/tenant.ts']) {
  const filename = path.resolve(rel);
  const m = new Module(filename);
  m.filename = filename; m.loaded = true; m.exports = Module._load(filename);
  require.cache[filename] = m;
}

const results: Array<{ t: string; pass: boolean }> = [];
const check = (t: string, what: string, pass: boolean, detail = '') => { results.push({ t, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  [${t}] ${what}${detail ? ` — ${detail}` : ''}`); };

(async () => {
  const { MongoMemoryServer } = await import('mongodb-memory-server' as string);
  const mem = await MongoMemoryServer.create({ instance: { launchTimeout: 90_000 } });
  process.env.MONGODB_URI = mem.getUri('media_upload_check');
  try {
    const mongoose = (await import('mongoose')).default;
    const dbConnect = (await import('../src/lib/mongodb')).default; await dbConnect();
    const { default: Business } = await import('../src/models/Business');
    const { default: GbpMediaAsset } = await import('../src/models/GbpMediaAsset');
    const { readImageGps } = await import('../src/lib/imageGeotag');
    const uploadRoute = await import('../src/app/api/gbp/media/upload/route');

    const PIN = { lat: 20.00588, lng: 73.76323 };
    const PHONE = { lat: 19.99751, lng: 73.78982 };
    const org = new mongoose.Types.ObjectId();
    const biz: any = await Business.create({
      name: 'Media Biz', category: 'Salon', address: 'Nashik', organizationId: org, userId: new mongoose.Types.ObjectId(), googleConnected: true,
      verifiedLocation: { ...PIN, source: 'gbp_location', verifiedAt: new Date() },
    });
    const noPin: any = await Business.create({ name: 'No Pin', category: 'Salon', address: 'Pune', organizationId: org, userId: new mongoose.Types.ObjectId(), googleConnected: true });
    const as = (b: any) => { ctx = { ok: true, userId: String(new mongoose.Types.ObjectId()), organizationId: String(org), businessId: String(b._id), business: { googleConnected: true } }; };

    const send = async (file: { bytes: Buffer; type: string; name: string }, fields: Record<string, string> = {}) => {
      const fd = new FormData();
      fd.append('file', new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
      fd.append('category', 'ADDITIONAL');
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      const res = await uploadRoute.POST(new Request('http://local.test/api/gbp/media/upload', { method: 'POST', body: fd }));
      return { status: res.status, body: await res.json() as any };
    };
    const app = (p: { lat: number; lng: number }, source: string, acc?: number) => ({
      photoLat: String(p.lat), photoLng: String(p.lng), photoLocationSource: source, ...(acc != null ? { photoLocationAccuracy: String(acc) } : {}),
    });
    const jpeg = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 90, g: 40, b: 20 } } }).jpeg().toBuffer();
    const bareMp4 = Buffer.from('....ftypmp42....moov....mdat....video-bytes');
    const locMov = Buffer.concat([Buffer.from('....ftypqt  ....moov....udta'), Buffer.from('com.apple.quicktime.location.ISO6709'), Buffer.from('....+18.5204+073.8567+560.000/'), Buffer.from('mdat....')]);
    const near = (a: any, b: { lat: number; lng: number }) => !!a && Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4;

    as(biz);
    // Photo — existing behaviour unchanged.
    const p1 = await send({ bytes: jpeg, type: 'image/jpeg', name: 'p.jpg' }, app(PHONE, 'device_at_capture', 15));
    const pStored = stored[stored.length - 1];
    check('P1', 'photo (app camera): phone position at capture written into EXIF and recorded on the asset (unchanged behaviour)',
      p1.status === 200 && p1.body.asset.mediaType === 'photo' && p1.body.asset.geotag.status === 'photo_location_added' &&
      p1.body.asset.geotag.source === 'device_at_capture' && near(await readImageGps(pStored.bytes), PHONE));
    const p2 = await send({ bytes: jpeg, type: 'image/jpeg', name: 'g.jpg' });
    check('P2', 'photo (no location from the app): verified business location written (unchanged behaviour)',
      p2.status === 200 && p2.body.asset.geotag.status === 'business_location_added' && near(await readImageGps(stored[stored.length - 1].bytes), PIN));

    // Video — same flow, same structure.
    const v1 = await send({ bytes: bareMp4, type: 'video/mp4', name: 'v.mp4' }, app(PHONE, 'device_at_capture', 15));
    const g1 = v1.body.asset?.geotag;
    check('V1', 'video recorded in the app: same location rule as photos (phone position at capture) recorded on the asset; video bytes untouched',
      v1.status === 200 && v1.body.asset.mediaType === 'video' && v1.body.asset.category === 'ADDITIONAL' &&
      g1.status === 'video_location_recorded' && g1.source === 'device_at_capture' && near(g1, PHONE) && g1.accuracyM === 15 && !!g1.at &&
      stored[stored.length - 1].bytes.equals(bareMp4) && stored[stored.length - 1].mime === 'video/mp4',
      JSON.stringify(g1));
    const v2 = await send({ bytes: locMov, type: 'video/quicktime', name: 'v.mov' }, app(PHONE, 'device_at_capture', 15));
    check('V2', 'gallery video with its own recorded location: that location wins (same precedence as a photo\'s own GPS)',
      v2.status === 200 && v2.body.asset.geotag.source === 'video_metadata' && near(v2.body.asset.geotag, { lat: 18.5204, lng: 73.8567 }));
    const v3 = await send({ bytes: bareMp4, type: 'video/mp4', name: 'v.mp4' });
    check('V3', 'video with no location from the file or the app: verified business location recorded (same fallback as photos)',
      v3.status === 200 && v3.body.asset.geotag.status === 'video_location_recorded' && v3.body.asset.geotag.source === 'gbp_location' && near(v3.body.asset.geotag, PIN));
    const v4 = await send({ bytes: bareMp4, type: 'video/mp4', name: 'v.mp4' }, app(PHONE, 'device_at_capture', 2000));
    check('V4', 'same validation as photos: an imprecise phone fix (> 500 m) is not used', v4.body.asset.geotag.source === 'gbp_location');
    const v5 = await send({ bytes: bareMp4, type: 'video/mp4', name: 'v.mp4' }, { photoLat: '999', photoLng: '0', photoLocationSource: 'device_at_capture' });
    check('V5', 'implausible coordinates from the client are rejected (same validation)', v5.body.asset.geotag.source === 'gbp_location');
    as(noPin);
    const v6 = await send({ bytes: bareMp4, type: 'video/mp4', name: 'v.mp4' });
    check('V6', 'no location anywhere → nothing recorded, never invented', v6.status === 200 && v6.body.asset.geotag.status === 'video_unmodified' && v6.body.asset.geotag.lat == null);
    as(biz);
    const bad = await send({ bytes: Buffer.from('x'), type: 'video/webm', name: 'v.webm' });
    const cover = await (async () => {
      const fd = new FormData();
      fd.append('file', new File([new Uint8Array(bareMp4)], 'v.mp4', { type: 'video/mp4' }));
      fd.append('category', 'COVER');
      const res = await uploadRoute.POST(new Request('http://local.test/api/gbp/media/upload', { method: 'POST', body: fd }));
      return res.status;
    })();
    check('V7', 'only MP4/MOV accepted; video only as an additional item (not logo/cover)', bad.status === 400 && cover === 400);
    const all: any[] = await GbpMediaAsset.find({ businessId: biz._id }).lean();
    const shapeOk = all.every((a) => a.geotag && typeof a.geotag.status === 'string' && typeof a.geotag.at === 'string');
    check('V8', 'photos and videos land in the same Media collection with the same geotag structure', all.filter((a) => a.mediaType === 'video').length === 5 && all.filter((a) => a.mediaType === 'photo').length === 2 && shapeOk);
  } finally {
    await mem.stop({ doCleanup: true, force: true }).catch(() => {});
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILED: ${failed.map((f) => f.t).join(', ')}` : ''}`);
  process.exit(failed.length ? 1 : 0);
})();
