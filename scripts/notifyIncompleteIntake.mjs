/**
 * One-time (idempotent) backfill: notify EXISTING workspaces that haven't
 * completed the post-payment intake, asking them to fill in their details.
 *
 * New workspaces are hard-gated into the intake in-app (src/proxy.ts); existing
 * ones are nudged with this in-app notification instead of being walled.
 *
 * Safe to re-run: it skips any business that already has a 'complete_intake'
 * notification. Read + additive writes only (creates Notification docs).
 *
 * Usage:  node scripts/notifyIncompleteIntake.mjs
 * Env:    reads .env.local (fallback .env.production) for MONGODB_URI
 */
import fs from 'fs';
import mongoose from 'mongoose';

function loadEnv(path) {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnv('.env.local');
loadEnv('.env.production');

const LINK = '/dashboard/onboarding/intake';
const TYPE = 'complete_intake';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const businesses = db.collection('businesses');
  const users = db.collection('users');
  const notifications = db.collection('notifications');

  const incomplete = await businesses
    .find({ intakeCompleted: { $ne: true }, isDeleted: { $ne: true } })
    .project({ name: 1, userId: 1, organizationId: 1 })
    .toArray();

  console.log(`Found ${incomplete.length} workspaces without completed intake.`);
  let created = 0, skipped = 0;

  for (const b of incomplete) {
    const already = await notifications.findOne({ businessId: b._id, type: TYPE });
    if (already) { skipped++; continue; }

    // Same ownership rule as services/notifications.ts notifyBusinessUsers.
    const or = [{ businessIds: b._id.toString() }];
    if (b.userId) or.push({ _id: b.userId });
    if (b.organizationId) or.push({ organizationId: b.organizationId });
    const owners = await users.find({ $or: or, isDeleted: { $ne: true } }).project({ _id: 1 }).toArray();
    if (owners.length === 0) { skipped++; continue; }

    const now = new Date();
    await notifications.insertMany(
      owners.map((u) => ({
        userId: u._id,
        businessId: b._id,
        type: TYPE,
        title: 'Complete your business profile',
        body: `Add your services, target keywords and competitors for ${b.name || 'your business'} so we can generate accurate audits, content and comparisons.`,
        link: LINK,
        read: false,
        createdAt: now,
        updatedAt: now,
      }))
    );
    created += owners.length;
  }

  console.log(`Done. Created ${created} notifications; skipped ${skipped} workspaces (already notified or no owner).`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
