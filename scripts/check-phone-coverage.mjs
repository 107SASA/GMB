/**
 * Read-only check: how many User accounts have a phone number on file vs.
 * not. Directly relevant to the "email login removed, no fallback" decision —
 * any CLIENT account with no phone is now permanently locked out.
 *
 * Run:
 *   MONGODB_URI="mongodb://..." node scripts/check-phone-coverage.mjs
 */
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Prefix the command with MONGODB_URI="..."');
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  const users = db.collection('users');

  const hasPhone = { phone: { $exists: true, $nin: [null, ''] } };
  const noPhone = { $or: [{ phone: { $exists: false } }, { phone: null }, { phone: '' }] };

  const totalClient = await users.countDocuments({ role: 'CLIENT' });
  const clientWithPhone = await users.countDocuments({ role: 'CLIENT', ...hasPhone });
  const clientNoPhone = await users.countDocuments({ role: 'CLIENT', ...noPhone });
  const clientPhoneVerified = await users.countDocuments({ role: 'CLIENT', isPhoneVerified: true });

  const totalAdmin = await users.countDocuments({ role: 'SUPER_ADMIN' });
  const adminWithPhone = await users.countDocuments({ role: 'SUPER_ADMIN', ...hasPhone });

  console.log('--- CLIENT users (affected by phone-only login) ---');
  console.log(`Total:              ${totalClient}`);
  console.log(`Has a phone number: ${clientWithPhone}`);
  console.log(`NO phone number:    ${clientNoPhone}  <-- locked out, can never log in as things stand`);
  console.log(`Already phone-verified (can log in today): ${clientPhoneVerified}`);
  console.log('');
  console.log('--- SUPER_ADMIN users (unaffected — admin-login still email/password) ---');
  console.log(`Total: ${totalAdmin}, with phone: ${adminWithPhone}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
