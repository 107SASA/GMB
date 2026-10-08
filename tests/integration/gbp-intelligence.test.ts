/**
 * GBP Intelligence (FR-3.2 → FR-3.6) — sync orchestrator, normalization,
 * change detection, health, duplicates, review paging, token classification
 * and the audit / SEO Brain inputs. Every Google response is mocked; nothing
 * here touches the network or a database.
 * Run: node --experimental-strip-types --test tests/integration/gbp-intelligence.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runGbpIntelligenceSync, emptySections, MEDIA_POSTS_TTL_HOURS, type SyncDeps } from '../../src/services/gbp/intelligence/sync.ts';
import { normalizeLocation, normalizeAttributes, normalizeVoiceOfMerchant, timeOfDay, LOCATION_READ_MASK } from '../../src/services/gbp/intelligence/normalize.ts';
import { canonicalizeLocation, detectChanges, canonPhone, canonWebsite } from '../../src/services/gbp/intelligence/changes.ts';
import { computeHealth } from '../../src/services/gbp/intelligence/health.ts';
import { scoreCandidate, needsPlacesSearch, napFingerprint, tokenSimilarity } from '../../src/services/gbp/intelligence/duplicates.ts';
import { classifyGoogleError, classifyTokenRefreshFailure, sanitizeErrorMessage, GoogleApiRequestError } from '../../src/services/gbp/intelligence/errors.ts';
import { createGbpReadApi, searchPlacesNear, type FetchFn } from '../../src/services/gbp/intelligence/googleApi.ts';
import {
  checklistStatesFromSnapshot,
  fieldSourcesFromSnapshot,
  gbpIntelligenceEvidence,
  gbpIntelligenceFindings,
  gbpLiveFromSnapshot,
  seoBrainGbpLines,
  snapshotUsableForAudit,
  gbpServiceNames,
} from '../../src/services/gbp/intelligence/auditInput.ts';
import { collectGbpReviews, chooseReviewSyncMode, reportedReviewConflicts } from '../../src/services/reviews/providers/gbpReviewPaging.ts';
import { buildEvidenceAndFindings, describeEvidence } from '../../src/services/audit/findings.ts';
import { summarizeRankings, competitorsAhead, buildReviewFacts, suspensionRiskHeuristic } from '../../src/services/audit/facts.ts';
import { compareAudits } from '../../src/services/audit/optimizationPlan.ts';
import type { GbpSnapshotCore, GbpReviewsSummary } from '../../src/services/gbp/intelligence/types.ts';

// ── Fixtures (shapes follow the public Business Profile API reference) ─────

const RAW_LOCATION = {
  name: 'locations/111',
  title: 'Sahyadri Tile Works',
  storeCode: 'STW-1',
  languageCode: 'en',
  phoneNumbers: { primaryPhone: '+91 98220 12345', additionalPhones: ['0253 2345678'] },
  categories: {
    primaryCategory: { name: 'categories/gcid:tile_contractor', displayName: 'Tile contractor' },
    additionalCategories: [{ name: 'categories/gcid:flooring_contractor', displayName: 'Flooring contractor' }],
  },
  storefrontAddress: { regionCode: 'IN', postalCode: '422013', administrativeArea: 'Maharashtra', locality: 'Nashik', addressLines: ['12 Gangapur Road'] },
  websiteUri: 'https://www.sahyadritiles.in/',
  regularHours: { periods: [
    { openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 18, minutes: 30 } },
    { openDay: 'TUESDAY', openTime: { hours: 9, minutes: 0 }, closeDay: 'TUESDAY', closeTime: { hours: 18, minutes: 30 } },
  ] },
  specialHours: { specialHourPeriods: [{ startDate: { year: 2099, month: 10, day: 20 }, closed: true }] },
  serviceArea: { businessType: 'CUSTOMER_AND_BUSINESS_LOCATION', places: { placeInfos: [{ placeName: 'Nashik Road', placeId: 'ChIJ-area' }] }, regionCode: 'IN' },
  latlng: { latitude: 20.00588, longitude: 73.76323 },
  openInfo: { status: 'OPEN', canReopen: true },
  metadata: { placeId: 'ChIJ-own', mapsUri: 'https://maps.google.com/?cid=1', hasGoogleUpdated: false, hasPendingEdits: false, hasVoiceOfMerchant: true, canModifyServiceList: true },
  profile: { description: 'Tile installation and bathroom renovation in Nashik.' },
  serviceItems: [
    { freeFormServiceItem: { category: 'categories/gcid:tile_contractor', label: { displayName: 'Bathroom renovation', description: 'Full bathroom retiling' } } },
    { structuredServiceItem: { serviceTypeId: 'job_type_id:tile_installation' } },
  ],
};
const RAW_ATTRIBUTES = { name: 'locations/111/attributes', attributes: [
  { name: 'attributes/has_wheelchair_accessible_entrance', valueType: 'BOOL', values: [true] },
  { name: 'attributes/url_appointment', valueType: 'URL', uriValues: [{ uri: 'https://sahyadritiles.in/book' }] },
] };
const RAW_VOM_OK = { hasVoiceOfMerchant: true, hasBusinessAuthority: true };
const MEDIA = [
  { category: 'LOGO', mediaFormat: 'PHOTO', createTime: '2026-09-01T00:00:00Z' },
  { category: 'COVER', mediaFormat: 'PHOTO', createTime: '2026-09-02T00:00:00Z' },
  { category: 'ADDITIONAL', mediaFormat: 'VIDEO', createTime: '2026-09-03T00:00:00Z' },
  { category: 'ADDITIONAL', mediaFormat: 'PHOTO', createTime: '2026-10-01T00:00:00Z' },
];
const POSTS = [
  { name: 'accounts/1/locations/111/localPosts/a', topicType: 'STANDARD', state: 'LIVE', summary: 'New tiles in stock', createTime: '2026-10-01T00:00:00Z' },
  { name: 'accounts/1/locations/111/localPosts/b', topicType: 'OFFER', state: 'LIVE', summary: 'Festive offer', createTime: '2026-09-15T00:00:00Z' },
];
const REVIEWS: GbpReviewsSummary = { googleTotalCount: 42, googleAverageRating: 4.7, storedCount: 42, unrepliedCount: 3, newestReviewAt: '2026-10-02T00:00:00Z', complete: true, lastSyncMode: 'full', lastSyncAt: '2026-10-06T00:00:00Z', conflicts: 0 };

const T0 = new Date('2026-10-07T06:00:00Z');
const hoursLater = (h: number) => new Date(T0.getTime() + h * 3_600_000);

type Overrides = Partial<Record<'getLocation' | 'getAttributes' | 'getVoiceOfMerchantState' | 'getGoogleUpdated' | 'listLocalPosts' | 'listMedia' | 'searchPlaces' | 'token', () => Promise<any>>>;

function mockDeps(now: Date, o: Overrides = {}): { deps: SyncDeps; calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const hit = (k: string) => { calls[k] = (calls[k] || 0) + 1; };
  const deps: SyncDeps = {
    now: () => now,
    getAccessToken: async () => { hit('token'); return o.token ? o.token() : 'ya29.test-token'; },
    api: {
      getLocation: async () => { hit('getLocation'); return o.getLocation ? o.getLocation() : structuredClone(RAW_LOCATION); },
      getAttributes: async () => { hit('getAttributes'); return o.getAttributes ? o.getAttributes() : RAW_ATTRIBUTES; },
      getVoiceOfMerchantState: async () => { hit('getVoiceOfMerchantState'); return o.getVoiceOfMerchantState ? o.getVoiceOfMerchantState() : RAW_VOM_OK; },
      getGoogleUpdated: async () => { hit('getGoogleUpdated'); return o.getGoogleUpdated ? o.getGoogleUpdated() : {}; },
      listLocalPosts: async () => { hit('listLocalPosts'); return o.listLocalPosts ? o.listLocalPosts() : { posts: POSTS, truncated: false }; },
    },
    listMedia: async () => { hit('listMedia'); return o.listMedia ? o.listMedia() : MEDIA; },
    readReviewsSummary: async () => { hit('readReviewsSummary'); return REVIEWS; },
    searchPlaces: async () => { hit('searchPlaces'); return o.searchPlaces ? o.searchPlaces() : []; },
    growmaticsEditedFields: async () => new Set<string>(),
  };
  return { deps, calls };
}

const input = (previous: GbpSnapshotCore | null, reason: 'connect' | 'scheduled' | 'manual' = 'scheduled', force = false) =>
  ({ businessId: 'biz-A', accountId: 'accounts/1', locationId: 'locations/111', previous, reason, force });

const fail = (status: number, body = '') => async () => { throw new GoogleApiRequestError(classifyGoogleError(status, body), status, `HTTP ${status}: ${body}`); };

// ── 1. Complete snapshot ────────────────────────────────────────────────────

test('1. one sync builds a complete snapshot with every FR-3.2 field and the minimum calls', async () => {
  const { deps, calls } = mockDeps(T0);
  const r = await runGbpIntelligenceSync(input(null, 'connect'), deps);
  const s = r.snapshot;
  const loc = s.sections.location.data!;
  assert.equal(s.sections.location.meta.status, 'SUCCESS');
  assert.equal(loc.title, 'Sahyadri Tile Works');
  assert.equal(loc.address!.postalCode, '422013');
  assert.equal(loc.address!.formatted, '12 Gangapur Road, Nashik, Maharashtra, 422013');
  assert.equal(loc.primaryPhone, '+91 98220 12345');
  assert.equal(loc.websiteUri, 'https://www.sahyadritiles.in/');
  assert.equal(loc.regularHours!.length, 2);
  assert.equal(loc.regularHours![0].openTime, '09:00', 'proto3 {hours:9} → 09:00');
  assert.equal(loc.specialHours[0].closed, true);
  assert.equal(loc.primaryCategory!.name, 'categories/gcid:tile_contractor');
  assert.deepEqual(loc.additionalCategories.map((c) => c.displayName), ['Flooring contractor']);
  assert.equal(loc.services.length, 2);
  assert.equal(loc.description, 'Tile installation and bathroom renovation in Nashik.');
  assert.deepEqual(loc.latlng, { latitude: 20.00588, longitude: 73.76323 });
  assert.equal(loc.metadata.placeId, 'ChIJ-own');
  assert.equal(loc.resourceName, 'locations/111');
  assert.equal(s.sections.attributes.data!.length, 2);
  assert.equal(s.sections.verification.data!.hasVoiceOfMerchant, true);
  assert.equal(s.sections.media.data!.photos, 3);
  assert.equal(s.sections.media.data!.videos, 1);
  assert.equal(s.sections.posts.data!.total, 2);
  assert.equal(s.sections.reviews.data!.storedCount, 42);
  assert.equal(s.sections.products.meta.status, 'NOT_AVAILABLE');
  assert.equal(s.sections.products.data, null);
  assert.equal(s.lastSyncOutcome, 'SUCCESS');
  assert.equal(s.health.state, 'HEALTHY');
  // ONE location read for every profile field; Google-updated not asked (flag false).
  assert.deepEqual(r.calls, { 'locations.get': 1, 'locations.getAttributes': 1, 'verifications.getVoiceOfMerchantState': 1, 'media.list': 1, 'localPosts.list': 1, 'places.searchText': 1 });
  assert.equal(calls.token, 1, 'one token per run, shared by every call');
  assert.equal(calls.getGoogleUpdated, undefined);
  assert.deepEqual(r.newChanges, [], 'first snapshot is a baseline, not a change');
  assert.equal(r.profileForBusiness!.primaryCategory, 'Tile contractor', 'worker gap-fill reuses this read');
  assert.ok(LOCATION_READ_MASK.includes('regularHours') && LOCATION_READ_MASK.includes('serviceItems') && LOCATION_READ_MASK.includes('metadata'));
});

// ── 2. Partial failure ──────────────────────────────────────────────────────

test('2. a failed section keeps its last successful data and is marked FAILED (never empty)', async () => {
  const first = await runGbpIntelligenceSync(input(null, 'connect'), mockDeps(T0).deps);
  const { deps } = mockDeps(hoursLater(6), { getAttributes: fail(500, 'backend error') });
  const r = await runGbpIntelligenceSync(input(first.snapshot), deps);
  const a = r.snapshot.sections.attributes;
  assert.equal(a.meta.status, 'FAILED');
  assert.equal(a.meta.error!.category, 'TEMPORARY');
  assert.equal(a.data!.length, 2, 'previous attributes preserved, not replaced by []');
  assert.equal(a.meta.lastSuccessfulFetchAt, T0.toISOString());
  assert.equal(r.snapshot.sections.location.meta.status, 'SUCCESS');
  assert.equal(r.snapshot.lastSyncOutcome, 'PARTIAL');
  assert.ok(!r.newChanges.some((c) => c.field.startsWith('attribute:')), 'a failed fetch is never read as removed attributes');
});

test('2b. location read failure → FAILED snapshot, data kept, SYNC_ERROR health (not suspension)', async () => {
  const first = await runGbpIntelligenceSync(input(null, 'connect'), mockDeps(T0).deps);
  const r = await runGbpIntelligenceSync(input(first.snapshot), mockDeps(hoursLater(6), { getLocation: fail(503) }).deps);
  assert.equal(r.snapshot.lastSyncOutcome, 'FAILED');
  assert.equal(r.snapshot.sections.location.data!.title, 'Sahyadri Tile Works');
  assert.equal(r.snapshot.lastSuccessfulSyncAt, T0.toISOString());
  assert.equal(r.snapshot.health.state, 'SYNC_ERROR');
  assert.ok(!r.snapshot.health.issues.some((i) => i.state === 'SUSPENDED'));
  assert.equal(r.profileForBusiness, null, 'worker falls back to its own read');
});

// ── 3/4/5/6. Reuse, no duplicate calls, scheduled vs on-demand ─────────────

test('3. scheduled run within the TTL reuses media, posts and the Places cache', async () => {
  const first = await runGbpIntelligenceSync(input(null, 'connect'), mockDeps(T0).deps);
  const { deps, calls } = mockDeps(hoursLater(6));
  const r = await runGbpIntelligenceSync(input(first.snapshot, 'scheduled'), deps);
  assert.deepEqual(r.calls, { 'locations.get': 1, 'locations.getAttributes': 1, 'verifications.getVoiceOfMerchantState': 1 });
  assert.equal(calls.listMedia, undefined);
  assert.equal(calls.listLocalPosts, undefined);
  assert.equal(calls.searchPlaces, undefined);
  assert.equal(r.snapshot.sections.media.data!.photos, 3, 'reused, still present');
  assert.equal(r.snapshot.sections.media.meta.lastSuccessfulFetchAt, T0.toISOString());
  // After the TTL they are refreshed again.
  const later = mockDeps(hoursLater(MEDIA_POSTS_TTL_HOURS + 1));
  const r2 = await runGbpIntelligenceSync(input(r.snapshot, 'scheduled'), later.deps);
  assert.equal(r2.calls['media.list'], 1);
  assert.equal(r2.calls['localPosts.list'], 1);
});

test('4. Google-suggested edits are requested only when metadata.hasGoogleUpdated is true', async () => {
  const flagged = { ...structuredClone(RAW_LOCATION), metadata: { ...RAW_LOCATION.metadata, hasGoogleUpdated: true } };
  const { deps, calls } = mockDeps(T0, {
    getLocation: async () => flagged,
    getGoogleUpdated: async () => ({ location: { ...flagged, phoneNumbers: { primaryPhone: '+91 90000 00000' } }, diffMask: 'phoneNumbers', pendingMask: '' }),
  });
  const r = await runGbpIntelligenceSync(input(null, 'connect'), deps);
  assert.equal(calls.getGoogleUpdated, 1);
  assert.deepEqual(r.snapshot.sections.googleUpdates.data!.diffFields, ['phoneNumbers']);
  assert.equal(r.snapshot.sections.googleUpdates.data!.googleValues.primaryPhone, '9000000000');
  assert.ok(r.snapshot.health.issues.some((i) => i.code === 'GOOGLE_UPDATES'));
});

test('5. manual (on-demand) sync refreshes media/posts even when fresh; force re-runs Places', async () => {
  const first = await runGbpIntelligenceSync(input(null, 'connect'), mockDeps(T0).deps);
  const { deps, calls } = mockDeps(hoursLater(1));
  await runGbpIntelligenceSync(input(first.snapshot, 'manual', true), deps);
  assert.equal(calls.listMedia, 1);
  assert.equal(calls.listLocalPosts, 1);
  assert.equal(calls.searchPlaces, 1);
});

test('6. scheduler runs every 6 hours, manual sync emits the same event (one pipeline)', () => {
  const fns = fs.readFileSync('src/services/inngest/functions.ts', 'utf8');
  assert.match(fns, /id: "gbp-nightly-sync-scheduler", triggers: \[\{ cron: "0 \*\/6 \* \* \*" \}\]/);
  assert.match(fns, /name: "gbp\/sync.requested",\s*data: \{ businessId: b\._id\.toString\(\), reason: "scheduled" \}/);
  assert.match(fns, /step\.run\("sync-gbp-intelligence"/);
  assert.match(fns, /intelligence\?\.profileForBusiness \?\? await fetchLocationProfile\(businessId\)/, 'profile step reuses the intelligence read');
  const route = fs.readFileSync('src/app/api/gbp/sync/route.ts', 'utf8');
  assert.match(route, /name: 'gbp\/sync\.requested'/);
  assert.match(route, /reason: 'manual'/);
  assert.doesNotMatch(route, /fetchDailyMetrics|fetchLocationProfile|fetchSearchKeywords/, 'no second inline sync implementation');
});

// ── 7/8. External change detection ─────────────────────────────────────────

test('7. external changes are detected with before/after/source', async () => {
  const first = await runGbpIntelligenceSync(input(null, 'connect'), mockDeps(T0).deps);
  const changed = structuredClone(RAW_LOCATION);
  changed.regularHours.periods[0].closeTime = { hours: 20, minutes: 0 };
  changed.categories.additionalCategories = [];
  const r = await runGbpIntelligenceSync(input(first.snapshot), mockDeps(hoursLater(6), { getLocation: async () => changed }).deps);
  const hours = r.newChanges.find((c) => c.field === 'regularHours')!;
  assert.ok(hours, 'hours change detected');
  assert.equal(hours.source, 'GOOGLE_EXTERNAL_CHANGE');
  assert.equal(hours.changeType, 'modified');
  assert.match(hours.previousValue!, /MONDAY 09:00-18:30/);
  assert.match(hours.newValue!, /MONDAY 09:00-20:00/);
  const cats = r.newChanges.find((c) => c.field === 'additionalCategories')!;
  assert.equal(cats.changeType, 'removed');
  assert.equal(r.snapshot.externalChanges.length, r.newChanges.length);
});

test('8. unchanged data (and formatting-only differences) never create change records', async () => {
  const first = await runGbpIntelligenceSync(input(null, 'connect'), mockDeps(T0).deps);
  const reformatted = structuredClone(RAW_LOCATION);
  reformatted.regularHours.periods[0].openTime = { hours: 9, minutes: 0 } as any; // {hours:9} vs {hours:9, minutes:0}
  reformatted.websiteUri = 'http://sahyadritiles.in';                              // scheme / www / trailing slash
  reformatted.phoneNumbers.primaryPhone = '+919822012345';                          // spacing
  const r1 = await runGbpIntelligenceSync(input(first.snapshot), mockDeps(hoursLater(6), { getLocation: async () => reformatted }).deps);
  assert.deepEqual(r1.newChanges, []);
  const r2 = await runGbpIntelligenceSync(input(r1.snapshot), mockDeps(hoursLater(12)).deps);
  assert.deepEqual(r2.newChanges, []);
  assert.equal(r2.snapshot.externalChanges.length, 0, 'no duplicate records across runs');
  assert.equal(timeOfDay({ hours: 9 }), timeOfDay({ hours: 9, minutes: 0 }));
  assert.equal(canonWebsite('https://www.x.com/'), canonWebsite('x.com'));
  assert.equal(canonPhone('+91 98220 12345'), canonPhone('098220-12345'));
});

test('8b. a field GrowwMatics wrote itself is attributed to GrowwMatics, not to Google', () => {
  const prev = { location: { meta: { status: 'SUCCESS' as const, fetchedAt: 'x', lastSuccessfulFetchAt: 'x' }, data: normalizeLocation(RAW_LOCATION) } };
  const next = { location: { meta: { status: 'SUCCESS' as const, fetchedAt: 'y', lastSuccessfulFetchAt: 'y' }, data: normalizeLocation({ ...RAW_LOCATION, profile: { description: 'New description' } }) } };
  const ch = detectChanges({ prev, next, growmaticsEditedFields: new Set(['description']), now: T0 });
  assert.equal(ch.length, 1);
  assert.equal(ch[0].source, 'GROWMATICS_EDIT');
});

// ── 9/10. Token refresh / revocation ───────────────────────────────────────

test('9. token refresh failures are classified; only invalid_grant means revoked', () => {
  assert.equal(classifyTokenRefreshFailure(400, JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })), 'REVOKED');
  assert.equal(classifyTokenRefreshFailure(401, JSON.stringify({ error: 'invalid_client' })), 'CONFIGURATION');
  assert.equal(classifyTokenRefreshFailure(500, 'oops'), 'TEMPORARY');
  assert.equal(classifyTokenRefreshFailure(429, ''), 'TEMPORARY');
  assert.equal(classifyTokenRefreshFailure(null, ''), 'TEMPORARY');
  assert.equal(classifyTokenRefreshFailure(400, 'not json'), 'CONFIGURATION', 'ambiguous 4xx never disconnects');
  assert.doesNotMatch(sanitizeErrorMessage('Authorization: Bearer ya29.a0AfB_secret refresh 1//0gSecret'), /ya29\.a0|1\/\/0g/);
  const client = fs.readFileSync('src/lib/gbpClient.ts', 'utf8');
  assert.match(client, /classifyTokenRefreshFailure\(res\.status, body\)/);
  assert.match(client, /if \(kind === 'REVOKED'\) throw new GBPAuthError/);
});

test('10. revoked access → REAUTH_REQUIRED, no Google calls, previous data preserved', async () => {
  const first = await runGbpIntelligenceSync(input(null, 'connect'), mockDeps(T0).deps);
  const revoked = async () => { const e = new Error('Google token refresh failed — user must reconnect'); e.name = 'GBPAuthError'; throw e; };
  const { deps, calls } = mockDeps(hoursLater(6), { token: revoked });
  const r = await runGbpIntelligenceSync(input(first.snapshot), deps);
  assert.equal(r.authRevoked, true);
  assert.equal(r.snapshot.health.state, 'REAUTH_REQUIRED');
  assert.equal(calls.getLocation, undefined);
  assert.deepEqual(r.calls, {});
  assert.equal(r.snapshot.sections.location.data!.title, 'Sahyadri Tile Works');
  assert.equal(r.snapshot.sections.location.meta.error!.category, 'AUTHENTICATION');
  assert.ok(!r.snapshot.health.issues.some((i) => i.code === 'SYNC_FAILED'), 'no double alert');
  assert.deepEqual(r.newChanges, []);
});

// ── 11. Health ──────────────────────────────────────────────────────────────

test('11. health states come only from Google evidence', async () => {
  const loc = { meta: { status: 'SUCCESS' as const, fetchedAt: 'x', lastSuccessfulFetchAt: 'x' }, data: normalizeLocation(RAW_LOCATION) };
  const vom = (raw: any) => ({ meta: { status: 'SUCCESS' as const, fetchedAt: 'x', lastSuccessfulFetchAt: 'x' }, data: normalizeVoiceOfMerchant(raw) });
  const h = (raw: any) => computeHealth({ authRevoked: false, location: loc, verification: vom(raw), duplicates: null, now: T0 });
  assert.equal(h({ hasVoiceOfMerchant: false, complyWithGuidelines: { recommendationReason: 'BUSINESS_LOCATION_SUSPENDED' } }).state, 'SUSPENDED');
  assert.equal(h({ hasVoiceOfMerchant: false, verify: {} }).state, 'VERIFICATION_REQUIRED');
  assert.equal(h({ hasVoiceOfMerchant: false, verify: { hasPendingVerification: true } }).state, 'VERIFICATION_PENDING');
  assert.equal(h({ hasVoiceOfMerchant: false, resolveOwnershipConflict: {} }).state, 'NEEDS_ATTENTION');
  assert.equal(h(RAW_VOM_OK).state, 'HEALTHY');
  const susp = h({ complyWithGuidelines: { recommendationReason: 'BUSINESS_LOCATION_SUSPENDED' } }).issues[0];
  assert.equal(susp.ownerActionRequired, true);
  assert.match(susp.recommendedAction, /Only the owner/);
  // Verifications API not enabled (or billing stopped) is a CONFIGURATION failure — never "suspended".
  const r = await runGbpIntelligenceSync(input(null, 'connect'), mockDeps(T0, {
    getVoiceOfMerchantState: fail(403, '{"error":{"message":"My Business Verifications API has not been used in project 1 before or it is disabled.","status":"PERMISSION_DENIED","details":[{"reason":"SERVICE_DISABLED"}]}}'),
  }).deps);
  assert.equal(r.snapshot.sections.verification.meta.status, 'FAILED');
  assert.equal(r.snapshot.sections.verification.meta.error!.category, 'CONFIGURATION');
  assert.equal(r.snapshot.health.state, 'HEALTHY', 'metadata says hasVoiceOfMerchant=true; no inference from the failure');
  assert.equal(classifyGoogleError(403, '{"error":{"message":"Billing account for project 1 is disabled","status":"PERMISSION_DENIED","details":[{"reason":"BILLING_DISABLED"}]}}'), 'CONFIGURATION');
  assert.equal(classifyGoogleError(429, ''), 'RATE_LIMIT');
  assert.equal(classifyGoogleError(404, ''), 'NOT_FOUND');
  assert.equal(classifyGoogleError(401, ''), 'AUTHENTICATION');
  // detectedAt survives later checks (first detection time).
  const first = h({ verify: {} });
  const again = computeHealth({ authRevoked: false, location: loc, verification: vom({ verify: {} }), duplicates: null, previous: { ...first, issues: first.issues.map((i) => ({ ...i, detectedAt: '2026-01-01T00:00:00.000Z' })) }, now: hoursLater(6) });
  assert.equal(again.issues[0].detectedAt, '2026-01-01T00:00:00.000Z');
});

// ── 12. Duplicate listings ──────────────────────────────────────────────────

test('12. duplicate detection: phone/name/address/distance scoring, no proximity-only matches', () => {
  const own = normalizeLocation(RAW_LOCATION);
  const dup = scoreCandidate(own, { placeId: 'ChIJ-dup', name: 'Sahyadri Tiles Works Nashik', address: '12 Gangapur Rd, Nashik', phone: '098220 12345', location: { latitude: 20.0059, longitude: 73.7633 } })!;
  assert.equal(dup.confidence, 'high');
  assert.ok(dup.signals.includes('same phone number'));
  assert.equal(scoreCandidate(own, { placeId: 'ChIJ-own', name: own.title!, phone: own.primaryPhone }), null, 'own listing excluded');
  assert.equal(scoreCandidate(own, { placeId: 'ChIJ-neighbour', name: 'Hotel Panchavati', address: '12 Gangapur Road, Nashik', phone: '0253 1111111', location: { latitude: 20.00588, longitude: 73.76323 } }), null, 'same building, different business');
  assert.ok(tokenSimilarity('Sahyadri Tile Works', 'Sahyadri Tile Works Pvt Ltd') >= 0.85);
  // Cache: no search when fresh and NAP unchanged; search when NAP changes or cache expires.
  const cache = { placesCheckedAt: T0.toISOString(), napFingerprint: napFingerprint(own) };
  assert.equal(needsPlacesSearch(own, cache, hoursLater(24)), false);
  assert.equal(needsPlacesSearch(normalizeLocation({ ...RAW_LOCATION, phoneNumbers: { primaryPhone: '+91 90000 00000' } }), cache, hoursLater(24)), true);
  assert.equal(needsPlacesSearch(own, cache, hoursLater(31 * 24)), true);
  assert.equal(needsPlacesSearch(normalizeLocation({ ...RAW_LOCATION, latlng: undefined }), null, T0), false, 'no pin → no search');
});

test('12b. a high-confidence Places duplicate becomes a health issue with a recommendation only', async () => {
  const { deps } = mockDeps(T0, { searchPlaces: async () => [{ placeId: 'ChIJ-dup', name: 'Sahyadri Tile Works', address: '12 Gangapur Road, Nashik', phone: '+91 98220 12345', location: { latitude: 20.00589, longitude: 73.76324 } }] });
  const r = await runGbpIntelligenceSync(input(null, 'connect'), deps);
  const issue = r.snapshot.health.issues.find((i) => i.code === 'POSSIBLE_DUPLICATE')!;
  assert.ok(issue);
  assert.match(issue.recommendedAction, /Verify whether this Google listing represents the same business/);
  assert.equal(r.snapshot.sections.duplicates.data!.candidates[0].placeId, 'ChIJ-dup');
  assert.equal(r.snapshot.sections.duplicates.data!.placesCheckedAt, T0.toISOString());
});

// ── 13. Tenant isolation ────────────────────────────────────────────────────

test('13. tenant isolation: snapshot, API and review identity are scoped to businessId', async () => {
  const r = await runGbpIntelligenceSync(input(null, 'connect'), mockDeps(T0).deps);
  assert.equal(r.snapshot.businessId, 'biz-A');
  const route = fs.readFileSync('src/app/api/gbp/intelligence/route.ts', 'utf8');
  assert.match(route, /requireBusinessContext\(\)/);
  assert.match(route, /getGbpSnapshot\(ctx\.businessId\)/);
  assert.doesNotMatch(route, /accessToken|refreshToken/, 'tokens never selected for the client');
  const runner = fs.readFileSync('src/services/gbp/intelligence/runner.ts', 'utf8');
  assert.match(runner, /GbpLocationSnapshot\.findOneAndUpdate\(\s*\{ businessId \}/);
  assert.match(runner, /previous\.locationId === token\.locationId/, 'snapshot of another location is never compared');
  const sync = fs.readFileSync('src/services/reviews/syncReviews.ts', 'utf8');
  assert.match(sync, /\{ businessId: bid, providerReviewId: raw\.providerReviewId \}/, 'review upsert scoped to the workspace');
  assert.match(sync, /err\?\.code !== 11000/, 'a review held by another workspace is skipped, not moved');
  const model = fs.readFileSync('src/models/GbpLocationSnapshot.ts', 'utf8');
  assert.match(model, /businessId: \{ type: Schema\.Types\.ObjectId, ref: 'Business', required: true, unique: true/);
});

// ── 14/15/16. Audit + SEO Brain ─────────────────────────────────────────────

test('14. audit consumes the snapshot: checklist, gbp_api sources, evidence and findings', async () => {
  const { snapshot } = await runGbpIntelligenceSync(input(null, 'connect'), mockDeps(T0).deps);
  assert.equal(snapshotUsableForAudit(snapshot, hoursLater(6)), true);
  assert.equal(snapshotUsableForAudit(snapshot, hoursLater(30)), false, 'stale → audit does its own live read');
  const live = gbpLiveFromSnapshot(snapshot);
  assert.deepEqual(Object.keys(live).sort(), ['additionalCategories', 'address', 'description', 'primaryCategory', 'primaryPhone', 'title', 'website']);
  const states = checklistStatesFromSnapshot(snapshot);
  assert.equal(states['Business Hours'], 'Complete');
  assert.equal(states['Services Listed'], 'Complete');
  assert.equal(states['Attributes'], 'Complete');
  assert.equal(states['Booking / Appointment Link'], 'Complete');
  assert.equal(states['Logo / Cover Image'], 'Complete');
  assert.equal(states['Videos'], 'Complete');
  assert.equal(states['Service Area'], 'Complete');
  assert.equal(states['Social Links'], undefined, 'not answered → stays Unknown');
  assert.ok(Object.values(states).every((v) => v === 'Complete' || v === 'Missing'), 'never Partial (validateAudit counts it differently)');
  const noOwnerMedia = checklistStatesFromSnapshot({ ...snapshot, sections: { ...snapshot.sections, media: { ...snapshot.sections.media, data: { ...snapshot.sections.media.data!, photos: 0, videos: 0, hasLogo: false, hasCover: false } } } });
  assert.equal(noOwnerMedia['Business Photos'], undefined, 'owner-only media list never proves "no photos"');
  assert.equal(noOwnerMedia['Logo / Cover Image'], 'Missing');
  assert.equal(fieldSourcesFromSnapshot(snapshot)['Business Hours'], 'gbp_api');
  const ev = gbpIntelligenceEvidence(snapshot, hoursLater(1));
  const products = ev.find((e) => e.id === 'gbp.products')!;
  assert.equal(products.state, 'NOT_MEASURED');
  assert.equal(ev.find((e) => e.id === 'gbp.services')!.state, 'VERIFIED');
  assert.ok(ev.every((e) => e.source === 'gbp_api'));
  assert.match(describeEvidence(ev.find((e) => e.id === 'gbp.media')!), /3 owner photos, 1 videos/);
  // Audit evidence for profile fields is labelled gbp_api when read from the GBP API.
  const base = {
    fields: { 'Business Hours': 'verified_missing' as const, Phone: 'verified_present' as const },
    title: { name: 'Sahyadri Tile Works', selfPraiseTerm: null, wordCount: 3 },
    primaryKeyword: null,
    primaryRanking: summarizeRankings([]),
    nearbyRanking: summarizeRankings([]),
    nearbyByKeyword: [],
    competitors: [],
    competitorsAhead: competitorsAhead([]),
    reviews: buildReviewFacts({ count: 10, rating: 4.5, source: 'gbp_api' } as any, { periodDays: 14, synced: false, reviews: [] }),
    reviewComparison: null,
    keywordRows: [],
    website: null,
    suspensionRisk: suspensionRiskHeuristic({ selfPraiseTerm: null }),
  } as any;
  const withSources = buildEvidenceAndFindings({ ...base, fieldSources: { 'Business Hours': 'gbp_api' } });
  assert.equal(withSources.evidence.find((e) => e.id === 'profile.business_hours')!.source, 'gbp_api');
  assert.equal(withSources.findings.find((f) => f.id === 'profile.business_hours.missing')!.source, 'gbp_api');
  // 16. Without a snapshot the existing behaviour is unchanged.
  const without = buildEvidenceAndFindings(base);
  assert.equal(without.evidence.find((e) => e.id === 'profile.business_hours')!.source, 'google_places');
  assert.deepEqual(checklistStatesFromSnapshot({ ...snapshot, sections: emptySections() }), {}, 'never-read sections add nothing');
});

test('14b. snapshot findings: health, website alignment, attributes, stale posts, external changes', async () => {
  const noAttrs = { name: 'locations/111/attributes', attributes: [] };
  const oldPosts = { posts: [{ name: 'p', topicType: 'STANDARD', state: 'LIVE', createTime: '2026-05-01T00:00:00Z' }], truncated: false };
  const first = await runGbpIntelligenceSync(input(null, 'connect'), mockDeps(T0, { getAttributes: async () => noAttrs, listLocalPosts: async () => oldPosts }).deps);
  const moved = { ...structuredClone(RAW_LOCATION), phoneNumbers: { primaryPhone: '+91 90000 11111' } };
  const r = await runGbpIntelligenceSync(input(first.snapshot), mockDeps(hoursLater(6), { getAttributes: async () => noAttrs, getLocation: async () => moved }).deps);
  const f = gbpIntelligenceFindings(r.snapshot, { websiteServices: ['Bathroom renovation'], changesSince: T0, now: hoursLater(6) });
  const ids = f.map((x) => x.id);
  assert.ok(ids.includes('gbp.attributes.none'));
  assert.ok(ids.includes('gbp.posts.stale'));
  assert.ok(ids.includes('gbp.change.primaryPhone'));
  assert.ok(ids.includes('website.gbp_services_not_on_site'), 'GBP "Tile installation" is not on the website');
  assert.ok(!f.find((x) => x.id === 'gbp.attributes.none')!.recommendedAction.match(/wheelchair|wifi/i), 'never invents which attributes apply');
  assert.ok(f.every((x) => x.evidence && x.evidenceIds.length && x.recommendedAction));
});

test('15. SeoPlan receives short, verified GBP facts (not the raw snapshot)', async () => {
  const { snapshot } = await runGbpIntelligenceSync(input(null, 'connect'), mockDeps(T0).deps);
  const lines = seoBrainGbpLines(snapshot, { changesSince: null, now: hoursLater(1) });
  const text = lines.join('\n');
  assert.match(text, /Services listed on Google: Bathroom renovation, Tile installation/);
  assert.match(text, /Opening hours: set; upcoming special hours: 1/);
  assert.match(text, /Attributes set on Google: 2/);
  assert.match(text, /Reviews synced: 42 of 42 on Google/);
  assert.match(text, /Products: not readable through the Google API/);
  assert.ok(lines.length < 20 && !text.includes('"metadata"'), 'normalized lines, never JSON');
  assert.deepEqual(gbpServiceNames(snapshot), ['Bathroom renovation', 'Tile installation']);
  const engine = fs.readFileSync('src/services/ai/seoPlanEngine.ts', 'utf8');
  assert.match(engine, /gbpIntelligenceLines\?: string\[\]/);
  assert.match(engine, /GOOGLE BUSINESS PROFILE \(read from the Google Business Profile API/);
  const audit = fs.readFileSync('src/services/audit/auditService.ts', 'utf8');
  assert.match(audit, /gbpIntelligenceLines: intelApi \? intelApi\.seoBrainGbpLines/);
  assert.match(audit, /if \(!gbpLive && depth === 'full' && business\.googleLocationId\)/, 'live read still runs when no fresh snapshot');
});

test('16b. profile completion measured with the snapshot is not compared with older audits', () => {
  const base = { auditId: 'a', kind: 'monthly' as const, at: '2026-09-01', keywords: ['x'], searches: 9, foundCount: 5, top3Count: 1, averageObservedRank: 6, reviewCount: 10, rating: 4.6, completionPercentage: 80, completionScope: 'full' };
  const cmp = compareAudits(base, { ...base, auditId: 'b', completionPercentage: 70, completionBasis: 'gbp_intelligence' });
  const row = cmp.rows.find((r) => r.metric === 'Profile completion')!;
  assert.equal(row.change, 'not_comparable');
  assert.match(row.note!, /different set of Google profile fields/);
  const same = compareAudits({ ...base, completionBasis: 'gbp_intelligence' }, { ...base, auditId: 'c', completionPercentage: 90, completionBasis: 'gbp_intelligence' });
  assert.equal(same.rows.find((r) => r.metric === 'Profile completion')!.change, 'better');
  const legacy = compareAudits(base, { ...base, auditId: 'd', completionPercentage: 85 });
  assert.equal(legacy.rows.find((r) => r.metric === 'Profile completion')!.change, 'better', 'unchanged for audits without the snapshot');
});

// ── 17. Existing connected business (no snapshot yet / older shape) ────────

test('17. an existing connected business with no or a partial snapshot syncs normally', async () => {
  const legacy: any = { businessId: 'biz-A', locationId: 'locations/111', sections: { location: { meta: { status: 'NOT_FETCHED', fetchedAt: null, lastSuccessfulFetchAt: null }, data: null } }, externalChanges: [], health: { state: 'UNKNOWN', issues: [], lastCheckedAt: T0.toISOString() } };
  const r = await runGbpIntelligenceSync(input(legacy, 'scheduled'), mockDeps(T0).deps);
  assert.equal(r.snapshot.lastSyncOutcome, 'SUCCESS');
  assert.deepEqual(r.newChanges, [], 'no previous data → nothing to compare');
  assert.equal(r.snapshot.sections.posts.meta.status, 'SUCCESS', 'missing sections are filled in');
});

// ── 18. Review sync paging ──────────────────────────────────────────────────

const review = (id: string, updateTime: string, reply?: string) => ({ reviewId: id, starRating: 'FIVE', comment: `r ${id}`, createTime: updateTime, updateTime, reviewer: { displayName: id }, ...(reply ? { reviewReply: { comment: reply } } : {}) });
const pages = (all: any[], size: number, total = all.length) => {
  const seen: Array<string | undefined> = [];
  const fetchPage = async (token: string | undefined) => {
    seen.push(token);
    const start = token ? Number(token) : 0;
    const slice = all.slice(start, start + size);
    return { reviews: slice, nextPageToken: start + size < all.length ? String(start + size) : undefined, totalReviewCount: total, averageRating: 4.66 };
  };
  return { fetchPage, seen };
};

test('18. review import: full pages past 50, incremental re-reads edited old reviews, cap is reported', async () => {
  const all = Array.from({ length: 120 }, (_, i) => review(`r${i}`, new Date(Date.UTC(2026, 9, 1) - i * 86_400_000).toISOString()));
  const full = pages(all, 50);
  const f = await collectGbpReviews(full.fetchPage, { mode: 'full', maxReviews: 1000 });
  assert.equal(f.reviews.length, 120, 'no silent 50 cap');
  assert.equal(f.run.pages, 3);
  assert.equal(f.run.hitCap, false);
  assert.deepEqual(f.totals, { count: 120, rating: 4.7 });
  // Owner replied on Google to an OLD review → it moves to the top (updateTime desc).
  const edited = { ...review('r100', '2026-10-05T00:00:00.000Z', 'Thanks!'), createTime: all[100].createTime };
  const reordered = [edited, ...all.filter((r) => r.reviewId !== 'r100')];
  const inc = await collectGbpReviews(pages(reordered, 50).fetchPage, { mode: 'incremental', maxReviews: 1000, sinceUpdateTime: f.run.maxUpdateTime });
  assert.deepEqual(inc.reviews.map((r) => r.providerReviewId), ['r100'], 'only the changed review, one page');
  assert.equal(inc.reviews[0].ownerReply, 'Thanks!');
  const capped = await collectGbpReviews(pages(all, 50).fetchPage, { mode: 'full', maxReviews: 60 });
  assert.equal(capped.reviews.length, 60);
  assert.equal(capped.run.hitCap, true);
  const known = await collectGbpReviews(pages(all, 50).fetchPage, { mode: 'known_ids', maxReviews: 1000, knownReviewIds: new Set(['r3']) });
  assert.equal(known.reviews.length, 3, 'original behaviour kept when no watermark exists');
});

test('18b. review sync mode: full first, daily backfill while incomplete, then incremental', () => {
  assert.equal(chooseReviewSyncMode({ storedCount: 0, googleTotal: null, watermark: null, lastFullSyncAt: null, now: T0 }), 'full');
  assert.equal(chooseReviewSyncMode({ storedCount: 50, googleTotal: 300, watermark: 'w', lastFullSyncAt: hoursLater(-30), now: T0 }), 'full');
  assert.equal(chooseReviewSyncMode({ storedCount: 50, googleTotal: 300, watermark: 'w', lastFullSyncAt: hoursLater(-6), now: T0 }), 'incremental', 'backfill at most daily');
  assert.equal(chooseReviewSyncMode({ storedCount: 300, googleTotal: 300, watermark: 'w', lastFullSyncAt: hoursLater(-30), now: T0 }), 'incremental');
});

test('18c. an incremental pass that imports nothing does not clear an unresolved identity conflict', () => {
  assert.equal(reportedReviewConflicts({ upsertConflicts: 3, previousConflicts: 0, storedCount: 0, googleTotal: 3 }), 3);
  assert.equal(reportedReviewConflicts({ upsertConflicts: 0, previousConflicts: 3, storedCount: 0, googleTotal: 3 }), 3, 'fetched nothing, reviews still missing');
  assert.equal(reportedReviewConflicts({ upsertConflicts: 0, previousConflicts: 3, storedCount: 3, googleTotal: 3 }), 0, 'resolved once this workspace holds them');
  assert.equal(reportedReviewConflicts({ upsertConflicts: 0, previousConflicts: 0, storedCount: 3, googleTotal: 3 }), 0);
});

// ── Request construction (no network) ──────────────────────────────────────

test('Google requests: correct endpoints, one readMask, bearer token, Places field mask', async () => {
  const urls: Array<{ url: string; init?: any }> = [];
  let postPages = 0;
  const fetchFn: FetchFn = async (url, init) => {
    urls.push({ url, init });
    const isPosts = url.includes('localPosts');
    if (isPosts) postPages++;
    return { ok: true, status: 200, json: async () => (isPosts ? { localPosts: [{ name: 'p' }], nextPageToken: postPages < 2 ? 't' : undefined } : url.includes('searchText') ? { places: [{ id: 'X', displayName: { text: 'Y' }, location: { latitude: 1, longitude: 2 } }] } : {}), text: async () => '' };
  };
  const api = createGbpReadApi(fetchFn);
  await api.getLocation('tok', 'accounts/1/locations/111');
  await api.getAttributes('tok', 'locations/111');
  await api.getVoiceOfMerchantState('tok', 'locations/111');
  await api.getGoogleUpdated('tok', 'locations/111');
  const posts = await api.listLocalPosts('tok', 'accounts/1', 'locations/111');
  assert.equal(urls[0].url, `https://mybusinessbusinessinformation.googleapis.com/v1/locations/111?readMask=${encodeURIComponent(LOCATION_READ_MASK)}`);
  assert.equal(urls[0].init.headers.Authorization, 'Bearer tok');
  assert.equal(urls[1].url, 'https://mybusinessbusinessinformation.googleapis.com/v1/locations/111/attributes');
  assert.equal(urls[2].url, 'https://mybusinessverifications.googleapis.com/v1/locations/111/VoiceOfMerchantState');
  assert.match(urls[3].url, /locations\/111:getGoogleUpdated\?readMask=/);
  assert.match(urls[4].url, /^https:\/\/mybusiness\.googleapis\.com\/v4\/accounts\/1\/locations\/111\/localPosts\?pageSize=100$/);
  assert.match(urls[5].url, /pageToken=t/);
  assert.equal(posts.posts.length, 2);
  const places = await searchPlacesNear(fetchFn, 'KEY', 'Sahyadri Tile Works', { latitude: 20, longitude: 73 }, 1000);
  const last = urls[urls.length - 1];
  assert.equal(last.init.method, 'POST');
  assert.equal(last.init.headers['X-Goog-Api-Key'], 'KEY');
  assert.match(last.init.headers['X-Goog-FieldMask'], /places\.nationalPhoneNumber/);
  assert.deepEqual(JSON.parse(last.init.body).locationBias.circle.radius, 1000);
  assert.equal(places[0].placeId, 'X');
  // Errors are classified, not swallowed.
  const failing: FetchFn = async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => '{"error":{"message":"Quota exceeded"}}' });
  await assert.rejects(createGbpReadApi(failing).getLocation('tok', 'locations/1'), (e: any) => e.category === 'RATE_LIMIT');
});

test('normalizers keep unknown fields null instead of inventing values', () => {
  const bare = normalizeLocation({ name: 'locations/9' });
  assert.equal(bare.regularHours, null, 'no hours returned → null (not [])');
  assert.equal(bare.primaryCategory, null);
  assert.equal(bare.latlng, null);
  assert.deepEqual(bare.services, []);
  assert.equal(normalizeAttributes({}).length, 0);
  assert.equal(canonicalizeLocation(bare).regularHours, 'none');
});

// ── Pre-production review additions ────────────────────────────────────────

test('first full audit waits (bounded, DB-only) for the first snapshot, before the review pre-sync', () => {
  const fns = fs.readFileSync('src/services/inngest/functions.ts', 'utf8');
  const start = fns.indexOf("export const generateAuditJob");
  const body = fns.slice(start, fns.indexOf('export const', start + 10));
  const check = body.indexOf("step.run('check-gbp-snapshot'");
  const preSync = body.indexOf("step.run('pre-sync-reviews'");
  assert.ok(check > 0 && preSync > check, 'snapshot wait runs before the review pre-sync');
  assert.match(body, /if \(!audit \|\| audit\.fastMode\) return \{ wait: false/, 'free reports never wait');
  assert.match(body, /for \(let i = 0; i < 5; i\+\+\) \{\s*await step\.sleep\(`wait-gbp-snapshot-\$\{i\}`, '15s'\)/, 'at most 75 s — inside the 5-minute PENDING cleanup');
  const waitBlock = body.slice(check, preSync);
  assert.doesNotMatch(waitBlock, /gbpClient|fetchLocationProfile|getValidToken|syncCompleteGbpIntelligence/, 'no Google calls while waiting');
  const runner = fs.readFileSync('src/services/gbp/intelligence/runner.ts', 'utf8');
  assert.match(runner, /ready: !!snap\?\.fetchedAt && snap\.locationId === token\.locationId/);
});

test('6-hourly runs reuse metrics/keywords for 20 h; connect and manual always refresh', () => {
  const fns = fs.readFileSync('src/services/inngest/functions.ts', 'utf8');
  assert.match(fns, /if \(reason === "scheduled" && tokenDoc\.lastSyncAt && now\.getTime\(\) - new Date\(tokenDoc\.lastSyncAt\)\.getTime\(\) < 20 \* 3_600_000\)/);
  assert.match(fns, /concurrency: \[\{ limit: 10 \}, \{ key: "event\.data\.businessId", limit: 1 \}\]/);
});

test('review identity: per-workspace unique index declared; providerReviewId is not globally unique', () => {
  const model = fs.readFileSync('src/models/Review.ts', 'utf8');
  assert.match(model, /ReviewSchema\.index\(\s*\{ businessId: 1, providerReviewId: 1 \},\s*\{ unique: true, partialFilterExpression: \{ providerReviewId: \{ \$type: 'string' \} \} \}/);
  assert.match(model, /providerReviewId: \{ type: String, index: true, sparse: true \}/);
  assert.doesNotMatch(model, /providerReviewId: \{[^}]*unique:\s*true/, 'field must not declare a global unique index');
  const script = fs.readFileSync('scripts/migrate-review-identity.ts', 'utf8');
  assert.match(script, /const APPLY = process\.argv\.includes\('--apply'\)/, 'dry run by default');
  assert.match(script, /if \(globalUnique && !schemaIsMigrated\(\)\)/, 'refuses to drop while the schema still declares the global index');
  assert.match(script, /if \(duplicatePairs > 0\) throw/);
  assert.ok(script.indexOf('createIndex({ businessId: 1, providerReviewId: 1 }') < script.indexOf('dropIndex(FIELD_NAME)'), 'per-workspace uniqueness exists before the global index is dropped');
  assert.doesNotMatch(script, /deleteMany|deleteOne|updateMany/, 'never modifies review documents');
});
