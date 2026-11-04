/**
 * Competitor discovery across GBP service areas + progressive expansion
 * (areaDiscovery.ts), combined with the separate same-trade check
 * (competitorRelevance.ts). Fake geocoder / Maps search; real coordinates
 * around Durva Fireworks (Janori MIDC, Nashik district).
 *
 * Run: npx tsx --test tests/workflow/audit-area-discovery.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverCompetitorAreas,
  planServiceAreaSearches,
  haversineKm,
  AREA_DISCOVERY_LIMITS,
  type AreaSearch,
  type GeoPoint,
} from '../../src/services/audit/areaDiscovery';
import { buildObservation, competitorsFromObservations, AROUND_ADDRESS, type SearchObservation } from '../../src/services/audit/facts';
import { buildTradeProfile, classifyCompetitor } from '../../src/services/audit/competitorRelevance';

const DURVA: GeoPoint = { lat: 20.08352, lng: 73.894995 };
const PLACES: Record<string, GeoPoint> = {
  'pid-janori': { lat: 20.087, lng: 73.893 }, // ~0.4 km — already covered by the grid
  'pid-ojhar': { lat: 20.0975, lng: 73.931 }, // ~4 km
  'pid-nashik': { lat: 19.9975, lng: 73.7898 }, // ~14.5 km
  'pid-pimpalgaon': { lat: 20.1667, lng: 73.9878 }, // ~13.4 km
  'pid-dindori': { lat: 20.2036, lng: 73.8333 }, // ~14.7 km
};
const resolve = async (a: { placeId: string | null; placeName: string | null }) => (a.placeId ? PLACES[a.placeId] ?? null : null);

type Listing = { name: string; placeId: string; category: string };
const FIREWORKS_OJHAR: Listing = { name: 'Matoshree Fireworks (Ozar Branch)', placeId: 'c-matoshree', category: 'Store' };
const SHREE_FATAKA: Listing = { name: 'Shree Fataka Bhandar', placeId: 'c-fataka', category: 'Fireworks store' };
const NASHIK_CRACKERS: Listing = { name: 'Nashik Crackers Mart', placeId: 'c-nashik-crackers', category: 'Fireworks supplier' };
const KIRANA: Listing = { name: 'Swami Kirana And General Stores', placeId: 'c-kirana', category: 'Indian grocery store' };
const PHARMACY: Listing = { name: 'Samarth Medical', placeId: 'c-pharmacy', category: 'Pharmacy' };

/** Fake Maps: what Google returns at each searched place; Durva itself is not listed outside Janori. */
function fakeSearch(byLabel: Record<string, Listing[]>, log: AreaSearch[] = []) {
  return async (searches: AreaSearch[]): Promise<SearchObservation[]> =>
    searches.map((s) => {
      log.push(s);
      const listings = byLabel[s.label] ?? [];
      return {
        ...buildObservation({
          keyword: s.keyword,
          kind: 'discovery',
          point: s.point,
          results: listings.map((l) => ({ name: l.name, placeId: l.placeId, category: l.category, rating: 4.2, reviewCount: 30 })),
          targetPosition: null,
        }),
        area: s.label,
      };
    });
}

const durvaProfile = buildTradeProfile({ searchCategory: 'Fireworks Store', category: 'Store' })!;
const relevantIn = (obs: SearchObservation[]) =>
  competitorsFromObservations(obs).filter((c) =>
    classifyCompetitor({ name: c.name, category: c.category, additionalCategories: c.additionalCategories, keywords: c.keywords }, durvaProfile).counted,
  ).length;

// ── Durva with configured service areas ─────────────────────────────────────

test('Durva: searches Ojhar and Nashik (service areas); Janori is skipped (already around the address)', async () => {
  const log: AreaSearch[] = [];
  const res = await discoverCompetitorAreas(
    {
      pin: DURVA,
      searchTerm: 'Fireworks Store',
      serviceAreas: [
        { placeName: 'Janori', placeId: 'pid-janori' },
        { placeName: 'Ojhar', placeId: 'pid-ojhar' },
        { placeName: 'Ojhar', placeId: 'pid-ojhar' }, // listed twice → searched once
        { placeName: 'Nashik', placeId: 'pid-nashik' },
      ],
    },
    {
      resolve,
      search: fakeSearch({
        'Ojhar (service area)': [FIREWORKS_OJHAR, KIRANA, SHREE_FATAKA],
        'Nashik (service area)': [NASHIK_CRACKERS, PHARMACY, SHREE_FATAKA],
      }, log),
      relevantCount: relevantIn,
    },
  );
  // Nearest first; each area once, with two searches at its own coordinates.
  assert.deepEqual(log.map((s) => s.label), ['Ojhar (service area)', 'Ojhar (service area)', 'Nashik (service area)', 'Nashik (service area)']);
  assert.deepEqual(log.map((s) => s.keyword), ['Fireworks Store Ojhar', 'Fireworks Store near me', 'Fireworks Store Nashik', 'Fireworks Store near me']);
  assert.deepEqual(log.map((s) => s.areaName), ['Ojhar', 'Ojhar', 'Nashik', 'Nashik']);
  assert.deepEqual(log.map((s) => s.point), [PLACES['pid-ojhar'], PLACES['pid-ojhar'], PLACES['pid-nashik'], PLACES['pid-nashik']]);
  assert.ok(res.skipped.some((s) => s.label.startsWith('Janori') && /around the business/.test(s.reason)));
  assert.deepEqual(res.expandedToKm, [], 'enough relevant competitors → no expansion');

  // Relevance is a separate step: the Ojhar fireworks shop counts, kirana/pharmacy don't.
  const comps = competitorsFromObservations(res.observations);
  const counted = comps.filter((c) => classifyCompetitor({ name: c.name, category: c.category, keywords: c.keywords }, durvaProfile).counted);
  assert.deepEqual(counted.map((c) => c.name).sort(), ['Matoshree Fireworks (Ozar Branch)', 'Nashik Crackers Mart', 'Shree Fataka Bhandar']);
  // Deduplicated across areas, and where each was found is tracked.
  const fataka = comps.filter((c) => c.name === 'Shree Fataka Bhandar');
  assert.equal(fataka.length, 1);
  assert.deepEqual(fataka[0].foundIn!.sort(), ['Nashik (service area)', 'Ojhar (service area)']);
  assert.deepEqual(comps.find((c) => c.name.startsWith('Matoshree'))!.foundIn, ['Ojhar (service area)']);
});

test('a competitor seen both around the address and in a service area is one competitor with both locations', () => {
  const around = { ...buildObservation({ keyword: 'Fireworks Store janori', kind: 'primary', results: [{ name: SHREE_FATAKA.name, placeId: SHREE_FATAKA.placeId, category: 'Fireworks store' }], targetPosition: 2 }) };
  const ojhar = { ...buildObservation({ keyword: 'Fireworks Store Ojhar', kind: 'discovery', results: [{ name: SHREE_FATAKA.name, placeId: SHREE_FATAKA.placeId, category: 'Fireworks store' }], targetPosition: null }), area: 'Ojhar (service area)' };
  const comps = competitorsFromObservations([around, ojhar]);
  assert.equal(comps.length, 1);
  assert.deepEqual(comps[0].foundIn, [AROUND_ADDRESS, 'Ojhar (service area)']);
});

// ── Progressive expansion ───────────────────────────────────────────────────

test('Durva today (no connected GBP, no service areas): too few fireworks shops → widens to 6 km, then 12 km', async () => {
  const log: AreaSearch[] = [];
  const res = await discoverCompetitorAreas(
    { pin: DURVA, searchTerm: 'Fireworks Store', serviceAreas: [] },
    {
      resolve,
      search: fakeSearch({ '~6 km north': [KIRANA], '~6 km east': [FIREWORKS_OJHAR], '~12 km south': [NASHIK_CRACKERS], '~12 km east': [SHREE_FATAKA] }, log),
      relevantCount: relevantIn,
    },
  );
  assert.deepEqual(res.expandedToKm, [6, 12]);
  assert.equal(log.length, 8, '4 directions × 2 rings');
  assert.ok(log.every((s) => s.kind === 'expansion' && s.keyword === 'Fireworks Store'));
  assert.equal(relevantIn(res.observations), 3);
});

test('expansion stops as soon as enough relevant competitors are found', async () => {
  const log: AreaSearch[] = [];
  const res = await discoverCompetitorAreas(
    { pin: DURVA, searchTerm: 'Fireworks Store', serviceAreas: [] },
    {
      resolve,
      search: fakeSearch({ '~6 km north': [FIREWORKS_OJHAR, SHREE_FATAKA, NASHIK_CRACKERS] }, log),
      relevantCount: relevantIn,
    },
  );
  assert.deepEqual(res.expandedToKm, [6], 'the 12 km ring is never searched');
  assert.equal(log.length, 4);
});

test('enough relevant competitors around the address already → no extra searches at all', async () => {
  const log: AreaSearch[] = [];
  await discoverCompetitorAreas(
    { pin: DURVA, searchTerm: 'Fireworks Store', serviceAreas: [] },
    { resolve, search: fakeSearch({}, log), relevantCount: () => 5 },
  );
  assert.equal(log.length, 0);
});

test('trade unknown (relevantCount = Infinity) → service areas still searched, never expanded', async () => {
  const log: AreaSearch[] = [];
  const res = await discoverCompetitorAreas(
    { pin: DURVA, searchTerm: 'Store', serviceAreas: [{ placeName: 'Ojhar', placeId: 'pid-ojhar' }] },
    { resolve, search: fakeSearch({}, log), relevantCount: () => Infinity },
  );
  assert.deepEqual(log.map((s) => s.keyword), ['Store Ojhar', 'Store near me']);
  assert.deepEqual(res.expandedToKm, []);
});

// ── Cost controls ───────────────────────────────────────────────────────────

test('many service areas: nearest 6 searched, the rest skipped with a reason; hard cap on total searches', async () => {
  const areas = Array.from({ length: 10 }, (_, i) => ({ name: `Area ${i}`, point: { lat: DURVA.lat + 0.05 * (i + 1), lng: DURVA.lng } }));
  const plan = planServiceAreaSearches(DURVA, 'Fireworks Store', areas);
  assert.equal(plan.searches.length, AREA_DISCOVERY_LIMITS.maxServiceAreas * 2, 'two searches per area');
  assert.deepEqual(Array.from(new Set(plan.searches.map((s) => s.label))), areas.slice(0, 6).map((a) => `${a.name} (service area)`));
  assert.equal(plan.skipped.filter((s) => s.reason === 'service-area limit reached').length, 4);

  const log: AreaSearch[] = [];
  const res = await discoverCompetitorAreas(
    { pin: DURVA, searchTerm: 'Fireworks Store', serviceAreas: areas.map((a, i) => ({ placeName: a.name, placeId: `pid-${i}` })) },
    { resolve: async (a) => areas[Number(a.placeId!.slice(4))].point, search: fakeSearch({}, log), relevantCount: () => 0 },
  );
  assert.ok(res.searched.length <= AREA_DISCOVERY_LIMITS.maxSearches, `${res.searched.length} searches`);
  assert.equal(log.length, res.searched.length);
});

test('two service areas a few hundred metres apart are searched once', () => {
  const plan = planServiceAreaSearches(DURVA, 'Fireworks Store', [
    { name: 'Ojhar', point: PLACES['pid-ojhar'] },
    { name: 'Ojhar MIDC', point: { lat: 20.0985, lng: 73.932 } },
  ]);
  assert.deepEqual(Array.from(new Set(plan.searches.map((s) => s.label))), ['Ojhar (service area)']);
  assert.match(plan.skipped[0].reason, /nearby service area/);
});

test('a service area that cannot be located is skipped and reported, not guessed', async () => {
  const res = await discoverCompetitorAreas(
    { pin: DURVA, searchTerm: 'Fireworks Store', serviceAreas: [{ placeName: 'Unknown Gaon', placeId: 'pid-missing' }] },
    { resolve, search: fakeSearch({}), relevantCount: () => 9 },
  );
  assert.equal(res.searched.length, 0);
  assert.deepEqual(res.skipped, [{ label: 'Unknown Gaon (service area)', reason: 'location could not be resolved' }]);
});

// ── Other business types (generic, not fireworks-specific) ──────────────────

test('plumber serving Pune suburbs: each suburb searched as "Plumber <suburb>", only plumbers count', async () => {
  const PUNE: GeoPoint = { lat: 18.5204, lng: 73.8567 };
  const suburbs: Record<string, GeoPoint> = { 'pid-hadapsar': { lat: 18.5089, lng: 73.926 }, 'pid-baner': { lat: 18.559, lng: 73.7868 }, 'pid-wakad': { lat: 18.5987, lng: 73.7609 } };
  const log: AreaSearch[] = [];
  const res = await discoverCompetitorAreas(
    { pin: PUNE, searchTerm: 'Plumber', serviceAreas: Object.keys(suburbs).map((id) => ({ placeId: id, placeName: id.slice(4)[0].toUpperCase() + id.slice(5) })) },
    {
      resolve: async (a) => suburbs[a.placeId!],
      search: fakeSearch({
        'Hadapsar (service area)': [{ name: 'Quick Fix Plumbing Services', placeId: 'p1', category: 'Plumber' }, { name: 'Hadapsar Hardware', placeId: 'p2', category: 'Hardware store' }],
        'Baner (service area)': [{ name: 'Baner Plumbers', placeId: 'p3', category: 'Store' }],
      }, log),
      relevantCount: () => 3,
    },
  );
  assert.deepEqual(log.map((s) => s.keyword).sort(), ['Plumber Baner', 'Plumber Hadapsar', 'Plumber Wakad', 'Plumber near me', 'Plumber near me', 'Plumber near me']);
  const plumber = buildTradeProfile({ searchCategory: 'Plumber', category: 'Plumber' })!;
  const counted = competitorsFromObservations(res.observations)
    .filter((c) => classifyCompetitor({ name: c.name, category: c.category, keywords: c.keywords }, plumber).counted)
    .map((c) => c.name)
    .sort();
  assert.deepEqual(counted, ['Baner Plumbers', 'Quick Fix Plumbing Services']);
});

test('distances are real: Ojhar ≈ 4 km and Nashik ≈ 14 km from Durva', () => {
  assert.ok(Math.abs(haversineKm(DURVA, PLACES['pid-ojhar']) - 4) < 1);
  assert.ok(Math.abs(haversineKm(DURVA, PLACES['pid-nashik']) - 14.5) < 1.5);
});
