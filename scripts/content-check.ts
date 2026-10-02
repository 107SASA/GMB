/**
 * WEEKLY CONTENT ENGINE CHECK — the 32 spec cases on a throwaway in-memory
 * MongoDB (nothing touches production data).
 *
 *   npx tsx scripts/content-check.ts [outDir]
 *
 * REAL: Groq (one weekly batch for the "website + services + logo" business,
 *   plus any regeneration it needs), sharp image composition, the evidence
 *   gate, Mongo unique indexes, notifications written to the in-memory DB.
 * SIMULATED (labelled per check): AI output for the failure/claim cases,
 *   image generation (a generated test image / a thrown error), Google's
 *   localPosts.create (success / rejection), logo download, WhatsApp (sends
 *   are intercepted and captured — NEVER delivered), object storage (off →
 *   data URLs, nothing uploaded).
 */
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(process.argv[2] || 'tmp-content-check');
fs.mkdirSync(OUT, { recursive: true });

for (const file of ['.env.local', '.env']) {
  const p = path.resolve(file);
  if (!fs.existsSync(p)) continue;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '');
    v = v.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.WHATSAPP_PROVIDER = 'twilio';
// The real createLocalPost is only reached for the "not connected" case, where it
// must fail before any network call; every other publish uses a simulated client.
process.env.GBP_LIVE_WRITES_ENABLED = 'true';
process.env.NEXT_PUBLIC_APP_URL ||= 'https://app.example.invalid';
delete process.env.NANOBANANA_API_KEY; // image generation only through the injected simulator
// Never upload test images to real object storage — even if an interceptor below missed.
for (const k of Object.keys(process.env)) if (k.startsWith('DO_SPACES_')) delete process.env[k];

// ── Interceptors ────────────────────────────────────────────────────────────
// Match both the alias ('@/lib/storage') and the resolved path tsx passes for
// lazy imports ('…\src\lib\storage.ts').
const whatsapp: Array<{ phone: string; body: string }> = [];
const fetchHosts: string[] = [];
const intercepted = new Set<string>();
let logoPng: Buffer | null = null;
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/services[\\/]whatsapp[\\/]send(\.ts)?$/.test(request)) {
    intercepted.add('whatsapp');
    return { sendOutboundMessage: async (phone: string, body: string) => { whatsapp.push({ phone, body }); return { success: true, sid: 'captured' }; } };
  }
  if (/lib[\\/]storage(\.ts)?$/.test(request)) {
    intercepted.add('storage');
    const no = async () => { throw new Error('storage disabled in content-check'); };
    // __esModule so a lazy `await import()` sees the named exports, not just `default`.
    const mod: any = { __esModule: true, isStorageConfigured: () => false, uploadPublicObject: no, rehostImageFromUrl: no, deleteObject: no };
    mod.default = mod;
    return mod;
  }
  if (/lib[\\/]ssrfGuard(\.ts)?$/.test(request)) {
    intercepted.add('ssrfGuard');
    const real = origLoad.call(this, request, ...rest);
    return { ...real, guardedFetchBuffer: async (url: string) => (/logo/i.test(url) && logoPng ? { finalUrl: url, body: logoPng, contentType: 'image/png' } : null) };
  }
  return origLoad.call(this, request, ...rest);
};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  try { fetchHosts.push(new URL(typeof input === 'string' ? input : input.url).host); } catch { /* ignore */ }
  return realFetch(input, init);
}) as typeof fetch;

type Result = { n: string; test: string; pass: boolean; detail: string; mode: string };
const results: Result[] = [];
const check = (n: string, test: string, pass: boolean, detail: string, mode = 'integration (in-memory DB)') => {
  results.push({ n, test, pass, detail, mode });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${n}] ${test} — ${detail}`);
};

async function main() {
  const { MongoMemoryServer } = await import('mongodb-memory-server' as string);
  const mem = await MongoMemoryServer.create({ instance: { launchTimeout: 90_000 } });
  process.env.MONGODB_URI = mem.getUri('growwmatics_content_check');
  try {
    await run();
  } finally {
    await mem.stop({ doCleanup: true, force: true }).catch(() => {});
  }
}

async function run() {
  const sharp = (await import('sharp')).default;
  logoPng = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 220, g: 20, b: 60, alpha: 1 } } }).png().toBuffer();
  let genN = 0;
  const genImage = async () => {
    genN++;
    return `data:image/png;base64,${(await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: (30 + genN * 37) % 256, g: (90 + genN * 53) % 256, b: 200 } } }).png().toBuffer()).toString('base64')}`;
  };

  const dbConnect = (await import('../src/lib/mongodb')).default;
  await dbConnect();
  const User = (await import('../src/models/User')).default;
  const Organization = (await import('../src/models/Organization')).default;
  const Business = (await import('../src/models/Business')).default;
  const SeoPlan = (await import('../src/models/SeoPlan')).default;
  const WebsiteIntelligence = (await import('../src/models/WebsiteIntelligence')).default;
  const GbpMediaAsset = (await import('../src/models/GbpMediaAsset')).default;
  const Post = (await import('../src/models/Post')).default;
  const WeeklyOffer = (await import('../src/models/WeeklyOffer')).default;
  const FestivalPrompt = (await import('../src/models/FestivalPrompt')).default;
  const WeeklyMonitor = (await import('../src/models/WeeklyMonitor')).default;
  const Notification = (await import('../src/models/Notification')).default;
  await Promise.all([Post.init(), WeeklyOffer.init(), FestivalPrompt.init(), WeeklyMonitor.init(), WebsiteIntelligence.init()]);

  const { generateWeeklyBatch, applyWeeklyOffer } = await import('../src/services/content/weeklyBatch');
  const { publishPost, sweepStalePublishing, BLOCKED_REASON } = await import('../src/services/content/publishPost');
  const { contentPrompts, runWeeklyMonitoring } = await import('../src/services/lifecycle/notify');
  const { collectExecutions } = await import('../src/services/lifecycle/collect');
  const { buildMonthlyReport, contentActivityLines } = await import('../src/services/lifecycle/monthly');
  const { contentWeekKey } = await import('../src/services/content/plan');
  const { watermarkImageBuffer } = await import('../src/lib/imageWatermark');
  const { runWithMeter } = await import('../src/lib/providerMeter');

  let seq = 0;
  async function mkBiz(o: { website?: string; services?: string; connected?: boolean; manualColors?: string[]; phone?: string; syncedAt?: Date } = {}) {
    seq++;
    const user: any = await User.create({ fullName: `Owner ${seq}`, email: `owner${seq}@example.invalid`, phone: `+9199999${String(seq).padStart(5, '0')}`, role: 'CLIENT' });
    const org: any = await Organization.create({ name: `Org ${seq}`, ownerId: user._id, subscriptionPlan: 'Pro' });
    return Business.create({
      name: 'Sahyadri Tile Works', category: 'Tile contractor', address: 'Gangapur Road, Nashik', area: 'Gangapur Road', city: 'Nashik', state: 'Maharashtra', country: 'India',
      phone: o.phone ?? '+91 98220 11111', website: o.website, services: o.services ?? 'Tile installation, Bathroom renovation',
      organizationId: org._id, userId: user._id, subscriptionStatus: 'active', googleConnected: o.connected ?? true,
      googleReviewTotals: { rating: 4.6, total: 38, capturedAt: o.syncedAt ?? new Date() },
      ...(o.manualColors ? { brandProfile: { manualColors: o.manualColors } } : {}),
    } as any);
  }
  async function seedPlan(biz: any) {
    return SeoPlan.create({
      businessId: biz._id, version: 1, status: 'active',
      keywordTable: [
        { keyword: 'bathroom renovation nashik', searchVolume: 170, volumeBand: 'MED', demandStatus: 'measured', estimated: false, mapsRank: 9, rank: 9, found: true, rankStatus: 'ok' },
        { keyword: 'tile contractor nashik', searchVolume: 90, volumeBand: 'LOW', demandStatus: 'measured', estimated: false, mapsRank: null, rank: null, found: false, rankStatus: 'ok' },
        { keyword: 'sahyadri tile works', searchVolume: null, volumeBand: null, demandStatus: 'unavailable', estimated: true, mapsRank: 1, rank: 1, found: true, rankStatus: 'ok' },
      ],
      postThemes: [
        { weekday: 'Mon', theme: 'Planning a bathroom renovation', keyword: 'bathroom renovation nashik', postType: 'Educational' },
        { weekday: 'Thu', theme: 'Choosing floor tiles for Indian homes', keyword: 'floor tiles nashik', postType: 'Educational' },
      ],
      draft: { proposedKeywords: [{ keyword: 'floor tiles nashik', basis: 'owner-provided service + city' }] },
    } as any);
  }
  async function seedWI(origin: string, o: { status?: string; services?: string[]; cssColors?: string[]; logo?: boolean } = {}) {
    return WebsiteIntelligence.create({
      origin, status: o.status ?? 'complete', pagesCrawled: [], services: (o.services ?? ['Kitchen tiling']).map((v) => ({ value: v, sourceUrl: `${origin}/services` })),
      credentials: [], differentiators: [], offers: [],
      brand: { cssColors: o.cssColors ?? ['#0a7d4f'], themeColor: undefined, logoUrl: o.logo ? `${origin}/logo.png` : undefined, images: [], sourceUrl: `${origin}/` },
    } as any);
  }
  async function seedAssets(biz: any, o: { logo?: boolean; photos?: number }) {
    if (o.logo) await GbpMediaAsset.create({ businessId: biz._id, category: 'LOGO', url: 'https://cdn.example.invalid/logo.png', status: 'published' } as any);
    for (let i = 0; i < (o.photos ?? 0); i++) await GbpMediaAsset.create({ businessId: biz._id, category: 'ADDITIONAL', url: `https://cdn.example.invalid/photo${i}.jpg`, status: 'published' } as any);
  }
  const firstDate = new Date('2026-09-30T04:30:00Z'); // 10:00 IST, a week with no stored festival
  const festivalFirst = new Date('2026-11-02T04:30:00Z'); // Diwali 2026-11-08 is inside the 8-day window
  const nowFor = (d: Date) => new Date(d.getTime() - 86_400_000);
  const goodPost = (t: string) => ({ title: t, body: `Sahyadri Tile Works handles tile installation and bathroom renovation on Gangapur Road, Nashik. Call us to discuss your project.`, cta: 'Call now', hashtags: ['#Nashik'] });
  const batch = (biz: any, extra: any = {}) => generateWeeklyBatch({ business: biz.toObject ? biz.toObject() : biz, tenantId: String(biz.organizationId), firstDate, daySpacing: 2, generatedVia: 'cron', batchKey: contentWeekKey(nowFor(firstDate)), now: nowFor(firstDate), ...extra });
  const postsOf = async (biz: any) => Post.find({ businessId: biz._id }).sort({ 'contentMeta.slot': 1 }).lean() as Promise<any[]>;

  // ── S1: website + services + logo + photos, REAL Groq (cases 1, 4, 5, 23, 24, cost) ──
  const A = await mkBiz({ website: 'https://sahyadri-tiles.example' });
  await seedPlan(A); await seedWI('https://sahyadri-tiles.example', { logo: true }); await seedAssets(A, { logo: true, photos: 2 });
  fetchHosts.length = 0;
  const { result: r1, counts: meter1 } = await runWithMeter(() => batch(A, { deps: { generateImage: genImage } }));
  const p1 = await postsOf(A);
  fs.writeFileSync(path.join(OUT, 'S1-posts.json'), JSON.stringify(p1.map((p) => ({ status: p.status, title: p.title, content: p.content, contentMeta: { ...p.contentMeta, evidence: undefined } })), null, 2));
  check('1', 'website + services + logo → 4 slot posts with trace metadata', p1.length === 4 && p1.every((p) => p.batchKey && p.contentMeta?.slot && p.contentMeta?.purpose && 'keywordMeasured' in p.contentMeta && p.contentMeta.seoPlanId),
    `${p1.map((p) => `${p.contentMeta.slot}:${p.contentMeta.purpose}/${p.status}/${p.contentMeta.generatedVia}`).join(', ')}`, 'REAL Groq + in-memory DB');
  const aiOk = p1.filter((p) => p.contentMeta.generatedVia !== 'template');
  check('1b', 'every scheduled post passed the evidence gate', p1.every((p) => p.status !== 'scheduled' || p.contentMeta.validation.ok === true), `scheduled ${p1.filter((p) => p.status === 'scheduled').length}, drafts ${p1.filter((p) => p.status === 'draft').length}, AI copy ${aiOk.length}/4${p1.some((p) => p.contentMeta.draftReason) ? ` · draft reasons: ${p1.filter((p) => p.contentMeta.draftReason).map((p) => p.contentMeta.draftReason.slice(0, 90)).join(' | ')}` : ''}`, 'REAL Groq');
  check('5', 'owner has Photos, but every autopilot post gets its own new AI image (Photos not auto-used)', p1.every((p) => p.contentMeta.imageOrigin === 'AI_GENERATED' && !/cdn\.example\.invalid\/photo/.test(p.imageUrl || '')), p1.map((p) => p.contentMeta.imageOrigin).join(', '));
  const bizA: any = await Business.findById(A._id).lean();
  check('4', 'customer logo drives brand colour (logo > website)', bizA.brandProfile?.colorSource === 'logo' && bizA.brandProfile?.logoSource === 'customer_upload', `colorSource ${bizA.brandProfile?.colorSource}, colors ${bizA.brandProfile?.colors?.join(' ')}, logo ${bizA.brandProfile?.logoSource}`);
  const m1 = p1.find((p) => p.contentMeta.keyword === 'bathroom renovation nashik');
  const pr1 = p1.find((p) => p.contentMeta.keyword === 'floor tiles nashik');
  check('23', 'measured keyword marked measured', !!m1 && m1.contentMeta.keywordMeasured === true && m1.contentMeta.keywordSource === 'measured', m1 ? `slot ${m1.contentMeta.slot}` : 'none');
  check('24', 'proposed keyword marked NOT measured', !!pr1 && pr1.contentMeta.keywordMeasured === false && pr1.contentMeta.keywordSource === 'proposed', pr1 ? `slot ${pr1.contentMeta.slot}` : 'none');
  check('cost', 'no crawl / ranking / volume / Places call during generation', Object.keys(meter1).every((k) => /groq|Token/i.test(k)) && fetchHosts.every((h) => /groq\.com$/.test(h)),
    `meter: ${JSON.stringify(meter1)} · hosts: ${Array.from(new Set(fetchHosts)).join(', ') || 'none'}`, 'REAL Groq');

  // ── Watermark rule (case 4 continued): customer logo only, never GrowwMatics ──
  const plain = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: { r: 30, g: 90, b: 200 } } }).png().toBuffer();
  const withLogo = await watermarkImageBuffer(plain, logoPng);
  const noLogo = await watermarkImageBuffer(plain, null);
  const statsNo = await sharp(noLogo.buffer).stats();
  const cornerRed = await sharp(withLogo.buffer).extract({ left: 880, top: 880, width: 150, height: 150 }).stats();
  check('4b', 'generated image: customer logo composited; no logo → no mark at all (no GrowwMatics watermark)',
    cornerRed.channels[0].max > 150 && statsNo.channels.every((c: any) => c.min === c.max), `with-logo corner red max ${cornerRed.channels[0].max}; without-logo channels uniform ${statsNo.channels.every((c: any) => c.min === c.max)}`, 'sharp (real)');

  // ── Case 21: duplicate weekly generation ──
  const again = await batch(A, { deps: { generateImage: genImage, generate: async () => { throw new Error('must not be called'); } } });
  check('21', 'rerun of the same week creates nothing', again.created.length === 0 && (await Post.countDocuments({ businessId: A._id })) === 4, `created ${again.created.length}, total ${await Post.countDocuments({ businessId: A._id })}`);
  const D = await mkBiz({ website: 'https://sahyadri-tiles.example' }); await seedPlan(D);
  const fakeGen = async (req: any) => ({ posts: req.slotBriefs.map((_: string, i: number) => goodPost(`Tile installation update ${i + 1}`)) });
  await Promise.all([batch(D, { deps: { generate: fakeGen } }), batch(D, { deps: { generate: fakeGen } })]);
  check('21b', 'two concurrent runs → still exactly 4 posts (unique businessId+batchKey+slot)', (await Post.countDocuments({ businessId: D._id })) === 4, `${await Post.countDocuments({ businessId: D._id })} posts`, 'simulated AI + in-memory DB');

  // ── Publishing (cases 19, 20, BLOCKED, stale, 31) ──
  const [s1, s2, s3] = (await Post.find({ businessId: D._id }).sort({ 'contentMeta.slot': 1 }).lean()) as any[];
  const ok = await publishPost(String(s1._id), { deps: { writesEnabled: () => true, createLocalPost: async () => ({ liveWriteApplied: true, postName: 'accounts/1/locations/2/localPosts/SIM' }) } });
  const okDoc: any = await Post.findById(s1._id).lean();
  check('19', 'Google confirms → PUBLISHED with liveWriteApplied + Google post name', ok.outcome === 'published' && okDoc.status === 'published' && okDoc.liveWriteApplied === true && !!okDoc.gbpPostName, `${okDoc.status} ${okDoc.gbpPostName}`, 'SIMULATED Google API');
  const bad = await publishPost(String(s2._id), { deps: { writesEnabled: () => true, createLocalPost: async () => { throw new Error('Google rejected the post: PERMISSION_DENIED'); } } });
  const badDoc: any = await Post.findById(s2._id).lean();
  check('20', 'Google rejects → FAILED with reason, never published', bad.outcome === 'failed' && badDoc.status === 'failed' && /PERMISSION_DENIED/.test(badDoc.failureReason) && !badDoc.liveWriteApplied, badDoc.failureReason, 'SIMULATED Google API');
  const blk = await publishPost(String(s3._id), { deps: { writesEnabled: () => false } });
  const blkDoc: any = await Post.findById(s3._id).lean();
  check('19b', 'live writes off → BLOCKED with the "not executed" message (not published)', blk.outcome === 'blocked' && blkDoc.status === 'blocked' && blkDoc.failureReason === BLOCKED_REASON, blkDoc.failureReason.slice(0, 80));
  const dupe = await publishPost(String(s1._id), { deps: { writesEnabled: () => true, createLocalPost: async () => { throw new Error('second publish must not happen'); } } });
  check('19c', 'a published post cannot be published twice', dupe.outcome === 'skipped', dupe.outcome);
  const s4: any = (await Post.find({ businessId: D._id, 'contentMeta.slot': 4 }).lean())[0];
  await Post.collection.updateOne({ _id: s4._id }, { $set: { status: 'publishing', updatedAt: new Date(Date.now() - 3_600_000) } });
  const swept = await sweepStalePublishing();
  check('19d', 'interrupted publish → FAILED "outcome unknown", not retried blindly', swept === 1 && ((await Post.findById(s4._id).lean()) as any).status === 'failed', `swept ${swept}`);

  const E = await mkBiz({ website: 'https://sahyadri-tiles.example', connected: false }); await seedPlan(E);
  await batch(E, { deps: { generate: fakeGen } });
  const eFirst: any = await Post.findOne({ businessId: E._id, status: 'scheduled' }).lean();
  const eRes = eFirst ? await publishPost(String(eFirst._id)) : { outcome: 'none' as const };
  const monE = await runWeeklyMonitoring(String(E._id), new Date('2026-10-05T12:00:00Z'));
  const selectable = await Business.countDocuments({ _id: E._id, isDeleted: { $ne: true }, subscriptionStatus: 'active', googleConnected: true });
  check('31', 'website but no connected GBP → content can be prepared, publish fails honestly, autopilot/monitoring skip it',
    eRes.outcome === 'failed' && monE.status === 'skipped' && selectable === 0, `publish ${eRes.outcome}${(eRes as any).reason ? ` (${String((eRes as any).reason).slice(0, 70)})` : ''} · monitoring ${monE.status} · autopilot-eligible ${selectable}`, 'REAL createLocalPost guard (no network) + in-memory DB');

  // ── AI failure / unsupported claim / weak services (cases 14, 18, 2, 17) ──
  const F = await mkBiz({ website: 'https://sahyadri-tiles.example' }); await seedPlan(F);
  await batch(F, { deps: { generate: async () => { throw new Error('Groq 503 (simulated)'); } } });
  const pF = await postsOf(F);
  check('14', 'AI failure → safe templates saved as DRAFT, nothing scheduled', pF.length === 4 && pF.every((p) => p.status === 'draft' && p.contentMeta.generatedVia === 'template' && /AI content was unavailable/.test(p.contentMeta.draftReason)), pF.map((p) => p.title).join(' | '), 'SIMULATED AI failure');

  const G = await mkBiz({ website: 'https://sahyadri-tiles.example' }); await seedPlan(G);
  let regenCalls = 0;
  await batch(G, { deps: {
    generate: async (req: any) => ({ posts: req.slotBriefs.map((_: string, i: number) => i === 0
      ? { title: 'Best tile contractor in Nashik', body: 'Rated 4.9 stars by 500+ happy customers. 15 years of experience. Get 20% off this week!', cta: 'Call' }
      : i === 1 ? { title: 'Pool tiling', body: 'Sahyadri Tile Works also offers swimming pool construction and roofing services in Nashik.', cta: 'Call' }
      : goodPost(`Tile work ${i}`)) }),
    regenerate: async (inp: any) => { regenCalls++; return /Pool/.test(inp.rejected.title) ? goodPost('Tile installation in Nashik') : { ...inp.rejected, hashtags: [], thumbnailPrompt: '' }; },
  } });
  const pG = await postsOf(G);
  check('18', 'unsupported claims → regenerated once; still failing → DRAFT with reasons', pG[0].status === 'draft' && pG[0].contentMeta.validation.attempts === 2 && /superlative|rating|percentage/.test(pG[0].contentMeta.draftReason), pG[0].contentMeta.draftReason.slice(0, 140), 'SIMULATED AI output');
  check('17', 'invented service → rejected; regenerated copy passes → scheduled', pG[1].status === 'scheduled' && pG[1].contentMeta.generatedVia === 'ai_regenerated' && regenCalls === 2, `slot 2 ${pG[1].status}/${pG[1].contentMeta.generatedVia}, regenerations ${regenCalls}`, 'SIMULATED AI output');

  const H = await mkBiz({ website: 'https://weak-site.example', services: '' }); await seedPlan(H); await seedWI('https://weak-site.example', { services: [] });
  await batch(H, { deps: { generate: fakeGen } });
  const pH = await postsOf(H);
  check('2', 'website with weak service info → no invented services in the plan', pH.every((p) => !p.contentMeta.service) && pH.filter((p) => p.contentMeta.purpose === 'education').length >= 1, pH.map((p) => p.contentMeta.purpose).join(', '), 'simulated AI + in-memory DB');

  // ── No website / website unavailable (cases 3, 16, 30) ──
  const I = await mkBiz({}); await seedPlan(I);
  const rI = await batch(I, { deps: { generate: fakeGen } });
  const pI = await postsOf(I);
  check('3/30', 'no website + connected GBP → posts from verified business facts only', pI.length === 4 && pI.every((p) => p.contentMeta.evidence.every((e: any) => e.state !== 'SOURCE_CLAIM')) && rI.contextNotes.some((n) => /No website/.test(n)), rI.contextNotes.join(' | '));
  const J = await mkBiz({ website: 'https://down-site.example' }); await seedPlan(J); await seedWI('https://down-site.example', { status: 'failed', services: ['Should not be used'] });
  const rJ = await batch(J, { deps: { generate: fakeGen } });
  const pJ = await postsOf(J);
  check('16', 'website unavailable → website facts not used, noted', rJ.contextNotes.some((n) => /could not be read/.test(n)) && pJ.every((p) => !JSON.stringify(p.contentMeta.evidence).includes('Should not be used')), rJ.contextNotes.join(' | '));

  // ── Photos / images / brand (cases 6, 15, 7, 8) ──
  const K = await mkBiz({ website: 'https://sahyadri-tiles.example' }); await seedPlan(K);
  await batch(K, { deps: { generate: fakeGen, generateImage: genImage } });
  const pK = await postsOf(K);
  check('6', 'no customer photos → generated image (not a fake photo of the business)', pK.every((p) => p.contentMeta.imageSource === 'generate' && p.contentMeta.imageOrigin === 'AI_GENERATED'), `${pK.map((p) => p.contentMeta.imageSource).join(', ')}${pK[0]?.contentMeta.imageNote ? ` · ${pK[0].contentMeta.imageNote}` : ''}`, 'SIMULATED image generation');
  const L = await mkBiz({ website: 'https://sahyadri-tiles.example' }); await seedPlan(L); await seedAssets(L, { photos: 5 });
  await batch(L, { deps: { generate: fakeGen, generateImage: async () => { throw new Error('image API 500 (simulated)'); } } });
  const pL = await postsOf(L);
  check('15', 'TEST G: AI image fails → approved branded fallback, failure recorded, NO customer photo substituted (5 Photos exist)', pL.every((p) => p.contentMeta.imageSource === 'branded_graphic' && p.contentMeta.imageOrigin === 'FALLBACK' && p.contentMeta.imageGeneration?.status === 'failed' && /image API 500/.test(p.contentMeta.imageGeneration?.error || '') && /^data:image\//.test(p.imageUrl) && !/cdn\.example\.invalid\/photo/.test(p.imageUrl)), `${pL.map((p) => p.contentMeta.imageSource).join(', ')}${pL[0]?.contentMeta.imageNote ? ` · ${pL[0].contentMeta.imageNote}` : ''}`, 'SIMULATED image failure');
  const M = await mkBiz({ website: 'https://sahyadri-tiles.example', manualColors: ['#aa0000'] }); await seedPlan(M); await seedAssets(M, { logo: true });
  await batch(M, { deps: { generate: fakeGen } });
  const bM: any = await Business.findById(M._id).lean();
  check('7', 'manual brand colours win and are never overwritten', bM.brandProfile.colorSource === 'manual' && bM.brandProfile.manualColors.join() === '#aa0000' && bM.brandProfile.colors.join() === '#aa0000', `${bM.brandProfile.colorSource} ${bM.brandProfile.colors}`);
  const N = await mkBiz({ website: 'https://green-site.example' }); await seedPlan(N); await seedWI('https://green-site.example', { cssColors: ['#0a7d4f', '#f2a900'] });
  await batch(N, { deps: { generate: fakeGen } });
  const bN: any = await Business.findById(N._id).lean();
  check('8', 'website-derived colours cached on the business with their source page', bN.brandProfile.colorSource === 'website' && bN.brandProfile.colors[0] === '#0a7d4f' && bN.brandProfile.sourceUrl === 'https://green-site.example/', `${bN.brandProfile.colorSource} ${bN.brandProfile.colors} from ${bN.brandProfile.sourceUrl}`);

  // ── Offers (cases 9, 10, 11, 32) and festivals (12, 13) ──
  const offerWeek = contentWeekKey(nowFor(firstDate));
  const O = await mkBiz({ website: 'https://sahyadri-tiles.example' }); await seedPlan(O);
  await WeeklyOffer.create({ businessId: O._id, weekKey: offerWeek, weekStart: new Date(), status: 'YES', text: 'Free site visit for bathroom renovation enquiries this week' });
  await batch(O, { deps: { generate: async (req: any) => ({ posts: req.slotBriefs.map((b: string, i: number) => (/owner's offer/.test(b) ? { title: 'This week', body: 'Free site visit for bathroom renovation enquiries this week. Call Sahyadri Tile Works.', cta: 'Call now' } : goodPost(`Tile work ${i}`))) }) } });
  const pO = await postsOf(O);
  const offerPost = pO.find((p) => p.contentMeta.purpose === 'offer');
  check('9', 'owner-confirmed offer → one offer post with the owner\'s words', !!offerPost && offerPost.status === 'scheduled' && /Free site visit/.test(offerPost.content) && !!offerPost.contentMeta.offerId, offerPost ? `${offerPost.status}: ${offerPost.content.slice(0, 80)}` : 'none', 'simulated AI + in-memory DB');
  check('10', 'no offer → no offer/discount language anywhere', pK.every((p) => p.contentMeta.purpose !== 'offer'), pK.map((p) => p.contentMeta.purpose).join(', '));
  const P = await mkBiz({ website: 'https://sahyadri-tiles.example' }); await seedPlan(P);
  await WeeklyOffer.create({ businessId: P._id, weekKey: offerWeek, weekStart: new Date(), status: 'DISMISSED' });
  await batch(P, { deps: { generate: fakeGen } });
  const nextWeekPrompt = await contentPrompts(String(P._id), new Date(nowFor(firstDate).getTime() + 7 * 86_400_000), 'Sahyadri Tile Works');
  const thisWeekPrompt = await contentPrompts(String(P._id), nowFor(firstDate), 'Sahyadri Tile Works');
  check('11', 'dismissed offer → no offer post; not asked again this week; asked again next week', (await postsOf(P)).every((p) => p.contentMeta.purpose !== 'offer') && thisWeekPrompt.offerAsked === false && nextWeekPrompt.offerAsked === true, `this week asked ${thisWeekPrompt.offerAsked}, next week asked ${nextWeekPrompt.offerAsked}`);

  const Q = await mkBiz({ website: 'https://sahyadri-tiles.example' }); await seedPlan(Q);
  await generateWeeklyBatch({ business: Q.toObject(), tenantId: String(Q.organizationId), firstDate: festivalFirst, daySpacing: 2, generatedVia: 'cron', batchKey: contentWeekKey(nowFor(festivalFirst)), now: nowFor(festivalFirst),
    deps: { generate: async (req: any) => ({ posts: req.slotBriefs.map((b: string, i: number) => (/greeting/.test(b) ? { title: 'Happy Diwali', body: 'Sahyadri Tile Works wishes everyone in Nashik a happy Diwali.', cta: 'Learn more' } : goodPost(`Tile work ${i}`))) }) } });
  const pQ = await postsOf(Q);
  check('12', 'festival week → one festival greeting from the stored calendar', pQ.filter((p) => p.contentMeta.purpose === 'festival').length === 1 && pQ.find((p) => p.contentMeta.purpose === 'festival')?.contentMeta.festivalKey === 'diwali-2026', pQ.map((p) => `${p.contentMeta.purpose}${p.contentMeta.festivalKey ? `(${p.contentMeta.festivalKey})` : ''}`).join(', '));
  check('13', 'non-festival week → no festival post', pK.every((p) => p.contentMeta.purpose !== 'festival'), 'week of 30 Sep 2026');

  const R = await mkBiz({ website: 'https://sahyadri-tiles.example' }); await seedPlan(R);
  await WeeklyOffer.create({ businessId: R._id, weekKey: contentWeekKey(nowFor(festivalFirst)), weekStart: new Date(), status: 'YES', text: 'Free site visit this week' });
  await generateWeeklyBatch({ business: R.toObject(), tenantId: String(R.organizationId), firstDate: festivalFirst, daySpacing: 2, generatedVia: 'cron', batchKey: contentWeekKey(nowFor(festivalFirst)), now: nowFor(festivalFirst), deps: { generate: async () => { throw new Error('AI down (simulated)'); } } });
  const pR = await postsOf(R);
  check('32', 'festival + owner offer same week → greeting slot 3, offer slot 4, still 4 posts', pR.length === 4 && pR[2].contentMeta.purpose === 'festival' && pR[3].contentMeta.purpose === 'offer' && pR[3].content === 'Free site visit this week', pR.map((p) => p.contentMeta.purpose).join(', '), 'simulated AI failure → templates');

  // Offer answered AFTER the batch → applied to slot 4 once.
  const S = await mkBiz({ website: 'https://sahyadri-tiles.example' }); await seedPlan(S);
  await batch(S, { deps: { generate: fakeGen } });
  await WeeklyOffer.create({ businessId: S._id, weekKey: offerWeek, weekStart: new Date(), status: 'YES', text: 'Free site visit this week' });
  const ap1 = await applyWeeklyOffer({ businessId: String(S._id), weekKey: offerWeek, now: nowFor(firstDate), deps: { generate: async () => ({ posts: [{ title: 'This week', body: 'Free site visit this week at Sahyadri Tile Works.', cta: 'Call now' }] }) } });
  const ap2 = await applyWeeklyOffer({ businessId: String(S._id), weekKey: offerWeek, now: nowFor(firstDate) });
  const s4doc: any = await Post.findOne({ businessId: S._id, 'contentMeta.slot': 4 }).lean();
  check('9b', 'offer given after the batch → slot 4 rewritten once (idempotent)', ap1.applied === 'updated' && ap2.applied === 'already' && s4doc.contentMeta.purpose === 'offer' && (await Post.countDocuments({ businessId: S._id })) === 4, `${ap1.applied} then ${ap2.applied}`);

  // ── Notifications (case 22) + weekly review monitoring (27) ──
  const pre = new Date('2026-10-28T06:00:00Z');
  const T = await mkBiz({ website: 'https://sahyadri-tiles.example', syncedAt: new Date(pre.getTime() - 86_400_000) }); // review sync ran this week
  const beforeWa = whatsapp.length;
  const n1 = await contentPrompts(String(T._id), pre, 'Sahyadri Tile Works');
  const n2 = await contentPrompts(String(T._id), pre, 'Sahyadri Tile Works');
  const festNotes = await Notification.countDocuments({ businessId: T._id, type: 'festival_prompt' });
  check('22', 'festival prompt sent once (in-app + WhatsApp captured once) on repeat runs', n1.festivals.includes('diwali-2026') && n2.festivals.length === 0 && festNotes === 1 && whatsapp.length - beforeWa === 1 && (await FestivalPrompt.countDocuments({ businessId: T._id })) === 1,
    `in-app ${festNotes}, WhatsApp captured ${whatsapp.length - beforeWa} (NOT delivered)`, 'in-memory DB; WhatsApp intercepted');
  const wm1 = await runWeeklyMonitoring(String(T._id), pre);
  const wm2 = await runWeeklyMonitoring(String(T._id), pre);
  const noRev = await Notification.countDocuments({ businessId: T._id, type: 'weekly_no_new_reviews' });
  check('27', 'weekly review monitoring once per week; "no new reviews" notified once', wm1.status === 'done' && wm2.status === 'already_ran' && noRev === 1, `run1 ${wm1.status}, run2 ${wm2.status}, notices ${noRev}`);

  // ── Monthly report from execution records (cases 25, 26, 28, 29) ──
  const ex = await collectExecutions(String(D._id), new Date('2026-09-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z'));
  const perf = (calls: number, m: string) => ({ status: 'verified', periodStart: `2026-${m}-01`, periodEnd: `2026-${m}-28`, calls, websiteClicks: 6, directionRequests: 3, profileViews: 120 });
  const common = { periodStart: '2026-10-01', periodEnd: '2026-10-31', previousAuditId: 'a', baselineAuditId: 'a', actions: [], executions: ex };
  const upReport = buildMonthlyReport({ ...common, prevData: { performanceBaseline: perf(5, '09') }, curData: { performanceBaseline: perf(11, '10') } });
  const naReport = buildMonthlyReport({ ...common, prevData: {}, curData: {} });
  const lines = contentActivityLines(upReport.contentActivity);
  fs.writeFileSync(path.join(OUT, 'monthly-content.json'), JSON.stringify({ contentActivity: upReport.contentActivity, lines, growwmaticsOptimized: upReport.growwmaticsOptimized }, null, 2));
  check('25', 'monthly: only the Google-confirmed post counts as published', upReport.contentActivity?.published === 1 && ex.posts.length === 1, lines[0] ?? 'none');
  check('26', 'monthly: failed and blocked posts reported as such', upReport.contentActivity?.failed === 2 && upReport.contentActivity?.blocked === 1 && lines.some((l) => /Google rejected: 2/.test(l)) && lines.some((l) => /Not sent to Google/.test(l)), lines.slice(1, 3).join(' | '));
  check('28', 'monthly: increased engagement shown as measured change, no revenue', upReport.improved.some((l) => /^Calls: 5 → 11/.test(l)) && !JSON.stringify(upReport).match(/revenue|₹/i), upReport.improved.join(' | '));
  check('29', 'monthly: performance unavailable → stated, nothing inferred', naReport.performance.status === 'unavailable' && naReport.improved.length === 0, naReport.performance.status);

  // ── EXIF / GPS through the whole pipeline (upload → processing → storage → post → Google fetch) ──
  {
    const { prepareGalleryMedia } = await import('../src/lib/mediaUpload');
    const { getVerifiedBusinessLocation } = await import('../src/lib/verifiedLocation');
    const { readImageGps, exifGpsTags } = await import('../src/lib/imageGeotag');
    const { createOrReplaceStagedAsset } = await import('../src/lib/gbpMediaService');
    const bucket = new Map<string, Buffer>(); // simulated object storage: url → exact stored bytes
    let n = 0;
    const storeObj = (buf: Buffer, mime: string) => { const url = `https://cdn.example.invalid/gallery/${++n}.${mime.split('/')[1]}`; bucket.set(url, buf); return url; };
    const CAMERA = { lat: 19.99751, lng: 73.78982 };
    const PIN = { lat: 20.00588, lng: 73.76323 };
    const near = (a: any, b: any) => !!a && Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4;
    const plain = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 140, g: 110, b: 90 } } }).jpeg({ quality: 88 }).toBuffer();
    const withGps = await sharp(plain).withExif({ IFD0: { Make: 'Phone' }, IFD3: exifGpsTags(CAMERA) }).jpeg({ quality: 88 }).toBuffer();

    // Verified location: from the connected profile (simulated Google response), cached on the business.
    const V = await mkBiz({ website: 'https://sahyadri-tiles.example' }); await seedPlan(V);
    await Business.updateOne({ _id: V._id }, { $set: { coordinates: { lat: 1.23, lng: 4.56 } } }); // browser-supplied: must be ignored
    let pinCalls = 0;
    const deps = { fetchPin: async () => { pinCalls++; return { placeId: 'ChIJ-sim' }; }, fetchPlace: async () => PIN };
    const loc = await getVerifiedBusinessLocation(String(V._id), { deps });
    const loc2 = await getVerifiedBusinessLocation(String(V._id), { deps });
    check('geo-loc', 'verified location comes from Google (profile → Places fallback), cached; browser-supplied coordinates ignored', near(loc, PIN) && loc?.source === 'google_places' && pinCalls === 1 && near(loc2, PIN),
      `${loc?.source} ${loc?.lat},${loc?.lng} · Google lookups ${pinCalls}`, 'SIMULATED Google responses');
    const U = await mkBiz({ connected: false });
    await Business.updateOne({ _id: U._id }, { $set: { coordinates: { lat: 20.1, lng: 73.9 } } });
    check('geo-loc2', 'no Google confirmation → no verified location (coordinates field alone is never trusted)', (await getVerifiedBusinessLocation(String(U._id))) === null, 'null');

    // A: photo WITH GPS → upload → storage → post → what Google fetches.
    const a = await prepareGalleryMedia({ buffer: withGps, mime: 'image/jpeg', category: 'ADDITIONAL', location: loc });
    const assetA: any = await createOrReplaceStagedAsset({ businessId: String(V._id), category: 'ADDITIONAL', url: storeObj(a.buffer, a.mime), geotag: a.geotag });
    await GbpMediaAsset.updateOne({ _id: assetA._id }, { $set: { status: 'published' } });
    // The owner explicitly chose this photo for this week's offer post.
    await WeeklyOffer.create({ businessId: V._id, weekKey: contentWeekKey(nowFor(firstDate)), weekStart: new Date(), status: 'YES', text: 'Free site visit this week', imageId: String(assetA._id) });
    await batch(V, { deps: { generate: async (req: any) => ({ posts: req.slotBriefs.map((b: string, i: number) => (/owner's offer/.test(b) ? { title: 'This week', body: 'Free site visit this week at Sahyadri Tile Works.', cta: 'Call now' } : goodPost(`Tile work ${i}`))) }), generateImage: genImage } });
    const vPosts = await postsOf(V);
    const photoPost = vPosts.find((p) => p.contentMeta.imageAssetId === String(assetA._id));
    check('geo-A0', 'owner-selected photo is used only for the post the owner chose it for; other posts get new AI images', photoPost?.contentMeta.imageOrigin === 'OWNER_SELECTED' && photoPost?.contentMeta.purpose === 'offer' && vPosts.filter((p) => p !== photoPost).every((p) => p.contentMeta.imageOrigin === 'AI_GENERATED'), vPosts.map((p) => `${p.contentMeta.purpose}:${p.contentMeta.imageOrigin}`).join(', '));
    let googleFetched = '';
    if (photoPost) await publishPost(String(photoPost._id), { deps: { writesEnabled: () => true, createLocalPost: async (_b, input) => { googleFetched = input.mediaUrl || ''; return { liveWriteApplied: true, postName: 'sim/localPosts/1' }; } } });
    const fetchedBytes = bucket.get(googleFetched);
    check('geo-A', 'gallery photo WITH GPS (owner-selected): original GPS survives upload → processing → storage → post → publish request',
      a.geotag.status === 'original_gps_preserved' && a.buffer.equals(withGps) && !!fetchedBytes && fetchedBytes.equals(withGps) && near(await readImageGps(fetchedBytes!), CAMERA) && photoPost?.imageGeotag?.status === 'original_gps_preserved',
      `stored bytes identical ${a.buffer.equals(withGps)} · Google would fetch ${googleFetched || 'nothing'} · GPS ${JSON.stringify(fetchedBytes ? await readImageGps(fetchedBytes) : null)}`, 'in-memory DB; Google publish SIMULATED');
    const cover = await prepareGalleryMedia({ buffer: withGps, mime: 'image/jpeg', category: 'COVER', location: loc });
    const coverMeta = await sharp(cover.buffer).metadata();
    check('geo-A2', 'cover crop (server-side) keeps the photo GPS', cover.cropped && coverMeta.width === 1024 && near(await readImageGps(cover.buffer), CAMERA) && cover.geotag.status === 'original_gps_preserved', `${coverMeta.width}x${coverMeta.height} ${cover.geotag.status}`);

    // B: photo WITHOUT GPS → verified pin added (recorded); without a verified location → nothing added.
    const b = await prepareGalleryMedia({ buffer: plain, mime: 'image/jpeg', category: 'ADDITIONAL', location: loc });
    const urlB = storeObj(b.buffer, b.mime);
    const assetB: any = await createOrReplaceStagedAsset({ businessId: String(V._id), category: 'ADDITIONAL', url: urlB, geotag: b.geotag });
    const recB: any = await GbpMediaAsset.findById(assetB._id).lean();
    const pxSame = (await sharp(plain).raw().toBuffer()).equals(await sharp(bucket.get(urlB)!).raw().toBuffer());
    check('geo-B', 'gallery photo WITHOUT GPS + verified location → exactly that location added and recorded; pixels unchanged',
      recB.geotag?.status === 'business_location_added' && recB.geotag?.source === 'google_places' && near(await readImageGps(bucket.get(urlB)!), PIN) && pxSame, `${recB.geotag?.status} ${recB.geotag?.lat},${recB.geotag?.lng} · pixels identical ${pxSame}`);
    const b2 = await prepareGalleryMedia({ buffer: plain, mime: 'image/jpeg', category: 'ADDITIONAL', location: null });
    check('geo-B2', 'gallery photo WITHOUT GPS and no verified location → still valid, no coordinates added', b2.geotag.status === 'none' && b2.buffer.equals(plain) && (await readImageGps(b2.buffer)) === null && (await sharp(b2.buffer).metadata()).width === 800, b2.geotag.reason ?? '');
    const vid = Buffer.from('....ftypmp42....moov....mdat....');
    const v = await prepareGalleryMedia({ buffer: vid, mime: 'video/mp4', category: 'ADDITIONAL', location: loc });
    // Same policy as photos (Oct 2026): the verified business location is RECORDED on the video's
    // media item; the video file itself is never modified; without a verified location nothing is recorded.
    const v2 = await prepareGalleryMedia({ buffer: vid, mime: 'video/mp4', category: 'ADDITIONAL', location: null });
    check('geo-video', 'video stored byte-for-byte; verified location recorded on the item (same rule as photos); nothing invented without one',
      v.geotag.status === 'video_location_recorded' && v.buffer.equals(vid) && near({ lat: v.geotag.lat!, lng: v.geotag.lng! }, PIN) && v.geotag.source === 'google_places' &&
      v2.geotag.status === 'video_unmodified' && v2.geotag.lat === undefined && v2.buffer.equals(vid), v.geotag.reason ?? '');

    // C: generated image in a weekly post → verified location written, recorded on the post.
    const W = await mkBiz({ website: 'https://sahyadri-tiles.example' }); await seedPlan(W);
    await Business.updateOne({ _id: W._id }, { $set: { verifiedLocation: { lat: PIN.lat, lng: PIN.lng, source: 'gbp_location', verifiedAt: new Date() } } });
    await batch(W, { deps: { generate: fakeGen, generateImage: genImage } });
    const wPost = (await postsOf(W))[0];
    const genBytes = Buffer.from(String(wPost.imageUrl).split(',')[1] || '', 'base64');
    check('geo-C', 'generated post image carries the verified Google location (recorded on the post)', wPost.contentMeta.imageSource === 'generate' && wPost.imageGeotag?.status === 'business_location_added' && near(await readImageGps(genBytes), PIN),
      `${wPost.imageGeotag?.status} ${JSON.stringify(await readImageGps(genBytes))}`, 'SIMULATED image generation');
  }

  // ── Weekly autopilot images: tests A–H ──
  {
    const { readImageGps } = await import('../src/lib/imageGeotag');
    const PIN = { lat: 20.00588, lng: 73.76323 };
    const near = (a: any, b: any) => !!a && Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4;
    const decode = (u: string) => Buffer.from(String(u).split(',')[1] || '', 'base64');
    const prompts: string[] = [];
    let n = 0;
    const capture = async (prompt: string) => {
      prompts.push(prompt);
      n++;
      return `data:image/png;base64,${(await sharp({ create: { width: 1200, height: 1200, channels: 3, background: { r: (n * 61) % 256, g: (n * 97) % 256, b: (n * 13) % 256 } } }).png().toBuffer()).toString('base64')}`;
    };
    const IA = await mkBiz({ website: 'https://sahyadri-tiles.example' });
    await seedPlan(IA); await seedAssets(IA, { logo: true, photos: 10 });
    await Business.updateOne({ _id: IA._id }, { $set: { verifiedLocation: { lat: PIN.lat, lng: PIN.lng, source: 'gbp_location', verifiedAt: new Date() } } });
    await batch(IA, { deps: { generate: fakeGen, generateImage: capture } });
    const pI = await postsOf(IA);
    const photoUrls = (await GbpMediaAsset.find({ businessId: IA._id, category: 'ADDITIONAL' }).select('url').lean() as any[]).map((x) => x.url);
    const hashes = new Set(pI.map((p) => p.contentMeta.imageGeneration?.hash));
    check('IMG-A', 'TEST A: 10 Photos exist → 4 posts, 4 NEW AI images, no Photo auto-selected, 4 distinct images',
      pI.length === 4 && pI.every((p) => p.contentMeta.imageOrigin === 'AI_GENERATED' && !photoUrls.includes(p.imageUrl)) && hashes.size === 4 && prompts.length === 4,
      `${pI.map((p) => p.contentMeta.imageOrigin).join(', ')} · distinct ${hashes.size} · generator calls ${prompts.length}`, 'SIMULATED image generator');
    const ok = pI.every((p, i) => {
      const pr = prompts[i] || '';
      return pr.includes(p.title) && (!p.contentMeta.keyword || pr.includes(p.contentMeta.keyword)) && (!p.contentMeta.service || pr.includes(p.contentMeta.service)) && (!p.contentMeta.seoTheme || pr.includes(p.contentMeta.seoTheme)) && pr.includes('Gangapur Road, Nashik');
    });
    check('IMG-B', 'TEST B: each image request carries that post\'s own theme / keyword / service / area / headline', ok && new Set(prompts.map((x) => x.slice(0, 160))).size === 4,
      pI.map((p) => `${p.contentMeta.slot}:${p.contentMeta.keyword || p.contentMeta.service || p.contentMeta.purpose}`).join(' | '));
    const bp: any = (await Business.findById(IA._id).lean() as any).brandProfile;
    const img0 = decode(pI[0].imageUrl);
    const meta0 = await sharp(img0).metadata();
    const corner = await sharp(img0).extract({ left: Math.round(meta0.width! * 0.8), top: Math.round(meta0.height! * 0.8), width: Math.round(meta0.width! * 0.15), height: Math.round(meta0.height! * 0.15) }).stats();
    check('IMG-C', 'TEST C: customer colours in every prompt, customer logo in the corner, brand recorded (no GrowwMatics mark)',
      prompts.every((x) => bp.colors.every((c: string) => x.includes(c))) && pI.every((p) => p.contentMeta.brandUsed?.logo === true && p.contentMeta.brandUsed?.colorSource === 'logo') && corner.channels[0].max > 180,
      `colours ${bp.colors.join(' ')} (${bp.colorSource}) · corner red max ${corner.channels[0].max}`);
    check('IMG-H', 'TEST H: generated images pass the geotag step → confirmed Google location in EXIF, recorded on the post',
      (await Promise.all(pI.map(async (p) => near(await readImageGps(decode(p.imageUrl)), PIN)))).every(Boolean) && pI.every((p) => p.imageGeotag?.status === 'business_location_added'),
      `GPS ${JSON.stringify(await readImageGps(img0))}`);
    const noOfferPrompts = prompts.join(' ');
    check('IMG-F', 'TEST F: no offer → no offer post and no promotional/discount image requested', pI.every((p) => p.contentMeta.purpose !== 'offer') && !/promotional visual/.test(noOfferPrompts), pI.map((p) => p.contentMeta.purpose).join(', '));

    // D: owner offer → exact text in the post, NEW AI image, exact text drawn on it.
    prompts.length = 0;
    const ID = await mkBiz({ website: 'https://sahyadri-tiles.example' }); await seedPlan(ID); await seedAssets(ID, { logo: true, photos: 10 });
    const OFFER = 'Free site visit for bathroom renovation enquiries this week';
    await WeeklyOffer.create({ businessId: ID._id, weekKey: contentWeekKey(nowFor(firstDate)), weekStart: new Date(), status: 'YES', text: OFFER });
    await batch(ID, { deps: { generate: async (req: any) => ({ posts: req.slotBriefs.map((b: string, i: number) => (/owner's offer/.test(b) ? { title: 'This week', body: `${OFFER}. Call Sahyadri Tile Works.`, cta: 'Call now' } : goodPost(`Tile work ${i}`))) }), generateImage: capture } });
    const offerPost = (await postsOf(ID)).find((p) => p.contentMeta.purpose === 'offer');
    const offerPrompt = prompts.find((x) => /promotional visual/.test(x)) || '';
    const ob = offerPost ? decode(offerPost.imageUrl) : Buffer.alloc(0);
    const om = ob.length ? await sharp(ob).metadata() : null;
    const band = om ? await sharp(ob).extract({ left: 0, top: 0, width: om.width!, height: Math.round(om.height! * 0.05) }).stats() : null;
    const brandBg = ((await Business.findById(ID._id).lean() as any).brandProfile.colors[0] as string);
    const bgR = parseInt(brandBg.slice(1, 3), 16);
    check('IMG-D', 'TEST D: offer post uses the stored owner offer word-for-word, gets a NEW AI image, offer text band drawn in brand colour',
      !!offerPost && offerPost.content.includes(OFFER) && offerPost.contentMeta.imageOrigin === 'AI_GENERATED' && offerPrompt.includes(OFFER) && /Do NOT include any text/.test(offerPrompt) && !!band && Math.abs(band.channels[0].mean - bgR) < 60,
      offerPost ? `origin ${offerPost.contentMeta.imageOrigin} · band mean R ${band?.channels[0].mean.toFixed(0)} vs brand ${bgR}` : 'no offer post');

    // E: festival week → festival-specific NEW image.
    prompts.length = 0;
    const IE = await mkBiz({ website: 'https://sahyadri-tiles.example' }); await seedPlan(IE); await seedAssets(IE, { photos: 10 });
    await generateWeeklyBatch({ business: IE.toObject(), tenantId: String(IE.organizationId), firstDate: festivalFirst, daySpacing: 2, generatedVia: 'cron', batchKey: contentWeekKey(nowFor(festivalFirst)), now: nowFor(festivalFirst),
      deps: { generate: async (req: any) => ({ posts: req.slotBriefs.map((b: string, i: number) => (/greeting/.test(b) ? { title: 'Happy Diwali', body: 'Sahyadri Tile Works wishes everyone in Nashik a happy Diwali.', cta: 'Learn more' } : goodPost(`Tile work ${i}`))) }), generateImage: capture } });
    const fest = (await postsOf(IE)).find((p) => p.contentMeta.purpose === 'festival');
    check('IMG-E', 'TEST E: festival week → festival post gets a NEW festival-specific AI image (calendar date, no invented offer)',
      !!fest && fest.contentMeta.imageOrigin === 'AI_GENERATED' && prompts.some((x) => /Diwali greeting design/.test(x)) && !prompts.some((x) => /promotional visual/.test(x)),
      fest ? `${fest.contentMeta.festivalKey} · ${fest.contentMeta.imageOrigin}` : 'no festival post');

    // Uniqueness: a generator that returns the same picture every time.
    const same = `data:image/png;base64,${(await sharp({ create: { width: 800, height: 800, channels: 3, background: { r: 9, g: 9, b: 9 } } }).png().toBuffer()).toString('base64')}`;
    const IU = await mkBiz({ website: 'https://sahyadri-tiles.example' }); await seedPlan(IU);
    await batch(IU, { deps: { generate: fakeGen, generateImage: async () => same } });
    const pU = await postsOf(IU);
    const aiU = pU.filter((p) => p.contentMeta.imageOrigin === 'AI_GENERATED');
    check('IMG-U', 'same image returned for different posts → used once, the rest flagged "duplicate" and given the fallback (never presented as new)',
      aiU.length === 1 && pU.filter((p) => p.contentMeta.imageGeneration?.status === 'duplicate' && p.contentMeta.imageOrigin === 'FALLBACK').length === 3 && pU.filter((p) => p.contentMeta.imageGeneration?.status === 'duplicate').every((p) => p.contentMeta.imageGeneration.attempts === 2),
      pU.map((p) => `${p.contentMeta.imageOrigin}/${p.contentMeta.imageGeneration?.status}`).join(', '));
  }

  check('safety', 'storage + WhatsApp interceptors engaged (nothing uploaded, nothing delivered)', intercepted.has('storage') && intercepted.has('whatsapp') && !Object.keys(process.env).some((k) => k.startsWith('DO_SPACES_')), `intercepted: ${Array.from(intercepted).join(', ')}`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, whatsappCaptured: whatsapp.length }, null, 2));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILED: ${failed.map((f) => f.n).join(', ')}` : ''}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
