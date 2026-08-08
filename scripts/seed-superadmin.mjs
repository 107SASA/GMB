/**
 * One-time / re-runnable script to create (or rotate the password of) the
 * SUPER_ADMIN user.
 *
 * Run:
 *   MONGODB_URI="mongodb://..." SUPERADMIN_PASSWORD="..." node scripts/seed-superadmin.mjs
 *
 * If the user already exists, this ROTATES its password to SUPERADMIN_PASSWORD
 * (and fixes the role to SUPER_ADMIN if it had drifted) — it does not silently
 * leave the old password in place.
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// Never hardcode credentials here — this file is committed and this URI points
// at the PRODUCTION cluster. Pass it in at run time:
//   MONGODB_URI="mongodb://..." node scripts/seed-superadmin.mjs
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Prefix the command with MONGODB_URI="..."');
  process.exit(1);
}

// Never hardcode the password either — it was previously baked in as a
// literal ('Superadmin@123'), which meant it sat in plaintext in Git history
// for as long as this file existed. Pass it in at run time instead:
//   SUPERADMIN_PASSWORD="..." node scripts/seed-superadmin.mjs
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD;
if (!SUPERADMIN_PASSWORD) {
  console.error('SUPERADMIN_PASSWORD is not set. Prefix the command with SUPERADMIN_PASSWORD="..."');
  process.exit(1);
}
if (SUPERADMIN_PASSWORD.length < 12) {
  console.error('SUPERADMIN_PASSWORD is too short — use at least 12 characters.');
  process.exit(1);
}

const SUPERADMIN_EMAIL = process.env.SUPERADMIN_EMAIL || 'studysphere654@gmail.com';

const UserSchema = new mongoose.Schema(
  {
    fullName: String,
    email: { type: String, lowercase: true, trim: true },
    phone: String,
    passwordHash: String,
    role: String,
    isEmailVerified: Boolean,
    onboardingCompleted: Boolean,
    failedOtpAttempts: Number,
    failedLoginAttempts: Number,
    businessIds: [mongoose.Schema.Types.ObjectId],
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model('User', UserSchema);

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const passwordHash = await bcrypt.hash(SUPERADMIN_PASSWORD, 12);

  const existing = await User.findOne({ email: SUPERADMIN_EMAIL });
  if (existing) {
    existing.passwordHash = passwordHash;
    existing.failedLoginAttempts = 0;
    if (existing.role !== 'SUPER_ADMIN') existing.role = 'SUPER_ADMIN';
    await existing.save();
    console.log(`Rotated password for existing user: ${existing.email} (role: ${existing.role})`);
    await mongoose.disconnect();
    return;
  }

  await User.create({
    fullName: 'Super Admin',
    email: SUPERADMIN_EMAIL,
    phone: '+10000000000',
    passwordHash,
    role: 'SUPER_ADMIN',
    isEmailVerified: true,
    onboardingCompleted: true,
    failedOtpAttempts: 0,
    failedLoginAttempts: 0,
    businessIds: [],
  });

  console.log(`SUPER_ADMIN created: ${SUPERADMIN_EMAIL}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
