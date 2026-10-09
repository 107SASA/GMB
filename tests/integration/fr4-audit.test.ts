/**
 * FR-4.1, FR-4.2, FR-4.4, FR-4.5. Pure. Keyword research is not covered
 * because it is unchanged.
 *
 * Run with: node --experimental-strip-types --test tests/integration/fr4-audit.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuditScore } from '../../src/services/audit/fr4/score.ts';
import { buildCompetitorBenchmark, postsInLast30Days } from '../../src/services/audit/fr4/benchmark.ts';
import { fixabilityFor, fr4Severity, impactFor, toFr4Issues } from '../../src/services/audit/fr4/issues.ts';
import { buildWebsiteAudit, compareNapField, comparePhone, napNormalize } from '../../src/services/audit/fr4/website.ts';
import { websiteFindings } from '../../src/services/audit/fr4/websiteFindings.ts';
import { extractPage, robotsTxtDisallowAll } from '../../src/services/intel/websiteExtract.ts';
import { compareAudits, type ComparableSnapshot } from '../../src/services/audit/optimizationPlan.ts';
import type { Finding } from '../../src/services/audit/findings.ts';
import type { SearchObservation } from '../../src/services/audit/facts.ts';

const baseScore = {
  completionPercentage: 80 as number | null,
  primaryCategoryState: 'verified_present' as const,
  primaryCategory: 'Plumber',
  serviceNames: ['Blocked drain repair'],
  servicesState: 'unknown' as const,
  attributesState: 'unknown' as const,
  photos: { status: 'not_measured' as const, count: null, scope: null },
  posts: { status: 'not_measured' as const, total: null, newestAgeDays: null },
  reviews: { status: 'not_measured' as const, count: null, medianCompetitorCount: null },
  nap: 'unknown' as const,
  website: { status: 'not_measured' as const, score: null, note: 'not measured' },
  schema: { status: 'not_measured' as const, score: null, note: 'not measured' },
};

test('FR-4.1: unknown and unavailable are excluded from the overall score', () => {
  const score = buildAuditScore({
    ...baseScore,
    completionPercentage: null,
    primaryCategoryState: 'unknown',
    servicesState: 'unknown',
    attributesState: 'not_applicable',
  });
  assert.equal(score.overall, null);
  assert.equal(score.dimensions.find((d) => d.id === 'services')?.score, null);
  assert.equal(score.dimensions.find((d) => d.id === 'services')?.status, 'not_measured');
  assert.equal(score.dimensions.find((d) => d.id === 'attributes')?.status, 'unavailable');
  assert.ok(score.dimensions.every((d) => d.evidenceIds.length > 0));
});

test('FR-4.1: measured dimensions average, and a verified zero is a zero', () => {
  const score = buildAuditScore({
    ...baseScore,
    completionPercentage: 50,
    servicesState: 'verified_missing',
    attributesState: 'verified_present',
    photos: { status: 'measured', count: 0, scope: 'owner_media' },
    reviews: { status: 'measured', count: 3, medianCompetitorCount: 6 },
  });
  const services = score.dimensions.find((d) => d.id === 'services');
  const photos = score.dimensions.find((d) => d.id === 'photos');
  const reviews = score.dimensions.find((d) => d.id === 'reviews');
  assert.equal(services?.score, 0);
  assert.equal(photos?.score, 0);
  assert.equal(reviews?.score, 50);
  assert.equal(score.dimensions.find((d) => d.id === 'categoryFit')?.status, 'not_measured');
  const measured = score.dimensions.filter((d) => d.status === 'measured').map((d) => d.score as number);
  assert.equal(score.overall, Math.round(measured.reduce((s, n) => s + n, 0) / measured.length));
});

test('FR-4.1: reviews without a competitor median are not scored as zero', () => {
  const score = buildAuditScore({ ...baseScore, reviews: { status: 'measured', count: 3, medianCompetitorCount: null } });
  assert.equal(score.dimensions.find((d) => d.id === 'reviews')?.status, 'not_measured');
  assert.equal(score.dimensions.find((d) => d.id === 'reviews')?.score, null);
});

function obs(over: Partial<SearchObservation>): SearchObservation {
  return {
    keyword: 'plumber nashik',
    kind: 'primary',
    status: 'ok',
    found: true,
    rank: 4,
    ahead: [],
    target: { position: 4, name: 'Mulsetu', placeId: 'self' },
    ...over,
  };
}

test('FR-4.2: keeps the first five competitors in rank order and drops the business itself', () => {
  const ahead = [1, 2, 3, 6].map((position) => ({
    position, name: `C${position}`, placeId: `p${position}`, reviewCount: position * 10, category: 'Plumber', totalPhotos: position,
  }));
  ahead.splice(2, 0, { position: 4, name: 'Mulsetu', placeId: 'self', reviewCount: 3, category: 'Plumber', totalPhotos: 9 });
  const bench = buildCompetitorBenchmark({
    observations: [obs({ ahead, others: [{ position: 5, name: 'C5', placeId: 'p5' }, { position: 7, name: 'C7', placeId: 'p7' }] })],
    history: null,
    historyAt: null,
    now: '2026-10-08T00:00:00.000Z',
    subjectReviewCount: 3,
    subjectPhotoCount: null,
    subjectPostsLast30Days: null,
  });
  const names = bench.keywords[0].competitors.map((c) => c.name);
  assert.deepEqual(names, ['C1', 'C2', 'C3', 'C5', 'C6']);
  assert.deepEqual(bench.keywords[0].competitors.map((c) => c.position), [1, 2, 3, 5, 6]);
  assert.equal(bench.keywords[0].competitors[0].reviewVelocityStatus, 'not_measured');
  assert.equal(bench.keywords[0].competitors[0].reviewVelocityPerMonth, null);
  assert.equal(bench.keywords[0].competitors[0].photoCount, 1);
  assert.equal(bench.keywords[0].competitors[3].photoCountStatus, 'not_measured');
  assert.equal(bench.keywords[0].competitors[0].postingFrequencyStatus, 'not_measured');
  assert.equal(bench.subject.reviewVelocityStatus, 'not_measured');
  assert.equal(bench.subject.reviewVelocityPerMonth, null);
});

test('FR-4.2: review velocity uses a previous measured count and is not zero when history is missing', () => {
  const bench = buildCompetitorBenchmark({
    observations: [obs({ ahead: [{ position: 1, name: 'C1', placeId: 'p1', reviewCount: 30 }] })],
    history: [
      { at: '2026-09-08T00:00:00.000Z', placeId: 'p1', name: 'C1', reviewCount: 20 },
      { at: '2026-09-08T00:00:00.000Z', placeId: '__subject__', name: '', reviewCount: 3 },
    ],
    historyAt: '2026-09-08T00:00:00.000Z',
    now: '2026-10-08T00:00:00.000Z',
    subjectReviewCount: 5,
    subjectPhotoCount: 9,
    subjectPostsLast30Days: 2,
  });
  assert.equal(bench.keywords[0].competitors[0].reviewVelocityStatus, 'measured');
  assert.ok((bench.keywords[0].competitors[0].reviewVelocityPerMonth || 0) > 0);
  assert.equal(bench.subject.reviewVelocityStatus, 'measured');
  assert.equal(bench.subject.postsLast30Days, 2);
  assert.equal(bench.subject.postingFrequencyPerMonth, 2);
  const none = postsInLast30Days(
    [{ createTime: '2026-10-01T00:00:00.000Z' }, { createTime: '2026-09-20T00:00:00.000Z' }],
    true,
    new Date('2026-10-08T00:00:00.000Z'),
  );
  assert.equal(none, null);
});

function finding(over: Partial<Finding>): Finding {
  return {
    id: 'reviews.volume_gap',
    category: 'reviews',
    title: 'Fewer reviews',
    evidence: 'You: 3. Median: 24.',
    evidenceIds: ['reviews.lifetime'],
    source: 'calculated',
    severity: 'high',
    confidence: 'high',
    businessImpact: 'Fewer reviews than the businesses above you.',
    actionability: 'indirectly_influenceable',
    growwmaticsCapability: 'review_requests',
    recommendedAction: 'Ask recent customers.',
    ...over,
  };
}

test('FR-4.4: existing high findings stay high; critical is limited; nothing executes automatically', () => {
  const issues = toFr4Issues([
    finding({}),
    finding({ id: 'website.nap_mismatch', severity: 'high', growwmaticsCapability: 'update_phone' }),
    finding({ id: 'website.not_indexable', severity: 'high', growwmaticsCapability: null }),
    finding({ id: 'ranking.track', severity: 'low', growwmaticsCapability: 'rank_tracking' }),
    finding({ id: 'profile.hours', severity: 'medium', growwmaticsCapability: null }),
  ], { reviewCount: 3, medianReviews: 24 });
  assert.equal(fr4Severity(finding({})), 'high');
  assert.equal(issues[0].severity, 'high');
  assert.equal(issues[0].impactScore, 88);
  assert.match(issues[0].impactBasis, /Not a revenue estimate/);
  assert.equal(issues[1].severity, 'critical');
  assert.equal(issues[2].severity, 'critical');
  assert.equal(issues[0].action.fixability, 'FIXABLE_WITH_APPROVAL');
  assert.equal(issues[0].action.executesAutomatically, false);
  assert.equal(fixabilityFor('update_description'), 'FIXABLE_WITH_APPROVAL');
  assert.equal(issues[3].action.fixability, 'NOT_SUPPORTED');
  assert.equal(issues[4].action.fixability, 'MANUAL_ACTION_REQUIRED');
  assert.equal(impactFor(finding({ id: 'profile.hours' }), {}).impactScore, null);
});

const site = {
  crawled: true,
  title: 'Mulsetu',
  phones: ['+91 84858 60323'],
  textSample: 'Visit us at Shop No 5 Nashik Rd',
  schemaTypes: [] as string[],
  jsonLdBlocks: 0,
  jsonLdErrors: 0,
  jsonLdUntyped: 0,
  mapEmbeds: [] as string[],
  requestedUrl: 'https://mulsetu.example',
  finalUrl: 'https://mulsetu.example/',
  robotsMeta: null as string | null,
  xRobotsTag: null as string | null,
  canonical: 'https://mulsetu.example/',
  robotsTxtFetched: true,
  robotsTxtDisallowAll: false,
  sitemapSeen: true,
  pageNoindex: false,
  gbp: { name: 'Mulsetu', phone: '08485860323', address: 'Shop No. 5, Nashik Road' },
};

test('FR-4.5: NAP normalisation matches formatting differences and detects a real phone mismatch', () => {
  assert.equal(napNormalize('Shop No. 5, Nashik Road'), napNormalize('Shop No 5 Nashik Rd'));
  assert.equal(compareNapField('Shop No. 5, Nashik Road', 'Shop No 5 Nashik Rd'), 'matched');
  assert.equal(compareNapField('Mulsetu | Home', 'Mulsetu'), 'matched');
  assert.equal(comparePhone('+91 84858 60323', '8485860323'), 'matched');
  const matched = buildWebsiteAudit(site);
  assert.equal(matched.nap.phone, 'matched');
  assert.equal(matched.nap.address, 'matched');
  assert.equal(matched.nap.overall, 'matched');
  const mismatch = buildWebsiteAudit({ ...site, phones: ['99999 99999'] });
  assert.equal(mismatch.nap.phone, 'mismatch');
  assert.equal(mismatch.nap.overall, 'mismatch');
  const unknown = buildWebsiteAudit({ ...site, gbp: null, phones: [] });
  assert.equal(unknown.nap.overall, 'unknown');
});

test('FR-4.5: map, schema, https, and indexability follow what was fetched', () => {
  const addressOnly = extractPage('<html><body><p>Shop No 5 Nashik Road</p></body></html>', 'https://mulsetu.example/');
  assert.deepEqual(addressOnly.mapEmbeds, []);
  const mapped = extractPage('<html><body><iframe src="https://www.google.com/maps/embed?pb=1"></iframe></body></html>', 'https://mulsetu.example/');
  assert.equal(mapped.mapEmbeds?.length, 1);
  const broken = extractPage('<html><head><script type="application/ld+json">{not json}</script></head></html>', 'https://mulsetu.example/');
  assert.equal(broken.jsonLdErrors, 1);
  const typed = extractPage('<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"Mulsetu"}</script></head></html>', 'https://mulsetu.example/');
  assert.equal(typed.jsonLdErrors, 0);
  assert.ok(typed.jsonLd.some((n) => n['@type'] === 'LocalBusiness'));

  const invalid = buildWebsiteAudit({ ...site, jsonLdBlocks: 1, jsonLdErrors: 1, schemaTypes: [] });
  assert.equal(invalid.schema.validity, 'INVALID');
  assert.equal(invalid.schema.richResultEligible, null);
  const valid = buildWebsiteAudit({ ...site, jsonLdBlocks: 1, schemaTypes: ['LocalBusiness'] });
  assert.equal(valid.schema.validity, 'VALID');
  assert.equal(valid.schema.richResultEligible, null);

  const http = buildWebsiteAudit({ ...site, requestedUrl: 'http://mulsetu.example', finalUrl: 'http://mulsetu.example/' });
  assert.equal(http.https.enabled, false);
  assert.equal(http.https.redirectedToHttps, false);
  const redirected = buildWebsiteAudit({ ...site, requestedUrl: 'http://mulsetu.example', finalUrl: 'https://mulsetu.example/' });
  assert.equal(redirected.https.enabled, true);
  assert.equal(redirected.https.redirectedToHttps, true);

  const blocked = buildWebsiteAudit({ ...site, pageNoindex: true, robotsMeta: 'noindex, nofollow' });
  assert.equal(blocked.indexability.status, 'NOT_INDEXABLE');
  assert.equal(robotsTxtDisallowAll('User-agent: *\nDisallow: /\n'), true);
  assert.equal(robotsTxtDisallowAll('User-agent: *\nDisallow: /\nAllow: /\n'), false);
  const robots = buildWebsiteAudit({ ...site, robotsTxtDisallowAll: true, pageNoindex: false });
  assert.equal(robots.indexability.status, 'NOT_INDEXABLE');
  const partial = buildWebsiteAudit({ ...site, robotsTxtFetched: false, robotsTxtDisallowAll: null });
  assert.equal(partial.indexability.status, 'PARTIAL');
  const dark = buildWebsiteAudit({ ...site, crawled: false, jsonLdBlocks: null, jsonLdErrors: null, jsonLdUntyped: null, mapEmbeds: null, finalUrl: null });
  assert.equal(dark.indexability.status, 'UNKNOWN');
  assert.equal(dark.map.status, 'not_measured');
  assert.equal(dark.mobile.status, 'NOT_MEASURED');
  assert.equal(dark.performance.status, 'NOT_MEASURED');
  assert.equal(dark.https.status, 'not_measured');
});

test('FR-4.5: measured website problems become findings; unknown checks do not', () => {
  const bad = buildWebsiteAudit({ ...site, phones: ['9999999999'], mapEmbeds: [], pageNoindex: true, finalUrl: 'http://mulsetu.example/', jsonLdBlocks: 0 });
  const ids = websiteFindings(bad).map((f) => f.id);
  assert.ok(ids.includes('website.nap_mismatch'));
  assert.ok(ids.includes('website.map_missing'));
  assert.ok(ids.includes('website.not_indexable'));
  assert.ok(ids.includes('website.https_off'));
  assert.ok(ids.includes('website.schema_missing'));
  assert.equal(websiteFindings(buildWebsiteAudit({ ...site, crawled: false, mapEmbeds: null, jsonLdBlocks: null, jsonLdErrors: null, jsonLdUntyped: null, finalUrl: null, gbp: null })).length, 0);
});

test('FR-4 score is not compared with profile completion', () => {
  const base: ComparableSnapshot = {
    auditId: 'a', kind: 'monthly', at: '2026-09-01T00:00:00.000Z', keywords: ['k'], searches: 1,
    foundCount: 1, top3Count: 0, averageObservedRank: 4, reviewCount: 3, rating: 5,
    completionPercentage: 75, completionScope: 'full', completionBasis: 'gbp_intelligence',
  };
  const mixed = compareAudits(base, { ...base, auditId: 'b', fr4Overall: 60, fr4ScoreVersion: 'fr4-v1' });
  const row = mixed.rows.find((r) => r.metric === 'FR-4 audit score');
  assert.equal(row?.change, 'not_comparable');
  assert.match(row?.note || '', /profile completion/);
  const both = compareAudits(
    { ...base, fr4Overall: 40, fr4ScoreVersion: 'fr4-v1' },
    { ...base, auditId: 'c', fr4Overall: 60, fr4ScoreVersion: 'fr4-v1' },
  );
  assert.equal(both.rows.find((r) => r.metric === 'FR-4 audit score')?.change, 'better');
  assert.equal(both.rows.find((r) => r.metric === 'Profile completion')?.change, 'same');
});
