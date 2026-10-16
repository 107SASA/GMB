/**
 * One-off cleanup of Subscription records stuck in the old schema-default
 * "Trialing" state (no trialSource) — see src/lib/billing/legacyTrialCleanup.ts.
 * They no longer grant access (requireModule requires trialSource 'offer');
 * this just makes the data say what it means: a free subscription.
 *
 * DRY RUN by default: prints counts per category and changes nothing.
 * Paying customers (paid user plan, or an active workspace) are never changed —
 * they are listed by id for manual review.
 *
 *   Dry run:  node --env-file=.env --experimental-strip-types scripts/cleanup-legacy-trialing.ts
 *   Apply:    node --env-file=.env --experimental-strip-types scripts/cleanup-legacy-trialing.ts --apply --confirm-db=<database name>
 *
 * --apply refuses to run unless --confirm-db matches the database the URI
 * actually connected to, so a script pointed at the wrong cluster stops.
 */
import mongoose from 'mongoose';
import {
  isLegacyDefaultTrial,
  classifyLegacyTrial,
  LEGACY_TRIAL_FIX,
  type LegacyTrialCategory,
} from '../src/lib/billing/legacyTrialCleanup.ts';

const APPLY = process.argv.includes('--apply');
const confirmDb = process.argv.find((a) => a.startsWith('--confirm-db='))?.split('=')[1];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set (use --env-file)');
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const dbName = db.databaseName;
  console.log(`Connected to database "${dbName}". Mode: ${APPLY ? 'APPLY' : 'dry run'}`);
  if (APPLY && confirmDb !== dbName) {
    throw new Error(`--apply needs --confirm-db=${dbName} (got ${confirmDb ?? 'nothing'}). Nothing changed.`);
  }

  const now = new Date();
  const subs = db.collection('subscriptions');
  const candidates = await subs
    .find({ billingStatus: 'Trialing', trialSource: { $ne: 'offer' } })
    .project({ userId: 1, billingStatus: 1, trialSource: 1, trialStatus: 1, razorpaySubscriptionId: 1, planType: 1 })
    .toArray();

  const counts: Record<LegacyTrialCategory, number> = { was_granting_access: 0, expired: 0, paying_customer_skip: 0 };
  let withCheckout = 0;
  let changed = 0;
  const skipped: string[] = [];

  for (const sub of candidates) {
    if (!isLegacyDefaultTrial(sub as any)) continue;
    const owner = await db.collection('users').findOne({ _id: sub.userId }, { projection: { subscriptionPlan: 1 } });
    const hasActiveWorkspace = !!(await db.collection('businesses').findOne(
      { userId: sub.userId, subscriptionStatus: { $in: ['active', 'trial_active'] } },
      { projection: { _id: 1 } }
    ));
    const category = classifyLegacyTrial(sub as any, { subscriptionPlan: owner?.subscriptionPlan, hasActiveWorkspace }, now);
    counts[category]++;
    if (sub.razorpaySubscriptionId) withCheckout++;
    if (category === 'paying_customer_skip') {
      skipped.push(String(sub._id));
      continue;
    }
    if (APPLY) {
      const res = await subs.updateOne(
        { _id: sub._id, billingStatus: 'Trialing', trialSource: { $ne: 'offer' } },
        { $set: LEGACY_TRIAL_FIX }
      );
      changed += res.modifiedCount;
    }
  }

  console.log(`\nLegacy "Trialing" records without trialSource: ${candidates.length}`);
  console.log(`  was granting paid access under the old rule : ${counts.was_granting_access}`);
  console.log(`  already expired                             : ${counts.expired}`);
  console.log(`  paying customers (left alone, review)       : ${counts.paying_customer_skip}`);
  console.log(`  (of all: opened a Razorpay checkout          : ${withCheckout})`);
  if (skipped.length) console.log(`  subscription ids to review: ${skipped.join(', ')}`);
  console.log(APPLY ? `\nUpdated ${changed} record(s) to a free subscription.` : '\nDry run — nothing changed. Re-run with --apply --confirm-db=<name> to fix.');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err.message || err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
