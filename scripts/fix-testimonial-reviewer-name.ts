/**
 * One-time fix: Testimonial was originally shaped with a `customerName`
 * field (an early, since-corrected design — see src/models/Testimonial.ts)
 * before being renamed to `reviewerName`. Any document created against the
 * old shape still has `customerName` in Mongo and no `reviewerName`, which
 * crashes the public showcase page (`r.reviewerName.charAt(...)`) since the
 * new schema/UI only ever reads `reviewerName`.
 *
 * This renames the field in place on any document missing `reviewerName`.
 * Idempotent — a second run finds nothing left to fix.
 *
 * Run once:  npx tsx scripts/fix-testimonial-reviewer-name.ts
 */
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf-8');
  envConfig.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[match[1]] = val;
    }
  });
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not found in .env.local');
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const col = db.collection('testimonials');

  const total = await col.countDocuments({});
  console.log(`testimonials collection: ${total} document(s) total`);

  const broken = await col.find({ reviewerName: { $exists: false } }).toArray();
  console.log(`${broken.length} document(s) missing reviewerName:`);
  for (const doc of broken) {
    console.log(' -', doc._id.toString(), 'customerName:', (doc as any).customerName);
  }

  if (broken.length > 0) {
    const res = await col.updateMany(
      { reviewerName: { $exists: false }, customerName: { $exists: true } },
      [{ $set: { reviewerName: '$customerName' } }, { $unset: 'customerName' }],
    );
    console.log(`Fixed ${res.modifiedCount} document(s).`);

    // Anything still missing reviewerName has no customerName either —
    // give it a safe placeholder rather than leaving the field absent.
    const stillBroken = await col.updateMany(
      { reviewerName: { $exists: false } },
      { $set: { reviewerName: 'A GrowwMatics client' } },
    );
    if (stillBroken.modifiedCount > 0) {
      console.log(`Placeholder-filled ${stillBroken.modifiedCount} document(s) with no name at all.`);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
