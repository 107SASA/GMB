/**
 * Keyword search volume (Nov 2026): 399 of 446 phrases had no volume, and
 * one phrase built from a full address made Google reject every keyword of
 * that report on every run. Now phrases are cleaned, a rejected one is
 * dropped and the rest asked again, and when Google can't count an exact
 * local phrase the report shows the service's searches in the customer's
 * city (or state). DataForSEO is stubbed — no paid calls.
 * Run: npx tsx --test tests/workflow/keyword-demand.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const calls: any[] = [];
const Module = require('module');
const origLoad = Module._load;
// Real Google Ads shapes (DataForSEO, Nov 2026): 3- and 4-part names.
const locations = [
  { location_code: 9040235, location_name: 'Nashik,Nashik,Maharashtra,India', location_type: 'City' },
  { location_code: 9075232, location_name: 'Ojhar,Maharashtra,India', location_type: 'City' },
  { location_code: 20462, location_name: 'Maharashtra,India', location_type: 'State' },
  { location_code: 1007785, location_name: 'Nashik,Other State,India', location_type: 'City' },
  { location_code: 1, location_name: '422206,Maharashtra,India', location_type: 'Postal Code' },
];
const VOL: Record<string, Record<string, number | null>> = {
  '2356': { 'website development near me': 1600, 'website development ojhar': null },
  '9040235': { 'website development': 1300 },
  '9075232': { 'website development': null, 'ai and automation': null },
  '20462': { 'website development': 9900, 'ai and automation': 590 },
};
Module._load = function (request: string, ...rest: any[]) {
  if (request === 'axios') {
    return {
      get: async (url: string) => { calls.push({ get: url }); return { data: { tasks: [{ result: locations }] } }; },
      post: async (_url: string, body: any[]) => {
        const { keywords, location_code } = body[0];
        calls.push({ post: keywords, location_code });
        if (keywords.includes('bad phrase')) {
          return { status: 200, data: { status_code: 20000, tasks: [{ status_code: 40501, status_message: "Invalid Field: 'keywords'. Keyword text has invalid characters or symbols: 'bad phrase'." }] } };
        }
        const table = VOL[String(location_code)] || {};
        return { status: 200, data: { status_code: 20000, tasks: [{ status_code: 20000, result: keywords.filter((k: string) => k in table).map((k: string) => ({ keyword: k, search_volume: table[k] })) }] } };
      },
    };
  }
  return origLoad.call(this, request, ...rest);
};

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_kw_demand_${Date.now()}`);
  process.env.DATAFORSEO_LOGIN = 'test-login';
  process.env.DATAFORSEO_PASSWORD = 'test-password';
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    vol: await import('../../src/services/audit/keywordVolumeClient'),
    area: await import('../../src/services/audit/areaDemand'),
    table: await import('../../src/services/audit/keywordTable'),
  };
});

after(async () => {
  Module._load = origLoad;
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

test('phrases are cleaned to what Google Ads accepts', (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal(m.vol.adsKeyword('Software & Marketing Company Dhapa, Kolkata, West Bengal'), 'software and marketing company dhapa kolkata west bengal');
  assert.equal(m.vol.adsKeyword('a b c d e f g h i j k'), null, 'more than 10 words');
  assert.equal(m.vol.adsKeyword('x'.repeat(81)), null);
});

test('one rejected phrase no longer blanks the rest; volumes map back to the original wording', async (t) => {
  if (skipReason) return t.skip(skipReason);
  calls.length = 0;
  const out = await m.vol.fetchSearchVolumes(['Website Development, Near Me', 'bad phrase', 'website development ojhar']);
  assert.equal(calls.filter((c) => c.post).length, 2, 'asked again without the rejected phrase');
  assert.equal(out.get('website development, near me'), 1600, 'commas removed before asking; the answer maps back to the original wording');
  assert.equal(out.has('bad phrase'), false, 'rejected = not measured');
  assert.equal(out.get('website development ojhar'), null, 'Google answered with no data = too few searches');
});

test('the broad term and the customer\'s Google Ads locations, narrowest first', (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal(m.area.headTerm('best website development ojhar', ['Ojhar', 'Maharashtra']), 'website development');
  assert.equal(m.area.headTerm('website development near me', ['Ojhar']), 'website development');
  assert.equal(m.area.headTerm('ojhar', ['Ojhar']), null);
  const rows = locations.map((r) => ({ code: r.location_code, name: r.location_name, type: r.location_type }));
  assert.deepEqual(m.area.pickAdsLocations(rows, { city: 'Nashik', state: 'Maharashtra' }), [
    { code: 9040235, area: 'Nashik', level: 'city' }, { code: 20462, area: 'Maharashtra', level: 'state' },
  ], '4-part name matched on its state');
  assert.deepEqual(m.area.pickAdsLocations(rows, { city: 'Ojhar', state: 'Maharashtra' }).map((l: any) => l.area), ['Ojhar', 'Maharashtra']);
  assert.deepEqual(m.area.pickAdsLocations(rows, { city: 'Nowhere' }), []);
});

test('a small town Google can\'t count falls back to the state', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const out = await m.area.areaDemandFor(['website development ojhar', 'ai and automation ojhar'], { city: 'Ojhar', state: 'Maharashtra', country: 'India' });
  assert.deepEqual(out.get('website development ojhar'), { term: 'website development', area: 'Maharashtra', level: 'state', searchVolume: 9900 });
  assert.equal(out.get('ai and automation ojhar').searchVolume, 590);
});

test('keyword table: exact phrase too rare → "Too few to count" + the service in the city', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const table = await m.table.buildKeywordTable(
    [{ keyword: 'website development ojhar', rank: 3, found: true }, { keyword: 'website development near me', rank: null, found: false }],
    { city: 'Nashik', area: 'Ojhar', state: 'Maharashtra', country: 'India' },
  );
  const [local, nearMe] = table;
  assert.equal(local.demandStatus, 'unavailable');
  assert.equal(local.demandReason, 'too_few_searches');
  assert.deepEqual(local.areaDemand, { term: 'website development', area: 'Nashik', level: 'city', searchVolume: 1300 });
  assert.equal(nearMe.demandStatus, 'measured');
  assert.equal(nearMe.searchVolume, 1600);
  assert.equal(nearMe.demandReason, null);
  assert.equal(nearMe.areaDemand, null, 'a measured phrase is not looked up again');
});

test('no extra paid call when every phrase already has a number, and none on a repeat report', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const ranked = [{ keyword: 'website development near me', rank: 1, found: true }];
  const place = { city: 'Nashik', state: 'Maharashtra', country: 'India' };
  await m.table.buildKeywordTable(ranked, place); // warm the cache
  calls.length = 0;
  await m.table.buildKeywordTable(ranked, place);
  assert.equal(calls.filter((c) => c.post).length, 0);
  // A full repeat of the earlier report (country, city and state answers all cached).
  await m.table.buildKeywordTable([{ keyword: 'website development ojhar', rank: 3, found: true }], { city: 'Nashik', area: 'Ojhar', state: 'Maharashtra', country: 'India' });
  assert.equal(calls.filter((c) => c.post).length, 0, 'every answer comes from the 45-day cache');
  assert.equal(calls.filter((c) => c.get).length, 0, 'location list comes from the 30-day store');
});
