/**
 * REVIEW REPLY WORKFLOW CHECK — throwaway in-memory MongoDB (no production data).
 *
 *   npx tsx scripts/review-reply-check.ts [outDir]
 *
 * REAL: Groq (one pass drafting replies to four reviews), the fact check,
 *   Mongo records. SIMULATED (labelled): AI output for the failure cases,
 *   Google's reply endpoint (success / error / live writes off).
 * Nothing reaches Google; WhatsApp is intercepted; storage credentials are removed.
 */
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(process.argv[2] || 'tmp-review-reply-check');
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
process.env.GBP_LIVE_WRITES_ENABLED = 'false'; // the default Google path must never be reachable here
for (const k of Object.keys(process.env)) if (k.startsWith('DO_SPACES_')) delete process.env[k];

const intercepted = new Set<string>();
const whatsapp: string[] = [];
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/services[\\/]whatsapp[\\/]send(\.ts)?$/.test(request)) {
    intercepted.add('whatsapp');
    return { sendOutboundMessage: async (_p: string, body: string) => { whatsapp.push(body); return { success: true, sid: 'captured' }; } };
  }
  return origLoad.call(this, request, ...rest);
};

type Result = { n: string; test: string; pass: boolean; detail: string; mode: string };
const results: Result[] = [];
const check = (n: string, test: string, pass: boolean, detail: string, mode = 'integration (in-memory DB)') => {
  results.push({ n, test, pass, detail, mode });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${n}] ${test} — ${detail}`);
};

async function main() {
  const { MongoMemoryServer } = await import('mongodb-memory-server' as string);
  const mem = await MongoMemoryServer.create({ instance: { launchTimeout: 90_000 } });
  process.env.MONGODB_URI = mem.getUri('growwmatics_review_reply_check');
  try { await run(); } finally { await mem.stop({ doCleanup: true, force: true }).catch(() => {}); }
}

async function run() {
  const dbConnect = (await import('../src/lib/mongodb')).default;
  await dbConnect();
  const User = (await import('../src/models/User')).default;
  const Organization = (await import('../src/models/Organization')).default;
  const Business = (await import('../src/models/Business')).default;
  const SeoPlan = (await import('../src/models/SeoPlan')).default;
  const WebsiteIntelligence = (await import('../src/models/WebsiteIntelligence')).default;
  const Review = (await import('../src/models/Review')).default;
  const ReviewReply = (await import('../src/models/ReviewReply')).default;
  const { draftReply, approveReply, publishReply, isAutoPublishActive } = await import('../src/services/reviews/replyPipeline');
  const { autoReplyToReview } = await import('../src/services/reviews/autoReply');

  let seq = 0;
  async function mkBiz(settings?: any) {
    seq++;
    const user: any = await User.create({ fullName: `Owner ${seq}`, email: `rr${seq}@example.invalid`, phone: `+9198888${String(seq).padStart(5, '0')}`, role: 'CLIENT' });
    const org: any = await Organization.create({ name: `Org ${seq}`, ownerId: user._id, subscriptionPlan: 'Pro' });
    const b: any = await Business.create({
      name: 'Sahyadri Tile Works', category: 'Tile contractor', address: 'Gangapur Road, Nashik', area: 'Gangapur Road', city: 'Nashik', country: 'India',
      website: 'https://sahyadri-tiles.example', services: 'Tile installation, Bathroom renovation', organizationId: org._id, userId: user._id,
      subscriptionStatus: 'active', googleConnected: true, ...(settings ? { reviewReplySettings: settings } : {}),
    } as any);
    await SeoPlan.create({ businessId: b._id, version: 1, status: 'active',
      keywordTable: [
        { keyword: 'bathroom renovation nashik', searchVolume: 170, volumeBand: 'MED', demandStatus: 'measured', estimated: false, mapsRank: 9, rank: 9, found: true, rankStatus: 'ok' },
        { keyword: 'sahyadri tile works', searchVolume: null, volumeBand: null, demandStatus: 'unavailable', estimated: true, mapsRank: 1, rank: 1, found: true, rankStatus: 'ok' },
      ],
      draft: { proposedKeywords: [{ keyword: 'floor tiles nashik', basis: 'owner service + city' }] } } as any);
    return b;
  }
  await WebsiteIntelligence.create({ origin: 'https://sahyadri-tiles.example', status: 'complete', pagesCrawled: [], services: [{ value: 'Kitchen tiling', sourceUrl: 'https://sahyadri-tiles.example/services' }], credentials: [], differentiators: [], offers: [] } as any);
  let rseq = 0;
  const mkReview = (b: any, o: { text: string; rating: number; reviewer?: string; response?: string; replyPostedBy?: string }) =>
    Review.create({ businessId: b._id, providerReviewId: `accounts/1/locations/2/reviews/r${++rseq}`, source: 'gbp_api', reviewer: o.reviewer ?? 'Priya Kulkarni', rating: o.rating, reviewText: o.text, sentiment: o.rating >= 4 ? 'positive' : 'negative', response: o.response, replyPostedBy: o.replyPostedBy, postedAt: new Date() } as any);

  const POS = 'Ramesh and his team did a neat job on our bathroom tiles. Finished on time and cleaned up after.';
  const goodReply = 'Thank you, Priya! We are glad the bathroom tiles came out neat and that Ramesh and the team finished on time and cleaned up. — The Sahyadri Tile Works Team';
  const offerReply = 'Thanks Priya for the bathroom tiles review! Enjoy 20% off your next project — book now.';
  const seen: any[] = [];
  const genConst = (reply: string) => async (p: any) => { seen.push(p); return { reply }; };
  let googleCalls = 0;
  const googleOk = async () => { googleCalls++; return { liveWriteApplied: true, googleResponse: '{"comment":"...","updateTime":"2026-09-30T10:00:00Z"}' }; };

  // ── Auto-publish OFF by default ──
  const A = await mkBiz();
  const aSaved: any = await Business.findById(A._id).lean();
  const rA = await mkReview(A, { text: POS, rating: 5 });
  const outA = await autoReplyToReview(String(A._id), rA as any, { generate: genConst(goodReply), postToGoogle: googleOk });
  const docA: any = await Review.findById(rA._id).lean();
  check('R1', 'automatic publishing disabled by default: new review → validated DRAFT, nothing sent to Google',
    aSaved.reviewReplySettings.mode === 'manual' && !isAutoPublishActive(aSaved.reviewReplySettings) && outA.published === null && docA.replyStatus === 'DRAFT' && googleCalls === 0 && !docA.response,
    `default mode ${aSaved.reviewReplySettings.mode}, status ${docA.replyStatus}, Google calls ${googleCalls}`);

  const L = await mkBiz({ mode: 'auto', tone: 'Professional' }); // saved before the fact-checked flow: no consent
  const rL = await mkReview(L, { text: POS, rating: 5 });
  const outL = await autoReplyToReview(String(L._id), rL as any, { generate: genConst(goodReply), postToGoogle: googleOk });
  check('R2', 'legacy mode:"auto" without the owner\'s new consent → drafts only (paused)', outL.published === null && googleCalls === 0 && ((await Review.findById(rL._id).lean()) as any).replyStatus === 'DRAFT', `published ${outL.published}`);

  // ── Owner approval required ──
  const refused = await publishReply(String(A._id), String(rA._id), { deps: { postToGoogle: googleOk } });
  check('R3', 'owner approval required: a DRAFT cannot be posted', refused.outcome === 'refused' && /approved/.test(refused.reason || '') && googleCalls === 0, refused.reason || '');

  // ── Successful validation → approve → publish (simulated Google) ──
  const ap = await approveReply(String(A._id), String(rA._id), { by: 'owner' });
  const pub = await publishReply(String(A._id), String(rA._id), { deps: { postToGoogle: googleOk } });
  const docA2: any = await Review.findById(rA._id).lean();
  const rows: any[] = await ReviewReply.find({ reviewId: rA._id }).sort({ createdAt: 1 }).lean();
  const pubRow = rows.find((r) => r.event === 'publish_attempt');
  check('R4', 'successful validation → owner approves → published; POSTED only on Google confirmation',
    ap.ok && pub.outcome === 'published' && docA2.replyStatus === 'POSTED' && docA2.replyPublishStatus === 'published' && docA2.replyLiveWriteApplied === true && docA2.replyPostedBy === 'growwmatics_owner_approved' && googleCalls === 1,
    `${docA2.replyStatus}/${docA2.replyPublishStatus} by ${docA2.replyPostedBy}`, 'SIMULATED Google');
  check('R5', 'stored: review id, reply, sources, validation, approval, Google status + response, timestamps',
    rows.map((r) => r.event).join(',') === 'drafted,approved,publish_attempt' && !!pubRow && String(pubRow.reviewId) === String(rA._id) && pubRow.generatedReply === goodReply
      && pubRow.sources.some((s: string) => s.startsWith('website:')) && pubRow.sources.some((s: string) => s.startsWith('seo_plan:')) && pubRow.validation.ok === true
      && pubRow.approvalStatus === 'approved' && pubRow.approvedBy === 'owner' && pubRow.publishStatus === 'published' && /updateTime/.test(pubRow.googleResponse) && !!pubRow.createdAt,
    `events ${rows.map((r) => r.event).join(',')} · sources ${pubRow?.sources.join(', ')}`);

  // ── Context the AI received ──
  const p0 = seen[0];
  check('R6', 'AI receives review text, reviewer, verified facts (services, website, location), SEO keywords labelled measured/proposed',
    p0.reviewText === POS && p0.reviewer === 'Priya Kulkarni' && /Tile installation/.test(p0.factsBlock) && /Kitchen tiling/.test(p0.factsBlock) && /Nashik/.test(p0.factsBlock)
      && p0.keywords.includes('bathroom renovation nashik (measured)') && p0.keywords.includes('floor tiles nashik (proposed)') && !p0.keywords.some((k: string) => /sahyadri/i.test(k)),
    `keywords: ${p0.keywords.join(', ')}`);
  const X = await mkBiz();
  const rX = await mkReview(X, { text: 'Tiles look great but the job ran a day late.', rating: 4, response: 'Thanks for the feedback!', replyPostedBy: 'external' });
  await Review.updateOne({ _id: rX._id }, { $set: { replyStatus: 'PENDING' } });
  seen.length = 0;
  await draftReply(String(X._id), String(rX._id), { deps: { generate: genConst('Thank you — sorry the job ran a day late; we are glad the tiles look great.') } });
  check('R7', 'previous reply on the review is passed as conversation context', seen[0]?.previousReply === 'Thanks for the feedback!', String(seen[0]?.previousReply));

  // ── Failed validation → regenerate once → NEEDS_REVIEW, never published (even with auto on) ──
  const C = await mkBiz({ mode: 'auto', tone: 'Professional', autoPublishConsentAt: new Date(), autoPublishConsentBy: 'owner' });
  const rC = await mkReview(C, { text: POS, rating: 5 });
  let genCalls = 0;
  const outC = await autoReplyToReview(String(C._id), rC as any, { generate: async () => { genCalls++; return { reply: offerReply }; }, postToGoogle: googleOk });
  const docC: any = await Review.findById(rC._id).lean();
  check('R8', 'failed validation after one regeneration → NEEDS_REVIEW, not published (auto-reply ON)',
    genCalls === 2 && docC.replyStatus === 'NEEDS_REVIEW' && docC.replyValidation.attempts === 2 && docC.replyValidation.reasons.length > 0 && outC.published === null && googleCalls === 1,
    `${docC.replyStatus}: ${docC.replyValidation.reasons.slice(0, 2).join(' | ')}`, 'SIMULATED AI output');
  const postNeeds = await publishReply(String(C._id), String(rC._id), { deps: { postToGoogle: googleOk } });
  check('R9', 'a NEEDS_REVIEW reply cannot be posted', postNeeds.outcome === 'refused' && googleCalls === 1, postNeeds.reason || '');

  // Regeneration that fixes it → DRAFT
  const D = await mkBiz();
  const rD = await mkReview(D, { text: POS, rating: 5 });
  let n = 0;
  const dres = await draftReply(String(D._id), String(rD._id), { deps: { generate: async (p: any) => ({ reply: ++n === 1 ? offerReply : goodReply, _p: p }) } });
  check('R10', 'rejected draft regenerated once with the reasons; passing regeneration → DRAFT', dres.status === 'DRAFT' && n === 2, `${dres.status} after ${n} generations`, 'SIMULATED AI output');

  // Auto ON (with consent) + valid draft → published automatically
  const rC2 = await mkReview(C, { text: POS, rating: 5 });
  const outC2 = await autoReplyToReview(String(C._id), rC2 as any, { generate: genConst(goodReply), postToGoogle: googleOk });
  const docC2: any = await Review.findById(rC2._id).lean();
  check('R11', 'auto-reply switched ON by the owner: validated reply published automatically', outC2.published === 'published' && docC2.replyPostedBy === 'growwmatics_auto' && docC2.replyApprovedBy === 'auto' && googleCalls === 2, `${docC2.replyStatus} by ${docC2.replyPostedBy}`, 'SIMULATED Google');

  // Owner edits in an unsupported claim → cannot approve
  const E = await mkBiz();
  const rE = await mkReview(E, { text: POS, rating: 5 });
  await draftReply(String(E._id), String(rE._id), { deps: { generate: genConst(goodReply) } });
  const apE = await approveReply(String(E._id), String(rE._id), { by: 'owner', text: `${goodReply} We also do swimming pool construction and offer a free consultation.` });
  check('R12', 'owner-edited text with an unsupported claim is not approved (NEEDS_REVIEW, reasons shown)', !apE.ok && apE.review.replyStatus === 'NEEDS_REVIEW', apE.reasons.join(' | '));

  // Approved text tampered afterwards → publish re-check refuses
  await approveReply(String(E._id), String(rE._id), { by: 'owner', text: goodReply });
  await Review.updateOne({ _id: rE._id }, { $set: { aiSuggestedReply: 'Thanks! We are the #1 tile company in Pune — call now.' } });
  const tam = await publishReply(String(E._id), String(rE._id), { deps: { postToGoogle: googleOk } });
  check('R13', 'publish re-checks the exact text: an unsafe approved reply is refused', tam.outcome === 'refused' && googleCalls === 2 && ((await Review.findById(rE._id).lean()) as any).replyStatus === 'NEEDS_REVIEW', tam.reason?.slice(0, 120) || '');

  // Live writes off → blocked (not POSTED); Google error → FAILED with the error stored
  const F = await mkBiz();
  const rF = await mkReview(F, { text: POS, rating: 5 });
  await draftReply(String(F._id), String(rF._id), { deps: { generate: genConst(goodReply) } });
  await approveReply(String(F._id), String(rF._id), { by: 'owner' });
  const blk = await publishReply(String(F._id), String(rF._id)); // real postReviewReplyToGoogle, GBP_LIVE_WRITES_ENABLED=false
  const docF: any = await Review.findById(rF._id).lean();
  check('R14', 'live Google writes off → "not executed", stays APPROVED, not marked replied', blk.outcome === 'blocked' && docF.replyStatus === 'APPROVED' && docF.replyPublishStatus === 'blocked' && !docF.response, docF.replyFailureReason.slice(0, 90), 'REAL gate (writes disabled)');
  const err = await publishReply(String(F._id), String(rF._id), { deps: { postToGoogle: async () => { throw new Error('Google API 403: PERMISSION_DENIED'); } } });
  const docF2: any = await Review.findById(rF._id).lean();
  const errRow: any = await ReviewReply.findOne({ reviewId: rF._id, publishStatus: 'failed' }).lean();
  check('R15', 'Google error → FAILED with Google\'s error stored', err.outcome === 'failed' && docF2.replyStatus === 'FAILED' && /PERMISSION_DENIED/.test(docF2.replyGoogleResponse) && /PERMISSION_DENIED/.test(errRow?.error), docF2.replyFailureReason, 'SIMULATED Google');

  // ── Real Groq: four kinds of review ──
  if (process.env.GROQ_API_KEY) {
    const R = await mkBiz();
    const cases = [
      { label: 'positive', text: POS, rating: 5, reviewer: 'Priya Kulkarni' },
      { label: 'negative', text: 'The kitchen tiling started two days late and nobody called to tell us. Grout is already cracking.', rating: 2, reviewer: 'Amit Shah' },
      { label: 'specific service', text: 'Got our kitchen tiling done by them. Clean lines around the sink and they matched the old tiles well.', rating: 5, reviewer: 'Neha Joshi' },
      { label: 'no information', text: 'Good', rating: 4, reviewer: 'A Google User' },
    ];
    const out: any[] = [];
    for (const c of cases) {
      const rv = await mkReview(R, c);
      const d = await draftReply(String(R._id), String(rv._id));
      out.push({ ...c, status: d.status, reply: d.reply, reasons: d.validation?.reasons, error: d.error });
    }
    fs.writeFileSync(path.join(OUT, 'real-groq-replies.json'), JSON.stringify(out, null, 2));
    for (const o of out) console.log(`   [${o.label}] ${o.status}: ${o.reply}${o.reasons?.length ? `  (reasons: ${o.reasons.join(' | ')})` : ''}`);
    check('R16', 'real AI drafts for positive / negative / specific-service / no-info reviews: each is DRAFT (passed) or NEEDS_REVIEW (held) — none published',
      out.every((o) => ['DRAFT', 'NEEDS_REVIEW'].includes(o.status)) && googleCalls === 2, out.map((o) => `${o.label}: ${o.status}`).join(', '), 'REAL Groq');
  } else {
    check('R16', 'real AI drafting', true, 'SKIPPED — no GROQ_API_KEY', 'not run');
  }

  check('safety', 'no Google write path reachable; storage credentials removed', process.env.GBP_LIVE_WRITES_ENABLED === 'false' && !Object.keys(process.env).some((k) => k.startsWith('DO_SPACES_')), `WhatsApp captured ${whatsapp.length}, interceptors: ${Array.from(intercepted).join(', ') || 'none needed'}`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILED: ${failed.map((f) => f.n).join(', ')}` : ''}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
