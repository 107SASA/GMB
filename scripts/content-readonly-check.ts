/**
 * Content / posting — opening the Content screens (web + mobile) is READ-ONLY.
 * In-memory MongoDB; Inngest, Groq and LLM hosts intercepted and counted.
 *   npx tsx scripts/content-readonly-check.ts
 * Proves: opening / refreshing every Content read API creates no posts, no
 * dispatch, no AI call (even for a business that qualifies but has not
 * started autopilot); the automatic first start still fires exactly once;
 * web and the mobile app's own parser show the same weekly posts.
 */
import path from 'path';

for (const k of Object.keys(process.env)) if (k.startsWith('DO_SPACES_')) delete process.env[k];

const events: Array<{ name: string; data: any }> = [];
const aiCalls: string[] = [];
let ctx: any = null;
let mobileGet: ((url: string, cfg?: any) => Promise<{ data: any }>) | null = null;
const esm = (o: Record<string, unknown>) => { const m: any = { __esModule: true, ...o }; m.default = m; return m; };
class FakeGroq { chat = { completions: { create: async () => { aiCalls.push('groq'); return { choices: [] }; } } }; }
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url ?? '';
  if (/groq\.com|openai\.com|anthropic\.com|generativelanguage\.googleapis\.com/.test(url)) { aiCalls.push(url); return new Response('{}'); }
  return realFetch(input, init);
}) as typeof fetch;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (request === 'groq-sdk') return esm({ Groq: FakeGroq, default: FakeGroq });
  if (/services[\\/]inngest[\\/]client(\.ts)?$/.test(request)) {
    return esm({ inngest: { send: async (e: any) => { for (const x of Array.isArray(e) ? e : [e]) events.push(x); return { ids: [] }; }, createFunction: () => ({}) } });
  }
  if (/lib[\\/]tenant(\.ts)?$/.test(request)) return esm({ requireBusinessContext: async () => ctx });
  if (/lib[\\/]moduleGating(\.ts)?$/.test(request)) return esm({ requireModule: async () => ({ ok: true }) });
  if (/mobile[\\/]src[\\/]api[\\/]client(\.ts)?$/.test(request) || request === '../client') {
    return esm({ api: { get: async (url: string, cfg?: any) => mobileGet!(url, cfg) }, getApiErrorMessage: () => '' });
  }
  return origLoad.call(this, request, ...rest);
};
for (const rel of ['src/services/inngest/client.ts', 'src/lib/tenant.ts', 'src/lib/moduleGating.ts', 'mobile/src/api/client.ts']) {
  const filename = path.resolve(rel);
  const m = new Module(filename);
  m.filename = filename; m.loaded = true; m.exports = Module._load(filename);
  require.cache[filename] = m;
}

const results: Array<{ t: string; pass: boolean }> = [];
const check = (t: string, what: string, pass: boolean, detail = '') => { results.push({ t, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  [${t}] ${what}${detail ? ` — ${detail}` : ''}`); };
const req = (url: string) => new Request(`http://local.test${url}`);
async function json(res: Response) { return { status: res.status, body: await res.json().catch(() => ({})) as any }; }

(async () => {
  const { MongoMemoryServer } = await import('mongodb-memory-server' as string);
  const mem = await MongoMemoryServer.create({ instance: { launchTimeout: 90_000 } });
  process.env.MONGODB_URI = mem.getUri('content_readonly_check');
  try {
    const mongoose = (await import('mongoose')).default;
    const dbConnect = (await import('../src/lib/mongodb')).default; await dbConnect();
    const { default: Business } = await import('../src/models/Business');
    const { default: Post } = await import('../src/models/Post');
    const routes = {
      autopilot: await import('../src/app/api/content/autopilot-status/route'),
      buffer: await import('../src/app/api/scheduler/buffer/route'),
      contentPosts: await import('../src/app/api/content/posts/route'),
      posts: await import('../src/app/api/posts/route'),
      weeklyOffer: await import('../src/app/api/content/weekly-offer/route'),
    };
    const { maybeStartContentAutopilot } = await import('../src/lib/contentAutopilot');

    const org = new mongoose.Types.ObjectId();
    // Qualifies for autopilot (paid + Google connected + keywords) but has NOT started.
    const fresh: any = await Business.create({ name: 'Fresh Biz', category: 'Salon', address: 'Pune', organizationId: org, userId: new mongoose.Types.ObjectId(), subscriptionStatus: 'active', googleConnected: true, keywords: ['hair salon pune'] });
    const as = (b: any) => { ctx = { ok: true, userId: String(new mongoose.Types.ObjectId()), organizationId: String(org), businessId: String(b._id), business: b }; };
    const openAll = async () => Promise.all([
      routes.autopilot.GET(),
      routes.buffer.GET(),
      routes.contentPosts.GET(req('/api/content/posts?page=1&limit=20')),
      (routes.posts as any).GET(req('/api/posts?status=published&page=1&limit=10')),
      routes.weeklyOffer.GET(),
    ]);

    as(fresh);
    const postsBefore = await Post.countDocuments();
    for (let i = 0; i < 3; i++) await openAll(); // open + two refreshes
    const freshAfter: any = await Business.findById(fresh._id).lean();
    check('R1', 'opening / refreshing every Content read API (autopilot status, calendar, posts, history, weekly offer) creates no posts, no dispatch, no AI call — even for a business that qualifies but has not started',
      (await Post.countDocuments()) === postsBefore && events.length === 0 && aiCalls.length === 0 && freshAfter.autopilotNextRunAt == null,
      `posts +${(await Post.countDocuments()) - postsBefore} · events ${events.length} · ai ${aiCalls.length}`);

    // The automatic first start (Google connect / payment / intake / hourly cron) still fires — once.
    await maybeStartContentAutopilot(String(fresh._id));
    await maybeStartContentAutopilot(String(fresh._id));
    const starts = events.filter((e) => e.name === 'scheduler/generate' && e.data?.autopilot === true && e.data.businessId === String(fresh._id));
    check('R2', 'the automatic start path still dispatches the first weekly batch exactly once (atomic claim), unchanged', starts.length === 1 && !!(await Business.findById(fresh._id).lean() as any).autopilotNextRunAt);

    // A business with this week's 4 automatic posts — web vs the mobile parser.
    const live: any = await Business.create({ name: 'Live Biz', category: 'Salon', address: 'Pune', organizationId: org, userId: new mongoose.Types.ObjectId(), subscriptionStatus: 'active', googleConnected: true, keywords: ['spa pune'], autopilotNextRunAt: new Date(Date.now() + 6 * 86_400_000) });
    const week = '2026-W40';
    const statuses = ['scheduled', 'published', 'blocked', 'draft'];
    for (let i = 0; i < 4; i++) {
      await Post.create({
        businessId: live._id, tenantId: String(org), title: `Post ${i + 1}`, content: `Body ${i + 1}`, status: statuses[i], aiGenerated: true,
        batchKey: week, scheduledDate: new Date(Date.now() + (i + 1) * 86_400_000), imageUrl: `https://cdn.example.invalid/p${i}.jpg`,
        contentMeta: { slot: i + 1, purpose: 'service', seoTheme: 'Bridal makeup', keyword: 'bridal makeup pune', keywordSource: 'seo_plan', keywordMeasured: true, keywordReason: 'Top theme in your SEO plan', imageOrigin: 'AI_GENERATED', ...(i === 3 ? { festivalName: 'Diwali' } : {}) },
      });
    }
    as(live);
    const eventsBefore = events.length;
    const web = (await json(await routes.contentPosts.GET(req('/api/content/posts?page=1&limit=20')))).body;
    mobileGet = async (url: string, cfg?: any) => {
      const qs = new URLSearchParams(Object.entries(cfg?.params ?? {}).map(([k, v]) => [k, String(v)])).toString();
      if (url === '/api/content/posts') return { data: (await json(await routes.contentPosts.GET(req(`${url}?${qs}`)))).body };
      throw new Error(`unexpected mobile call ${url}`);
    };
    const mobileContent: any = await import('../mobile/src/api/endpoints/content');
    const mob = await mobileContent.fetchContentPosts(1);
    const pick = (p: any) => ({ id: String(p._id), status: p.status, scheduledDate: p.scheduledDate ? new Date(p.scheduledDate).toISOString() : null, keyword: p.contentMeta?.keyword, theme: p.contentMeta?.seoTheme, reason: p.contentMeta?.keywordReason, origin: p.contentMeta?.imageOrigin, festival: p.contentMeta?.festivalName ?? null });
    const webRows = (web.posts as any[]).map(pick).sort((a, b) => a.id.localeCompare(b.id));
    const mobRows = (mob.posts as any[]).map(pick).sort((a, b) => a.id.localeCompare(b.id));
    check('R3', 'web and mobile show the same weekly 4-post batch: same post IDs, status (scheduled / published / blocked / draft), scheduled dates, theme, keyword + reason, image origin, festival',
      webRows.length === 4 && JSON.stringify(webRows) === JSON.stringify(mobRows) && events.length === eventsBefore,
      `${webRows.length} web / ${mobRows.length} mobile`);
    check('R4', 'no AI / image-generation call anywhere in this run', aiCalls.length === 0, `${aiCalls.length}`);
  } finally {
    await mem.stop({ doCleanup: true, force: true }).catch(() => {});
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILED: ${failed.map((f) => f.t).join(', ')}` : ''}`);
  process.exit(failed.length ? 1 : 0);
})();
