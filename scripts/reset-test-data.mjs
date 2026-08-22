/**
 * One-time "go live" reset: wipes all test/customer data while leaving the
 * platform itself fully functional — SUPER_ADMIN login and every admin-
 * configured setting (agent personas, pricing, FAQs, etc.) are untouched.
 *
 * Deletes ALL DOCUMENTS from every collection except:
 *   - User: keeps only role === 'SUPER_ADMIN' documents (deletes CLIENT users)
 *   - Platform config collections (never touched): SalesAgentConfig,
 *     ReportAgentConfig, BookingAgentConfig, PlatformSettings, PlanConfig,
 *     Plan, BillingPlan, FAQ, ContentTemplate, AdminInvite
 *
 * Uses the live list of collections from the database itself (via
 * listCollections) rather than a hardcoded/guessed name list, so nothing is
 * silently skipped because of a naming mismatch.
 *
 * SAFETY: defaults to a DRY RUN — prints what WOULD be deleted, deletes
 * nothing. Pass --confirm to actually perform the deletion.
 *
 * Run (dry run first):
 *   MONGODB_URI="mongodb://..." node scripts/reset-test-data.mjs
 * Then for real:
 *   MONGODB_URI="mongodb://..." node scripts/reset-test-data.mjs --confirm
 */
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Prefix the command with MONGODB_URI="..."');
  process.exit(1);
}

const CONFIRMED = process.argv.includes('--confirm');

// Collection names as they actually exist in MongoDB (lowercase, Mongoose's
// default pluralization) for every model that must NOT be touched.
const KEEP_COLLECTIONS = new Set([
  'salesagentconfigs',
  'reportagentconfigs',
  'bookingagentconfigs',
  'platformsettings',
  'planconfigs',
  'plans',
  'billingplans',
  'faqs',
  'contenttemplates',
  'admininvites',
]);

async function main() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  console.log(`Connected to database: ${db.databaseName}`);
  console.log(CONFIRMED ? '*** LIVE RUN — data will be deleted ***' : 'DRY RUN — nothing will be deleted (pass --confirm to actually run)');
  console.log('');

  const collections = await db.listCollections().toArray();
  let totalDeleted = 0;

  for (const { name } of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    if (name.startsWith('system.')) continue;

    if (KEEP_COLLECTIONS.has(name.toLowerCase())) {
      const count = await db.collection(name).countDocuments();
      console.log(`  KEEP    ${name} (${count} docs untouched — platform config)`);
      continue;
    }

    if (name.toLowerCase() === 'users') {
      const clientCount = await db.collection(name).countDocuments({ role: { $ne: 'SUPER_ADMIN' } });
      const adminCount = await db.collection(name).countDocuments({ role: 'SUPER_ADMIN' });
      console.log(`  ${CONFIRMED ? 'DELETE ' : 'WOULD DELETE'} ${name}: ${clientCount} client user(s) (keeping ${adminCount} SUPER_ADMIN)`);
      if (CONFIRMED && clientCount > 0) {
        await db.collection(name).deleteMany({ role: { $ne: 'SUPER_ADMIN' } });
      }
      totalDeleted += clientCount;
      continue;
    }

    const count = await db.collection(name).countDocuments();
    if (count === 0) continue;
    console.log(`  ${CONFIRMED ? 'DELETE ' : 'WOULD DELETE'} ${name}: ${count} doc(s)`);
    if (CONFIRMED) {
      await db.collection(name).deleteMany({});
    }
    totalDeleted += count;
  }

  console.log('');
  console.log(CONFIRMED
    ? `Done — deleted ${totalDeleted} document(s) total.`
    : `Dry run complete — would delete ${totalDeleted} document(s) total. Re-run with --confirm to actually delete.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
