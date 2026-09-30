/**
 * Unit tests for the evidence / intelligence layer (Sep 2026): website
 * extraction, business-specific search terms, public listing + competitor
 * comparison, competitor insights, unverified-GBP-claim repair, audit
 * comparison, the optimization plan and onboarding prefill. Pure functions,
 * no DB, no network, no `@/` aliases.
 *
 * Run with: node --experimental-strip-types --test tests/integration/audit-intel.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPage,
  extractWebsiteFacts,
  normalizeOrigin,
  planCrawl,
  sameSite,
} from '../../src/services/intel/websiteExtract.ts';
import {
  isGroundedKeywordProposal,
  keywordSource,
  pickServiceForSearch,
  websiteServiceKeywords,
} from '../../src/services/intel/searchTerms.ts';
import { buildCompetitorInsights, commonCompetitorServices, sameService } from '../../src/services/intel/competitorInsights.ts';
import { buildIntakePrefill } from '../../src/services/intel/intakePrefill.ts';
import {
  buildObservation,
  compareCompetitors,
  competitorsFromObservations,
  publicProfileFromObservations,
  summarizeRankings,
} from '../../src/services/audit/facts.ts';
import { assertsGbpContent, repairUnverifiedGbpClaims } from '../../src/services/audit/validateAudit.ts';
import { evidenceState } from '../../src/services/audit/findings.ts';
import { auditKindOf, buildOptimizationPlan, compareAudits } from '../../src/services/audit/optimizationPlan.ts';

// ── Website extraction ──────────────────────────────────────────────────────

const HOME = `<!doctype html><html><head>
<title>Acme Tech — Software Studio</title>
<meta name="description" content="Acme Tech builds websites &amp; mobile apps for small businesses in Nashik.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme Tech",
 "hasOfferCatalog":{"@type":"OfferCatalog","itemListElement":[
  {"@type":"Offer","itemOffered":{"@type":"Service","name":"Website Development"}},
  {"@type":"Offer","itemOffered":{"@type":"Service","name":"Mobile App Development"}},
  {"@type":"Offer","itemOffered":{"@type":"Service","name":"SEO Services"}}]}}</script>
</head><body>
<nav><a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a>
<a href="https://other-site.com/x">Partner</a><a href="/book">Book Free Consultation</a>
<a href="https://www.linkedin.com/company/acme">LinkedIn</a></nav>
<h1>We build software</h1><h2>Book Free Consultation</h2>
<p>Email hello@acme.test or call +91 98765 43210.</p>
</body></html>`;

test('website: origin normalisation and same-site check', () => {
  assert.equal(normalizeOrigin('acme.test/path?x=1'), 'https://acme.test');
  assert.equal(normalizeOrigin('http://www.acme.test/'), 'https://acme.test', 'cache key: https, no www');
  assert.equal(normalizeOrigin('not a url'), null);
  assert.ok(sameSite('https://www.acme.test/a', 'https://acme.test/b'));
  assert.ok(!sameSite('https://acme.test', 'https://other-site.com'));
});

test('website: crawl plan stays on-site, within the page budget, and prioritises service/about/contact', () => {
  const home = extractPage(HOME, 'https://acme.test/');
  const plan = planCrawl(home, 3);
  assert.ok(plan.length <= 2, 'home counts toward the budget');
  assert.ok(plan.every((p) => p.url.startsWith('https://acme.test/')));
  assert.ok(!plan.some((p) => p.url.includes('other-site.com')));
});

test('website: navigation labels and CTAs are never services (live Wix nav, Sep 2026)', () => {
  const html = `<html><head><title>Academy</title></head><body>
    <h1>IT Training</h1><h2>Explore Job Ready Professional Courses</h2><h2>Explore Our Professional Pogram</h2>
    <h2>Courses</h2><h2>Placement</h2><h2>Interview</h2><h2>Hire From Us</h2><h2>Upcoming Events</h2>
    <h2>Full Stack Web Development</h2><h2>Data Science with Python</h2></body></html>`;
  const page = { ...extractPage(html, 'https://academy.test/all-courses'), kind: 'services' as const };
  const services = extractWebsiteFacts([page]).services.map((s) => s.value);
  assert.deepEqual(services, ['Full Stack Web Development', 'Data Science with Python']);
});

test('website: services come from schema first; a CTA is never a service', () => {
  const home = extractPage(HOME, 'https://acme.test/');
  const facts = extractWebsiteFacts([{ ...home, kind: 'home' }]);
  const services = facts.services.map((s) => s.value);
  assert.deepEqual(services.slice(0, 3), ['Website Development', 'Mobile App Development', 'SEO Services']);
  assert.ok(!services.some((s) => /consultation/i.test(s)), 'CTA "Book Free Consultation" must not be a service');
  assert.ok(facts.services.every((s) => s.sourceUrl === 'https://acme.test/'), 'every claim keeps its page URL');
  assert.equal(facts.description?.value, 'Acme Tech builds websites & mobile apps for small businesses in Nashik.');
  assert.ok(facts.emails.some((e) => e.value === 'hello@acme.test'));
  assert.ok(facts.socialProfiles.some((s) => /linkedin/.test(s.value)));
});

// ── Search terms ────────────────────────────────────────────────────────────

test('search terms: a generic category is replaced by a real website service', () => {
  assert.equal(pickServiceForSearch(['AI & Automation', 'Website Development', 'SaaS Development']), 'Website Development');
  assert.equal(pickServiceForSearch(['Home', 'Contact us']), null, 'no service-like name → no override');
  assert.deepEqual(websiteServiceKeywords(['Website Development', 'Mobile Apps'], 'Nashik', 2), ['website development nashik', 'mobile apps nashik']);
  assert.deepEqual(websiteServiceKeywords(['AI & Automation', 'Custom Software & ERP'], 'Ojhar', 2), ['ai and automation ojhar', 'custom software and erp ojhar'], '& never reaches Google');
});

test('search terms: keyword source labels', () => {
  const o = { websiteServices: ['Website Development'], ownerTerms: ['app development'], branded: false };
  assert.equal(keywordSource('website development nashik', o), 'website_service');
  assert.equal(keywordSource('app development nashik', o), 'owner');
  assert.equal(keywordSource('software company nashik', o), 'category');
  assert.equal(keywordSource('acme tech', { ...o, branded: true }), 'brand');
});

test('search terms: AI keyword proposals need a real service AND a real location, never the brand', () => {
  const opts = { terms: ['Website Development'], locations: ['Nashik', 'Ojhar'], brandPhrase: 'acme tech' };
  assert.ok(isGroundedKeywordProposal('website development ojhar', opts));
  assert.ok(isGroundedKeywordProposal('website development near me', opts));
  assert.ok(!isGroundedKeywordProposal('cctv installation nashik', opts), 'service not verified');
  assert.ok(!isGroundedKeywordProposal('website development pune', opts), 'location not real');
  assert.ok(!isGroundedKeywordProposal('acme tech website development nashik', opts), 'brand');
});

// ── Public listing + competitor comparison ─────────────────────────────────

const item = (name: string, placeId: string, extra: Record<string, unknown> = {}) => ({ name, placeId, rating: 4.6, reviewCount: 80, ...extra });

function sampleObservations() {
  return [
    buildObservation({
      keyword: 'website development nashik', kind: 'primary', targetPosition: 4,
      results: [
        item('A', 'a', { bookingUrl: 'https://a.test/book', website: 'https://a.test', additionalCategories: ['Web designer'] }),
        item('B', 'b', { website: 'https://b.test', additionalCategories: [] }),
        item('C', 'c', { reviewCount: 10 }),
        item('Target', 't', { reviewCount: 3, rating: 5, website: 'https://t.test', additionalCategories: null }),
      ],
    }),
    buildObservation({
      keyword: 'software company nashik', kind: 'nearby', targetPosition: null,
      results: [item('A', 'a', { bookingUrl: 'https://a.test/book', website: 'https://a.test' }), item('D', 'd')],
    }),
  ];
}

test('facts: the target public listing is read from its own result row', () => {
  const p = publicProfileFromObservations(sampleObservations());
  assert.equal(p.observed, true);
  assert.equal(p.website, 'https://t.test');
  assert.equal(p.bookingUrl, null);
});

test('facts: competitor comparison counts only what listings show', () => {
  const obs = sampleObservations();
  const comps = competitorsFromObservations(obs);
  const cmp = compareCompetitors(comps, {
    rating: 5, reviewCount: 3, profile: publicProfileFromObservations(obs), ranking: summarizeRankings(obs),
  })!;
  assert.equal(cmp.competitorsCompared, 4);
  assert.equal(cmp.medianReviewCount, 80);
  assert.equal(cmp.target.hasBookingLink, false);
  assert.equal(cmp.inTop3Somewhere, 4);
  assert.equal(cmp.withBookingLink, 0.25);
});

// ── Competitor insights ─────────────────────────────────────────────────────

test('insights: fact / meaning / recommendation, counted from real data', () => {
  const ins = buildCompetitorInsights(
    [
      { name: 'A', source: 'dataforseo', reviewCount: 120, top3Count: 2, hasBookingLink: true, hasWebsite: true, additionalCategories: ['Web designer'], websiteServices: ['Website Design', 'SEO'] },
      { name: 'B', source: 'dataforseo', reviewCount: 60, top3Count: 1, hasBookingLink: false, hasWebsite: true, additionalCategories: [], websiteServices: ['Web Design & Development', 'Branding'] },
      { name: 'Places only', source: 'google_places', reviewCount: 999 },
    ],
    { name: 'T', rating: 5, reviewCount: 3, listingObserved: true, hasWebsite: true, hasBookingLink: false, additionalCategories: null, top3Searches: 0, searches: 4, services: ['Mobile Apps'], websiteBookingUrl: 'https://t.test/book' },
  );
  const byTopic = Object.fromEntries(ins.map((i) => [i.topic, i]));
  assert.match(byTopic.reviews.fact, /2 of the 2 businesses above you that show a review count have more Google reviews than your 3; their median is 90/);
  assert.match(byTopic.booking.fact, /1 of 2/);
  assert.match(byTopic.booking.recommendation, /https:\/\/t\.test\/book/);
  assert.match(byTopic.top3.fact, /none of 4/);
  assert.ok(byTopic.services, 'design service stated by 2 competitor sites and not by the target');
  assert.match(byTopic.services.recommendation, /^Only if you genuinely offer/);
  assert.ok(!byTopic.website, 'target already shows a website');
  for (const i of ins) assert.ok(!/because|causes|due to/i.test(i.meaning), 'no causal claims');
});

test('insights: service matching is word-based and ignores filler words', () => {
  assert.ok(sameService('Website Design', 'Website Development'));
  assert.ok(sameService('SEO Services', 'Local SEO'));
  assert.ok(!sameService('Custom Services', 'Professional Services'));
  assert.deepEqual(commonCompetitorServices([{ name: 'A', websiteServices: ['SEO'] }], []), [], 'needs ≥ 2 competitor sites read');
});

// ── AI output repair / evidence states ──────────────────────────────────────

test('validation: unverified GBP claims become verification steps', () => {
  assert.equal(repairUnverifiedGbpClaims('Your GBP is missing CCTV installation.', false), 'Verify whether your Google Business Profile lists CCTV installation.');
  assert.equal(repairUnverifiedGbpClaims('There are no photos on your Google listing.', false), 'Verify whether your Google Business Profile lists photos.');
  assert.equal(repairUnverifiedGbpClaims('Your GBP is missing CCTV installation.', true), 'Your GBP is missing CCTV installation.', 'untouched when the GBP was read');
});

test('validation: GBP-content assertions are detected', () => {
  assert.ok(assertsGbpContent('Services Not Reflected on GBP'));
  assert.ok(assertsGbpContent('Your Google Business Profile lacks attributes'));
  assert.ok(!assertsGbpContent('Add your services to your Google Business Profile'));
  assert.ok(!assertsGbpContent('Fewer reviews than competitors'));
});

test('evidence: unified states', () => {
  assert.equal(evidenceState({ status: 'verified', source: 'website' }), 'SOURCE_CLAIM');
  assert.equal(evidenceState({ status: 'verified', source: 'google_places' }), 'VERIFIED');
  assert.equal(evidenceState({ status: 'unknown', source: 'google_places' }), 'UNKNOWN');
  assert.equal(evidenceState({ status: 'unavailable', source: 'dataforseo' }), 'UNAVAILABLE');
  assert.equal(evidenceState({ status: 'verified', source: 'calculated' }), 'INFERRED');
});

// ── Audit kind, comparison, optimization plan ───────────────────────────────

test('audit kind: free report vs connected baseline vs monthly', () => {
  assert.equal(auditKindOf({ fastMode: true }), 'free_report');
  assert.equal(auditKindOf({ fastMode: false, metadata: { trigger: 'audit-autopilot-first-run' } }), 'connected_baseline');
  assert.equal(auditKindOf({ fastMode: false, metadata: { trigger: 'audit-autopilot-monthly' } }), 'monthly');
  assert.equal(auditKindOf({ fastMode: false }), 'dashboard');
});

test('comparison: rankings compared only on identical searches; completion only on the same scope', () => {
  const base = { auditId: 'a', kind: 'free_report' as const, at: '2026-09-01', keywords: ['x', 'y'], searches: 6, foundCount: 2, top3Count: 0, averageObservedRank: 9, reviewCount: 3, rating: 5, completionPercentage: 80, completionScope: 'places' };
  const same = compareAudits(base, { ...base, auditId: 'b', foundCount: 4, averageObservedRank: 6, reviewCount: 7 });
  assert.equal(same.rows[0].change, 'better');
  assert.equal(same.rows[2].change, 'better', 'lower average position is better');
  assert.equal(same.rows[3].change, 'better');
  const diff = compareAudits(base, { ...base, auditId: 'c', keywords: ['z'], searches: 45, completionScope: 'full' });
  assert.equal(diff.rows[0].change, 'not_comparable');
  assert.equal(diff.rows[5].change, 'not_comparable');
});

test('optimization plan: evidence, executor, owner confirmation, measurement', () => {
  const plan = buildOptimizationPlan([
    { id: 'reviews.none_replied', category: 'reviews', title: 't', evidence: 'e', evidenceIds: [], source: 'serpapi', severity: 'medium', actionability: 'directly_fixable', growwmaticsCapability: 'review_replies', recommendedAction: 'Reply' },
    { id: 'website.services.verify_on_gbp', category: 'website', title: 't', evidence: 'site', evidenceIds: [], source: 'website', severity: 'low', actionability: 'directly_fixable', growwmaticsCapability: null, recommendedAction: 'Verify' },
    { id: 'ranking.x', category: 'ranking', title: 't', evidence: 'e', evidenceIds: [], source: 'dataforseo', severity: 'high', actionability: 'monitor_only', growwmaticsCapability: null, recommendedAction: 'Watch' },
  ]);
  assert.equal(plan.length, 2, 'monitor-only items are not plan items');
  assert.equal(plan[0].executor, 'growwmatics:review_replies');
  assert.equal(plan[1].executor, 'owner_in_google');
  assert.equal(plan[1].requiresOwnerConfirmation, true, 'website claims need owner confirmation');
  assert.ok(plan.every((p) => p.executionStatus === 'not_started' && p.measurement));
});

// ── Onboarding prefill ──────────────────────────────────────────────────────

test('prefill: only empty fields, every suggestion sourced, never auto-saved', () => {
  const s = buildIntakePrefill({
    business: { description: '', services: 'Already mine', keywords: [], category: 'Services' },
    website: {
      status: 'complete',
      description: { value: 'We build apps.', sourceUrl: 'https://t.test/' },
      services: [{ value: 'Website Development', sourceUrl: 'https://t.test/services' }],
      credentials: [{ value: 'ISO 9001 certified', sourceUrl: 'https://t.test/about' }],
    },
    measuredKeywords: [{ keyword: 'website development nashik', source: 'website_service' }, { keyword: 'acme tech', source: 'brand' }],
    listingCategory: 'Services',
  });
  assert.equal(s.description?.value, 'We build apps.');
  assert.equal(s.description?.source, 'website');
  assert.equal(s.description?.sourceUrl, 'https://t.test/');
  assert.equal(s.services, undefined, "owner's own answer is never replaced");
  assert.equal(s.keywords?.value, 'website development nashik', 'brand searches excluded');
  assert.equal(s.uniqueSellingPoints?.value, 'ISO 9001 certified');
  assert.equal(s.category, undefined, 'a category is already set');
  const failed = buildIntakePrefill({ business: {}, website: { status: 'failed', description: { value: 'x' } } });
  assert.equal(failed.description, undefined, 'failed crawl → no suggestion');
});
