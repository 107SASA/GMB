/**
 * One-shot cleanup: removes all records tagged tenantId: 'demo-tenant'.
 *
 * Run AFTER verifying the new session/tenant fix is working correctly:
 *
 *   node scripts/cleanup-demo-tenant.js
 *
 * Dry-run first (no deletes, just counts):
 *
 *   DRY_RUN=1 node scripts/cleanup-demo-tenant.js
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: '.env.local' });

const DEMO_TENANT = 'demo-tenant';
const DRY_RUN = process.env.DRY_RUN === '1';

const COLLECTIONS = [
  'leads',
  'posts',
  'automationlogs',
  'reviews',
  'businessaiconfigs',
  'conversations',
  'activities',
  'reviewrequests',
  'customers',
  'campaigns',
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set in .env.local');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected to MongoDB');
  console.log(DRY_RUN ? '--- DRY RUN (no deletes) ---' : '--- LIVE RUN ---');

  const db = mongoose.connection.db;
  let grandTotal = 0;

  for (const collName of COLLECTIONS) {
    const coll = db.collection(collName);

    // Check if the collection actually exists
    const exists = await db.listCollections({ name: collName }).hasNext();
    if (!exists) continue;

    const count = await coll.countDocuments({ tenantId: DEMO_TENANT });
    if (count === 0) continue;

    console.log(`${collName}: found ${count} demo-tenant record(s)`);
    grandTotal += count;

    if (!DRY_RUN) {
      const result = await coll.deleteMany({ tenantId: DEMO_TENANT });
      console.log(`  → deleted ${result.deletedCount}`);
    }
  }

  if (grandTotal === 0) {
    console.log('No demo-tenant records found — nothing to clean up.');
  } else if (DRY_RUN) {
    console.log(`\nDry run complete. ${grandTotal} records would be deleted.`);
    console.log('Run without DRY_RUN=1 to execute.');
  } else {
    console.log(`\nCleanup complete. ${grandTotal} demo-tenant records deleted.`);
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
