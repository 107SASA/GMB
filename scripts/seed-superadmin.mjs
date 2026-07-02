/**
 * One-time script to create the SUPER_ADMIN user.
 * Run: node scripts/seed-superadmin.mjs
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const MONGODB_URI =
  'mongodb://vaishnavinimse8797_db_user:Nimse8797@ac-uwutnsc-shard-00-00.bnnszbl.mongodb.net:27017,ac-uwutnsc-shard-00-01.bnnszbl.mongodb.net:27017,ac-uwutnsc-shard-00-02.bnnszbl.mongodb.net:27017/?ssl=true&replicaSet=atlas-p3f7v0-shard-0&authSource=admin&appName=GMBBoost';

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

  const existing = await User.findOne({ email: 'studysphere654@gmail.com' });
  if (existing) {
    console.log(`User already exists: ${existing.email} (role: ${existing.role})`);
    if (existing.role !== 'SUPER_ADMIN') {
      existing.role = 'SUPER_ADMIN';
      await existing.save();
      console.log('Updated role to SUPER_ADMIN');
    }
    await mongoose.disconnect();
    return;
  }

  const passwordHash = await bcrypt.hash('Superadmin@123', 12);

  await User.create({
    fullName: 'Super Admin',
    email: 'studysphere654@gmail.com',
    phone: '+10000000000',
    passwordHash,
    role: 'SUPER_ADMIN',
    isEmailVerified: true,
    onboardingCompleted: true,
    failedOtpAttempts: 0,
    failedLoginAttempts: 0,
    businessIds: [],
  });

  console.log('SUPER_ADMIN created: studysphere654@gmail.com');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
