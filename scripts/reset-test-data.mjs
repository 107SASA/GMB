/**
 * Wipes CUSTOMER data while preserving platform configuration.
 *
 * Written for the 2026-07-22 pre-production reset: the cluster had accumulated
 * ~1,560 documents of test/demo data that must not follow us into production.
 *
 * DELETES: every document in every collection listed in WIPE_COLLECTIONS, plus
 *          every user EXCEPT the super admin(s) named in KEEP_USER_EMAILS.
 *
 * PRESERVES (deleting these would break the live install):
 *   - users            the SUPER_ADMIN account — without it you cannot log in
 *                      to /admin at all and must re-run seed-superadmin.mjs
 *   - billingplans     the configured price + razorpayPlanId. Deleting it drops
 *                      you back to the PLAN_FALLBACK price in code and orphans
 *                      the Razorpay plan that customers would subscribe to.
 *   - platformsettings platformName / supportEmail set via Admin -> Settings
 *   - planconfigs      per-plan module limits
 *
 * Collections are only emptied — never dropped — so all indexes and schema
 * remain intact, exactly as required.
 *
 * Usage (dry run — prints the plan, changes nothing):
 *   MONGODB_URI="mongodb://..." node scripts/reset-test-data.mjs
 *
 * Usage (actually delete):
 *   MONGODB_URI="mongodb://..." node scripts/reset-test-data.mjs --confirm
 */
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Prefix the command with MONGODB_URI="..."');
  process.exit(1);
}

/** Accounts that survive the wipe. Everything else in `users` is removed. */
const KEEP_USER_EMAILS = ['studysphere654@gmail.com'];

/** Config collections that are never touched. */
const PRESERVE_COLLECTIONS = new Set([
  'billingplans',
  'platformsettings',
  'planconfigs',
]);

/** Emptied completely. */
const WIPE_COLLECTIONS = [
  'businesses', 'organizations', 'subscriptions', 'subscriptionusages',
  'usagetrackings', 'userlimitoverrides', 'admininvites',
  'audits', 'reportshares',
  'reviews', 'reviewreplies', 'reviewrequests', 'reviewanalytics', 'reviewmonitorlogs',
  'posts', 'contenttemplates', 'contentgenerationlogs', 'seocontents', 'faqs',
  'campaigns', 'customers', 'leads', 'activities', 'followups', 'appointments',
  'conversations', 'conversationthreads', 'messagequeues',
  'whatsappappointments', 'whatsappconversationsummaries', 'businessaiconfigs',
  'gbptokens', 'gbpinsights', 'gbpkeywords',
  'notifications', 'automationlogs', 'aiusagelogs', 'jobqueues',
  'processedwebhookevents', 'demobookings',
];

const isConfirmed = process.argv.includes('--confirm');

async function main() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  console.log(`Connected to database: "${db.databaseName}"\n`);

  const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));
  const plan = [];

  for (const name of WIPE_COLLECTIONS) {
    if (!existing.has(name)) continue;
    const count = await db.collection(name).countDocuments();
    if (count > 0) plan.push({ name, count, keep: 0 });
  }

  // users: keep only the super admin(s)
  const usersTotal = await db.collection('users').countDocuments();
  const usersKeep = await db.collection('users').countDocuments({ email: { $in: KEEP_USER_EMAILS } });
  if (usersKeep === 0) {
    console.error(
      `REFUSING TO RUN: none of ${KEEP_USER_EMAILS.join(', ')} exist in this database.\n` +
        'Deleting every user would lock you out of /admin permanently.'
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(isConfirmed ? '=== DELETING ===' : '=== DRY RUN (pass --confirm to apply) ===');
  console.log('collection'.padEnd(34) + 'delete'.padStart(8) + 'keep'.padStart(8));
  console.log('-'.repeat(50));
  for (const p of plan) console.log(p.name.padEnd(34) + String(p.count).padStart(8) + '0'.padStart(8));
  console.log('users'.padEnd(34) + String(usersTotal - usersKeep).padStart(8) + String(usersKeep).padStart(8));

  console.log('\nPRESERVED (untouched):');
  for (const name of PRESERVE_COLLECTIONS) {
    if (!existing.has(name)) continue;
    console.log(`  ${name.padEnd(24)} ${await db.collection(name).countDocuments()} docs`);
  }

  const totalDelete = plan.reduce((s, p) => s + p.count, 0) + (usersTotal - usersKeep);
  console.log(`\nTotal documents to delete: ${totalDelete}`);

  if (!isConfirmed) {
    console.log('\nDry run only — nothing was changed. Re-run with --confirm to apply.');
    await mongoose.disconnect();
    return;
  }

  let deleted = 0;
  for (const p of plan) {
    const res = await db.collection(p.name).deleteMany({});
    deleted += res.deletedCount;
    console.log(`  cleared ${p.name} (${res.deletedCount})`);
  }
  const uRes = await db.collection('users').deleteMany({ email: { $nin: KEEP_USER_EMAILS } });
  deleted += uRes.deletedCount;
  console.log(`  cleared users (${uRes.deletedCount}, kept ${usersKeep})`);

  console.log(`\nDone. ${deleted} documents deleted. Collections and indexes left intact.`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
