/**
 * Idempotent seed for the app-store REVIEWER account (Google Play "App access").
 *
 * Creates/refreshes a plain CLIENT user + organization + fully set-up, ACTIVE
 * business + Pro subscription, so a reviewer who logs in with the fixed code
 * (see src/lib/reviewerAccount.ts) lands on the full app with no paywall and
 * no onboarding wizard.
 *
 * Run (against the DB the deployed app uses):
 *   MONGODB_URI="mongodb://..." REVIEWER_PHONE=9876543210 node scripts/seed-reviewer-account.mjs           # DRY RUN (read-only)
 *   MONGODB_URI="mongodb://..." REVIEWER_PHONE=9876543210 node scripts/seed-reviewer-account.mjs --apply   # writes
 *
 * Then set on the server:  REVIEWER_PHONE=9876543210  REVIEWER_OTP=000000
 */
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;
const RAW_PHONE = process.env.REVIEWER_PHONE;
if (!MONGODB_URI || !RAW_PHONE) {
  console.error('Set MONGODB_URI and REVIEWER_PHONE, e.g. REVIEWER_PHONE=9876543210');
  process.exit(1);
}

const digits = RAW_PHONE.replace(/\D/g, '').replace(/^0+/, '');
const PHONE = RAW_PHONE.trim().startsWith('+')
  ? `+${digits}`
  : digits.length === 10 ? `+91${digits}` : digits.length === 12 && digits.startsWith('91') ? `+${digits}` : null;
if (!PHONE) {
  console.error('Could not normalise REVIEWER_PHONE — pass a 10-digit Indian number or +<country><number>.');
  process.exit(1);
}

const EMAIL = 'reviewer@growwmatics.com';
const FAR_FUTURE = new Date('2030-12-31T00:00:00Z');

async function main() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  const now = new Date();

  const isReviewer = (u) => u.email === EMAIL && u.role === 'CLIENT' && u.phone === PHONE;
  const dbName = mongoose.connection.name;

  // Refuse to touch ANY other account. The login routes fall back to a
  // last-10-digits match, so check that too (legacy-format phones), plus the
  // reviewer email (unique) in case it sits on a different phone.
  const tail = PHONE.replace(/\D/g, '').slice(-10);
  const conflicts = (await db.collection('users').find({
    $or: [{ phone: PHONE }, { phone: { $regex: `${tail}$` } }, { email: EMAIL }],
  }).project({ email: 1, phone: 1, role: 1 }).toArray()).filter((u) => !isReviewer(u));
  if (conflicts.length) {
    console.error(`CONFLICT — nothing was modified. ${conflicts.length} unrelated user(s) match ${PHONE} / ${EMAIL}:`);
    for (const u of conflicts) console.error(`  _id=${u._id} role=${u.role} phone=${u.phone} email=${u.email}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const existing = await db.collection('users').findOne({ phone: PHONE });
  console.log(`Database: ${dbName}`);
  console.log(`Plan: ${existing ? 'REFRESH existing reviewer user' : 'CREATE reviewer user'} ${PHONE} (${EMAIL}, CLIENT)`);
  console.log('      upsert organization "Reviewer Demo Org", business "Sunrise Dental Clinic" (active, intake complete),');
  console.log('      subscription Pro/Active to 2030-12-31. No other user/business/subscription is touched, nothing is deleted.');
  if (!process.argv.includes('--apply')) {
    console.log('\nDRY RUN — no changes written. Re-run with --apply to write.');
    await mongoose.disconnect();
    return;
  }

  await db.collection('users').updateOne(
    { phone: PHONE },
    {
      $set: {
        fullName: 'Play Store Reviewer', email: EMAIL, role: 'CLIENT',
        isPhoneVerified: true, isEmailVerified: true, phoneVerifiedAt: now, emailVerifiedAt: now,
        onboardingCompleted: true, subscriptionPlan: 'Pro', isDeleted: false,
        failedLoginAttempts: 0, accountLockedUntil: null, updatedAt: now,
      },
      $setOnInsert: { phone: PHONE, createdAt: now, sessionEpoch: 0 },
    },
    { upsert: true }
  );
  const user = await db.collection('users').findOne({ phone: PHONE });

  let orgId = user.organizationId;
  if (!orgId) {
    orgId = (await db.collection('organizations').insertOne({
      name: 'Reviewer Demo Org', ownerId: user._id, subscriptionPlan: 'Pro', status: 'Active',
      maxBusinesses: 1, settings: { whiteLabel: false }, createdAt: now, updatedAt: now,
    })).insertedId;
  }

  const bizFields = {
    name: 'Sunrise Dental Clinic', category: 'Dentist',
    description: 'Demo business for app review.',
    address: '12 MG Road, Pune, Maharashtra 411001, India', city: 'Pune', state: 'Maharashtra', country: 'India',
    phone: PHONE, rating: 4.6, reviewCount: 128, tone: 'professional',
    keywords: ['dentist in pune', 'teeth cleaning', 'root canal', 'dental implants'],
    userId: user._id, organizationId: orgId,
    subscriptionStatus: 'active', subscriptionCurrentPeriodEnd: FAR_FUTURE,
    subscriptionCancelAtPeriodEnd: false, subscriptionRemindersSent: [],
    onboardingCompleted: true, intakeCompleted: true,
    intake: {
      uniqueSellingPoints: 'Painless treatment, same-day appointments',
      targetAudience: 'Families and working professionals in Pune',
      competitorNames: [], primaryGoal: 'More calls and bookings',
    },
    isDeleted: false, updatedAt: now,
  };
  let biz = await db.collection('businesses').findOne({ userId: user._id, isDeleted: { $ne: true } });
  if (biz) {
    await db.collection('businesses').updateOne({ _id: biz._id }, { $set: bizFields });
  } else {
    biz = { _id: (await db.collection('businesses').insertOne({ ...bizFields, createdAt: now })).insertedId };
  }

  await db.collection('users').updateOne(
    { _id: user._id },
    { $set: { organizationId: orgId, activeBusinessId: biz._id }, $addToSet: { businessIds: biz._id } }
  );
  await db.collection('subscriptions').updateOne(
    { userId: user._id },
    {
      $set: { planType: 'Pro', billingStatus: 'Active', businessId: biz._id, currentPeriodEnd: FAR_FUTURE, updatedAt: now },
      $setOnInsert: { userId: user._id, createdAt: now },
    },
    { upsert: true }
  );

  console.log(`Reviewer account ready: ${PHONE}  user=${user._id}  business=${biz._id}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
