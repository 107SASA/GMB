/**
 * LIVE end-to-end check of the report section against real providers.
 *
 *   npx tsx scripts/report-live-check.ts "<business search text>" [outDir] [--fresh]
 *
 * What it does (real Google Places / DataForSEO / SerpApi / Groq calls —
 * roughly ₹60–80 of provider usage per run):
 *   1. Finds the business via Google Places (autocomplete → details) and
 *      saves the raw source data.
 *   2. Runs a real FREE report (fastMode) and a real DASHBOARD audit (review
 *      pre-sync via SerpApi, like the Inngest step) through processAuditJob.
 *   3. Renders exactly what a customer sees — FreeReportView, the dashboard
 *      AuditReportGrexa, the PDF (HTML + real PDF via Chrome) and the
 *      WhatsApp report/sales messages — WITHOUT sending anything.
 *   4. Compares report values to the source data and scans every rendered
 *      output for phrases that must never appear.
 *
 * SAFETY: loads .env, then FORCES the MongoDB database name to TEST_DB_NAME
 * (default growwmatics_local_test) and refuses any name containing "prod".
 * WhatsApp sends are suppressed; no Inngest events are dispatched; nothing
 * is written to Google. `--fresh` clears this listing's PlaceInsightCache
 * entry in the TEST database so providers are really called.
 */
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FRESH = process.argv.includes('--fresh');
/** Real providers, but a throwaway in-memory MongoDB (for machines not on
 *  the Atlas IP allowlist). Needs `npm i --no-save mongodb-memory-server`. */
const MEMORY_DB = process.argv.includes('--memory-db');
const QUERY = args[0] || 'Mulsetu';
const OUT = path.resolve(args[1] || 'tmp-report-check');
fs.mkdirSync(OUT, { recursive: true });

// ── Environment (test DB only) ─────────────────────────────────────────────
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
const testDb = process.env.TEST_DB_NAME || 'growwmatics_local_test';
if (/prod/i.test(testDb)) throw new Error(`Refusing: test DB name "${testDb}" looks like production`);
const uriMatch = (process.env.MONGODB_URI || '').match(/^(mongodb(?:\+srv)?:\/\/[^/]+)(\/[^?]*)?(\?.*)?$/i);
if (!uriMatch) throw new Error('MONGODB_URI missing or unparseable');
process.env.MONGODB_URI = `${uriMatch[1]}/${testDb}${uriMatch[3] || ''}`;
process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
// Test harness: never reach production object storage (see memory: harness-side-effects).
for (const k of Object.keys(process.env)) if (k.startsWith('DO_SPACES_')) delete process.env[k];
process.env.GBP_LIVE_WRITES_ENABLED = 'false';
// Failure simulations (§36): the provider is really called with a bad
// credential, so the audit experiences a genuine provider failure.
const SIM_RANKING_FAILURE = process.argv.includes('--simulate-ranking-failure');
const SIM_AI_FAILURE = process.argv.includes('--simulate-ai-failure');
/** Free report only (skip the dashboard audit + review sync) — cheaper failure sims. */
const FREE_ONLY = process.argv.includes('--free-only');
/** Dashboard / connected audit only (skip the free report). */
const DASHBOARD_ONLY = process.argv.includes('--dashboard-only');
/** Run the free report a second time on warm caches (cache-hit path + cost). */
const REPEAT_FREE = process.argv.includes('--repeat-free');
/**
 * Connected-baseline CODE PATH with SIMULATED Google Business Profile
 * responses (no real OAuth is available here). Exercises: connected_baseline
 * kind, live-GBP field states, the performance baseline and the free →
 * connected comparison. Every GBP value it produces is labelled SIMULATED.
 */
const CONNECTED_STUB = process.argv.includes('--connected-stub');
const SIM_SERPAPI_FAILURE = process.argv.includes('--simulate-serpapi-failure');
if (SIM_SERPAPI_FAILURE) process.env.SERPAPI_KEY = 'invalid-simulated-failure';
if (SIM_RANKING_FAILURE) process.env.DATAFORSEO_PASSWORD = 'invalid-simulated-failure';
if (SIM_AI_FAILURE) process.env.GROQ_API_KEY = 'gsk_invalid_simulated_failure';
if (SIM_RANKING_FAILURE || SIM_AI_FAILURE) console.log(`[live-check] SIMULATING: ${[SIM_RANKING_FAILURE && 'ranking-provider failure', SIM_AI_FAILURE && 'AI failure'].filter(Boolean).join(' + ')}`);
console.log(`[live-check] database: ${testDb} (credentials not shown) · output: ${OUT}`);

const REQUIRED = ['MONGODB_URI', 'GOOGLE_MAPS_API_KEY', 'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD', 'GROQ_API_KEY', 'SERPAPI_KEY'];
const missingEnv = REQUIRED.filter((k) => !process.env[k]);
if (missingEnv.length) {
  console.error(`[live-check] BLOCKED — missing env: ${missingEnv.join(', ')}`);
  process.exit(2);
}

/** Phrases that must never reach a customer (checked case-insensitively). */
const FORBIDDEN = [
  '20+', 'losing customers', '4.2/week', '0 Policy Violation', '10–18', '10-18', 'Top 3 in 90 days',
  'wheelchair accessible', 'Business Consulting', 'Home Services', 'Facility Management',
  'reviews 0%', 'rank 0', 'Review Score: *0%*', 'Industry avg', 'Based on 25+ parameters',
  'Good businesses score more than 90%', 'Should add up to 20 services', 'Should have 5+ categories',
  'Title is not carrying the keywords', 'Services list is thinner', 'PROJECTED RANK IMPROVEMENT TIMELINE',
  'isn\'t ranking', 'getting your customers', 'page 3 of Google', 'visibility is low', 'look closed',
  // Unverified claims about GBP content (the GBP is not read in these runs).
  'your GBP is missing', 'Google Business Profile is missing', 'your profile lacks', 'your listing lacks', 'Not Reflected on GBP', 'not reflected on your',
];

/** Free Report sections that must always render (with data or a status message). */
const REQUIRED_SECTIONS = [
  'PERFORMANCE SNAPSHOT', 'Key Finding', 'KEYWORD SEARCH VOLUME ANALYSIS', 'COMPETITOR LANDSCAPE',
  'GBP PROFILE GAP ANALYSIS', 'MARKET OPPORTUNITY GAPS', 'PRIORITY ACTION PLAN', "THIS WEEK'S GOOGLE POSTS",
  'SUGGESTED GOOGLE Q&AS', 'PROJECTED IMPROVEMENT TIMELINE', 'DATA REQUIRED TO COMPLETE THIS AUDIT',
];

const stripHtml = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;|&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();

function scan(name: string, text: string, found: Array<{ surface: string; phrase: string; context: string }>) {
  const lower = text.toLowerCase();
  for (const phrase of FORBIDDEN) {
    let i = lower.indexOf(phrase.toLowerCase());
    while (i !== -1) {
      found.push({ surface: name, phrase, context: text.slice(Math.max(0, i - 60), i + phrase.length + 60) });
      i = lower.indexOf(phrase.toLowerCase(), i + 1);
    }
  }
}

/** Stopped (and its temp dbPath deleted) before exit — each run leaves ~300 MB otherwise. */
let memServer: any = null;
async function cleanup() {
  if (memServer) await memServer.stop({ doCleanup: true, force: true }).catch(() => {});
}

async function main() {
  if (MEMORY_DB) {
    const { MongoMemoryServer } = await import('mongodb-memory-server' as string);
    const mem = await MongoMemoryServer.create({ instance: { launchTimeout: 90_000 } });
    memServer = mem;
    process.env.MONGODB_URI = mem.getUri('growwmatics_live_check');
    console.log('[live-check] storage: in-memory MongoDB (all provider calls are live)');
  }
  const { GooglePlacesService } = await import('../src/services/google/places');
  const dbConnect = (await import('../src/lib/mongodb')).default;
  const Audit = (await import('../src/models/Audit')).default;
  const Business = (await import('../src/models/Business')).default;
  const PlaceInsightCache = (await import('../src/models/PlaceInsightCache')).default;
  const { processAuditJob } = await import('../src/services/audit/auditService');
  const { syncReviewsForBusiness } = await import('../src/services/reviews/syncReviews');

  // ── 1. Source data from Google ───────────────────────────────────────────
  const candidates = await GooglePlacesService.autocomplete(QUERY);
  console.log(`[live-check] Places candidates for "${QUERY}":`, candidates.map((c) => c.description));
  if (!candidates.length) throw new Error('No Places result — cannot run a live audit for this business');
  const pick = candidates.find((c) => c.description.toLowerCase().includes(QUERY.toLowerCase().split(' ')[0])) || candidates[0];
  const details = await GooglePlacesService.getDetails(pick.placeId);
  if (!details) throw new Error('Place details unavailable');
  fs.writeFileSync(path.join(OUT, 'source-places.json'), JSON.stringify(details, null, 2));
  console.log(`[live-check] Using: ${details.name} (${details.formattedAddress}) · Places rating ${details.rating} from ${details.totalReviews} reviews · phone ${details.phoneNumber ? 'yes' : 'NO'} · website ${details.website ? 'yes' : 'NO'} · hours ${details.hasHours} · photos ${details.photoCount}`);

  await dbConnect();
  if (FRESH) await PlaceInsightCache.deleteOne({ googlePlaceId: details.placeId });

  // Same fields /api/free-report/start stores via provisionShadowAccount —
  // created directly because that helper sets a session cookie (needs a
  // Next request scope).
  const User = (await import('../src/models/User')).default;
  const Organization = (await import('../src/models/Organization')).default;
  const user: any = await User.findOneAndUpdate(
    { phone: '+919999900001' },
    { $setOnInsert: { fullName: 'Live Check', email: 'live-check@example.invalid', phone: '+919999900001', role: 'CLIENT', isShadowAccount: true } },
    { upsert: true, new: true },
  );
  const organization: any = await Organization.findOneAndUpdate(
    { ownerId: user._id },
    { $setOnInsert: { name: 'Live Check Org', ownerId: user._id, subscriptionPlan: 'Free' } },
    { upsert: true, new: true },
  );
  const businessFields = {
    name: details.name,
    category: details.primaryCategory || 'Local Business',
    description: details.editorialSummary || undefined,
    address: details.formattedAddress || 'Unknown',
    area: details.area,
    city: details.city || 'Unknown',
    state: details.state,
    country: details.country,
    phone: details.phoneNumber || undefined,
    website: details.website || undefined,
    placeId: details.placeId,
    googlePlaceId: details.placeId,
    googleMapsUrl: details.googleMapsUrl,
    coordinates: details.latitude != null && details.longitude != null ? { lat: details.latitude, lng: details.longitude } : undefined,
    googleConnected: true,
    placesRating: details.rating,
    placesReviewCount: details.totalReviews,
    photoCount: details.photoCount,
    hasHours: details.hasHours,
    googleTypes: details.categories,
    organizationId: organization._id,
    userId: user._id,
    provisionedVia: 'report-live-check',
  };
  const business: any = await Business.findOneAndUpdate(
    { organizationId: organization._id, googlePlaceId: details.placeId },
    { $set: businessFields },
    { upsert: true, new: true },
  );

  const runAudit = async (fastMode: boolean, trigger = 'report-live-check') => {
    const audit = await Audit.create({
      tenantId: organization._id.toString(), userId: user._id.toString(), organizationId: organization._id.toString(),
      businessId: business._id, businessName: business.name, userDefinedCategory: business.userDefinedCategory || business.category,
      website: business.website, phone: business.phone, address: business.address, city: business.city, state: business.state,
      country: business.country, location: [business.city, business.state].filter(Boolean).join(', ') || business.address,
      status: 'PENDING', fastMode, metadata: { trigger },
    });
    const t0 = Date.now();
    await processAuditJob(audit._id.toString()).catch((e: any) => console.error(`[live-check] processAuditJob threw: ${e?.message}`));
    const done: any = await Audit.findById(audit._id).lean();
    console.log(`[live-check] ${fastMode ? 'FREE' : 'DASHBOARD'} audit ${audit._id}: ${done?.status} in ${Math.round((Date.now() - t0) / 1000)}s`);
    return done;
  };

  // ── 2. Free report ───────────────────────────────────────────────────────
  if (CONNECTED_STUB) {
    // Intercept the GBP client (auditService requires it lazily) with
    // SIMULATED responses built from the real Places listing.
    const Module = (await import('module')).default as any;
    const origLoad = Module._load;
    Module._load = function (request: string, ...rest: any[]) {
      if (/lib[\\/]gbpClient$/.test(request)) {
        return {
          fetchLocationProfile: async () => ({
            locationName: 'locations/SIMULATED',
            title: details.name,
            description: '',
            primaryPhone: details.phoneNumber || '',
            website: details.website || '',
            primaryCategory: details.primaryCategory || '',
            additionalCategories: [],
            address: details.formattedAddress || '',
          }),
          fetchDailyMetrics: async (_id: string, start: Date) =>
            Array.from({ length: 28 }, (_, i) => ({
              date: new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10),
              views: 40, viewsMaps: 25, viewsSearch: 15, callClicks: i % 3 === 0 ? 1 : 0, websiteClicks: i % 2, directionRequests: i % 5 === 0 ? 1 : 0, conversations: 0,
            })),
        };
      }
      return origLoad.call(this, request, ...rest);
    };
    console.log('[live-check] CONNECTED STUB: GBP profile + performance responses are SIMULATED (no real OAuth).');
  }
  const free = DASHBOARD_ONLY ? null : await runAudit(true);
  let freeRepeat: any = null;
  if (REPEAT_FREE && free) {
    freeRepeat = await runAudit(true);
    const u = freeRepeat?.auditData?.providerUsage;
    console.log(`[live-check] REPEAT FREE (warm caches): ${freeRepeat?.status} · paid calls ${u?.billableCalls} · $${u?.listPriceUsd} · ${JSON.stringify(u?.counts)}`);
    fs.writeFileSync(path.join(OUT, 'free-repeat-auditData.json'), JSON.stringify(freeRepeat?.auditData ?? null, null, 2));
  }
  if (CONNECTED_STUB) await Business.updateOne({ _id: business._id }, { $set: { googleLocationId: 'locations/SIMULATED' } });

  // ── 3. Dashboard audit (Inngest pre-sync step emulated) ─────────────────
  let dash: any = null;
  if (!FREE_ONLY) {
    try {
      const sync = await syncReviewsForBusiness(business._id.toString(), organization._id.toString());
      console.log(`[live-check] review sync: ${sync.synced} reviews fetched`);
    } catch (e: any) {
      console.warn(`[live-check] review sync failed (dashboard audit continues without it): ${e?.message}`);
    }
    dash = await runAudit(false, CONNECTED_STUB ? 'audit-autopilot-first-run' : 'report-live-check');
  }
  const bizAfter: any = await Business.findById(business._id).lean();

  // ── 4. Render every customer surface ─────────────────────────────────────
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const FreeReportView = (await import('../src/components/audit/FreeReportView')).default;
  const AuditReportGrexa = (await import('../src/components/audit/AuditReportGrexa')).default;
  const { buildReportHtml } = await import('../src/lib/pdf/reportHtml');
  const { extractReportScores, composeSummaryMessage } = await import('../src/services/report/reportAgent');
  const { defaultReportAgentConfig, DEFAULT_REPORT_SUMMARY } = await import('../src/lib/reportAgentDefaults');
  const { extractScores, composeFirstMessage, composeFollowUp } = await import('../src/services/sales/salesAgent');
  const { defaultSalesAgentConfig } = await import('../src/lib/salesAgentDefaults');
  const { launchBrowser } = await import('../src/lib/pdf/browser');
  // Client components (paywall sidebar) call useRouter — give them an inert
  // app router so the markup renders outside a running Next server.
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime' as string);
  const noop = () => {};
  const inertRouter = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop, hmrRefresh: noop };
  const render = (el: any) => renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: inertRouter }, el));

  const cssDir = path.resolve('.next/static/chunks');
  const css = fs.existsSync(cssDir)
    ? fs.readdirSync(cssDir).filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(path.join(cssDir, f), 'utf8')).join('\n')
    : '';
  const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;

  const found: Array<{ surface: string; phrase: string; context: string }> = [];
  const surfaces: Record<string, string> = {};
  const browser = await launchBrowser();

  for (const [label, audit] of ([['free', free], ['dashboard', dash]] as const).filter(([, a]) => a)) {
    if (!audit || audit.status !== 'COMPLETED') {
      surfaces[`${label}-status`] = `${audit?.status}: ${JSON.stringify(audit?.metadata?.validationErrors || audit?.metadata?.error || '')}`;
      continue;
    }
    fs.writeFileSync(path.join(OUT, `${label}-auditData.json`), JSON.stringify(audit.auditData, null, 2));
    const view = { ...audit, _id: String(audit._id) };

    const freeHtml = render(React.createElement(FreeReportView, { audit: view }));
    const grexaHtml = render(React.createElement(AuditReportGrexa, { audit: view, onDownload: () => {} }));
    const pdfHtml = buildReportHtml({ audit: view as any, businessRating: bizAfter?.rating, coordinates: bizAfter?.coordinates, mapsApiKey: process.env.GOOGLE_MAPS_API_KEY });
    fs.writeFileSync(path.join(OUT, `${label}-free-report.html`), page(freeHtml));
    fs.writeFileSync(path.join(OUT, `${label}-dashboard-report.html`), page(grexaHtml));
    fs.writeFileSync(path.join(OUT, `${label}-pdf.html`), pdfHtml);

    const tab = await browser.newPage();
    await tab.setViewport({ width: 1280, height: 900 });
    for (const [kind, html] of [['free-report', page(freeHtml)], ['dashboard-report', page(grexaHtml)], ['pdf', pdfHtml]] as const) {
      await tab.setContent(html, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500)); // let map images finish
      await tab.screenshot({ path: path.join(OUT, `${label}-${kind}.png`) as `${string}.png`, fullPage: true });
      if (kind === 'pdf') await tab.pdf({ path: path.join(OUT, `${label}-report.pdf`), format: 'A4', printBackground: true });
    }
    await tab.close();

    const reportScores = extractReportScores(audit, bizAfter);
    const reportMsg = composeSummaryMessage(defaultReportAgentConfig(), reportScores, 'Owner', 'https://growwmatics.example/dashboard');
    const legacyTpl = composeSummaryMessage({ ...defaultReportAgentConfig(), reportSummaryTemplate: DEFAULT_REPORT_SUMMARY }, reportScores, 'Owner', 'https://growwmatics.example/dashboard');
    const salesScores = extractScores(audit, bizAfter);
    const cfg = defaultSalesAgentConfig('https://growwmatics.example/billing', 'https://growwmatics.example/pricing');
    const salesTemplate = await composeFirstMessage({ ...cfg, firstMessage: { ...cfg.firstMessage, mode: 'template' } } as any, salesScores, 'Owner');
    const salesAi = await composeFirstMessage({ ...cfg, firstMessage: { ...cfg.firstMessage, mode: 'ai' } } as any, salesScores, 'Owner');
    const followUps = await Promise.all((cfg.followUps || []).map((f: any) => composeFollowUp(f, cfg, salesScores, 'Owner')));
    const whatsapp = [
      '=== REPORT SUMMARY ===', reportMsg, '=== (same, explicit default template) ===', legacyTpl,
      '=== SALES FIRST (template) ===', salesTemplate, '=== SALES FIRST (AI) ===', salesAi,
      ...followUps.flatMap((m, i) => [`=== FOLLOW-UP ${i + 1} ===`, m]),
    ].join('\n\n');
    fs.writeFileSync(path.join(OUT, `${label}-whatsapp.txt`), whatsapp);

    surfaces[`${label}/free-report`] = stripHtml(freeHtml);
    surfaces[`${label}/dashboard-report`] = stripHtml(grexaHtml);
    surfaces[`${label}/pdf`] = stripHtml(pdfHtml);
    surfaces[`${label}/whatsapp`] = whatsapp;
  }
  await browser.close();
  for (const [name, text] of Object.entries(surfaces)) scan(name, text, found);

  // ── 5. Source vs report ──────────────────────────────────────────────────
  const summarize = (a: any) => {
    if (!a?.auditData?.facts) return { status: a?.status, error: a?.metadata };
    const d = a.auditData; const f = d.facts;
    return {
      status: a.status,
      validation: d.validation,
      lifetimeReviews: f.reviews.lifetime,
      recentReviews: f.reviews.recent,
      displayedReviewCount: d.reviewAnalysis?.reviewCount ?? null,
      displayedRating: d.reviewAnalysis?.averageRating ?? null,
      ranking: {
        overall: f.ranking.overall,
        observations: f.observations.map((o: any) => ({ keyword: o.keyword, kind: o.kind, status: o.status, found: o.found, rank: o.rank, ahead: o.ahead.length })),
      },
      competitorsAhead: f.competitorsAhead,
      competitors: (d.competitors || []).slice(0, 10).map((c: any) => ({ name: c.name, placeId: c.placeId, rating: c.rating, reviewCount: c.reviewCount, searchesAhead: c.searchesAhead, source: c.source })),
      profile: { pct: d.profileCompletion?.completionPercentage, checklist: d.profileCompletion?.checklist?.map((c: any) => `${c.field}: ${c.status}`) },
      seoScore: d.seoScore,
      suspension: f.suspensionRisk,
      findings: (d.findings || []).map((x: any) => ({ id: x.id, title: x.title, evidence: x.evidence, actionability: x.actionability, capability: x.growwmaticsCapability })),
      keywordTable: (d.keywordTable || []).map((k: any) => ({ keyword: k.keyword, demand: k.volumeBand, demandStatus: k.demandStatus, searchVolume: k.searchVolume, rank: k.rank, found: k.found, rankStatus: k.rankStatus })),
      dataQuality: d.dataQuality,
      auditKind: d.auditKind,
      websiteSearchTerm: f.websiteSearchTerm ?? null,
      website: f.website ? { origin: f.website.origin, status: f.website.status, pages: (f.website.pagesCrawled || []).map((p: any) => `${p.kind}:${p.status}:${p.url}`), services: (f.website.services || []).map((s: any) => s.value), bookingLinks: (f.website.bookingLinks || []).map((s: any) => s.value) } : null,
      publicProfile: f.publicProfile,
      competitorComparison: f.competitorComparison,
      competitorInsights: d.seoPlanDraft?.competitorInsights,
      competitorWebsitesRead: (d.competitors || []).filter((c: any) => c.websiteServices).map((c: any) => ({ name: c.name, services: c.websiteServices })),
      proposedKeywords: d.seoPlanDraft?.proposedKeywords,
      keywordSources: (d.keywordTable || []).map((k: any) => `${k.keyword} [${k.source}]`),
      rankTimeline: d.seoPlanDraft?.rankTimeline,
      dataRequired: d.seoPlanDraft?.dataRequired,
      optimizationPlan: d.optimizationPlan,
      comparison: d.comparison ?? null,
      providerUsage: d.providerUsage,
      evidenceStates: (d.evidenceItems || []).reduce((m: any, e: any) => ({ ...m, [e.state]: (m[e.state] || 0) + 1 }), {}),
      aiStatus: d.aiStatus,
      performanceBaseline: d.performanceBaseline,
      competitorRelevance: (d.competitors || []).slice(0, 10).map((c: any) => `${c.name}: ${c.relevance} (above ${c.searchesAhead}, seen ${c.appearances})`),
      aiRepairs: [...(d.validation?.repairs || []), ...(d.seoPlanDraft?.repairs || [])],
    };
  };
  const checks = (a: any) => {
    const d = a?.auditData; const f = d?.facts;
    if (!f) return ['audit not completed — see status'];
    const out: string[] = [];
    const lt = f.reviews.lifetime;
    out.push(`lifetime reviews ${lt.totalCount} vs Places ${details.totalReviews} (Google totals source: ${lt.source})`);
    out.push(`rating ${lt.rating} vs Places ${details.rating}`);
    out.push(`displayed total = lifetime: ${d.reviewAnalysis?.reviewCount === lt.totalCount}`);
    out.push(`phone on listing: ${!!details.phoneNumber} → checklist Phone: ${d.profileCompletion.checklist.find((c: any) => c.field === 'Phone')?.status}`);
    out.push(`website on listing: ${!!details.website} → checklist Website: ${d.profileCompletion.checklist.find((c: any) => c.field === 'Website')?.status}`);
    out.push(`hours on listing: ${details.hasHours} → ${d.profileCompletion.checklist.find((c: any) => c.field === 'Business Hours')?.status}`);
    out.push(`photos on listing: ${details.photoCount} → ${d.profileCompletion.checklist.find((c: any) => c.field === 'Business Photos')?.status}`);
    const ranks = f.observations.filter((o: any) => o.found).map((o: any) => o.rank);
    const avg = ranks.length ? Math.round((ranks.reduce((x: number, y: number) => x + y, 0) / ranks.length) * 10) / 10 : null;
    out.push(`average from raw observations ${avg} = reported ${f.ranking.overall.averageObservedRank}: ${avg === f.ranking.overall.averageObservedRank}`);
    out.push(`no rank > 20 or 21 anywhere in observations: ${!f.observations.some((o: any) => o.rank != null && o.rank > 20)}`);
    out.push(`competitorsAhead ${f.competitorsAhead.count} = unique real businesses listed ${(d.competitors || []).filter((c: any) => c.source === 'dataforseo').length}`);
    out.push(`target not in its own competitor list: ${!(d.competitors || []).some((c: any) => c.placeId && c.placeId === details.placeId)}`);
    out.push(`review themes from real text only: ${d.reviewAnalysis?.reviewThemes ?? 'n/a'} (text samples ${f.reviews.recent.textSampleCount})`);
    out.push(`validation ok: ${d.validation?.ok} · repairs: ${(d.validation?.repairs || []).length}`);
    return out;
  };
  const sectionCheck = (label: string) => {
    const text = surfaces[`${label}/free-report`] || '';
    const pdf = surfaces[`${label}/pdf`] || '';
    return REQUIRED_SECTIONS.map((s) => `${s}: page ${text.includes(s) ? 'yes' : 'MISSING'} · pdf ${pdf.toLowerCase().includes(s.toLowerCase()) ? 'yes' : 'MISSING'}`);
  };

  // ── 6. Onboarding prefill (same builder + stored data the intake GET uses) ─
  const { buildIntakePrefill } = await import('../src/services/intel/intakePrefill');
  const { normalizeOrigin } = await import('../src/services/intel/websiteExtract');
  const WebsiteIntelligence = (await import('../src/models/WebsiteIntelligence')).default;
  const origin = normalizeOrigin(String(bizAfter?.website || ''));
  const storedSite: any = origin ? await WebsiteIntelligence.findOne({ origin }).lean() : null;
  const latest: any = await Audit.findOne({ businessId: business._id, status: 'COMPLETED' }).sort({ createdAt: -1 }).lean();
  const prefill = buildIntakePrefill({
    business: { ...bizAfter, description: '', services: '', keywords: [], intake: {} },
    website: storedSite,
    measuredKeywords: (latest?.auditData?.keywordTable || []).filter((r: any) => (r.rankStatus ?? 'ok') === 'ok').map((r: any) => ({ keyword: r.keyword, source: r.source })),
    listingCategory: latest?.auditData?.facts?.publicProfile?.category ?? null,
  });
  fs.writeFileSync(path.join(OUT, 'onboarding-prefill.json'), JSON.stringify(prefill, null, 2));

  const report = {
    business: { name: details.name, placeId: details.placeId, address: details.formattedAddress },
    source: { placesRating: details.rating, placesReviewCount: details.totalReviews, phone: !!details.phoneNumber, website: !!details.website, hasHours: details.hasHours, photoCount: details.photoCount, googleReviewTotalsAfterSync: bizAfter?.googleReviewTotals ?? null },
    free: { summary: summarize(free), checks: checks(free), sections: sectionCheck('free') },
    dashboard: { summary: summarize(dash), checks: checks(dash), sections: sectionCheck('dashboard') },
    onboardingPrefill: prefill,
    websiteIntelStored: storedSite ? { origin: storedSite.origin, status: storedSite.status, crawlDepth: storedSite.crawlDepth, pages: storedSite.pagesCrawled?.length } : null,
    forbiddenPhraseHits: found,
    surfacesRendered: Object.keys(surfaces),
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(report, null, 2));
  console.log('\n[live-check] FREE checks:\n  ' + report.free.checks.join('\n  '));
  console.log('\n[live-check] DASHBOARD checks:\n  ' + report.dashboard.checks.join('\n  '));
  console.log('\n[live-check] FREE sections:\n  ' + report.free.sections.join('\n  '));
  console.log('\n[live-check] provider usage (free):', JSON.stringify((report.free.summary as any).providerUsage));
  console.log('[live-check] provider usage (dashboard):', JSON.stringify((report.dashboard.summary as any).providerUsage));
  console.log('\n[live-check] onboarding prefill:', JSON.stringify(prefill));
  console.log(`\n[live-check] forbidden-phrase hits: ${found.length}`);
  for (const h of found) console.log(`  [${h.surface}] "${h.phrase}" … ${h.context}`);
  await cleanup();
  process.exit(0);
}

main().catch(async (e) => {
  console.error('[live-check] FAILED:', e);
  await cleanup();
  process.exit(1);
});
