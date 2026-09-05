// One-off backfill: attaches a generated (watermarked, re-hosted) thumbnail
// to existing AI-generated posts that were created before processContentJob
// started generating images (see services/inngest/functions.ts). Scoped to
// a single business by name, matching the "Mulsetu" screenshot this was
// requested for — run again with a different name/id for other businesses.
// Run (on the droplet, or wherever has real DB access):
//   npx -y tsx scripts/backfill_post_thumbnails.ts "Mulsetu"

import fs from 'fs';
import path from 'path';

// Prefer .env.production (what the droplet actually has — see
// documentation: .env.local is deliberately never deployed there) and fall
// back to .env.local (local dev machines). Whichever exists wins; this
// never overrides a var already set in the real process environment.
const envCandidates = ['.env.production', '.env.local'];
const envPath = envCandidates.map((f) => path.resolve(process.cwd(), f)).find((p) => fs.existsSync(p));
if (!envPath) {
  console.error(`No .env.production or .env.local found in ${process.cwd()} — run this from the GMBBoost-audit-engine directory.`);
  process.exit(1);
}
console.log(`Loading env from ${path.basename(envPath)}`);
for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1].trim() in process.env)) process.env[m[1].trim()] = v;
}

async function main() {
  const businessName = process.argv[2];
  if (!businessName) {
    console.error('Usage: npx tsx scripts/backfill_post_thumbnails.ts "<business name>"');
    process.exit(1);
  }

  const dbConnect = (await import('../src/lib/mongodb')).default;
  const Business = (await import('../src/models/Business')).default;
  const Post = (await import('../src/models/Post')).default;
  const { generateThumbnail } = await import('../src/services/ai/imageGenerator');
  const { isStorageConfigured, rehostImageFromUrl } = await import('../src/lib/storage');

  await dbConnect();

  const business = await Business.findOne({ name: businessName });
  if (!business) {
    console.error(`No business found named "${businessName}"`);
    process.exit(1);
  }
  console.log(`Business: ${business.name} (${business._id})`);

  const posts = await Post.find({
    businessId: business._id,
    aiGenerated: true,
    $or: [{ imageUrl: { $exists: false } }, { imageUrl: null }, { imageUrl: '' }],
  });
  console.log(`Found ${posts.length} AI-generated post(s) with no image.`);

  for (const post of posts) {
    const prompt =
      `A professional, photorealistic thumbnail for a ${business.category || 'local business'}'s ` +
      `Google Business post titled "${post.title}". Post content: ${(post.content || '').slice(0, 300)}. ` +
      `Clean, modern, on-brand imagery — no text overlay.`;

    try {
      const generated = await generateThumbnail(prompt);
      if (!generated) {
        console.log(`  [${post._id}] "${post.title}" — generation returned null, skipped.`);
        continue;
      }
      const imageUrl = isStorageConfigured()
        ? await rehostImageFromUrl(generated, `post-thumbnails/${business._id}`)
        : generated;
      await Post.updateOne({ _id: post._id }, { $set: { imageUrl } });
      console.log(`  [${post._id}] "${post.title}" — done (${imageUrl.slice(0, 70)}...)`);
    } catch (e: any) {
      console.error(`  [${post._id}] "${post.title}" — FAILED: ${e?.message}`);
    }
  }

  console.log('Backfill complete.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
