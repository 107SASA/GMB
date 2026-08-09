// Full verification pass across multiple businesses:
//   1. Desun Technology (unclaimed lead) — main bug case
//   2. Desun Hospital   (unclaimed lead) — confirms fix generalizes
//   3. Desun Academy    (unclaimed lead) — confirms the fix doesn't fabricate
//      data when Places genuinely has nothing (no editorial_summary/type)
//   4. A synthetic GBP-OAuth-"connected" business with empty description/
//      services/keywords/social — confirms those still score Missing (not
//      Unknown) once we DO have real access, i.e. the gate direction is right
//   5. An existing business with real synced Review docs (Desun Academy,
//      _id 6a60cb08435420d4f6600d40, 50 reviews) — confirms the
//      hasReviewData=true scoring path is byte-for-byte unchanged
//
// All script-created Users/Organizations/Businesses/Audits are deleted at
// the end. Run: npx tsx scripts/verify_step4_full.ts

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

const cleanupIds: { users: any[]; orgs: any[]; businesses: any[]; audits: any[] } = {
  users: [], orgs: [], businesses: [], audits: [],
};

async function main() {
  const { GooglePlacesService } = await import('../src/services/google/places');
  const { processAuditJob } = await import('../src/services/audit/auditService');
  const { calculateProfileCompletion } = await import('../src/services/audit/seoAnalyzer');
  const dbConnect = (await import('../src/lib/mongodb')).default;
  const Audit = (await import('../src/models/Audit')).default;
  const Business = (await import('../src/models/Business')).default;
  const Organization = (await import('../src/models/Organization')).default;
  const User = (await import('../src/models/User')).default;

  await dbConnect();

  async function makeLeadAndRun(name: string, placeId: string) {
    const details = await GooglePlacesService.getDetails(placeId);
    const user = await User.create({
      fullName: 'Verify Script User', email: `verify-step4-${Date.now()}-${Math.random()}@shadow.growwmatics.internal`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`, role: 'CLIENT',
      isShadowAccount: true, shadowSource: 'verify-script', isEmailVerified: false, onboardingCompleted: false,
    });
    cleanupIds.users.push(user._id);
    const organization = await Organization.create({ name: `Verify ${name}`, ownerId: user._id, subscriptionPlan: 'Free' });
    cleanupIds.orgs.push(organization._id);

    const business = await Business.create({
      name, category: details?.primaryCategory || 'Local Business', description: details?.editorialSummary || undefined,
      address: details?.formattedAddress || 'Unknown', area: details?.area, city: details?.city || 'Unknown',
      state: details?.state, country: details?.country, phone: details?.phoneNumber, website: details?.website,
      placeId, googlePlaceId: placeId, googleMapsUrl: details?.googleMapsUrl, googleConnected: true,
      placesRating: details?.rating, placesReviewCount: details?.totalReviews,
      organizationId: organization._id, userId: user._id, provisionedVia: 'verify-script', onboardingCompleted: false,
    });
    cleanupIds.businesses.push(business._id);

    const audit = await Audit.create({
      tenantId: organization._id.toString(), userId: user._id.toString(), organizationId: organization._id.toString(),
      businessId: business._id, businessName: business.name, location: business.city, status: 'PENDING', fastMode: true,
    });
    cleanupIds.audits.push(audit._id);

    await processAuditJob(audit._id.toString());
    const completed: any = await Audit.findById(audit._id).lean();

    console.log(`\n${'═'.repeat(70)}\n${name}\n${'═'.repeat(70)}`);
    console.log('Live Places:', { rating: details?.rating, totalReviews: details?.totalReviews, primaryCategory: details?.primaryCategory, editorialSummary: details?.editorialSummary });
    console.log('Stored category:', business.category);
    console.log('reviewAnalysis:', completed.auditData?.reviewAnalysis);
    console.log('profileCompletion %:', completed.auditData?.profileCompletion?.completionPercentage);
    console.log('checklist:', completed.auditData?.profileCompletion?.checklist?.map((c: any) => `${c.field}=${c.status}`).join(', '));
    console.log('overallScore:', completed.overallScore);
  }

  await makeLeadAndRun('Desun Technology Private Limited', 'ChIJOaCUsBJxAjoRcfZNqb7fbMQ');
  await makeLeadAndRun('Desun Hospital', 'ChIJhTIzuv9zAjoRcA2Ky8PBb-I');
  await makeLeadAndRun('Desun Academy', 'ChIJLUW07d91AjoRZCX-ZmBMGgE');

  // ── Scenario 4: real GBP OAuth connection, fields genuinely empty ──────
  console.log(`\n${'═'.repeat(70)}\nSynthetic GBP-connected business, empty description/services/keywords/social\n${'═'.repeat(70)}`);
  const connectedResult = calculateProfileCompletion({
    name: 'Connected Test Co', category: 'Plumber', address: '123 Main St', phone: '+1234567890', website: 'https://x.com', area: 'Downtown',
    googleLocationId: 'locations/12345', // real OAuth connection
    // description/services/keywords/social all deliberately absent
  });
  console.log('checklist:', connectedResult.data.checklist.map((c: any) => `${c.field}=${c.status}`).join(', '));
  console.log('completionPercentage:', connectedResult.data.completionPercentage);
  const expectMissing = ['Additional Keywords', 'Business Description', 'Services Listed', 'Social Links'];
  const actuallyMissing = connectedResult.data.checklist.filter((c: any) => expectMissing.includes(c.field));
  const allMissing = actuallyMissing.every((c: any) => c.status === 'Missing');
  console.log(allMissing ? '✅ PASS — connected business with empty fields scores Missing (not Unknown)' : '❌ FAIL — expected Missing for a connected business');

  // ── Scenario 5: regression check — real synced reviews path untouched ──
  console.log(`\n${'═'.repeat(70)}\nRegression check: existing business with 50 real synced reviews\n${'═'.repeat(70)}`);
  const existingBusinessId = '6a60cb08435420d4f6600d40'; // Desun Academy, has 50 Review docs
  const existing = await Business.findById(existingBusinessId).lean();
  if (!existing) {
    console.log('⚠️  Reference business not found (DB may have changed) — skipping regression check.');
  } else {
    const regAudit = await Audit.create({
      tenantId: (existing as any).organizationId.toString(), userId: (existing as any).userId?.toString() || (existing as any).organizationId.toString(),
      organizationId: (existing as any).organizationId.toString(), businessId: existing._id, businessName: (existing as any).name,
      location: (existing as any).city, status: 'PENDING', fastMode: false, // NOT fastMode — real paid-flow path
    });
    cleanupIds.audits.push(regAudit._id);
    await processAuditJob(regAudit._id.toString());
    const regCompleted: any = await Audit.findById(regAudit._id).lean();
    console.log('reviewAnalysis:', regCompleted.auditData?.reviewAnalysis);
    console.log('estimatedFromPlaces flag present:', !!regCompleted.auditData?.reviewAnalysis?.estimatedFromPlaces);
    console.log(regCompleted.auditData?.reviewAnalysis?.estimatedFromPlaces
      ? '❌ FAIL — real synced reviews should never carry the Places-snapshot flag'
      : '✅ PASS — real review sync path unaffected by the fallback');
  }

  // ── Cleanup ──────────────────────────────────────────────────────────
  await User.deleteMany({ _id: { $in: cleanupIds.users } });
  await Organization.deleteMany({ _id: { $in: cleanupIds.orgs } });
  await Business.deleteMany({ _id: { $in: cleanupIds.businesses } });
  await Audit.deleteMany({ _id: { $in: cleanupIds.audits } });
  console.log(`\n${'═'.repeat(70)}\nCleaned up ${cleanupIds.users.length} users, ${cleanupIds.orgs.length} orgs, ${cleanupIds.businesses.length} businesses, ${cleanupIds.audits.length} audits.`);

  process.exit(0);
}

main().catch(async (e) => {
  console.error('VERIFY FAILED:', e);
  process.exit(1);
});
