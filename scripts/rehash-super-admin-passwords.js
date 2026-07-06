/**
 * GMBBoost – Re-hash any plain-text SUPER_ADMIN passwords
 * ----------------------------------------------------------
 * The admin login route now only accepts bcrypt hashes (no plain-text
 * fallback). Any SUPER_ADMIN whose passwordHash is not already a bcrypt
 * hash would be permanently locked out. This one-off script re-hashes
 * those passwords in place.
 *
 * Run:
 *   MONGODB_URI="mongodb+srv://..." node scripts/rehash-super-admin-passwords.js
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌  MONGODB_URI environment variable is not set.');
  process.exit(1);
}

const UserSchema = new mongoose.Schema(
  {
    email: { type: String },
    passwordHash: { type: String },
    role: { type: String },
  },
  { strict: false }
);

function isBcryptHash(value) {
  return typeof value === 'string' && (value.startsWith('$2b$') || value.startsWith('$2a$'));
}

async function main() {
  console.log('🔗  Connecting to MongoDB…');
  await mongoose.connect(MONGODB_URI);

  const User = mongoose.models.User || mongoose.model('User', UserSchema);

  const admins = await User.find({ role: 'SUPER_ADMIN' });
  console.log(`Found ${admins.length} SUPER_ADMIN account(s).`);

  let rehashed = 0;
  for (const admin of admins) {
    if (!admin.passwordHash) {
      console.warn(`⚠️  ${admin.email}: no passwordHash set, skipping`);
      continue;
    }
    if (isBcryptHash(admin.passwordHash)) {
      continue;
    }

    const plainText = admin.passwordHash;
    admin.passwordHash = await bcrypt.hash(plainText, SALT_ROUNDS);
    await admin.save();
    rehashed++;
    console.log(`🔄  Re-hashed password for ${admin.email}`);
  }

  console.log('');
  console.log(`✅  Done. ${rehashed} account(s) re-hashed, ${admins.length - rehashed} already bcrypt.`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌  Error:', err.message);
  process.exit(1);
});
