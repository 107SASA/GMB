/**
 * END-TO-END LIFECYCLE CHECK — onboarding prefill → connected baseline →
 * first monthly report → duplicate monthly attempt → weekly monitoring →
 * notifications (in-app + WhatsApp), on a throwaway in-memory MongoDB.
 *
 *   npx tsx scripts/lifecycle-check.ts "<business search>" <outDir>
 *
 * REAL: Google Places, DataForSEO, Groq, the business website (two full
 * audits ≈ ₹30–35 of provider usage).
 * SIMULATED (clearly labelled in the output): the Google Business Profile
 * API (profile + performance) — no real OAuth is available here; Inngest
 * dispatch (the audit job is run directly); execution records (posts,
 * replies, profile edits, review requests, reviews) seeded between audits.
 * WhatsApp: NEVER sent — sendOutboundMessage is intercepted and captured.
 */
import fs from 'fs';
import path from 'path';

const QUERY = process.argv[2] || 'Mulsetu';
const OUT = path.resolve(process.argv[3] || 'tmp-lifecycle-check');
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
// Test harness: never reach production object storage (see memory: harness-side-effects).
for (const k of Object.keys(process.env)) if (k.startsWith('DO_SPACES_')) delete process.env[k];
process.env.WHATSAPP_PROVIDER = 'twilio'; // the QA suppression lives on the Twilio path
process.env.GBP_LIVE_WRITES_ENABLED = 'true'; // gbpClient is simulated below — nothing reaches Google
process.env.NEXT_PUBLIC_APP_URL ||= 'https://app.example.invalid';

// ── Simulated GBP + Inngest + captured WhatsApp ─────────────────────────────
const gbpState: { profile: any; metricsScale: number } = { profile: null, metricsScale: 1 };
const whatsapp: Array<{ phone: string; body: string }> = [];
const inngestEvents: any[] = [];
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  // `(\.ts)?` — tsx passes the resolved path ('…\src\lib\gbpClient.ts') for lazy imports.
  if (/lib[\\/]gbpClient(\.ts)?$/.test(request)) {
    return {
      fetchLocationProfile: async () => ({ locationName: 'locations/SIMULATED', ...gbpState.profile }),
      fetchDailyMetrics: async (_id: string, start: Date) => Array.from({ length: 28 }, (_, i) => ({
        date: new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10),
        views: 40 * gbpState.metricsScale, viewsMaps: 25, viewsSearch: 15,
        callClicks: (i % 3 === 0 ? 1 : 0) * gbpState.metricsScale, websiteClicks: (i % 2) * gbpState.metricsScale, directionRequests: i % 5 === 0 ? 1 : 0, conversations: 0,
      })),
    };
  }
  if (/services[\\/]inngest[\\/]client(\.ts)?$/.test(request)) return { inngest: { send: async (e: any) => { inngestEvents.push(e); return { ids: [] }; } } };
  if (/services[\\/]whatsapp[\\/]send(\.ts)?$/.test(request)) {
    return { sendOutboundMessage: async (phone: string, body: string) => { whatsapp.push({ phone, body }); return { success: true, sid: 'captured' }; } };
  }
  return origLoad.call(this, request, ...rest);
};

type Result = { test: string; pass: boolean; detail: string };
const results: Result[] = [];
const check = (test: string, pass: boolean, detail: string) => { results.push({ test, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${test} — ${detail}`); };

async function main() {
  const { MongoMemoryServer } = await import('mongodb-memory-server' as string);
  const mem = await MongoMemoryServer.create({ instance: { launchTimeout: 90_000 } });
  process.env.MONGODB_URI = mem.getUri('growwmatics_lifecycle_check');
  try {
    await run();
  } finally {
    await mem.stop({ doCleanup: true, force: true }).catch(() => {});
  }
}

async function run() {
  const dbConnect = (await import('../src/lib/mongodb')).default;
  await dbConnect();
  const { GooglePlacesService } = await import('../src/services/google/places');
  const User = (await import('../src/models/User')).default;
  const Organization = (await import('../src/models/Organization')).default;
  const Business = (await import('../src/models/Business')).default;
  const Audit = (await import('../src/models/Audit')).default;
  await Audit.syncIndexes(); // the unique (businessId, auditKind, period) index must exist before the race tests
  const OptimizationAction = (await import('../src/models/OptimizationAction')).default;
  const Notification = (await import('../src/models/Notification')).default;
  const WeeklyMonitor = (await import('../src/models/WeeklyMonitor')).default;
  await WeeklyMonitor.syncIndexes();
  const Post = (await import('../src/models/Post')).default;
  const Review = (await import('../src/models/Review')).default;
  const ReviewRequest = (await import('../src/models/ReviewRequest')).default;
  const ProfileActivity = (await import('../src/models/ProfileActivity')).default;
  const GBPInsights = (await import('../src/models/GBPInsights')).default;
  const { getWebsiteIntelligence } = await import('../src/services/intel/websiteIntelligence');
  const { buildIntakePrefill } = await import('../src/services/intel/intakePrefill');
  const { createPendingAuditAndDispatch } = await import('../src/lib/startAudit');
  const { processAuditJob } = await import('../src/services/audit/auditService');
  const { runWeeklyMonitoring } = await import('../src/services/lifecycle/notify');
  const { runWithMeter } = await import('../src/lib/providerMeter');

  // ── TEST 1: account → website prefill → owner confirmation ────────────────
  const [cand] = await GooglePlacesService.autocomplete(QUERY);
  const details: any = await GooglePlacesService.getDetails(cand.placeId);
  const user: any = await User.create({ fullName: 'Lifecycle Owner', email: 'lifecycle@example.invalid', phone: '+919999900002', role: 'CLIENT' });
  const org: any = await Organization.create({ name: 'Lifecycle Org', ownerId: user._id, subscriptionPlan: 'Pro' });
  const business: any = await Business.create({
    name: details.name, category: details.primaryCategory || 'Local Business', address: details.formattedAddress, area: details.area,
    city: details.city, state: details.state, country: details.country, phone: details.phoneNumber || undefined, website: details.website || undefined,
    placeId: details.placeId, googlePlaceId: details.placeId, coordinates: { lat: details.latitude, lng: details.longitude },
    placesRating: details.rating, placesReviewCount: details.totalReviews, photoCount: details.photoCount, hasHours: details.hasHours,
    googleTypes: details.categories, organizationId: org._id, userId: user._id, subscriptionStatus: 'active',
  });
  const site = business.website ? await getWebsiteIntelligence(business.website, { maxPages: 6 }) : null;
  const prefill = buildIntakePrefill({ business: { ...business.toObject(), description: '', services: '', keywords: [] }, website: site });
  check('T1 website prefill offered with sources', !!prefill.services?.sourceUrl || !!prefill.description?.sourceUrl, `fields: ${Object.keys(prefill).join(', ') || 'none'}`);
  // Owner accepts the services suggestion unchanged (same update the intake POST performs).
  const accepted = prefill.services ? [{ field: 'services', source: prefill.services.source, sourceUrl: prefill.services.sourceUrl, confirmedAt: new Date() }] : [];
  await Business.updateOne({ _id: business._id }, { $set: { services: prefill.services?.value || '', 'intake.confirmedSuggestions': accepted } });
  const b1: any = await Business.findById(business._id).lean();
  check('T1 owner confirmation stored as owner-confirmed', (b1.intake?.confirmedSuggestions || []).length === accepted.length, `${accepted.length} suggestion(s) confirmed, source ${accepted[0]?.source ?? '—'}`);

  // ── TEST 2: GBP connected → fresh connected baseline ─────────────────────
  gbpState.profile = { title: details.name, description: '', primaryPhone: details.phoneNumber || '', website: details.website || '', primaryCategory: details.primaryCategory || '', additionalCategories: [], address: details.formattedAddress };
  await Business.updateOne({ _id: business._id }, { $set: { googleConnected: true, googleLocationId: 'locations/SIMULATED' } });
  const bizDoc: any = await Business.findById(business._id);
  const baseline: any = await createPendingAuditAndDispatch(bizDoc, org, user, { fastMode: false, trigger: 'audit-autopilot-first-run' });
  await processAuditJob(baseline._id.toString());
  const bl: any = await Audit.findById(baseline._id).lean();
  check('T2 connected baseline audit', bl.status === 'COMPLETED' && bl.auditKind === 'connected_baseline' && bl.period === 'baseline', `${bl.status} · kind ${bl.auditKind} · period ${bl.period}`);
  check('T2 baseline has verified GBP + performance baseline', bl.auditData?.facts?.gbpProfile?.fields?.title === details.name && bl.auditData?.performanceBaseline?.status === 'verified', `performance ${bl.auditData?.performanceBaseline?.status} (SIMULATED GBP data)`);
  const actions0 = await OptimizationAction.countDocuments({ businessId: business._id });
  check('T2 optimization plan stored as trackable actions', actions0 > 0, `${actions0} actions`);
  const again: any = await createPendingAuditAndDispatch(bizDoc, org, user, { fastMode: false, trigger: 'audit-autopilot-first-run' });
  check('T2 second baseline attempt reuses the first', String(again._id) === String(baseline._id) && again.$locals?.reused === true, `returned ${again._id}`);

  // ── Between audits: execution records + GBP changes (SIMULATED) ──────────
  const after = new Date(Date.now() + 1000);
  await Post.create({ businessId: business._id, content: 'Autopilot post', status: 'published', publishedAt: after, liveWriteApplied: true, aiGenerated: true, automationMetadata: { generatedVia: 'cron' } });
  await Post.create({ businessId: business._id, content: 'Dry-run post (live write off)', status: 'published', publishedAt: after, liveWriteApplied: false, aiGenerated: true, automationMetadata: { generatedVia: 'cron' } });
  await ProfileActivity.create({ businessId: business._id, type: 'profile_updated', title: 'Profile updated', updatedBy: 'Lifecycle Owner', metadata: { actor: 'owner', fields: ['description'], values: { description: 'We build websites and automation for growing businesses.' }, liveWriteApplied: true } });
  await Review.create({ businessId: business._id, reviewer: 'A', rating: 5, reviewText: 'Great work', sentiment: 'positive', response: 'Thank you!', replyStatus: 'POSTED', replyPostedBy: 'growwmatics_auto', replyPostedAt: after, replyLiveWriteApplied: true, replyCheckedAt: after, postedAt: after, providerReviewId: 'r-a', source: 'gbp_api' });
  await Review.create({ businessId: business._id, reviewer: 'B', rating: 4, reviewText: 'Good', sentiment: 'positive', response: '', replyCheckedAt: after, postedAt: after, providerReviewId: 'r-b', source: 'gbp_api' });
  await ReviewRequest.create({ tenantId: org._id.toString(), businessId: business._id, customerId: user._id, channel: 'whatsapp', message: 'Please review us', status: 'Sent', sentAt: after });
  gbpState.profile = { ...gbpState.profile, description: 'We build websites and automation for growing businesses.', primaryPhone: '+91 90000 00000' };
  gbpState.metricsScale = 2;

  // ── TEST 3: first monthly report ─────────────────────────────────────────
  const monthlyRun = await runWithMeter(async () => {
    const m: any = await createPendingAuditAndDispatch(await Business.findById(business._id), org, user, { fastMode: false, trigger: 'audit-autopilot-monthly' });
    await processAuditJob(m._id.toString());
    return m;
  });
  const mo: any = await Audit.findById(monthlyRun.result._id).lean();
  const m = mo.auditData?.monthly;
  check('T3 monthly audit completed and stored', mo.status === 'COMPLETED' && mo.auditKind === 'monthly' && !!m, `${mo.status} · period ${mo.period} · baseline ${mo.baselineAuditId} · previous ${mo.previousAuditId}`);
  check('T3 lineage references the baseline', String(mo.baselineAuditId) === String(baseline._id) && String(mo.previousAuditId) === String(baseline._id), 'baseline = previous for the first month');
  const desc = m?.changes?.find((c: any) => c.what === 'Description');
  const phone = m?.changes?.find((c: any) => c.what === 'Phone');
  check('T3 change with execution record attributed to owner', desc?.actor === 'Owner', `Description: ${desc?.previous} → ${desc?.current} · by ${desc?.actor}`);
  check('T3 change without a record is NOT attributed', phone?.actor === 'Unknown', `Phone by ${phone?.actor}`);
  const gm = Object.fromEntries((m?.growwmaticsOptimized || []).map((x: any) => [x.what, x.count]));
  check('T3 GrowwMatics credited only with live-write records', gm['Google posts published automatically'] === 1 && gm['Review replies posted automatically'] === 1 && gm['Review requests sent'] === 1, JSON.stringify(gm));
  check('T3 performance compared on measured periods', m?.performance?.status === 'compared' && m.performance.rows.every((r: any) => r.previous != null && r.current != null), JSON.stringify(m?.performance?.rows?.map((r: any) => `${r.metric} ${r.previous}→${r.current} ${r.pctChange}%`)));
  const rank = m?.ranking || [];
  check('T14 ranking compared only when comparable', rank.every((r: any) => r.change === 'Not directly comparable' ? !!r.note || true : ['better', 'worse', 'same'].includes(r.change)), rank.map((r: any) => `${r.metric}: ${r.change}`).join(' | '));
  const descAction: any = await OptimizationAction.findOne({ businessId: business._id, findingId: 'profile.business_description.missing' }).lean();
  check('T3 action lifecycle from evidence', !descAction || ['EXECUTED', 'VERIFIED'].includes(descAction.status), descAction ? `${descAction.findingId}: ${descAction.status} — ${descAction.statusReason}` : 'no description action in the plan');
  const monthlyWa = whatsapp.find((w) => /monthly report/i.test(w.body));
  check('T12 monthly WhatsApp composed from verified values', !!monthlyWa && !/₹|revenue|more calls/i.test(monthlyWa.body), monthlyWa ? monthlyWa.body.split('\n').slice(0, 4).join(' / ') : 'not sent');
  const monthlyNote = await Notification.findOne({ businessId: business._id, type: 'monthly_report' }).lean();
  check('T13 in-app monthly notification with link', !!monthlyNote && /\/dashboard\/audit\//.test((monthlyNote as any).link), (monthlyNote as any)?.body || 'none');

  // ── TEST 4: second monthly in the same month ─────────────────────────────
  const auditsBefore = await Audit.countDocuments({ businessId: business._id });
  const dup = await runWithMeter(async () => Promise.all([
    createPendingAuditAndDispatch(await Business.findById(business._id), org, user, { fastMode: false, trigger: 'audit-autopilot-monthly' }),
    createPendingAuditAndDispatch(await Business.findById(business._id), org, user, { fastMode: false, trigger: 'audit-autopilot-monthly' }),
  ]));
  const auditsAfter = await Audit.countDocuments({ businessId: business._id });
  const paidDup = Object.entries(dup.counts).filter(([k]) => !/CacheHit$|Token$/.test(k) && k !== 'websiteFetch').reduce((a, [, n]) => a + (n || 0), 0);
  check('T4 duplicate monthly prevented (2 concurrent attempts)', auditsAfter === auditsBefore && dup.result.every((a: any) => String(a._id) === String(mo._id)), `audits ${auditsBefore} → ${auditsAfter}; both returned ${mo._id}; paid calls ${paidDup}`);

  // ── TESTS 5–7: weekly monitoring ─────────────────────────────────────────
  const now = new Date(Date.now() + 2 * 86_400_000);
  await Business.updateOne({ _id: business._id }, { $set: { 'googleReviewTotals.capturedAt': new Date(), 'googleReviewTotals.rating': 4.8, 'googleReviewTotals.count': (details.totalReviews || 0) + 2 } });
  for (let i = 0; i < 20; i++) {
    await GBPInsights.create({ businessId: business._id, organizationId: org._id, date: new Date(now.getTime() - (i + 3) * 86_400_000), callClicks: i < 7 ? 3 : 2, websiteClicks: 4, directionRequests: 1, views: 50 });
  }
  const w1: any = await runWeeklyMonitoring(business._id.toString(), now);
  const wm: any = await WeeklyMonitor.findOne({ businessId: business._id, weekKey: w1.weekKey }).lean();
  check('T5 weekly with new reviews', w1.status === 'done' && wm.lines.some((l: string) => l.startsWith('New reviews: 2')), wm.lines.join(' | '));
  check('T7 unanswered reviews flagged', wm.lines.some((l: string) => l.startsWith('Unanswered reviews: 1')), '');
  check('T15 weekly monitoring made no paid provider calls', w1.paidCalls === 0, `paid calls ${w1.paidCalls}`);
  const w1b: any = await runWeeklyMonitoring(business._id.toString(), now);
  check('T5 weekly is idempotent per week', w1b.status === 'already_ran', w1b.status);
  const later = new Date(now.getTime() + 14 * 86_400_000);
  await Business.updateOne({ _id: business._id }, { $set: { 'googleReviewTotals.capturedAt': later } });
  const w2: any = await runWeeklyMonitoring(business._id.toString(), later);
  const wm2: any = await WeeklyMonitor.findOne({ businessId: business._id, weekKey: w2.weekKey }).lean();
  check('T6 weekly with zero new reviews states it, no blame', wm2.lines.some((l: string) => /no new Google reviews were detected this week/.test(l)) && !wm2.lines.some((l: string) => /fail/i.test(l)), wm2.lines.join(' | '));
  const weeklyNotes = await Notification.find({ businessId: business._id, type: /^weekly_/ }).lean();
  check('T13 weekly in-app notifications stored with links', weeklyNotes.length > 0 && weeklyNotes.every((n: any) => !!n.link), weeklyNotes.map((n: any) => n.type).join(', '));
  const weeklyWa = whatsapp.filter((w) => w.body.startsWith('GrowwMatics Weekly Update'));
  check('T12 weekly WhatsApp only for a meaningful week (or opt-in)', weeklyWa.length >= 1 && (wm2.meaningful || wm2.whatsappSkipReason === 'suppressed_nothing_new' || wm2.whatsappSent), `${weeklyWa.length} weekly message(s); week 2: meaningful=${wm2.meaningful}, ${wm2.whatsappSkipReason || 'sent'}`);

  fs.writeFileSync(path.join(OUT, 'lifecycle-results.json'), JSON.stringify({ results, whatsapp, monthly: m, baselineLineage: bl.auditData?.lineage, monthlyLineage: mo.auditData?.lineage, monthlyUsage: mo.auditData?.providerUsage, weekly: [wm, wm2], inngestEvents: inngestEvents.length }, null, 2));
  fs.writeFileSync(path.join(OUT, 'monthly-auditData.json'), JSON.stringify(mo.auditData, null, 2));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n[lifecycle-check] ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error('[lifecycle-check] FAILED:', e); process.exitCode = 1; }).finally(() => setTimeout(() => process.exit(), 500));
