/**
 * One-off backfill for the "New User" name bug.
 *
 * Before the fix, every web free-report account was created as "New User",
 * and its platform Lead (what the super admin CRM shows) copied that
 * placeholder. A name typed later at checkout / profile only reached the
 * User, never the Lead. This repairs both directions by phone:
 *   - Lead has no real person name, User does  → copy User.fullName to the Lead
 *   - User is still "New User", Lead has a real person name → copy it to the User
 * A real person name on either side is never overwritten.
 *
 * Dry run (default, no writes):  npx tsx --env-file=.env scripts/backfill-placeholder-names.ts
 * Apply:                         npx tsx --env-file=.env scripts/backfill-placeholder-names.ts --apply
 */
import mongoose from 'mongoose';
import { usablePersonName, PLACEHOLDER_PERSON_NAME } from '../src/lib/personName';

const APPLY = process.argv.includes('--apply');

function phoneKey(phone: unknown): string {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set (pass --env-file=.env)');
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const users = db.collection('users');
  const leads = db.collection('leads');

  const userByKey = new Map<string, any>();
  for await (const u of users.find({ phone: { $exists: true, $ne: '' } }, { projection: { fullName: 1, phone: 1 } })) {
    const key = phoneKey(u.phone);
    if (key) userByKey.set(key, u);
  }

  let leadFixes = 0;
  let userFixes = 0;
  for await (const lead of leads.find({ tenantId: 'gmbboost-internal' }, { projection: { name: 1, phone: 1, businessType: 1 } })) {
    const user = userByKey.get(phoneKey(lead.phone));
    if (!user) continue;
    const leadName = usablePersonName(lead.name, lead.businessType);
    const userName = usablePersonName(user.fullName);

    if (!leadName && userName) {
      console.log(`lead ${lead._id} ${lead.phone}: "${lead.name}" -> "${userName}"`);
      if (APPLY) await leads.updateOne({ _id: lead._id }, { $set: { name: userName } });
      leadFixes++;
    } else if (leadName && user.fullName === PLACEHOLDER_PERSON_NAME) {
      console.log(`user ${user._id} ${user.phone}: "${user.fullName}" -> "${leadName}"`);
      if (APPLY) await users.updateOne({ _id: user._id }, { $set: { fullName: leadName } });
      userFixes++;
    }
  }

  const stillPlaceholder = await users.countDocuments({ fullName: PLACEHOLDER_PERSON_NAME });
  console.log(`\n${APPLY ? 'Updated' : 'Would update'} ${leadFixes} lead(s) and ${userFixes} user(s).`);
  console.log(`Users still named "${PLACEHOLDER_PERSON_NAME}"${APPLY ? '' : ' before this run'}: ${stillPlaceholder} (no real name known anywhere for these).`);
  if (!APPLY) console.log('Dry run only. Re-run with --apply to write.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
