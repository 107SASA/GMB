/**
 * One-off: marks the CRM lead of every workspace that is on a free trial now
 * (or that paid after one) — trials started before Leads followed the trial
 * (services/billing/leadTrialSync.ts). Never changes a lead's stage, sends
 * nothing, and touches only platform CRM leads.
 *
 * DRY RUN by default: prints counts only (no names or phone numbers).
 *
 *   Dry run:  npx tsx --env-file=.env.production scripts/backfill-lead-trials.ts
 *   Apply:    npx tsx --env-file=.env.production scripts/backfill-lead-trials.ts --apply --confirm-db=<database name>
 *
 * --apply refuses to run unless --confirm-db matches the database actually
 * connected to.
 */
import mongoose from 'mongoose';
import dbConnect from '../src/lib/mongodb';
import Business from '../src/models/Business';
import { resolveLeadForPayment } from '../src/services/billing/customerActivation';

const APPLY = process.argv.includes('--apply');
const confirmDb = process.argv.find((a) => a.startsWith('--confirm-db='))?.split('=')[1];

async function main() {
  await dbConnect();
  const dbName = mongoose.connection.db?.databaseName;
  console.log(`Database: ${dbName} · mode: ${APPLY ? 'APPLY' : 'dry run'}`);
  if (APPLY && confirmDb !== dbName) throw new Error(`--confirm-db must be "${dbName}" to apply.`);

  const businesses: any[] = await Business.find({
    isDeleted: { $ne: true },
    $or: [{ subscriptionStatus: 'trial_active' }, { subscriptionStatus: 'active', trialStartedAt: { $exists: true } }],
  }).select('_id userId subscriptionStatus trialStartedAt trialEndsAt trialCancelledAt').lean();

  const counts = { workspaces: businesses.length, onTrial: 0, converted: 0, noLead: 0, alreadySet: 0, updated: 0 };
  for (const b of businesses) {
    const status = b.subscriptionStatus === 'active' ? 'converted' : b.trialCancelledAt ? 'cancelled' : 'active';
    if (status === 'converted') counts.converted++;
    else counts.onTrial++;
    const lead = await resolveLeadForPayment(b.userId ? String(b.userId) : '', String(b._id));
    if (!lead) { counts.noLead++; continue; }
    if ((lead.trial as any)?.status === status) { counts.alreadySet++; continue; }
    if (APPLY) {
      lead.trial = {
        status,
        startedAt: b.trialStartedAt ?? undefined,
        endsAt: b.trialEndsAt ?? undefined,
        businessId: b._id,
        updatedAt: new Date(),
      } as any;
      lead.markModified('trial');
      await lead.save();
    }
    counts.updated++;
  }
  console.log(counts);
  if (!APPLY) console.log('Dry run — nothing changed. "updated" is what --apply would change.');
}

main()
  .catch((err) => { console.error(err?.message ?? err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
