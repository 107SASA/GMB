/**
 * GMBBoost – Create Super Admin User
 * -----------------------------------
 * Run ONCE to seed the first super_admin account:
 *
 *   MONGODB_URI="mongodb+srv://..." node scripts/create-super-admin.js
 *
 * Or with .env.local loaded (requires dotenv):
 *
 *   node -r dotenv/config scripts/create-super-admin.js dotenv_config_path=.env.local
 *
 * Edit ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME below before running.
 */

const mongoose = require('mongoose');

// ── CONFIGURE THESE ──────────────────────────────────────────────────────────
const ADMIN_EMAIL    = 'superadmin@yourdomain.com';
const ADMIN_PASSWORD = 'ChangeMe@123!';          // stored as plain text in dev mode
const ADMIN_NAME     = 'Super Admin';
const ADMIN_PHONE    = '+910000000001';           // must be unique in your DB
// ─────────────────────────────────────────────────────────────────────────────

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌  MONGODB_URI environment variable is not set.');
  process.exit(1);
}

const UserSchema = new mongoose.Schema(
  {
    fullName:            { type: String, required: true },
    email:               { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone:               { type: String, required: true, unique: true, trim: true },
    passwordHash:        { type: String },
    role:                { type: String, enum: ['Admin', 'BusinessOwner', 'TeamMember', 'super_admin'], default: 'BusinessOwner' },
    companyName:         { type: String },
    isEmailVerified:     { type: Boolean, default: false },
    onboardingCompleted: { type: Boolean, default: false },
    organizationId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
    activeBusinessId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Business' },
    subscriptionPlan:    { type: String, default: 'Free' },
    emailOtpHash:        { type: String },
    emailOtpExpiry:      { type: Date },
    passwordResetOtp:    { type: String },
    passwordResetExpiry: { type: Date },
    failedOtpAttempts:   { type: Number, default: 0 },
    emailVerifiedAt:     { type: Date },
    failedLoginAttempts: { type: Number, default: 0 },
    accountLockedUntil:  { type: Date },
    lastLoginAt:         { type: Date },
    businessIds:         [{ type: mongoose.Schema.Types.ObjectId, ref: 'Business' }],
  },
  { timestamps: true }
);

async function main() {
  console.log('🔗  Connecting to MongoDB…');
  await mongoose.connect(MONGODB_URI);

  const User = mongoose.models.User || mongoose.model('User', UserSchema);

  // Check if already exists
  const existing = await User.findOne({ email: ADMIN_EMAIL });
  if (existing) {
    if (existing.role === 'super_admin') {
      console.log(`✅  super_admin already exists: ${ADMIN_EMAIL}`);
    } else {
      // Upgrade existing user to super_admin
      existing.role = 'super_admin';
      await existing.save();
      console.log(`🔄  Upgraded existing user to super_admin: ${ADMIN_EMAIL}`);
    }
    await mongoose.disconnect();
    return;
  }

  const admin = await User.create({
    fullName:            ADMIN_NAME,
    email:               ADMIN_EMAIL,
    phone:               ADMIN_PHONE,
    passwordHash:        ADMIN_PASSWORD,   // plain text – dev mode
    role:                'super_admin',
    isEmailVerified:     true,
    onboardingCompleted: true,
    subscriptionPlan:    'Enterprise',
  });

  console.log('');
  console.log('✅  Super admin created successfully!');
  console.log('────────────────────────────────────');
  console.log(`   ID       : ${admin._id}`);
  console.log(`   Email    : ${admin.email}`);
  console.log(`   Password : ${ADMIN_PASSWORD}`);
  console.log(`   Role     : ${admin.role}`);
  console.log('');
  console.log('🔐  Login at: /admin/login');
  console.log('');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌  Error:', err.message);
  process.exit(1);
});
