/**
 * One-time: shrink oversized post thumbnails already stored as base64 data-URLs.
 * Gemini returned ~2 MB PNGs; this resizes them to ~150 KB JPEGs in place so
 * content lists stay light. Idempotent — small images are skipped.
 *
 * Usage: node scripts/compressPostThumbnails.mjs
 */
import fs from 'fs';
import mongoose from 'mongoose';
import sharp from 'sharp';

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) { let v = m[2].trim().replace(/^["']|["']$/g, ''); if (!(m[1] in process.env)) process.env[m[1]] = v; }
  }
}
loadEnv('.env.local'); loadEnv('.env.production');

const THRESHOLD = 300 * 1024; // only compress data-URLs larger than ~300 KB

async function main() {
  const db = (await mongoose.connect(process.env.MONGODB_URI)).connection.db;
  const posts = db.collection('posts');
  const cursor = posts.find(
    { imageUrl: { $regex: '^data:' } },
    { projection: { imageUrl: 1 } }
  );

  let scanned = 0, compressed = 0, skipped = 0, saved = 0;
  while (await cursor.hasNext()) {
    const p = await cursor.next();
    scanned++;
    const url = p.imageUrl;
    if (!url || url.length < THRESHOLD) { skipped++; continue; }
    const b64 = url.slice(url.indexOf(',') + 1);
    try {
      const out = await sharp(Buffer.from(b64, 'base64'))
        .resize({ width: 1080, height: 1080, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      const newUrl = `data:image/jpeg;base64,${out.toString('base64')}`;
      if (newUrl.length < url.length) {
        await posts.updateOne({ _id: p._id }, { $set: { imageUrl: newUrl } });
        compressed++;
        saved += url.length - newUrl.length;
      } else { skipped++; }
    } catch (e) {
      console.warn('skip', p._id.toString(), e.message);
      skipped++;
    }
  }
  console.log(`scanned ${scanned}, compressed ${compressed}, skipped ${skipped}, freed ~${Math.round(saved / 1024 / 1024)} MB`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
