// Verification for Step 1 (rating/reviewCount Places-snapshot fallback).
// Inserts a Business doc exactly the way shadowAccount.ts's Business.create()
// now does (placesRating/placesReviewCount/description from editorial_summary),
// then runs the real processAuditJob() — the same function Inngest calls —
// directly, and inspects the resulting Audit. Skips provisionShadowAccount()
// itself since it calls next/headers cookies(), which requires a live Next.js
// request scope; everything this fix touches downstream of Business creation
// is exercised for real here.
//
// Run: MONGODB_URI="..." npx tsx scripts/verify_step1.ts

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

async function main() {
  const { GooglePlacesService } = await import('../src/services/google/places');
  const { processAuditJob } = await import('../src/services/audit/auditService');
  const dbConnect = (await import('../src/lib/mongodb')).default;
  const Audit = (await import('../src/models/Audit')).default;
  const Business = (await import('../src/models/Business')).default;
  const Organization = (await import('../src/models/Organization')).default;
  const User = (await import('../src/models/User')).default;

  await dbConnect();

  const placeId = 'ChIJOaCUsBJxAjoRcfZNqb7fbMQ'; // Desun Technology Private Limited
  const details = await GooglePlacesService.getDetails(placeId);
  console.log('Live Places details fetched:', {
    rating: details?.rating,
    totalReviews: details?.totalReviews,
    primaryCategory: details?.primaryCategory,
    editorialSummary: details?.editorialSummary,
  });

  // Minimal user/org so Audit's required tenantId/userId/organizationId are satisfiable.
  const user = await User.create({
    fullName: 'Verify Script User',
    email: `verify-step1-${Date.now()}@shadow.growwmatics.internal`,
    phone: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
    role: 'CLIENT',
    isShadowAccount: true,
    shadowSource: 'verify-script',
    isEmailVerified: false,
    onboardingCompleted: false,
  });
  const organization = await Organization.create({
    name: 'Verify Step1 Org',
    ownerId: user._id,
    subscriptionPlan: 'Free',
  });

  // Mirrors shadowAccount.ts's Business.create() call exactly, post-fix.
  const business = await Business.create({
    name: 'Desun Technology Private Limited',
    category: details?.primaryCategory || 'Local Business',
    description: details?.editorialSummary || undefined,
    address: details?.formattedAddress || 'Unknown',
    area: details?.area,
    city: details?.city || 'Unknown',
    state: details?.state,
    country: details?.country,
    phone: details?.phoneNumber,
    website: details?.website,
    placeId,
    googlePlaceId: placeId,
    googleMapsUrl: details?.googleMapsUrl,
    googleConnected: true,
    placesRating: details?.rating,
    placesReviewCount: details?.totalReviews,
    organizationId: organization._id,
    userId: user._id,
    provisionedVia: 'verify-script',
    onboardingCompleted: false,
  });

  console.log('\nStored Business doc:');
  console.log({
    category: business.category,
    description: business.description,
    placesRating: business.placesRating,
    placesReviewCount: business.placesReviewCount,
  });

  const audit = await Audit.create({
    tenantId: organization._id.toString(),
    userId: user._id.toString(),
    organizationId: organization._id.toString(),
    businessId: business._id,
    businessName: business.name,
    location: `${business.city}`,
    status: 'PENDING',
    fastMode: true, // exactly what every /free-report audit uses
  });

  console.log(`\nCreated PENDING Audit ${audit._id} — running processAuditJob() directly...`);
  await processAuditJob(audit._id.toString());

  const completed: any = await Audit.findById(audit._id).lean();
  console.log('\n=== RESULT ===');
  console.log('status:', completed.status);
  console.log('overallScore:', completed.overallScore);
  console.log('reviewAnalysis:', completed.auditData?.reviewAnalysis);
  console.log('profileCompletion %:', completed.auditData?.profileCompletion?.completionPercentage);
  console.log('evidence.reviewAnalysis:', completed.auditData?.evidence?.reviewAnalysis);

  process.exit(0);
}

main().catch((e) => { console.error('VERIFY FAILED:', e); process.exit(1); });
