/**
 * SEO Intelligence 2.0 — pure logic + rendering.
 *  - stable tracked keywords (rotation, removals, proposals measured, GBP terms)
 *  - measurements and like-for-like comparison (missing ≠ zero, unavailable ≠ not found)
 *  - visibility per service and service × area, only from measurements
 *  - feedback loop: completion and outcome are separate facts
 *  - website on-page checks (evidence-backed, recommendations only)
 *  - content: focus boost, multi-word service areas pass validation, near-duplicate text rejected
 *  - full report, dashboard and PDF render the same stored values; the free report shows nothing new
 * Run: npx tsx --test tests/render/seo-intelligence.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildObservation, type SearchObservation, type CompetitorFact } from '../../src/services/audit/facts';
import { verifiedServices, buildTrackedKeywords, serviceForKeyword, TRACKING_LIMITS } from '../../src/services/seo/trackedKeywords';
import { measurementRows, compareMeasurements, addressArea } from '../../src/services/seo/measurements';
import { buildServiceVisibility, statusOf, serviceStrategyLines } from '../../src/services/seo/serviceVisibility';
import { buildStrategyHistory, historyLines, planChanges } from '../../src/services/seo/strategyHistory';
import { trackedKeywordRows, planFocus } from '../../src/services/seo/planMemory';
import { analyzeWebsiteSeo } from '../../src/services/seo/websiteSeo';
import { intelligenceView } from '../../src/services/seo/intelligenceView';
import { keywordId, serviceId, areaId } from '../../src/services/seo/ids';
import { prioritizeKeywords } from '../../src/services/content/keywordPriority';
import { validatePost, textSimilarity } from '../../src/services/content/validatePost';
import { areasIn } from '../../src/services/content/plan';
import { buildMonthlyReport } from '../../src/services/lifecycle/monthly';

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/seo-intelligence';
process.env.GROQ_API_KEY ||= 'seo-intelligence';

const NOW = new Date('2026-12-04T05:00:00Z');
const ME = 'me';
type L = { name: string; placeId: string; category?: string; reviewCount?: number };
const RIVAL: L = { name: 'Smile Dental Care', placeId: 'r1', category: 'Dentist', reviewCount: 240 };
const OTHER: L = { name: 'City Dental', placeId: 'r2', category: 'Dentist', reviewCount: 80 };

function obs(keyword: string, listings: Array<L | 'ME'>, opts: { area?: string; failed?: boolean } = {}): SearchObservation {
  const list = listings.map((l) => (l === 'ME' ? { name: 'Patil Dental Clinic', placeId: ME, category: 'Dentist' } : l));
  const idx = list.findIndex((l) => l.placeId === ME);
  const o = buildObservation({
    keyword, kind: 'discovery',
    results: opts.failed ? null : list.map((l) => ({ name: l.name, placeId: l.placeId, category: l.category ?? null, reviewCount: (l as L).reviewCount ?? null })),
    targetPosition: idx === -1 ? null : idx + 1,
    isTarget: (r) => r.placeId === ME,
  });
  return opts.area ? { ...o, area: opts.area } : o;
}

const SERVICES = verifiedServices({ gbpServices: ['Dental implants', 'Root canal treatment', 'Teeth whitening'], ownerServices: ['Dental braces', 'dental implants'], websiteServices: ['Smile design'], category: 'Dentist' });

// ── Services and stable ids ─────────────────────────────────────────────────

test('verified services: Google first, owner next, website only when neither exists, category as last resort', () => {
  assert.deepEqual(SERVICES.map((s) => [s.name, s.state]), [
    ['Dental implants', 'VERIFIED'], ['Root canal treatment', 'VERIFIED'], ['Teeth whitening', 'VERIFIED'], ['Dental braces', 'OWNER_CONFIRMED'],
  ], 'deduplicated by id; website claims not used when verified services exist');
  assert.deepEqual(verifiedServices({ websiteServices: ['Smile design'] }).map((s) => s.state), ['SOURCE_CLAIM']);
  assert.deepEqual(verifiedServices({ category: 'Fireworks Store' }).map((s) => [s.name, s.source]), [['Fireworks Store', 'category']]);
  assert.equal(serviceId('Dental Implants!'), serviceId('dental implants'));
  assert.equal(keywordId('Dental implants  Nashik'), keywordId('dental implants nashik'));
  assert.equal(areaId({ placeId: 'places/abc' }), 'area:pid:abc');
});

test('keywords are associated with the right verified service', () => {
  assert.equal(serviceForKeyword('dental implant cost nashik', SERVICES)?.name, 'Dental implants');
  assert.equal(serviceForKeyword('root canal near me', SERVICES)?.name, 'Root canal treatment');
  assert.equal(serviceForKeyword('pizza delivery', SERVICES), null);
});

// ── Tracked keyword set ─────────────────────────────────────────────────────

const base = { services: SERVICES, city: 'Nashik', gridKeywords: ['dentist nashik', 'best dentist nashik'], businessName: 'Patil Dental Clinic', now: NOW };

test('first month: one "<service> <city>" per service, capped at 4 new, each with a reason', () => {
  const r = buildTrackedKeywords({ ...base, previous: [], searchTerms: [], proposed: [] });
  assert.deepEqual(r.measureNow.map((k) => k.keyword), ['Dental implants Nashik', 'Root canal treatment Nashik', 'Teeth whitening Nashik', 'Dental braces Nashik']);
  assert.ok(r.measureNow.every((k) => k.reason && k.serviceId));
  assert.equal(r.tracked.filter((k) => k.source === 'grid').length, 2);
  assert.ok(r.changes.some((c) => c.change === 'not_added' && /Monthly limit/.test(c.reason)), 'further candidates wait, with a reason');
});

test('next month: previous keywords stay (history kept), proposals and Google search terms are measured, removals carry a reason', () => {
  const m1 = buildTrackedKeywords({ ...base, previous: [], searchTerms: [], proposed: [] });
  const fewerServices = SERVICES.filter((s) => s.name !== 'Teeth whitening');
  const m2 = buildTrackedKeywords({
    ...base, services: fewerServices, previous: m1.tracked,
    searchTerms: [{ keyword: 'root canal specialist', impressions: 41, period: '2026-11' }],
    proposed: ['dental implants cost nashik'],
    now: new Date('2027-01-04T05:00:00Z'),
  });
  const ids = m2.tracked.map((k) => k.keyword);
  assert.ok(ids.includes('Dental implants Nashik') && ids.includes('Root canal treatment Nashik'), 'kept');
  assert.equal(m2.tracked.find((k) => k.keyword === 'Dental implants Nashik')!.addedAt, NOW.toISOString(), 'original date kept');
  assert.ok(!ids.includes('Teeth whitening Nashik'));
  assert.ok(m2.changes.some((c) => c.change === 'removed' && /no longer listed/.test(c.reason)));
  assert.ok(ids.includes('root canal specialist'), 'Google search term added');
  assert.ok(ids.includes('dental implants cost nashik'), 'AI proposal now measured');
  assert.ok(m2.tracked.filter((k) => k.source !== 'grid').length <= TRACKING_LIMITS.maxExtraKeywords);
});

test('claim words and the business name are never tracked', () => {
  const r = buildTrackedKeywords({ ...base, previous: [], searchTerms: [{ keyword: 'best dental implants', impressions: 99 }, { keyword: 'patil dental implants', impressions: 50 }], proposed: [], services: SERVICES.slice(0, 1), gridKeywords: [] });
  assert.ok(!r.tracked.some((k) => /best|patil/i.test(k.keyword)));
});

// ── Measurements and comparison ─────────────────────────────────────────────

const svcOf = (k: string) => { const s = serviceForKeyword(k, SERVICES); return s ? { id: s.id, name: s.name } : null; };
const home = addressArea('Around your address');
const rows = (o: SearchObservation[], scope: any = 'address_tracked') => measurementRows(o, { scope, areaOf: () => home, serviceOf: svcOf });

test('measurement rows: failed searches are unavailable, never "not in top 20"; missing keywords are absent, not zero', () => {
  const m = rows([
    obs('Dental implants Nashik', [RIVAL, 'ME']), obs('Dental implants Nashik', [RIVAL, OTHER, 'ME']), obs('Dental implants Nashik', [RIVAL]),
    obs('Teeth whitening Nashik', [], { failed: true }),
  ]);
  const imp = m.find((x) => x.keyword === 'Dental implants Nashik')!;
  assert.deepEqual([imp.points, imp.okCount, imp.foundCount, imp.bestRank, imp.avgRank, imp.status], [3, 3, 2, 2, 2.5, 'measured']);
  assert.equal(m.find((x) => x.keyword === 'Teeth whitening Nashik')!.status, 'unavailable');
  assert.ok(!m.some((x) => x.keyword === 'Dental braces Nashik'), 'not searched = not measured, not a zero row');
});

test('historical comparison survives new keywords: old ones compare, new ones are "new", different coverage is not compared', () => {
  const prev = rows([obs('Dental implants Nashik', [RIVAL, OTHER, OTHER, 'ME']), obs('Root canal treatment Nashik', ['ME'])]);
  const cur = rows([
    obs('Dental implants Nashik', ['ME']),
    obs('Root canal treatment Nashik', [RIVAL]), obs('Root canal treatment Nashik', [RIVAL]),
    obs('root canal specialist', ['ME']),
  ]);
  const ch = Object.fromEntries(compareMeasurements(prev, cur).map((c) => [c.keyword, c.change]));
  assert.deepEqual(ch, { 'Dental implants Nashik': 'improved', 'Root canal treatment Nashik': 'not_comparable', 'root canal specialist': 'new' });
});

test('unavailable this month is not a decline', () => {
  const prev = rows([obs('Dental implants Nashik', ['ME'])]);
  const cur = rows([obs('Dental implants Nashik', [], { failed: true })]);
  assert.equal(compareMeasurements(prev, cur)[0].change, 'not_comparable');
});

// ── Service visibility ──────────────────────────────────────────────────────

const competitors: CompetitorFact[] = [
  { key: 'pid:r1', name: RIVAL.name, placeId: 'r1', reviewCount: 240, rating: 4.8 } as any,
  { key: 'pid:r2', name: OTHER.name, placeId: 'r2', reviewCount: 80, rating: 4.4 } as any,
];

function visibility() {
  const addressObs = [
    obs('Dental implants Nashik', ['ME', RIVAL]), obs('Dental implants Nashik', [RIVAL, 'ME']), obs('Dental implants Nashik', ['ME']),
    obs('Root canal treatment Nashik', [RIVAL, OTHER]), obs('Root canal treatment Nashik', [RIVAL]), obs('Root canal treatment Nashik', [OTHER]),
    obs('Teeth whitening Nashik', [], { failed: true }),
  ];
  const areaObs = [obs('Dental implants Panchavati', [RIVAL, 'ME'], { area: 'Panchavati (service area)' }), obs('Root canal treatment Panchavati', [RIVAL], { area: 'Panchavati (service area)' })];
  const pa = { id: areaId({ placeId: 'pid-pan' }), name: 'Panchavati' };
  const measurements = [...rows(addressObs), ...measurementRows(areaObs, { scope: 'service_area', areaOf: () => pa, serviceOf: svcOf })];
  return buildServiceVisibility({
    services: SERVICES, measurements, changes: compareMeasurements(null, measurements), observations: [...addressObs, ...areaObs], serviceOf: svcOf,
    competitors, searchTerms: [{ keyword: 'dental implants near me', impressions: 120, period: '2026-11' }],
    gbpServiceNames: ['Dental implants', 'Root canal treatment', 'Teeth whitening'], websiteText: 'We offer dental implants and teeth whitening in Nashik', reviewCount: 35,
  });
}

test('service status only from measurements: strong / not visible / unavailable / not measured are distinct', () => {
  const v = visibility();
  const st = Object.fromEntries(v.services.map((s) => [s.service, s.status]));
  assert.deepEqual(st, { 'Dental implants': 'strong', 'Root canal treatment': 'not_visible', 'Teeth whitening': 'unavailable', 'Dental braces': 'not_measured' });
  assert.equal(statusOf([]), 'not_measured');
});

test('service details: competitors above, impressions, presence on Google/website, evidence-based recommendations', () => {
  const rc = visibility().services.find((s) => s.service === 'Root canal treatment')!;
  // Every search for the service counts: 2 around the address + 1 in Panchavati.
  assert.deepEqual(rc.competitorsAbove.map((c) => [c.name, c.searches]), [[RIVAL.name, 3], [OTHER.name, 2]]);
  assert.equal(rc.onGoogleProfile, true);
  assert.equal(rc.onWebsite, false);
  assert.ok(rc.recommendations.some((r) => /website's crawled pages do not mention "Root canal treatment"/.test(r)));
  assert.ok(rc.recommendations.some((r) => /240 reviews to your 35/.test(r)));
  const imp = visibility().services.find((s) => s.service === 'Dental implants')!;
  assert.equal(imp.impressions?.total, 120);
});

test('service × area matrix: one cell per measured combination, with its own position', () => {
  const m = visibility().matrix;
  assert.deepEqual(m.map((c) => [c.service, c.area, c.status, c.rank]), [
    ['Dental implants', 'Panchavati', 'found', 2], ['Root canal treatment', 'Panchavati', 'not_in_top_20', null],
  ]);
  assert.ok(serviceStrategyLines(visibility().services, m).some((l) => /Root canal treatment in Panchavati/.test(l)));
});

test('plan focus: weakest services first, areas where the business is not in the top 20', () => {
  const v = visibility();
  const f = planFocus(v.services, v.matrix);
  assert.deepEqual(f.services.map((s) => s.service), ['Root canal treatment', 'Teeth whitening', 'Dental braces']);
  assert.deepEqual(f.areas, [{ area: 'Panchavati', services: ['Root canal treatment'] }]);
  assert.ok(trackedKeywordRows(rows([obs('x', ['ME'])])).every((r) => r.source === 'tracked'));
});

// ── Feedback loop ───────────────────────────────────────────────────────────

const changes = compareMeasurements(
  rows([obs('Dental implants Nashik', [RIVAL, OTHER, 'ME']), obs('Root canal treatment Nashik', [RIVAL, 'ME']), obs('Teeth whitening Nashik', ['ME'])]),
  rows([obs('Dental implants Nashik', ['ME']), obs('Root canal treatment Nashik', ['ME']), obs('Teeth whitening Nashik', ['ME'])]),
);
const prevPlan = { version: 3, createdAt: '2026-11-04T05:00:00Z', primaryKeywords: ['Dental implants Nashik', 'braces nashik'], secondaryKeywords: [], postThemes: [{ theme: 'Implants explained' }], priorities: [] };

test('completion and outcome are separate: pending, blocked, too recent, positive, insufficient evidence', () => {
  const h = buildStrategyHistory({
    previousPlan: prevPlan, previousAuditAt: '2026-11-04T05:00:00Z', changes, postKeywords: ['Dental implants Nashik'], now: NOW,
    actions: [
      { findingId: 'a', description: 'Publish weekly posts', status: 'EXECUTED', capability: 'google_posts', executedAt: '2026-11-10T00:00:00Z' },
      { findingId: 'b', description: 'Update description', status: 'EXECUTED', capability: 'update_description', executedAt: '2026-11-28T00:00:00Z' },
      { findingId: 'c', description: 'Add photos', status: 'VERIFIED', capability: null, verifiedAt: '2026-11-15T00:00:00Z' },
      { findingId: 'd', description: 'Reply to reviews', status: 'READY', capability: 'review_replies' },
      { findingId: 'e', description: 'Fix phone', status: 'BLOCKED', capability: 'update_phone', statusReason: 'Live Google profile writes are turned off' },
    ],
  });
  const o = Object.fromEntries(h.actions.map((a) => [a.findingId, [a.completion, a.outcome]]));
  assert.deepEqual(o.a, ['completed', 'insufficient_evidence'], 'post keywords: only one comparable measurement');
  assert.deepEqual(o.b, ['completed', 'not_yet_measurable'], 'done 6 days ago');
  assert.deepEqual(o.c, ['completed', 'positive'], 'all tracked keywords: 2 improved, 1 stable');
  assert.deepEqual(o.d, ['pending', 'not_completed']);
  assert.deepEqual(o.e, ['blocked', 'not_completed']);
  assert.match(h.actions.find((a) => a.findingId === 'c')!.basis, /correlation, not proof/);
  assert.deepEqual(h.previousPriorities.map((p) => p.keyword), ['Dental implants Nashik', 'braces nashik']);
  assert.equal(h.previousPriorities[1].result, 'not re-measured this month');
  const lines = historyLines(h);
  assert.ok(lines[0].includes('version 3'));
  assert.ok(lines.some((l) => /Improved — "Dental implants Nashik"/.test(l)));
  assert.ok(lines.some((l) => /Actions still open/.test(l)));
});

test('a first plan has no earlier measurement: completed actions are not yet measurable', () => {
  const h = buildStrategyHistory({ previousPlan: null, previousAuditAt: null, changes: [], postKeywords: [], now: NOW,
    actions: [{ findingId: 'x', description: 'Posts', status: 'EXECUTED', capability: 'google_posts', executedAt: '2026-10-01T00:00:00Z' }] });
  assert.equal(h.actions[0].outcome, 'not_yet_measurable');
});

test('plan changes: added / removed / kept keywords and theme change', () => {
  const c = planChanges(prevPlan, { primaryKeywords: ['Dental implants Nashik', 'root canal nashik'], postThemes: [{ theme: 'Root canal myths' }] });
  assert.deepEqual([c.added, c.removed, c.kept, c.themesChanged], [['root canal nashik'], ['braces nashik'], ['Dental implants Nashik'], true]);
});

// ── Website SEO ─────────────────────────────────────────────────────────────

const page = (over: any) => ({ url: 'https://patil.example/', kind: 'home', title: 'Patil Dental Clinic Nashik', metaDescription: 'Dental clinic in Nashik.', h1: ['Patil Dental Clinic'], canonical: null, noindex: false, internalLinks: ['/', '/implants'], schemaTypes: ['Dentist'], wordCount: 600, ...over });

test('website checks: evidence-backed per page; service page gaps; one areas section (no doorway pages)', () => {
  const w = analyzeWebsiteSeo({
    pages: [
      page({}),
      page({ url: 'https://patil.example/implants', kind: 'service_detail', title: 'Dental implants in Nashik', h1: ['Dental implants'], metaDescription: null, wordCount: 90 }),
      page({ url: 'https://patil.example/contact', kind: 'contact', title: 'Patil Dental Clinic Nashik', h1: [], noindex: true }),
    ],
    services: SERVICES, serviceAreas: ['Panchavati', 'Gangapur Road'], siteText: 'Dental clinic in Panchavati', gbpServiceNames: ['Dental implants'],
  });
  const ids = w.items.map((i) => i.id);
  for (const id of ['noindex:/contact', 'meta-missing:/implants', 'thin:/implants', 'h1-missing:/contact', 'title-dup:/contact', 'service-page:svc:root-canal-treatment', 'areas-section']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('service-page:svc:dental-implants'), 'implants page exists');
  assert.ok(!ids.includes('schema-localbusiness'), 'Dentist schema present');
  assert.ok(w.items.every((i) => i.state === 'RECOMMENDATION' && i.evidence));
  const areas = w.items.find((i) => i.id === 'areas-section')!;
  assert.match(areas.issue, /Gangapur Road/);
  assert.ok(!/Panchavati/.test(areas.issue), 'already mentioned');
  assert.match(areas.recommendation, /Do not create separate thin pages/);
  assert.equal(w.items[0].priority, 'high');
});

test('website not crawled with per-page data → not measured (never "no issues")', () => {
  assert.equal(analyzeWebsiteSeo({ pages: null, services: SERVICES, serviceAreas: [], siteText: '', gbpServiceNames: null }).status, 'not_measured');
});

// ── Content ─────────────────────────────────────────────────────────────────

test('content priority: a keyword for a weak service or area gets a boost and the reason says why', () => {
  const input = {
    businessName: 'Patil Dental Clinic', serviceTerms: ['Dental implants', 'Root canal treatment'], places: ['Nashik', 'Panchavati'],
    measured: [
      { keyword: 'dental implants nashik', rank: 7, found: true },
      { keyword: 'root canal treatment panchavati', found: false },
    ],
    searchTerms: [], proposed: [], recentlyTargeted: [],
  };
  const score = (r: any, k: string) => r.ranked.find((p: any) => p.keyword === k).score;
  const without = prioritizeKeywords(input);
  const withFocus = prioritizeKeywords({ ...input, focus: { services: [{ service: 'Root canal treatment', status: 'not_visible' }], areas: ['Panchavati'] } });
  assert.equal(Math.round((score(withFocus, 'root canal treatment panchavati') - score(without, 'root canal treatment panchavati')) * 100) / 100, 0.15);
  assert.equal(score(withFocus, 'dental implants nashik'), score(without, 'dental implants nashik'), 'non-focus keyword unchanged');
  const pick = withFocus.ranked.find((p: any) => p.keyword === 'root canal treatment panchavati')!;
  assert.match(pick.reason, /outside the top 20 in Panchavati/);
  // With no measured position-4–10 win competing, the focus keyword is picked first.
  const alone = prioritizeKeywords({ ...input, measured: [{ keyword: 'dental implants nashik', rank: 2, found: true }, input.measured[1]], focus: { services: [], areas: ['Panchavati'] } });
  assert.equal(alone.seo?.keyword, 'root canal treatment panchavati');
});

test('posts: a multi-word service area named by the slot keyword passes validation; an unnamed one is not added', () => {
  assert.deepEqual(areasIn('Fireworks Store Panchwad Nagar', ['Panchwad Nagar', 'Ojhar']), ['Panchwad Nagar']);
  assert.deepEqual(areasIn('Fireworks Store near me', ['Panchwad Nagar']), []);
  const body = 'Planning Diwali? We deliver crackers to families in Ojhar, including Panchwad Nagar and nearby areas.';
  const ev = (places: string[]) => ({ businessName: 'Durva Fireworks', evidenceText: 'crackers fireworks delivery', serviceTerms: ['Fireworks', 'crackers'], places, businessNames: [] });
  assert.equal(validatePost({ title: 'Diwali crackers', body }, ev(['Ojhar'])).ok, false, 'area unknown to the validator');
  assert.equal(validatePost({ title: 'Diwali crackers', body }, ev(['Ojhar', 'Panchwad Nagar'])).ok, true);
});

test('posts: near-duplicate of a recent post is rejected; a different post passes', () => {
  const recent = 'Visit Durva Fireworks in Janori for a wide range of sparklers and flower pots this Diwali season.';
  const ev = { businessName: 'Durva Fireworks', evidenceText: 'sparklers flower pots fireworks', serviceTerms: ['Fireworks', 'sparklers'], places: ['Janori'], businessNames: [], recentTexts: [recent] };
  const dup = validatePost({ title: 'Diwali', body: 'Visit Durva Fireworks in Janori for a wide range of sparklers and flower pots this Diwali.' }, ev);
  assert.ok(dup.reasons.includes('too similar to a recent post'));
  assert.ok(textSimilarity(recent, 'Shop safe green crackers for your family celebrations at our Janori store.') < 0.5);
});

// ── Monthly report and rendering ────────────────────────────────────────────

function tracking() {
  const v = visibility();
  const h = buildStrategyHistory({ previousPlan: prevPlan, previousAuditAt: '2026-11-04T05:00:00Z', changes, postKeywords: [], now: NOW,
    actions: [{ findingId: 'c', description: 'Add photos', status: 'VERIFIED', capability: null, verifiedAt: '2026-11-15T00:00:00Z' }, { findingId: 'd', description: 'Reply to reviews', status: 'READY', capability: 'review_replies' }] });
  return {
    version: 1, measuredAt: NOW.toISOString(), previousMeasuredAt: '2026-11-04T05:00:00Z',
    services: SERVICES, tracked: [], keywordChanges: [{ id: 'k', keyword: 'root canal specialist', change: 'added', reason: 'Customers found the profile with this search' }],
    measurements: rows([obs('Dental implants Nashik', ['ME'])]), changes, serviceVisibility: v.services, matrix: v.matrix, history: h,
    websiteSeo: analyzeWebsiteSeo({ pages: [page({ title: null })], services: SERVICES, serviceAreas: [], siteText: '', gbpServiceNames: null }),
  };
}

test('monthly report: tracked keyword movements and action outcomes', () => {
  const m = buildMonthlyReport({
    periodStart: '2026-11-04', periodEnd: '2026-12-04', previousAuditId: 'p', baselineAuditId: 'b', prevData: {}, curData: { facts: { tracking: tracking() } },
    executions: { posts: [], replies: [], reviewRequests: { sent: 0, failed: 0 }, profileEdits: [], photos: [], newReviews: [] }, actions: [],
  });
  assert.ok(m.improved.some((l) => /"Dental implants Nashik": #3 → #1/.test(l)));
  assert.deepEqual(m.seo?.actions.map((a) => a.outcome), ['positive']);
  assert.deepEqual(m.seo?.weakServices, ['Root canal treatment']);
});

test('display rows: period, coverage, statuses, "Not enough data", recommendations-only website note', () => {
  const v = intelligenceView(tracking())!;
  assert.match(v.period, /compared with/);
  assert.match(v.coverage, /Google Maps searches/);
  assert.deepEqual(v.services.map((s) => s.status), ['Strong — average position 1–3', 'Not in the top 20', 'Ranking unavailable this month', 'Not measured yet']);
  assert.equal(v.services[0].keywords[0].demand, 'Not enough data');
  assert.match(v.website!.status, /nothing was changed on your website/);
  assert.equal(intelligenceView(null), null);
});

test('full report, dashboard, V6, V7 and PDF render the same stored values; the free report is unchanged', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime' as string);
  const noop = () => {};
  const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop, hmrRefresh: noop };
  const render = (el: any) => renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router }, el)).replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const fs = await import('node:fs');
  const fx = JSON.parse(fs.readFileSync('tests/fixtures/audits/mulsetu-dashboard.json', 'utf8'));
  const t = tracking();
  const audit: any = { _id: 'fx', businessName: 'Patil Dental Clinic', location: 'Nashik', status: 'COMPLETED', fastMode: false, createdAt: NOW.toISOString(), auditData: { ...fx.auditData, facts: { ...(fx.auditData.facts || {}), tracking: t } } };
  const Grexa = (await import('../../src/components/audit/AuditReportGrexa')).default;
  const V6 = (await import('../../src/components/audit/AuditReportV6')).default;
  const V7 = (await import('../../src/components/audit/AuditReportV7')).default;
  const Free = (await import('../../src/components/audit/FreeReportView')).default;
  const { buildReportHtml } = await import('../../src/lib/pdf/reportHtml');
  const surfaces = {
    grexa: render(React.createElement(Grexa, { audit, onDownload: noop })),
    v6: render(React.createElement(V6, { audit, onDownload: noop })),
    v7: render(React.createElement(V7, { audit, onDownload: noop })),
    pdf: buildReportHtml({ audit } as any).replace(/<[^>]+>/g, ' ').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' '),
  };
  for (const [name, text] of Object.entries(surfaces)) {
    for (const expect of ['SEO intelligence', 'Visibility by service', 'Root canal treatment', 'Not in the top 20', 'Services × service areas', 'Panchavati', 'Done — tracked keywords improved', 'Reply to reviews', 'root canal specialist', 'Website SEO recommendations', 'No page title']) {
      assert.ok(text.includes(expect), `${name} shows "${expect}"`);
    }
  }
  const free = render(React.createElement(Free, { audit: { ...audit, fastMode: true } }));
  assert.ok(!free.includes('SEO intelligence'), 'free report unchanged');
});
