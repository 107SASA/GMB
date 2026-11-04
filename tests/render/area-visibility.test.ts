/**
 * Competitors and SEO visibility by GBP service area: built from stored area
 * searches (areaVisibility.ts), compared month to month, and rendered from
 * the SAME saved facts by every report variant and the PDF.
 *
 * Durva Fireworks (Janori) serving Janori (within 3 km), Ojhar and Nashik.
 * Run: npx tsx --test tests/render/area-visibility.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildObservation, competitorsFromObservations, AROUND_ADDRESS, type SearchObservation } from '../../src/services/audit/facts';
import { buildAreaVisibility, compareAreaVisibility, areaStrategyLines, areaVisibilityView } from '../../src/services/audit/areaVisibility';
import { buildTradeProfile, classifyCompetitor } from '../../src/services/audit/competitorRelevance';
import { buildMonthlyReport } from '../../src/services/lifecycle/monthly';

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/area-visibility';
process.env.GROQ_API_KEY ||= 'area-visibility';

const DURVA = 'Durva Fireworks';
type L = { name: string; placeId: string; category: string };
const MATOSHREE: L = { name: 'Matoshree Fireworks (Ozar Branch)', placeId: 'c-matoshree', category: 'Store' };
const FATAKA: L = { name: 'Shree Fataka Bhandar', placeId: 'c-fataka', category: 'Fireworks store' };
const NASHIK: L = { name: 'Nashik Crackers Mart', placeId: 'c-nashik', category: 'Fireworks supplier' };
const KIRANA: L = { name: 'Swami Kirana', placeId: 'c-kirana', category: 'Indian grocery store' };
const ME: L = { name: DURVA, placeId: 'durva', category: 'Store' };

/** One Maps search: listings in order; the business's own position is where ME appears (if at all). */
function obs(keyword: string, listings: L[], area?: string): SearchObservation {
  const idx = listings.findIndex((l) => l.placeId === ME.placeId);
  const o = buildObservation({
    keyword,
    kind: area ? 'discovery' : 'primary',
    results: listings.map((l) => ({ name: l.name, placeId: l.placeId, category: l.category })),
    targetPosition: idx === -1 ? null : idx + 1,
    isTarget: (r) => r.placeId === ME.placeId,
  });
  return area ? { ...o, area } : o;
}

const PROFILE = buildTradeProfile({ searchCategory: 'Fireworks Store', category: 'Store' })!;
const SERVICE_AREAS = [
  { placeName: 'Janori', placeId: 'pid-janori' },
  { placeName: 'Ojhar', placeId: 'pid-ojhar' },
  { placeName: 'Nashik', placeId: 'pid-nashik' },
  { placeName: 'Unknown Gaon', placeId: 'pid-x' },
];
const DISCOVERY = {
  searched: [
    { label: 'Ojhar (service area)', kind: 'service_area', areaName: 'Ojhar', placeId: 'pid-ojhar', distanceKm: 4.1, keyword: 'Fireworks Store Ojhar' },
    { label: 'Ojhar (service area)', kind: 'service_area', areaName: 'Ojhar', placeId: 'pid-ojhar', distanceKm: 4.1, keyword: 'Fireworks Store near me' },
    { label: 'Nashik (service area)', kind: 'service_area', areaName: 'Nashik', placeId: 'pid-nashik', distanceKm: 14.5, keyword: 'Fireworks Store Nashik' },
    { label: 'Nashik (service area)', kind: 'service_area', areaName: 'Nashik', placeId: 'pid-nashik', distanceKm: 14.5, keyword: 'Fireworks Store near me' },
    { label: '~6 km north', kind: 'expansion', distanceKm: 6, keyword: 'Fireworks Store' },
  ],
  skipped: [
    { label: 'Janori (service area)', reason: 'already covered by the search around the business' },
    { label: 'Unknown Gaon (service area)', reason: 'location could not be resolved' },
  ],
};

function month(opts: { ojharNearMeRank: number | null; nashikNew?: boolean }) {
  const primary = [obs('Fireworks Store janori', [ME, FATAKA, KIRANA]), obs('Fireworks Store janori', [FATAKA, ME])];
  const ojharNearMe = opts.ojharNearMeRank == null ? [MATOSHREE, KIRANA, FATAKA] : [MATOSHREE, KIRANA, FATAKA].slice(0, opts.ojharNearMeRank - 1).concat([ME]);
  const area = [
    obs('Fireworks Store Ojhar', [MATOSHREE, FATAKA, KIRANA], 'Ojhar (service area)'),
    obs('Fireworks Store near me', ojharNearMe, 'Ojhar (service area)'),
    obs('Fireworks Store Nashik', opts.nashikNew ? [NASHIK, MATOSHREE] : [MATOSHREE], 'Nashik (service area)'),
    obs('Fireworks Store near me', [KIRANA], 'Nashik (service area)'),
    obs('Fireworks Store', [KIRANA], '~6 km north'),
  ];
  const competitors = competitorsFromObservations([...primary, ...area]).filter((c) => {
    c.tradeMatch = classifyCompetitor({ name: c.name, category: c.category, keywords: c.keywords }, PROFILE);
    return c.tradeMatch.counted;
  });
  return buildAreaVisibility({
    serviceAreas: SERVICE_AREAS,
    discovery: DISCOVERY,
    areaObservations: area,
    primaryObservations: primary,
    competitors,
    volumes: new Map([['fireworks store near me', 1300], ['fireworks store ojhar', null], ['fireworks store janori', null]]),
    primaryLabel: AROUND_ADDRESS,
  });
}

const PREV = month({ ojharNearMeRank: null });
const CUR = month({ ojharNearMeRank: 4, nashikNew: true });

// ── Building the stored facts ───────────────────────────────────────────────

test('every configured service area gets a row; the address location is a separate row', () => {
  assert.deepEqual(CUR.areas.map((a) => [a.area, a.status]), [
    ['Janori', 'covered_by_address'],
    ['Ojhar', 'measured'],
    ['Nashik', 'measured'],
    ['Unknown Gaon', 'not_located'],
  ]);
  assert.equal(CUR.configured, 4);
  assert.equal(CUR.primary.label, AROUND_ADDRESS);
  // Discovery-only expansion rings are never a service-area row.
  assert.ok(!CUR.areas.some((a) => /km north/.test(a.area)));
});

test("the business's own position per area comes from that area's searches only", () => {
  const ojhar = CUR.areas.find((a) => a.area === 'Ojhar')!;
  assert.deepEqual(ojhar.searches.map((s) => [s.keyword, s.rank, s.searchVolume]), [
    ['Fireworks Store Ojhar', null, null],
    ['Fireworks Store near me', 4, 1300],
  ]);
  assert.equal(ojhar.bestRank, 4);
  assert.equal(ojhar.distanceKm, 4.1);
  // The address row is the main grid only — not mixed with Ojhar's searches.
  assert.equal(CUR.primary.bestRank, 1);
  assert.deepEqual(CUR.primary.searches.map((s) => s.keyword), ['Fireworks Store janori']);
  // An area within 3 km reuses the address searches and says so.
  const janori = CUR.areas.find((a) => a.area === 'Janori')!;
  assert.equal(janori.bestRank, 1);
  assert.match(janori.note!, /searches around your address/);
});

test('competitors per area: same trade only, deduplicated, with their discovery locations', () => {
  const ojhar = CUR.areas.find((a) => a.area === 'Ojhar')!;
  assert.deepEqual(ojhar.competitors.map((c) => [c.name, c.bestRankHere, c.level]), [
    ['Matoshree Fireworks (Ozar Branch)', 1, 'probable'],
    ['Shree Fataka Bhandar', 2, 'confirmed'],
  ]);
  assert.ok(!ojhar.competitors.some((c) => c.name === 'Swami Kirana'), 'kirana is not a competitor');
  const fataka = ojhar.competitors.find((c) => c.name === 'Shree Fataka Bhandar')!;
  assert.deepEqual(fataka.foundIn.sort(), [AROUND_ADDRESS, 'Ojhar (service area)'].sort());
});

// ── Monthly comparison ──────────────────────────────────────────────────────

test('monthly: improving / declining / not ranking / new competitors / gaining / opportunities', () => {
  const cmp = compareAreaVisibility(PREV, CUR);
  assert.deepEqual(cmp.improving, ['Ojhar: not in top 20 → #4']);
  assert.deepEqual(cmp.declining, []);
  assert.deepEqual(cmp.notRanking, ['Nashik: not in the top 20 in 2 searches']);
  assert.deepEqual(cmp.newCompetitors, ['Nashik: Nashik Crackers Mart (#1)']);
  // Opportunities: phrases where the business is not in the top 3; measured demand first.
  assert.match(cmp.opportunities[0], /Ojhar: "Fireworks Store near me" — you are #4; 1300 searches\/month/);
  assert.ok(cmp.opportunities.some((o) => /Nashik: "Fireworks Store Nashik" — you are not in top 20; monthly searches: not enough data/.test(o)));

  const back = compareAreaVisibility(CUR, PREV);
  assert.deepEqual(back.declining, ['Ojhar: #4 → not in top 20']);
});

test('monthly: competitor gaining visibility in an area', () => {
  const prev = month({ ojharNearMeRank: 4 });
  const cur = structuredClone(prev);
  const ojhar = cur.areas.find((a) => a.area === 'Ojhar')!;
  ojhar.competitors.find((c) => c.name === 'Shree Fataka Bhandar')!.bestRankHere = 1;
  assert.deepEqual(compareAreaVisibility(prev, cur).competitorsGaining, ['Ojhar: Shree Fataka Bhandar #2 → #1']);
});

test('areas are compared only when measured in both audits', () => {
  const cmp = compareAreaVisibility(null, CUR);
  assert.deepEqual([cmp.improving, cmp.declining, cmp.newCompetitors], [[], [], []]);
  assert.ok(cmp.notRanking.length > 0, 'current state is still reported');
});

test('SEO Brain lines: measured facts and changes, every number from stored data', () => {
  const lines = areaStrategyLines(CUR, compareAreaVisibility(PREV, CUR));
  assert.ok(lines.includes('Service area Ojhar: best position #4 in 2 searches; same-trade competitors there: Matoshree Fireworks (Ozar Branch), Shree Fataka Bhandar'));
  assert.ok(lines.includes('Service area Nashik: not in the top 20 in 2 searches; same-trade competitors there: Nashik Crackers Mart, Matoshree Fireworks (Ozar Branch)'));
  assert.ok(lines.includes('Service-area visibility improved — Ojhar: not in top 20 → #4'));
  assert.ok(lines.includes('New competitor in a service area — Nashik: Nashik Crackers Mart (#1)'));
});

test('monthly report carries the area comparison and feeds improved/declined', () => {
  const m = buildMonthlyReport({
    periodStart: '2026-10-01', periodEnd: '2026-11-01', previousAuditId: 'a1', baselineAuditId: 'a0',
    prevData: { facts: { areaVisibility: PREV } }, curData: { facts: { areaVisibility: CUR } },
    executions: { posts: [], replies: [], reviewRequests: { sent: 0, failed: 0 }, profileEdits: [], photos: [], newReviews: [] },
    actions: [],
  });
  assert.deepEqual(m.areas!.improving, ['Ojhar: not in top 20 → #4']);
  assert.ok(m.improved.includes('Google Maps in Ojhar: not in top 20 → #4'));
});

// ── Every report variant shows the same saved data ──────────────────────────

test('display rows: "Not in top 20", "Not enough data", relevance and discovery location', () => {
  const v = areaVisibilityView(CUR)!;
  const ojhar = v.areas.find((a) => a.area === 'Ojhar')!;
  assert.deepEqual(ojhar.phrases, [
    { keyword: 'Fireworks Store Ojhar', position: 'Not in top 20', demand: 'Not enough data' },
    { keyword: 'Fireworks Store near me', position: '#4', demand: '1,300/month' },
  ]);
  assert.equal(ojhar.position, 'Best #4');
  assert.equal(ojhar.distance, '4.1 km away');
  assert.equal(ojhar.competitors[1].relevance, 'Same trade — confirmed');
  assert.match(v.areas.find((a) => a.area === 'Unknown Gaon')!.status, /could not locate/);
  assert.equal(areaVisibilityView(null), null);
  assert.equal(areaVisibilityView({ ...CUR, areas: [] }), null, 'no service areas → no section');
});

test('free report, full report (Grexa), V6, V7, monthly section and PDF render the same stored values', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime' as string);
  const noop = () => {};
  const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop, hmrRefresh: noop };
  const render = (C: any, props: any) => renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router }, React.createElement(C, props)));
  const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');

  const fx = JSON.parse(fs.readFileSync(path.resolve('tests/fixtures/audits/mulsetu-dashboard.json'), 'utf8'));
  fx.auditData.facts = { ...(fx.auditData.facts || {}), areaVisibility: CUR };
  fx.auditData.monthly = buildMonthlyReport({
    periodStart: '2026-10-01', periodEnd: '2026-11-01', previousAuditId: 'a1', baselineAuditId: 'a0',
    prevData: { facts: { areaVisibility: PREV } }, curData: fx.auditData,
    executions: { posts: [], replies: [], reviewRequests: { sent: 0, failed: 0 }, profileEdits: [], photos: [], newReviews: [] }, actions: [],
  });
  const audit: any = { _id: 'fixture', businessName: DURVA, location: 'Janori, Maharashtra', status: 'COMPLETED', fastMode: false, auditVersion: 'V7', auditData: fx.auditData, createdAt: '2026-11-03T00:00:00.000Z' };

  const surfaces: Record<string, string> = {
    free: text(render((await import('../../src/components/audit/FreeReportView')).default, { audit })),
    full: text(render((await import('../../src/components/audit/AuditReportGrexa')).default, { audit, onDownload: noop })),
    v6: text(render((await import('../../src/components/audit/AuditReportV6')).default, { audit, onDownload: noop })),
    v7: text(render((await import('../../src/components/audit/AuditReportV7')).default, { audit, onDownload: noop })),
    pdf: text((await import('../../src/lib/pdf/reportHtml')).buildReportHtml({ audit } as any)),
  };
  const mustShow = [
    'Competitors and visibility by service area',
    'Ojhar', '4.1 km away', 'Fireworks Store Ojhar', 'Fireworks Store near me', 'Not in top 20', '1,300/month', 'Not enough data',
    'Matoshree Fireworks (Ozar Branch)', 'Same trade — confirmed', 'Found:',
    'Nashik Crackers Mart', 'Google could not locate this area',
  ];
  for (const [name, t] of Object.entries(surfaces)) {
    for (const s of mustShow) assert.ok(t.includes(s), `${name} is missing "${s}"`);
    assert.ok(!t.includes('Swami Kirana'), `${name} lists an unrelated business as a competitor`);
  }
  // Monthly area changes on the full report and the PDF.
  for (const name of ['full', 'pdf']) {
    assert.ok(surfaces[name].includes('Service areas since last month'), `${name}: monthly area section`);
    assert.ok(surfaces[name].includes('Ojhar: not in top 20 → #4'), `${name}: monthly improvement line`);
    assert.ok(surfaces[name].includes('Nashik: Nashik Crackers Mart (#1)'), `${name}: new competitor line`);
  }
});
