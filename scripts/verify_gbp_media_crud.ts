// Verification for the GBP media CRUD rebuild — exercises gbpMediaService.ts
// directly (bypasses HTTP auth) against a throwaway test business, covering:
//   - singleton replace semantics (LOGO staged twice -> 1 record, not 2)
//   - gallery semantics (ADDITIONAL staged twice -> 2 records)
//   - listMediaAssets with isConnected=false (no live reconciliation attempted)
//   - category change allowed while staged, rejected once published
//   - publishAsset while GBP_LIVE_WRITES_ENABLED=false -> stays staged, no crash
//   - deleteAsset on staged (succeeds) vs published-while-gated (rejected)
//
// Run: npx tsx scripts/verify_gbp_media_crud.ts

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

let pass = 0;
let fail = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`✅ ${label}`);
    pass++;
  } else {
    console.log(`❌ ${label}`, detail ?? '');
    fail++;
  }
}

async function main() {
  const dbConnect = (await import('../src/lib/mongodb')).default;
  const Business = (await import('../src/models/Business')).default;
  const Organization = (await import('../src/models/Organization')).default;
  const User = (await import('../src/models/User')).default;
  const GbpMediaAsset = (await import('../src/models/GbpMediaAsset')).default;
  const {
    listMediaAssets,
    createOrReplaceStagedAsset,
    updateAssetCategory,
    publishAsset,
    deleteAsset,
  } = await import('../src/lib/gbpMediaService');

  await dbConnect();

  const user = await User.create({
    fullName: 'Verify Media CRUD', email: `verify-media-${Date.now()}@shadow.growwmatics.internal`,
    phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`, role: 'CLIENT',
    isShadowAccount: true, shadowSource: 'verify-script', isEmailVerified: false, onboardingCompleted: false,
  });
  const organization = await Organization.create({ name: 'Verify Media CRUD Org', ownerId: user._id, subscriptionPlan: 'Free' });
  const business = await Business.create({
    name: 'Verify Media CRUD Business', category: 'Test', address: 'Test address', city: 'Test City',
    organizationId: organization._id, userId: user._id, provisionedVia: 'verify-script',
  });
  const businessId = business._id.toString();

  try {
    // 1. Singleton replace: LOGO staged twice -> exactly 1 record
    const logo1 = await createOrReplaceStagedAsset({ businessId, category: 'LOGO', url: 'https://example.com/logo-v1.png' });
    const logo2 = await createOrReplaceStagedAsset({ businessId, category: 'LOGO', url: 'https://example.com/logo-v2.png' });
    check('Singleton replace reuses the same record id', logo1._id.toString() === logo2._id.toString());
    const logoCount = await GbpMediaAsset.countDocuments({ businessId, category: 'LOGO' });
    check('Exactly 1 LOGO record exists after 2 uploads', logoCount === 1, logoCount);
    const logoDoc = await GbpMediaAsset.findById(logo2._id).lean();
    check('LOGO record has the SECOND url (latest wins)', (logoDoc as any)?.url === 'https://example.com/logo-v2.png');

    // 2. Gallery semantics: ADDITIONAL staged twice -> 2 records
    const add1 = await createOrReplaceStagedAsset({ businessId, category: 'ADDITIONAL', url: 'https://example.com/photo-1.png' });
    const add2 = await createOrReplaceStagedAsset({ businessId, category: 'ADDITIONAL', url: 'https://example.com/photo-2.png' });
    check('Gallery uploads create distinct records', add1._id.toString() !== add2._id.toString());
    const addCount = await GbpMediaAsset.countDocuments({ businessId, category: 'ADDITIONAL' });
    check('Exactly 2 ADDITIONAL records exist', addCount === 2, addCount);

    // 3. listMediaAssets with isConnected=false — no live call attempted, returns local state
    const { media: listed, liveSyncError } = await listMediaAssets(businessId, false);
    check('listMediaAssets(isConnected=false) returns all 3 local records', listed.length === 3, listed.length);
    check('listMediaAssets(isConnected=false) reports no live sync error', liveSyncError === null, liveSyncError);

    // 4. Category change while staged
    const recat = await updateAssetCategory(businessId, add1._id.toString(), 'PROFILE');
    check('Category change succeeds while staged', recat.category === 'PROFILE');

    // 5. Category change rejected once published — manually mark a doc published to test the gate
    const fakePublished = await GbpMediaAsset.create({
      businessId, category: 'COVER', url: 'https://example.com/cover.png', status: 'published', googleMediaName: 'accounts/x/locations/y/media/fake',
    });
    let categoryChangeRejected = false;
    try {
      await updateAssetCategory(businessId, fakePublished._id.toString(), 'ADDITIONAL');
    } catch (e) {
      categoryChangeRejected = /already live/i.test((e as Error).message);
    }
    check('Category change REJECTED once published', categoryChangeRejected);

    // 6. publishAsset while GBP_LIVE_WRITES_ENABLED=false — stays staged, no crash, liveWriteApplied:false
    check('GBP_LIVE_WRITES_ENABLED is off for this test run (sanity)', process.env.GBP_LIVE_WRITES_ENABLED !== 'true', process.env.GBP_LIVE_WRITES_ENABLED);
    const publishResult = await publishAsset(businessId, logo2._id.toString());
    check('publishAsset returns liveWriteApplied:false when gate is off', publishResult.liveWriteApplied === false);
    const stillStaged = await GbpMediaAsset.findById(logo2._id).lean();
    check('Asset status remains "staged" (not wrongly marked failed/published)', (stillStaged as any)?.status === 'staged', (stillStaged as any)?.status);

    // 7. deleteAsset on a staged item — succeeds, removes the record
    await deleteAsset(businessId, add2._id.toString());
    const deletedCheck = await GbpMediaAsset.findById(add2._id).lean();
    check('deleteAsset removes a staged record', deletedCheck === null);

    // 8. deleteAsset on a published item while gate is off — rejected with a clear message
    let publishedDeleteRejected = false;
    try {
      await deleteAsset(businessId, fakePublished._id.toString());
    } catch (e) {
      publishedDeleteRejected = /live GBP writes are currently disabled/i.test((e as Error).message);
    }
    check('deleteAsset REJECTS a published item while live writes are off', publishedDeleteRejected);
    const stillThere = await GbpMediaAsset.findById(fakePublished._id).lean();
    check('Rejected delete did NOT remove the record', stillThere !== null);
  } finally {
    // Cleanup
    await GbpMediaAsset.deleteMany({ businessId });
    await Business.deleteOne({ _id: business._id });
    await Organization.deleteOne({ _id: organization._id });
    await User.deleteOne({ _id: user._id });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('VERIFY SCRIPT CRASHED:', e); process.exit(1); });
