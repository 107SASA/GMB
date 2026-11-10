/**
 * Keyword system audit stage end to end (docs/KEYWORD_SYSTEM_PLAN.md Phase 2):
 * research → volume for every candidate → rank checks (every owner keyword,
 * reusing searches the audit already ran) → 5 core + 5 rotating → saved on
 * the SEO plan and carried forward. DataForSEO is stubbed — no paid calls.
 * Run: npx tsx --test tests/workflow/keyword-pipeline.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATAFORSEO_LOGIN = 'test-login';
process.env.DATAFORSEO_PASSWORD = 'test-password';
process.env.DATAFORSEO_ADS_PER_MINUTE = '1000'; // stubbed calls — no real per-minute limit

const posts: Array<{ url: string; body: any }> = [];
let ideasEnabled = true;
const Module = require('module');
const origLoad = Module._load;
const COUNTRY: Record<string, number | null> = {
  'root canal treatment kolkata': 320, 'dental implants kolkata': 590, 'teeth whitening kolkata': null,
  'braces kolkata': 260, 'dentist near me': 2400, 'dental clinic kolkata': 1900, 'root canal cost kolkata': 140,
  'invisalign kolkata': 90, 'tooth extraction kolkata': 110,
};
Module._load = function (request: string, ...rest: any[]) {
  if (request === 'axios') {
    return {
      get: async () => ({ data: { tasks: [{ result: [{ location_code: 1007768, location_name: 'Kolkata,West Bengal,India', location_type: 'City' }, { location_code: 21345, location_name: 'West Bengal,India', location_type: 'State' }] }] } }),
      post: async (url: string, body: any[]) => {
        posts.push({ url, body: body[0] });
        const ok = (result: any[]) => ({ status: 200, data: { status_code: 20000, tasks: [{ status_code: 20000, result }] } });
        if (url.includes('keywords_for_keywords')) {
          if (!ideasEnabled) throw Object.assign(new Error('Forbidden'), { response: { status: 403, data: { status_message: 'Access denied' } } });
          return ok([
            { keyword: 'root canal cost kolkata', search_volume: 140 },
            { keyword: 'best dentist kolkata', search_volume: 3000 }, // claim word → dropped
            { keyword: 'car service kolkata', search_volume: 9000 },  // unrelated → dropped
          ]);
        }
        if (url.includes('keywords_for_site')) return ok([{ keyword: 'invisalign kolkata', search_volume: 90 }]);
        // search_volume: country table at India, city answers only the big ones.
        const { keywords, location_code } = body[0];
        const table = location_code === 2356 ? COUNTRY : { 'dentist near me': 900, 'dental implants kolkata': 210 } as Record<string, number | null>;
        return ok(keywords.map((k: string) => ({ keyword: k, search_volume: k in table ? table[k] : null })));
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
  process.env.MONGODB_URI = memoryServer.getUri(`gm_kw_pipeline_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    SeoPlan: (await import('../../src/models/SeoPlan')).default,
    Business: (await import('../../src/models/Business')).default,
    pipeline: await import('../../src/services/seo/keywordPipeline'),
    svc: await import('../../src/services/seoPlan/seoPlanService'),
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

const RANKS: Record<string, number | null> = {
  'root canal treatment kolkata': 9, 'dental implants kolkata': 6, 'teeth whitening kolkata': null,
  'braces kolkata': 14, 'dentist near me': 5, 'dental clinic kolkata': 12, 'invisalign kolkata': null,
};
const searched: Array<{ keyword: string; points: number }> = [];
const fakeMaps = async (_b: any, checks: Array<{ keyword: string; points: number }>) => {
  searched.push(...checks);
  return checks.flatMap((c) => Array.from({ length: c.points }, () => {
    const r = RANKS[c.keyword.toLowerCase()] ?? null;
    return {
      keyword: c.keyword, kind: 'discovery' as const, status: 'ok' as const, found: r != null, rank: r,
      ahead: [{ name: 'Apollo Dental', position: 1, reviewCount: 900, rating: 4.8 }],
      target: { name: 'Smilewell Dental', position: r ?? 0, reviewCount: 120 },
    };
  }));
};

const services = [
  { id: 'svc:root-canal-treatment', name: 'Root canal treatment', source: 'gbp' as const, state: 'VERIFIED' as const },
  { id: 'svc:dental-implants', name: 'Dental implants', source: 'gbp' as const, state: 'VERIFIED' as const },
  { id: 'svc:braces', name: 'Braces', source: 'gbp' as const, state: 'VERIFIED' as const },
  { id: 'svc:dental-clinic', name: 'Dental clinic', source: 'category' as const, state: 'VERIFIED' as const },
];
const input = (business: any, over: any = {}) => ({
  business,
  businessForRankings: { coordinates: { lat: 22.57, lng: 88.36 } },
  services,
  category: 'Dentist',
  city: 'Kolkata',
  place: { city: 'Kolkata', state: 'West Bengal', country: 'India' },
  serviceAreas: [],
  gbpSearchTerms: [{ keyword: 'dentist near me', impressions: 64 }],
  // The main grid already searched this one at 9 points.
  existingObservations: Array.from({ length: 9 }, () => ({ keyword: 'dental implants kolkata', kind: 'primary', status: 'ok', found: true, rank: 6, ahead: [] })),
  competitors: [{ name: 'Apollo Dental', website: 'https://www.apollodental.in' }],
  previous: [],
  ownerRemoved: [],
  now: new Date('2026-11-09T00:00:00.000Z'),
  fetchObservations: fakeMaps,
  ...over,
});

const owner = {
  name: 'Smilewell Dental', intakeCompleted: true,
  keywords: ['root canal treatment kolkata', 'teeth whitening kolkata', 'braces kolkata', 'dental implants kolkata'],
  intake: { competitorNames: ['Apollo Dental'] },
};

test('every owner keyword gets volume and a rank; targets are picked; nothing is invented', async (t) => {
  if (skipReason) return t.skip(skipReason);
  posts.length = 0; searched.length = 0;
  const r = await m.pipeline.runKeywordPipeline(input(owner));
  assert.ok(r, 'pipeline ran');
  const by = new Map(r.keywordSet.map((k: any) => [k.keyword, k]));

  for (const kw of owner.keywords) {
    const row: any = by.get(kw);
    assert.ok(row, `owner keyword "${kw}" is on the list`);
    assert.equal(row.owner, true);
    assert.equal(row.rank.status, 'measured', `owner keyword "${kw}" was rank-checked`);
  }
  assert.equal((by.get('root canal treatment kolkata') as any).volume.country, 320);
  assert.equal((by.get('teeth whitening kolkata') as any).volume.status, 'too_few_searches');
  assert.equal((by.get('dental implants kolkata') as any).volume.city, 210);

  // Discovery: ideas + competitor site; claim words and unrelated phrases dropped.
  assert.ok(by.has('root canal cost kolkata'));
  assert.ok(!by.has('invisalign kolkata'), 'competitor keyword dropped: no listed service matches it');
  assert.ok(!by.has('best dentist kolkata') && !by.has('car service kolkata'));

  // Reuse: the grid already searched "dental implants kolkata" at 9 points.
  assert.ok(!searched.some((s) => s.keyword === 'dental implants kolkata'), 'not paid twice');
  assert.ok(searched.length <= 50);

  const core = r.keywordSet.filter((k: any) => k.role === 'core');
  assert.ok(core.length >= 1 && core.length <= 5);
  assert.ok(core.some((k: any) => k.owner), 'a good owner keyword is a core target');
  assert.equal((by.get('teeth whitening kolkata') as any).role, 'owner', 'few-searches owner keyword is measured, not targeted');
  assert.match((by.get('root canal treatment kolkata') as any).reason, /320 Google searches a month; you are #9 on Google Maps/);
  assert.equal((by.get('dentist near me') as any).competitorsAbove[0].name, 'Apollo Dental');

  // Google Ads tasks: ideas, competitor site, country + city volume, ≤ 1 area pass.
  assert.equal(posts.filter((p) => p.url.includes('keywords_for_keywords')).length, 1);
  assert.equal(posts.filter((p) => p.url.includes('keywords_for_site')).length, 1);
  assert.ok(posts.filter((p) => p.url.includes('search_volume')).length <= 4);
});

test('research still runs when the ideas endpoint is not enabled', async (t) => {
  if (skipReason) return t.skip(skipReason);
  ideasEnabled = false;
  try {
    const r = await m.pipeline.runKeywordPipeline(input({ ...owner, name: 'Other Dental' }));
    assert.ok(r);
    assert.ok(r.keywordSet.some((k: any) => k.keyword === 'root canal treatment kolkata'));
    assert.ok(!r.keywordSet.some((k: any) => k.keyword === 'root canal cost kolkata'), 'no ideas without the endpoint');
  } finally {
    ideasEnabled = true;
  }
});

test('the SEO plan stores the keyword set, derives target lists and carries it forward', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const b = await m.Business.create({ name: 'Smilewell Dental', category: 'Dentist', address: 'Kolkata', userId: new m.mongoose.Types.ObjectId(), organizationId: new m.mongoose.Types.ObjectId() } as any);
  const businessId = String(b._id);
  const r = await m.pipeline.runKeywordPipeline(input(owner));
  const base = { businessId, keywordTable: [], areasChecked: [], baseline: {} };

  const v1 = await m.svc.upsertSeoPlanFromAudit({ ...base, keywords: { keywordSet: r.keywordSet, changes: r.changes, gaps: r.gaps, research: r.research }, rankingComplete: true });
  assert.equal(v1.keywordSet.length, r.keywordSet.length);
  assert.deepEqual(v1.primaryKeywords, r.keywordSet.filter((k: any) => k.role === 'core').map((k: any) => k.keyword));
  assert.equal(v1.keywordResearch.candidates, r.research.candidates);

  // An audit with no keyword research (or failed ranking) keeps the set.
  const v2 = await m.svc.upsertSeoPlanFromAudit({ ...base, rankingComplete: true });
  assert.equal(v2.keywordSet.length, r.keywordSet.length);
  const v3 = await m.svc.upsertSeoPlanFromAudit({ ...base, keywords: { keywordSet: [], changes: [], gaps: [], research: { candidates: 0, withVolume: 0, rankChecked: 0 } }, rankingComplete: false });
  assert.equal(v3.keywordSet.length, r.keywordSet.length, 'failed ranking never wipes the set');

  // Owner removes a keyword in Settings → it leaves the set.
  const v4 = await m.svc.applyOwnerProfileEdit(businessId, { keywords: { before: owner.keywords, after: owner.keywords.filter((k) => k !== 'braces kolkata') } });
  assert.ok(!v4.keywordSet.some((k: any) => k.keyword === 'braces kolkata'));
  assert.equal(await m.SeoPlan.countDocuments({ businessId, status: 'active' }), 1);
});

test('Google Ads calls wait for a slot once the per-minute limit is used', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { waitForGoogleAdsSlot } = await import('../../src/lib/googleAdsRateGate');
  const prev = process.env.DATAFORSEO_ADS_PER_MINUTE;
  process.env.DATAFORSEO_ADS_PER_MINUTE = '2';
  try {
    await m.mongoose.connection.db.collection('ratelimitwindows').deleteMany({ key: /^dataforseo:google_ads_live/ });
    const t0 = Date.now();
    await waitForGoogleAdsSlot('test 1', 400);
    await waitForGoogleAdsSlot('test 2', 400);
    assert.ok(Date.now() - t0 < 300, 'within the limit: no wait');
    const t1 = Date.now();
    await waitForGoogleAdsSlot('test 3', 400); // over the limit: waits, then gives up and sends anyway
    const sameMinute = Math.floor(t0 / 60_000) === Math.floor(Date.now() / 60_000);
    // (A new minute starting mid-test resets the window — then no wait is correct.)
    if (sameMinute) assert.ok(Date.now() - t1 >= 350, 'over the limit: waited for a slot');
  } finally {
    process.env.DATAFORSEO_ADS_PER_MINUTE = prev;
  }
});

test('onboarding volume lookups: real numbers, at most 8 lookups per business per day', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { ownerKeywordVolumes } = await import('../../src/services/seo/ownerKeywordVolume');
  const businessId = String(new m.mongoose.Types.ObjectId());
  const first = await ownerKeywordVolumes(businessId, ['Root canal treatment kolkata', 'teeth whitening kolkata', '!!'], 'India');
  assert.deepEqual(first, { volumes: { 'Root canal treatment kolkata': 320, 'teeth whitening kolkata': null }, limited: false });
  // Cached keywords are free and not counted.
  const cachedAgain = await ownerKeywordVolumes(businessId, ['root canal treatment kolkata'], 'India');
  assert.deepEqual(cachedAgain.volumes, { 'root canal treatment kolkata': 320 });
  // 8 live lookups use the day's allowance (the keywords above came from the cache).
  for (let i = 0; i < 8; i++) await ownerKeywordVolumes(businessId, [`new phrase ${i} kolkata`], 'India');
  const before = posts.length;
  const ninth = await ownerKeywordVolumes(businessId, ['another new phrase kolkata', 'root canal treatment kolkata'], 'India');
  assert.deepEqual(ninth, { volumes: { 'root canal treatment kolkata': 320 }, limited: true }, 'over the limit: cached numbers still shown');
  assert.equal(posts.length, before, 'no paid call once the daily limit is used');
});

test('one volume rule everywhere: the number stored by research wins over a fresh lookup', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { ownerKeywordVolumes } = await import('../../src/services/seo/ownerKeywordVolume');
  const b = await m.Business.create({ name: 'Rule Dental', category: 'Dentist', address: 'Kolkata', userId: new m.mongoose.Types.ObjectId(), organizationId: new m.mongoose.Types.ObjectId() } as any);
  await m.SeoPlan.create({
    businessId: b._id, version: 1, status: 'active',
    keywordSet: [{ id: 'kw:dental-implants-kolkata', keyword: 'dental implants kolkata', role: 'core', volume: { country: 590, city: 210, area: null, status: 'measured', measuredAt: null } }],
  } as any);
  const before = posts.length;
  const r = await ownerKeywordVolumes(String(b._id), ['Dental implants kolkata'], 'India');
  assert.deepEqual(r.volumes, { 'Dental implants kolkata': 210 }, 'city number, as on the Keywords page');
  assert.equal(posts.length, before, 'no paid call');
});

test('monthly budget: extras skipped when low, research kept when used up, spend recorded', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { keywordBudgetRemaining } = await import('../../src/lib/keywordBudget');

  // Used up → no paid call at all; the plan keeps last month's research.
  posts.length = 0; searched.length = 0;
  const none = await m.pipeline.runKeywordPipeline(input(owner, { budgetUsd: 0.05 }));
  assert.equal(none, null);
  assert.equal(posts.length + searched.length, 0);

  // Just above the essential reserve → no ideas / competitor sites, owner keywords still measured.
  posts.length = 0; searched.length = 0;
  const low = await m.pipeline.runKeywordPipeline(input(owner, { budgetUsd: 0.35 }));
  assert.ok(low);
  assert.equal(posts.filter((p) => p.url.includes('keywords_for_keywords') || p.url.includes('keywords_for_site')).length, 0);
  for (const kw of owner.keywords) assert.equal(low.keywordSet.find((k: any) => k.keyword === kw)?.rank.status, 'measured');
  assert.ok(low.spentUsd <= 0.35);

  // A real business id: spend is stored against this month's budget.
  const b = { ...owner, _id: new m.mongoose.Types.ObjectId() };
  const full = await m.pipeline.runKeywordPipeline(input(b));
  assert.ok(full.spentUsd > 0 && full.spentUsd <= 1.2);
  const left = await keywordBudgetRemaining(String(b._id), new Date('2026-11-20T00:00:00.000Z'));
  assert.ok(Math.abs(left - (1.2 - full.spentUsd)) < 0.001);
});

test('review replies use the month\'s targets; the report table until research ran', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { gatherReplyContext } = await import('../../src/services/reviews/replyPipeline');
  const mk = async (name: string) => m.Business.create({ name, category: 'Dentist', city: 'Kolkata', address: 'Kolkata', userId: new m.mongoose.Types.ObjectId(), organizationId: new m.mongoose.Types.ObjectId() } as any);

  const withTargets = await mk('Target Dental');
  await m.SeoPlan.create({
    businessId: withTargets._id, version: 1, status: 'active',
    keywordTable: [{ keyword: 'old table keyword kolkata', rankStatus: 'ok' }],
    keywordSet: [
      { id: 'kw:braces-kolkata', keyword: 'braces kolkata', role: 'rotating' },
      { id: 'kw:dental-implants-kolkata', keyword: 'dental implants kolkata', role: 'core' },
      { id: 'kw:watch', keyword: 'watched keyword kolkata', role: 'watch' },
    ],
  } as any);
  const a = await gatherReplyContext(String(withTargets._id));
  assert.deepEqual(a.keywords, ['dental implants kolkata (measured)', 'braces kolkata (measured)'], 'focus first, then monthly; no watch / old table');

  const noTargets = await mk('Old Dental');
  await m.SeoPlan.create({ businessId: noTargets._id, version: 1, status: 'active', keywordTable: [{ keyword: 'root canal kolkata', rankStatus: 'ok' }] } as any);
  const b = await gatherReplyContext(String(noTargets._id));
  assert.deepEqual(b.keywords, ['root canal kolkata (measured)']);
});
