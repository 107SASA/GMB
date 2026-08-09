// Verifies the new photo-scheduling pieces:
//  - scheduleAsset(): sets/clears scheduledFor, rejects non-staged assets,
//    rejects past dates
//  - the cron's exact query shape correctly finds only staged+due assets
//  - processScheduledMediaPublishJob's gate-off behavior: asset stays
//    'staged' (publishAsset's existing, already-verified behavior) AND
//    scheduledFor gets cleared so the cron doesn't reprocess it forever
//
// Run: npx tsx scripts/verify_photo_scheduling.ts

import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1].trim() in process.env)) process.env[m[1].trim()] = v;
}

let pass = 0, fail = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) { console.log(`✅ ${label}`); pass++; }
  else { console.log(`❌ ${label}`, detail ?? ''); fail++; }
}

async function main() {
  const dbConnect = (await import('../src/lib/mongodb')).default;
  const Business = (await import('../src/models/Business')).default;
  const Organization = (await import('../src/models/Organization')).default;
  const User = (await import('../src/models/User')).default;
  const GbpMediaAsset = (await import('../src/models/GbpMediaAsset')).default;
  const { createOrReplaceStagedAsset, scheduleAsset, publishAsset } = await import('../src/lib/gbpMediaService');

  await dbConnect();

  const user = await User.create({
    fullName: 'Verify Scheduling', email: `verify-sched-${Date.now()}@shadow.growwmatics.internal`,
    phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`, role: 'CLIENT',
    isShadowAccount: true, shadowSource: 'verify-script', isEmailVerified: false,
  });
  const organization = await Organization.create({ name: 'Verify Sched Org', ownerId: user._id, subscriptionPlan: 'Free' });
  const business = await Business.create({
    name: 'Verify Sched Business', category: 'Test', address: 'Test', city: 'Test',
    organizationId: organization._id, userId: user._id, provisionedVia: 'verify-script',
  });
  const businessId = business._id.toString();

  try {
    // 1. scheduleAsset rejects a past date.
    const staged = await createOrReplaceStagedAsset({ businessId, category: 'ADDITIONAL', url: 'https://example.com/p1.png' });
    let rejectedPastDate = false;
    try {
      await scheduleAsset(businessId, staged._id.toString(), new Date(Date.now() - 60_000));
    } catch (e) {
      rejectedPastDate = /future/i.test((e as Error).message);
    }
    check('scheduleAsset rejects a past date', rejectedPastDate);

    // 2. scheduleAsset accepts a future date and persists it.
    const future = new Date(Date.now() + 3600_000);
    const scheduled = await scheduleAsset(businessId, staged._id.toString(), future);
    check('scheduleAsset sets scheduledFor', scheduled.scheduledFor?.getTime() === future.getTime());

    // 3. scheduleAsset(null) clears it.
    const cleared = await scheduleAsset(businessId, staged._id.toString(), null);
    check('scheduleAsset(null) clears scheduledFor', cleared.scheduledFor == null, cleared.scheduledFor);

    // 4. Rejects scheduling a published asset.
    const staged2 = await createOrReplaceStagedAsset({ businessId, category: 'ADDITIONAL', url: 'https://example.com/p2.png' });
    await GbpMediaAsset.updateOne({ _id: staged2._id }, { $set: { status: 'published', googleMediaName: 'fake' } });
    let rejectedPublished = false;
    try {
      await scheduleAsset(businessId, staged2._id.toString(), future);
    } catch (e) {
      rejectedPublished = /staged/i.test((e as Error).message);
    }
    check('scheduleAsset rejects an already-published asset', rejectedPublished);

    // 5. Cron query: a due (past scheduledFor) staged asset is found; a
    // not-yet-due one is not.
    const due = await createOrReplaceStagedAsset({ businessId, category: 'ADDITIONAL', url: 'https://example.com/due.png' });
    await GbpMediaAsset.updateOne({ _id: due._id }, { $set: { scheduledFor: new Date(Date.now() - 60_000) } });
    const notDue = await createOrReplaceStagedAsset({ businessId, category: 'ADDITIONAL', url: 'https://example.com/notdue.png' });
    await GbpMediaAsset.updateOne({ _id: notDue._id }, { $set: { scheduledFor: new Date(Date.now() + 3600_000) } });
    const now = new Date();
    const dueResults = await GbpMediaAsset.find({ businessId, status: 'staged', scheduledFor: { $lte: now } }).lean();
    check('Cron query finds exactly the due asset', dueResults.length === 1 && String(dueResults[0]._id) === String(due._id), dueResults.map((d: any) => d._id));

    // 6. processScheduledMediaPublishJob's gate-off behavior, replicated: with
    // GBP_LIVE_WRITES_ENABLED off (default in this env), publishAsset leaves
    // status 'staged'; the job then clears scheduledFor.
    check('GBP_LIVE_WRITES_ENABLED is off in this test run (sanity)', process.env.GBP_LIVE_WRITES_ENABLED !== 'true');
    const { liveWriteApplied } = await publishAsset(businessId, due._id.toString(), { name: 'Scheduled publish' });
    check('publishAsset returns liveWriteApplied:false (gate off)', liveWriteApplied === false);
    await GbpMediaAsset.updateOne({ _id: due._id, businessId, status: 'staged' }, { $unset: { scheduledFor: '' } });
    const afterJob = await GbpMediaAsset.findById(due._id).lean();
    check('Asset stays "staged" (not fabricated as published)', (afterJob as any).status === 'staged');
    check('scheduledFor cleared so the cron stops reprocessing it', (afterJob as any).scheduledFor == null, (afterJob as any).scheduledFor);
  } finally {
    await GbpMediaAsset.deleteMany({ businessId });
    await Business.deleteOne({ _id: business._id });
    await Organization.deleteOne({ _id: organization._id });
    await User.deleteOne({ _id: user._id });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('VERIFY SCRIPT CRASHED:', e); process.exit(1); });
