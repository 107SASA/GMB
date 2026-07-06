/**
 * One-time cleanup for Issue 1 (review count mismatch with Google Business Profile).
 *
 * Root cause: `/api/reviews/monitor` used to call a legacy, hardcoded mock function
 * (`fetchGoogleReviews` in src/services/reviews.ts) that returned two static fake
 * reviews ("John Doe" / "Jane Smith") on every call and saved them as real Review
 * documents. That route has been fixed to use the real sync pipeline instead
 * (see src/app/api/reviews/monitor/route.ts), but any fake reviews it already wrote
 * to the database need to be removed so counts match Google again.
 *
 * This script ONLY deletes documents that match the exact signature of the mock
 * generator: no providerReviewId (real synced reviews always have one), sourcePlatform
 * 'Google', and reviewer name + rating exactly matching one of the two hardcoded mock
 * entries. It will not touch any real review, including a real reviewer who happens to
 * share one of these names but has a different rating/providerReviewId.
 *
 * Usage:
 *   MONGODB_URI="..." node scripts/cleanup-mock-reviews.js         # dry run (default)
 *   MONGODB_URI="..." node scripts/cleanup-mock-reviews.js --apply # actually delete
 */
const mongoose = require('mongoose');

const MOCK_SIGNATURES = [
  { reviewer: 'John Doe', rating: 5 },
  { reviewer: 'Jane Smith', rating: 2 },
];

async function run() {
  const apply = process.argv.includes('--apply');

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI env var is required.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');

  const db = mongoose.connection.db;
  const collection = db.collection('reviews');

  const query = {
    $or: MOCK_SIGNATURES.map((sig) => ({
      reviewer: sig.reviewer,
      rating: sig.rating,
      sourcePlatform: 'Google',
      $or: [{ providerReviewId: { $exists: false } }, { providerReviewId: null }],
    })),
  };

  const matches = await collection.find(query).toArray();
  console.log(`Found ${matches.length} candidate mock review(s):`);
  for (const m of matches) {
    console.log(`  - _id=${m._id} businessId=${m.businessId} reviewer="${m.reviewer}" rating=${m.rating} createdAt=${m.createdAt}`);
  }

  if (!apply) {
    console.log('\nDry run only — no documents deleted. Re-run with --apply to delete the above.');
  } else if (matches.length > 0) {
    const result = await collection.deleteMany(query);
    console.log(`\nDeleted ${result.deletedCount} mock review document(s).`);
  } else {
    console.log('\nNothing to delete.');
  }

  await mongoose.disconnect();
  console.log('Disconnected.');
}

run().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
