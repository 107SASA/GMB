/**
 * Backfill User.businessIds from Business.userId.
 *
 * `businessIds` is the canonical list of workspaces a user owns and is read by
 * automation.ts (per-user business iteration), push/notification targeting and
 * the business-list routes. Historically nothing populated it, so existing
 * accounts have an empty array even though they own businesses. New signups and
 * Add-Workspace now maintain it (see /api/onboarding and
 * /api/business/add-workspace); this script fixes the accounts that predate that.
 *
 * Run once:  npx tsx scripts/migrate-user-businessids.ts
 * Idempotent — uses $addToSet, so re-running changes nothing.
 */
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

// Load environment variables manually (same approach as migrate-subscriptions.ts)
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf-8');
  envConfig.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[match[1]] = val;
    }
  });
}

const BusinessSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  isDeleted: Boolean,
});
const UserSchema = new mongoose.Schema({
  businessIds: [mongoose.Schema.Types.ObjectId],
});

const Business = mongoose.models.Business || mongoose.model('Business', BusinessSchema);
const User = mongoose.models.User || mongoose.model('User', UserSchema);

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI as string);
    console.log('Connected.');

    // Group non-deleted businesses by owner.
    const businesses = await Business.find({ isDeleted: { $ne: true } }, { _id: 1, userId: 1 }).lean();
    const byUser = new Map<string, mongoose.Types.ObjectId[]>();
    for (const b of businesses as any[]) {
      if (!b.userId) continue;
      const key = b.userId.toString();
      if (!byUser.has(key)) byUser.set(key, []);
      byUser.get(key)!.push(b._id);
    }

    let updated = 0;
    for (const [userId, ids] of byUser) {
      const res = await User.updateOne(
        { _id: userId },
        { $addToSet: { businessIds: { $each: ids } } }
      );
      if (res.modifiedCount > 0) updated++;
    }

    console.log(`Backfill complete. Updated ${updated} user(s) across ${businesses.length} business(es).`);
    process.exit(0);
  } catch (error) {
    console.error('Backfill failed:', error);
    process.exit(1);
  }
}

run();
