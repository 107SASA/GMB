// Debug: compare our stored/computed free-report stats against Google's live
// Places API response, for Desun Technology Private Limited (Kolkata) or any
// business name passed as an argument.
//
// Run:  node scripts/debug_free_report_desun.mjs ["Desun"]
//
// Reads MONGODB_URI / GOOGLE_MAPS_API_KEY from .env.local (same loader
// pattern as scripts/diagnose-gbp-location.mjs).

import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';

// --- Load .env.local manually ---
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1].trim()] = v;
  }
} else {
  console.warn(`(no .env.local found at ${envPath} — relying on already-exported env vars)`);
}

const NAME_QUERY = process.argv[2] || 'Desun';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is not set (checked .env.local and process.env).`);
    process.exit(1);
  }
  return v;
}

// Mirrors src/services/google/places.ts GENERIC_PLACE_TYPES / deriveCategory —
// duplicated here (read-only) so this script has no dependency on the TS
// build. If you change the real logic in places.ts, update this too.
const GENERIC_PLACE_TYPES = new Set([
  'point_of_interest', 'establishment', 'premise', 'subpremise',
  'geocode', 'political', 'food', 'health', 'finance', 'place_of_worship',
]);
function deriveCategory(types = []) {
  const specific = types.find((t) => !GENERIC_PLACE_TYPES.has(t));
  if (!specific) return undefined;
  return specific.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Mirrors src/services/audit/seoAnalyzer.ts calculateProfileCompletion — read
// -only diagnostic copy, NOT the source of truth. Reproduced so we can print
// the itemized checklist without importing a TS module from a .mjs script.
//
// KEEP IN SYNC with seoAnalyzer.ts: as of Aug 2026 that function gates
// Additional Keywords / Business Description / Services Listed / Social
// Links on hasGbpConnection (= !!business.googleLocationId). A free-report
// lead (no GBP OAuth) with those fields empty is "Unknown" (never
// queryable via Places), NOT "Missing" (confirmed absent) — Places API
// doesn't expose them at all. This script previously always emitted
// "Missing" for those four fields regardless of connection state, which
// made every free-report business look worse than it actually scored.
function calculateProfileCompletionDebug(business) {
  const checklist = [];
  const add = (field, isComplete) => checklist.push({ field, status: isComplete ? 'Complete' : 'Missing' });
  const addUnknown = (field, known, isComplete) => {
    if (known === undefined || known === null) checklist.push({ field, status: 'Unknown' });
    else checklist.push({ field, status: isComplete ? 'Complete' : 'Missing' });
  };
  const hasGbpConnection = !!business.googleLocationId;
  const knownIf = (isKnown) => (isKnown ? true : undefined);

  add('Business Name', !!business.name);
  add('Primary Category', !!business.category || !!business.userDefinedCategory);
  addUnknown(
    'Additional Keywords',
    knownIf(hasGbpConnection || (!!business.keywords && business.keywords.length > 0)),
    !!business.keywords && business.keywords.length > 0,
  );
  addUnknown(
    'Business Description',
    knownIf(hasGbpConnection || (!!business.description && business.description.length > 0)),
    !!business.description && business.description.length > 50,
  );
  addUnknown(
    'Services Listed',
    knownIf(hasGbpConnection || (!!business.services && business.services.length > 0)),
    !!business.services && business.services.length > 0,
  );
  add('Address', !!business.address);
  add('Phone', !!business.phone);
  add('Website', !!business.website);
  add('Service Area', !!business.area);
  const hasSocial = !!(business.facebookPageUrl || business.instagramUrl || business.metaBusinessProfileUrl);
  addUnknown('Social Links', knownIf(hasGbpConnection || hasSocial), hasSocial);
  addUnknown('Business Photos', business.photoCount, (business.photoCount ?? 0) > 0);
  addUnknown('Business Hours', business.hasHours, !!business.hasHours);
  for (const f of ['Videos', 'Logo / Cover Image', 'Attributes', 'Booking / Appointment Link']) {
    checklist.push({ field: f, status: 'Unknown' });
  }
  const score = checklist.reduce((acc, c) => acc + (c.status === 'Complete' ? 1 : c.status === 'Unknown' ? 0.5 : 0), 0);
  return { checklist, completionPercentage: Math.round((score / checklist.length) * 100) };
}

async function fetchPlacesDetailsRaw(placeId, apiKey) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.append('place_id', placeId);
  url.searchParams.append('key', apiKey);
  url.searchParams.append(
    'fields',
    'name,formatted_address,formatted_phone_number,international_phone_number,website,url,rating,user_ratings_total,geometry,types,editorial_summary'
  );
  const res = await fetch(url.toString());
  return res.json();
}

async function fetchAutocompleteRaw(query, apiKey) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
  url.searchParams.append('input', query);
  url.searchParams.append('key', apiKey);
  url.searchParams.append('types', 'establishment');
  const res = await fetch(url.toString());
  return res.json();
}

async function main() {
  const MONGODB_URI = requireEnv('MONGODB_URI');
  const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY; // checked lazily below

  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection;

  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  STORED DATA — business name matching /${NAME_QUERY}/i`);
  console.log('══════════════════════════════════════════════════════════════\n');

  const businesses = await db.collection('businesses')
    .find({ name: { $regex: NAME_QUERY, $options: 'i' } })
    .toArray();

  if (businesses.length === 0) {
    console.log(`No Business documents match /${NAME_QUERY}/i. Nothing to compare — check the name/spelling used at submission time.`);
  }

  for (const business of businesses) {
    console.log('──────────────────────────────────────────────');
    console.log(`Business: ${business.name}  (_id=${business._id})`);
    console.log(`createdAt:        ${business.createdAt}`);
    console.log(`googlePlaceId:    ${business.googlePlaceId || '(none)'}`);
    console.log(`placeId:          ${business.placeId || '(none)'}`);
    console.log(`googleConnected:  ${business.googleConnected}`);
    console.log(`googleLocationId: ${business.googleLocationId || '(none — no real GBP OAuth, so hasGbpConnection=false)'}`);
    console.log(`placesRating:        ${business.placesRating ?? '(unset)'}`);
    console.log(`placesReviewCount:   ${business.placesReviewCount ?? '(unset)'}`);
    console.log(`category:         ${business.category || '(none)'}`);
    console.log(`userDefinedCategory: ${business.userDefinedCategory || '(none)'}`);
    console.log(`description:      ${business.description ? JSON.stringify(business.description).slice(0, 80) + '…' : '(none)'}`);
    console.log(`services:         ${JSON.stringify(business.services || [])}`);
    console.log(`keywords:         ${JSON.stringify(business.keywords || [])}`);
    console.log(`website:          ${business.website || '(none)'}`);
    console.log(`address/area/city: ${business.address || '?'} / ${business.area || '?'} / ${business.city || '?'}`);
    console.log(`photoCount:       ${business.photoCount ?? '(unset → scored Unknown)'}`);
    console.log(`hasHours:         ${business.hasHours ?? '(unset → scored Unknown)'}`);
    console.log(`social fields:    fb=${business.facebookPageUrl || '-'} ig=${business.instagramUrl || '-'} meta=${business.metaBusinessProfileUrl || '-'}`);
    console.log(`freeAuditUsed:    ${business.freeAuditUsed}`);

    // Our computed profile completion, mirrored from seoAnalyzer.ts
    const pc = calculateProfileCompletionDebug(business);
    console.log(`\n  → Our calculateProfileCompletion(): ${pc.completionPercentage}%`);
    for (const item of pc.checklist) {
      console.log(`      ${item.status === 'Complete' ? '✅' : item.status === 'Unknown' ? '❓' : '❌'} ${item.field}: ${item.status}`);
    }

    // Reviews actually stored for this business
    const reviewCount = await db.collection('reviews').countDocuments({ businessId: business._id });
    const sampleReviews = await db.collection('reviews').find({ businessId: business._id }).limit(3).toArray();
    console.log(`\n  → Stored Review docs: ${reviewCount}`);
    if (sampleReviews.length) console.log('     sample:', sampleReviews.map(r => ({ rating: r.rating, postedAt: r.postedAt })));

    // Audits for this business — including whether fastMode + status + age
    const audits = await db.collection('audits')
      .find({ businessId: business._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();
    console.log(`\n  → Audit documents (${audits.length}, newest first):`);
    for (const a of audits) {
      const reviewAnalysis = a.auditData?.reviewAnalysis;
      const profileCompletion = a.auditData?.profileCompletion;
      console.log(`     ${a._id} | status=${a.status} | fastMode=${a.fastMode} | createdAt=${a.createdAt} | overallScore=${a.overallScore}`);
      if (reviewAnalysis) console.log(`        reviewAnalysis: reviewCount=${reviewAnalysis.reviewCount} averageRating=${reviewAnalysis.averageRating}`);
      else console.log('        reviewAnalysis: (absent — hasReviewData was false when this audit ran, see auditService.ts)');
      if (profileCompletion) console.log(`        profileCompletion: ${profileCompletion.completionPercentage}%`);
    }
    console.log('');
  }

  console.log('══════════════════════════════════════════════════════════════');
  console.log('  LIVE GOOGLE PLACES DATA (ground truth)');
  console.log('══════════════════════════════════════════════════════════════\n');

  if (!GOOGLE_MAPS_API_KEY) {
    console.log('GOOGLE_MAPS_API_KEY not set — skipping live Places calls. Set it in .env.local to fetch live data.');
  } else {
    // Prefer a stored googlePlaceId if we found one; else resolve via autocomplete.
    let placeId = businesses.find(b => b.googlePlaceId)?.googlePlaceId;

    if (!placeId) {
      console.log(`No stored googlePlaceId — resolving "${NAME_QUERY}" via Autocomplete...`);
      const ac = await fetchAutocompleteRaw(NAME_QUERY, GOOGLE_MAPS_API_KEY);
      console.log('Autocomplete raw status:', ac.status);
      console.log((ac.predictions || []).map(p => ({ place_id: p.place_id, description: p.description })));
      placeId = ac.predictions?.[0]?.place_id;
    }

    if (!placeId) {
      console.log('Could not resolve a placeId — cannot fetch live details.');
    } else {
      console.log(`\nFetching live Place Details for placeId=${placeId} ...\n`);
      const details = await fetchPlacesDetailsRaw(placeId, GOOGLE_MAPS_API_KEY);
      console.log('Raw Places API response:');
      console.log(JSON.stringify(details, null, 2));

      if (details.status === 'OK') {
        const r = details.result;
        console.log('\n  → Live rating:        ', r.rating ?? '(none)');
        console.log('  → Live user_ratings_total:', r.user_ratings_total ?? '(none)');
        console.log('  → Live types:          ', r.types);
        console.log('  → deriveCategory(types) would produce:', deriveCategory(r.types) || '(undefined → falls back to "Local Business")');
        console.log('  → editorial_summary.overview:', r.editorial_summary?.overview || '(none — most listings don\'t have one)');
      }
    }
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  TAKEAWAY');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`
  Compare the "Live rating" / "Live user_ratings_total" above against the
  "Stored Review docs" count and the Audit's reviewAnalysis printed above.
  If live numbers are non-zero but stored Review docs = 0, that confirms:
  the correct Place ID resolves fine and Google returns real data — our
  pipeline just never carries it into the report (see PLACES_DETAILS →
  free-report/page.tsx handleSelect(), which drops rating/totalReviews
  before they're ever POSTed to /api/free-report/start; and fastMode
  audits, which skip review sync entirely — auditService.ts line ~91).
`);

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
