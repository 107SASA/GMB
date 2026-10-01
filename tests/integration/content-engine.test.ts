/**
 * Weekly GBP content engine — pure rules (plan, evidence gate, templates,
 * brand priority, image choice, festival calendar, monthly content lines).
 * Run: node --experimental-strip-types --test tests/integration/content-engine.test.ts
 * Case numbers refer to the spec's "TEST THESE CASES" list.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWeeklySlots, contentWeekKey, contentWeekStart, keywordInfo, type ContentFacts, type ContentSeoPlan } from '../../src/services/content/plan.ts';
import { validatePost, type PostEvidence } from '../../src/services/content/validatePost.ts';
import { templatePost, resolveBrand, chooseImageSource, buildImagePrompt, NEUTRAL_COLORS } from '../../src/services/content/creative.ts';
import { festivalsBetween, calendarCoversUntil, FESTIVALS } from '../../src/lib/festivalCalendar.ts';
import { summarizeContent, contentActivityLines, buildMonthlyReport, composeMonthlyWhatsApp, type ExecutionRecords } from '../../src/services/lifecycle/monthly.ts';
import { buildWeeklySummary, type WeeklyInput } from '../../src/services/lifecycle/weekly.ts';

const facts = (over: Partial<ContentFacts> = {}): ContentFacts => ({
  businessName: 'Mulsetu Tiles', category: 'Tile contractor', city: 'Nashik', area: 'Gangapur Road', phone: '+91 98765 43210', website: 'https://mulsetu.example',
  ownerServices: ['Tile installation', 'Bathroom renovation'], websiteServices: [{ value: 'Kitchen tiling', sourceUrl: 'https://mulsetu.example/services' }],
  ...over,
});
const plan = (over: Partial<ContentSeoPlan> = {}): ContentSeoPlan => ({
  seoPlanId: 'plan1',
  themes: [
    { weekday: 'Mon', theme: 'Bathroom renovation ideas', keyword: 'bathroom renovation nashik', postType: 'Educational' },
    { weekday: 'Thu', theme: 'Choosing floor tiles', keyword: 'floor tiles nashik', postType: 'Educational' },
  ],
  measuredKeywords: ['bathroom renovation nashik', 'tile contractor nashik'],
  proposedKeywords: ['floor tiles nashik'],
  ...over,
});
const ev = (over: Partial<PostEvidence> = {}): PostEvidence => ({
  businessName: 'Mulsetu Tiles', evidenceText: 'Mulsetu Tiles | Tile contractor | Nashik | Tile installation | Bathroom renovation | Kitchen tiling',
  serviceTerms: ['Tile contractor', 'Tile installation', 'Bathroom renovation', 'Kitchen tiling'], places: ['Nashik', 'Gangapur Road'], businessNames: [],
  offerText: null, festivalName: null, phone: '+91 98765 43210', website: 'https://mulsetu.example', ...over,
});

// ── Planning (cases 1, 2, 3, 10, 12, 13, 17, 23, 24, 32) ───────────────────

test('case 1/10/13: website + services, no offer, no festival → 4 slots from the SEO plan', () => {
  const s = planWeeklySlots({ facts: facts(), plan: plan(), weekIndex: 0, offer: null, festivals: [] });
  assert.equal(s.length, 4);
  assert.deepEqual(s.map((x) => x.slot), [1, 2, 3, 4]);
  assert.equal(s[0].purpose, 'seo_theme');
  assert.equal(s[0].seoTheme, 'Bathroom renovation ideas');
  assert.equal(s[1].purpose, 'service');
  assert.equal(s[2].purpose, 'local');
  assert.equal(s[3].purpose, 'seo_theme', 'no offer, no festival → next SEO theme (never a forced offer)');
  assert.ok(s.every((x) => x.purpose !== 'offer' && x.purpose !== 'festival'));
  assert.ok(s.every((x) => x.seoPlanId === 'plan1'));
});

test('case 23/24: measured vs proposed keyword is carried per slot', () => {
  const s = planWeeklySlots({ facts: facts(), plan: plan(), weekIndex: 0, offer: null, festivals: [] });
  assert.equal(s[0].keyword, 'bathroom renovation nashik');
  assert.equal(s[0].keywordMeasured, true);
  assert.equal(s[0].keywordSource, 'measured');
  assert.equal(s[3].keyword, 'floor tiles nashik');
  assert.equal(s[3].keywordMeasured, false);
  assert.equal(s[3].keywordSource, 'proposed');
  assert.deepEqual(keywordInfo('something the AI made up', plan()), { keyword: 'something the AI made up', keywordSource: 'proposed', keywordMeasured: false });
  assert.equal(s[2].keyword, 'tile contractor nashik', 'local slot uses a measured city keyword');
});

test('SEO themes rotate week to week (plan sequence), stable for the same week', () => {
  const w0 = planWeeklySlots({ facts: facts(), plan: plan(), weekIndex: 0, offer: null, festivals: [] });
  const w1 = planWeeklySlots({ facts: facts(), plan: plan(), weekIndex: 1, offer: null, festivals: [] });
  assert.notEqual(w0[0].seoTheme, w1[0].seoTheme);
  assert.deepEqual(planWeeklySlots({ facts: facts(), plan: plan(), weekIndex: 1, offer: null, festivals: [] }), w1);
});

test('case 2/17: weak or missing service data → education, never an invented service', () => {
  const s = planWeeklySlots({ facts: facts({ ownerServices: [], websiteServices: [] }), plan: plan({ themes: [] }), weekIndex: 0, offer: null, festivals: [] });
  assert.ok(s.every((x) => !x.service), 'no service invented');
  assert.equal(s[0].purpose, 'education');
  assert.equal(s[1].purpose, 'education');
  assert.equal(s[3].purpose, 'education');
});

test('case 3/30: no website → only verified business facts; no source-claim evidence', () => {
  const s = planWeeklySlots({ facts: facts({ website: '', websiteServices: [], websiteDescription: null }), plan: plan(), weekIndex: 0, offer: null, festivals: [] });
  assert.ok(s.flatMap((x) => x.evidence).every((e) => e.state !== 'SOURCE_CLAIM'));
});

test('website services are carried as SOURCE_CLAIM with the page URL', () => {
  const s = planWeeklySlots({ facts: facts({ ownerServices: [] }), plan: plan({ themes: [] }), weekIndex: 0, offer: null, festivals: [] });
  const e = s[0].evidence.find((x) => x.label === 'Service: Kitchen tiling');
  assert.equal(e?.state, 'SOURCE_CLAIM');
  assert.equal(e?.sourceUrl, 'https://mulsetu.example/services');
});

test('case 12: festival week → festival greeting in slot 4 from the calendar', () => {
  const diwali = { key: 'diwali-2026', name: 'Diwali', date: '2026-11-08' };
  const s = planWeeklySlots({ facts: facts(), plan: plan(), weekIndex: 0, offer: null, festivals: [diwali] });
  assert.equal(s[3].purpose, 'festival');
  assert.equal(s[3].festival?.key, 'diwali-2026');
  assert.equal(s[3].evidence.at(-1)?.state, 'CALENDAR');
});

test('case 9: owner offer → slot 4 is the offer, owner words verbatim', () => {
  const s = planWeeklySlots({ facts: facts(), plan: plan(), weekIndex: 0, offer: { text: '10% off tile installation booked this week' }, festivals: [] });
  assert.equal(s[3].purpose, 'offer');
  assert.equal(s[3].offerText, '10% off tile installation booked this week');
  assert.equal(s[3].evidence.at(-1)?.state, 'OWNER_CONFIRMED');
});

test('case 32: festival + owner offer — offer for the festival stays one post; unrelated festival moves to slot 3', () => {
  const diwali = { key: 'diwali-2026', name: 'Diwali', date: '2026-11-08' };
  const tied = planWeeklySlots({ facts: facts(), plan: plan(), weekIndex: 0, offer: { text: 'Diwali: free site visit', festivalName: 'Diwali' }, festivals: [diwali] });
  assert.equal(tied[3].purpose, 'offer');
  assert.equal(tied[3].festival?.key, 'diwali-2026');
  assert.equal(tied.filter((x) => x.purpose === 'festival').length, 0, 'no second festival post');
  const both = planWeeklySlots({ facts: facts(), plan: plan(), weekIndex: 0, offer: { text: 'Free site visit this week' }, festivals: [diwali] });
  assert.deepEqual(both.map((x) => x.purpose), ['seo_theme', 'service', 'festival', 'offer']);
  assert.equal(both.length, 4, 'still POSTS_PER_WEEK');
});

test('IST week key and week start', () => {
  assert.equal(contentWeekKey(new Date('2026-09-27T19:00:00Z')), '2026-W40', 'Mon 00:30 IST belongs to the new week');
  assert.equal(contentWeekKey(new Date('2026-09-27T18:00:00Z')), '2026-W39', 'Sun 23:30 IST is still the old week');
  assert.equal(contentWeekStart(new Date('2026-10-01T10:00:00Z')).toISOString(), '2026-09-27T18:30:00.000Z');
});

// ── Evidence gate (case 18) ────────────────────────────────────────────────

test('case 18: unsupported claims are rejected, each with a reason', () => {
  const cases: Array<[string, RegExp]> = [
    ['Mulsetu Tiles is the best tile contractor in Nashik.', /superlative/],
    ['Rated 4.9 stars by our customers.', /rating/],
    ['Over 15 years of experience in Nashik.', /years of experience/],
    ['500+ happy customers trust us.', /customer\/project count/],
    ['Our certified team handles every job.', /award \/ credential/],
    ['Guaranteed results on every bathroom.', /guarantee/],
    ['Get 20% off this Diwali!', /percentage|offer/],
    ['Book a free consultation today.', /offer \/ discount/],
    ['Call +91 91111 22222 now.', /phone number/],
    ['Visit othersite.com for details.', /link not the business/],
    ['Your trusted tile contractor on Gangapur Road.', /reputation claim/],
    ['Using the keyword bathroom renovation nashik helps homeowners find us.', /SEO meta-language/],
    ['When you search for tile contractor nashik, you will find us.', /SEO meta-language/],
  ];
  for (const [body, why] of cases) {
    const r = validatePost({ title: 'Tile installation in Nashik', body }, ev());
    assert.equal(r.ok, false, body);
    assert.ok(r.reasons.some((x) => why.test(x)), `${body} → ${r.reasons.join(' | ')}`);
  }
});

test('case 18: a factual post passes; the verb "offer" is not an offer', () => {
  const r = validatePost({ title: 'Bathroom renovation in Nashik', body: 'Mulsetu Tiles offers tile installation and bathroom renovation on Gangapur Road, Nashik. Call +91 98765 43210 or visit mulsetu.example to discuss your project.', cta: 'Call now' }, ev());
  assert.deepEqual(r, { ok: true, reasons: [] });
});

test('offer language only when it is the owner\'s own offer', () => {
  const body = 'This week: 10% off tile installation booked before Friday.';
  assert.equal(validatePost({ title: 'This week', body }, ev()).ok, false);
  assert.equal(validatePost({ title: 'This week', body }, ev({ offerText: '10% off tile installation booked before Friday' })).ok, true);
});

test('festival words outside a festival slot are rejected', () => {
  assert.equal(validatePost({ title: 'Tile installation', body: 'Get your home ready for Diwali with new tiles.' }, ev()).ok, false);
  assert.equal(validatePost({ title: 'Happy Diwali', body: 'Mulsetu Tiles wishes everyone a happy Diwali.' }, ev({ festivalName: 'Diwali' })).ok, true);
});

test('a claim that IS in the evidence passes (website says it)', () => {
  const r = validatePost({ title: 'Tile installation', body: 'Mulsetu Tiles has 12 years of experience in tile installation.' }, ev({ evidenceText: ev().evidenceText + ' | 12 years of experience' }));
  assert.equal(r.ok, true, r.reasons.join(' | '));
});

// ── Templates (case 14: AI failure → safe template, not fake content) ──────

test('case 14: template posts use only verified facts and pass the gate', () => {
  const slots = planWeeklySlots({ facts: facts(), plan: plan(), weekIndex: 0, offer: { text: 'Free site visit this week' }, festivals: [{ key: 'diwali-2026', name: 'Diwali', date: '2026-11-08' }] });
  for (const s of slots) {
    const t = templatePost(s, facts());
    const r = validatePost(t, ev({ offerText: s.offerText ?? null, festivalName: s.festival?.name ?? null }));
    assert.equal(r.ok, true, `${s.purpose}: ${r.reasons.join(' | ')}`);
  }
  assert.equal(templatePost(slots[3], facts()).body, 'Free site visit this week', 'offer text verbatim');
});

// ── Brand (cases 7, 8, 4) ──────────────────────────────────────────────────

test('case 7: manual colours win over logo and website', () => {
  const b = resolveBrand({ manualColors: ['#AA0000'], logoColors: ['#00aa00'], websiteColors: ['#0000aa'] });
  assert.deepEqual(b.colors, ['#aa0000']);
  assert.equal(b.colorSource, 'manual');
});

test('case 8/4: logo > website > theme > neutral; invalid hex ignored', () => {
  assert.equal(resolveBrand({ logoColors: ['#00aa00'], websiteColors: ['#0000aa'] }).colorSource, 'logo');
  const w = resolveBrand({ websiteColors: ['#0000aa', 'red', '#12'], sourceUrl: 'https://mulsetu.example/' });
  assert.deepEqual(w.colors, ['#0000aa']);
  assert.equal(w.colorSource, 'website');
  assert.equal(w.sourceUrl, 'https://mulsetu.example/');
  assert.equal(resolveBrand({ themeColors: ['#123456'] }).colorSource, 'theme');
  assert.deepEqual(resolveBrand({}).colors, NEUTRAL_COLORS);
  assert.equal(resolveBrand({}).colorSource, 'default');
});

// ── Image choice (cases 5, 6, 15) ──────────────────────────────────────────
// Oct 2026 requirement: autopilot generates a NEW image per post by default;
// Photos are used only on an explicit owner choice.

test('case 5: owning Photos never makes autopilot pick one — a new AI image is the default', () => {
  const s = planWeeklySlots({ facts: facts(), plan: plan(), weekIndex: 0, offer: null, festivals: [] });
  const photos = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, url: `https://x/p${i}.jpg` }));
  for (const slot of s) assert.deepEqual(chooseImageSource(slot, { customerPhotos: photos, imageGenerationAvailable: true }), { kind: 'generate' });
  assert.deepEqual(
    chooseImageSource(s[0], { customerPhotos: photos, ownerSelectedPhotoId: 'p3', imageGenerationAvailable: true }),
    { kind: 'customer_photo', assetId: 'p3', url: 'https://x/p3.jpg' },
    'only an explicit owner choice uses a Photos image',
  );
});

test('case 6/15: no generation available → branded graphic, never a customer or website photo', () => {
  const s = planWeeklySlots({ facts: facts(), plan: plan(), weekIndex: 0, offer: null, festivals: [] });
  const photos = [{ id: 'a', url: 'https://x/a.jpg' }];
  assert.equal(chooseImageSource(s[0], { customerPhotos: [], imageGenerationAvailable: true }).kind, 'generate');
  assert.equal(chooseImageSource(s[0], { customerPhotos: photos, imageGenerationAvailable: false }).kind, 'branded_graphic');
});

test('festival slots get a generated image; offer slot uses the photo the owner chose for the offer', () => {
  const photos = [{ id: 'a', url: 'https://x/a.jpg' }, { id: 'o', url: 'https://x/o.jpg' }];
  const fest = planWeeklySlots({ facts: facts(), plan: plan(), weekIndex: 0, offer: null, festivals: [{ key: 'diwali-2026', name: 'Diwali', date: '2026-11-08' }] })[3];
  assert.equal(chooseImageSource(fest, { customerPhotos: photos, imageGenerationAvailable: true }).kind, 'generate');
  assert.equal(chooseImageSource(fest, { customerPhotos: photos, imageGenerationAvailable: false }).kind, 'branded_graphic');
  const offer = planWeeklySlots({ facts: facts(), plan: plan(), weekIndex: 0, offer: { text: 'Free site visit' }, festivals: [] })[3];
  assert.deepEqual(chooseImageSource(offer, { customerPhotos: photos, offerImageId: 'o', imageGenerationAvailable: true }), { kind: 'customer_photo', assetId: 'o', url: 'https://x/o.jpg' });
  assert.deepEqual(chooseImageSource(offer, { customerPhotos: photos, imageGenerationAvailable: true }), { kind: 'generate' }, 'no owner photo → new image');
});

test('image prompt forbids text, logos, claims and invented people/projects', () => {
  const s = planWeeklySlots({ facts: facts(), plan: plan(), weekIndex: 0, offer: null, festivals: [] })[1];
  const p = buildImagePrompt(s, facts(), ['#aa0000']).toLowerCase();
  for (const w of ['text', 'logo', 'rating', 'real employee or customer', 'finished project', 'discounts', 'awards']) assert.ok(p.includes(w), w);
  assert.ok(p.includes('#aa0000'));
});

// ── Festival calendar (dated, not AI) ──────────────────────────────────────

test('festival calendar: stored dates, unique keys, window lookup in IST', () => {
  assert.equal(new Set(FESTIVALS.map((f) => f.key)).size, FESTIVALS.length);
  assert.ok(FESTIVALS.every((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.date)));
  assert.deepEqual(festivalsBetween(new Date('2026-11-02T04:00:00Z'), 8).map((f) => f.key), ['diwali-2026']);
  assert.deepEqual(festivalsBetween(new Date('2026-08-01T04:00:00Z'), 5), [], 'non-festival week');
  assert.ok(calendarCoversUntil() >= '2027-12-31');
});

// ── Monthly content activity (cases 25, 26, 27, 28, 29) ────────────────────

const rows = [
  { status: 'published', liveWriteApplied: true, contentMeta: { purpose: 'seo_theme', seoPlanId: 'p', seoTheme: 'Bathroom renovation ideas', service: 'Bathroom renovation', keyword: 'bathroom renovation nashik', keywordMeasured: true, imageSource: 'customer_photo' } },
  { status: 'published', liveWriteApplied: true, contentMeta: { purpose: 'festival', seoPlanId: 'p', festivalName: 'Diwali', imageSource: 'branded_graphic' } },
  { status: 'published', liveWriteApplied: false, contentMeta: { purpose: 'service', seoPlanId: 'p' } }, // old mock-published row: not on Google
  { status: 'blocked', contentMeta: { purpose: 'local', seoPlanId: 'p' } },
  { status: 'failed', contentMeta: { purpose: 'offer', seoPlanId: 'p' } },
  { status: 'draft', contentMeta: { purpose: 'education', seoPlanId: 'p' } },
];

test('case 25/26: content activity counts only Google-confirmed posts as published', () => {
  const c = summarizeContent(rows);
  assert.equal(c.planned, 6);
  assert.equal(c.published, 2);
  assert.equal(c.blocked, 1);
  assert.equal(c.failed, 1);
  assert.equal(c.drafts, 1);
  assert.deepEqual(c.publishedByPurpose, { seo_theme: 1, festival: 1 });
  assert.deepEqual(c.servicesCovered, ['Bathroom renovation']);
  assert.deepEqual(c.seoPlanPosts, { planned: 6, published: 2 });
  assert.equal(c.customerPhotosUsed, 1);
  const lines = contentActivityLines(c).join('\n');
  assert.match(lines, /published to Google: 2/);
  assert.match(lines, /Not sent to Google \(live publishing was off\): 1/);
  assert.match(lines, /Google rejected: 1/);
  assert.doesNotMatch(lines, /revenue|₹|leads? generated/i);
});

const baseEx = (over: Partial<ExecutionRecords> = {}): ExecutionRecords => ({ profileEdits: [], photos: [], posts: [], replies: [], reviewRequests: { sent: 0, failed: 0, sentAt: [] }, newReviews: [], ...over });

test('monthly report carries contentActivity (null when no engine posts were due)', () => {
  const common = { periodStart: '2026-10-01', periodEnd: '2026-10-31', previousAuditId: 'a', baselineAuditId: 'a', prevData: {}, curData: {}, actions: [] };
  assert.equal(buildMonthlyReport({ ...common, executions: baseEx() }).contentActivity, null);
  assert.equal(buildMonthlyReport({ ...common, executions: baseEx({ content: summarizeContent(rows) }) }).contentActivity?.published, 2);
});

test('case 28/29: engagement compared only when both periods are measured', () => {
  const common = { periodStart: '2026-10-01', periodEnd: '2026-10-31', previousAuditId: 'a', baselineAuditId: 'a', actions: [], executions: baseEx() };
  const perf = (calls: number, month: string) => ({ status: 'verified', periodStart: `2026-${month}-01`, periodEnd: `2026-${month}-28`, calls, websiteClicks: 5, directionRequests: 2, profileViews: 100 });
  const up = buildMonthlyReport({ ...common, prevData: { performanceBaseline: perf(4, '09') }, curData: { performanceBaseline: perf(9, '10') } });
  const none = buildMonthlyReport({ ...common, prevData: {}, curData: {} });
  assert.equal(none.performance.status, 'unavailable');
  assert.equal(none.improved.length, 0, 'no improvement claimed without data');
  assert.equal(up.performance.status, 'compared');
  assert.ok(up.improved.some((l) => /^Calls: 4 → 9/.test(l)), up.improved.join(' | '));
});

test('case 27: a synced week with no new reviews says so and notifies once', () => {
  const input: WeeklyInput = {
    weekKey: '2026-W40',
    reviews: { newCount: 0, newAverageRating: null, unanswered: 0, ratingNow: 4.6, ratingWeekAgo: 4.6, syncedThisWeek: true, requestsSent: 0 },
    activity: { postsPublished: 0, photosPublished: 0, profileEditsApplied: 0, repliesPosted: 0 },
    ranking: null, plan: { blocked: 0, awaitingOwner: 0, overdue: 0 }, performance: null,
  };
  const s = buildWeeklySummary(input);
  assert.ok(s.lines.some((l) => /no new Google reviews/i.test(l)));
  assert.equal(s.notifications.filter((n) => n.type === 'weekly_no_new_reviews').length, 1);
  const notSynced = buildWeeklySummary({ ...input, reviews: { ...input.reviews, syncedThisWeek: false } });
  assert.equal(notSynced.notifications.filter((n) => n.type === 'weekly_no_new_reviews').length, 0, 'never claim "no reviews" when the sync did not run');
});

test('case 27: monthly report with no new reviews states zero, with no blame or invented cause', () => {
  const m = buildMonthlyReport({ periodStart: '2026-10-01', periodEnd: '2026-10-31', previousAuditId: 'a', baselineAuditId: 'a', prevData: {}, curData: {}, actions: [], executions: baseEx({ content: summarizeContent(rows) }) });
  assert.equal(m.reviews.newReviews, 0);
  assert.ok(!m.changes.some((c) => c.what === 'New Google reviews'), 'no review change row when nothing changed');
  const wa = composeMonthlyWhatsApp(m, 'Mulsetu Tiles', 'https://app.example.invalid/r');
  assert.match(wa, /New Google reviews: 0/);
  assert.doesNotMatch(wa, /unhappy|losing|revenue|₹/i);
});

test('monthly: images counted by origin — never calls a fallback or owner photo "AI-generated"', () => {
  const c = summarizeContent([
    { status: 'published', liveWriteApplied: true, contentMeta: { purpose: 'seo_theme', imageOrigin: 'AI_GENERATED', imageSource: 'generate' } },
    { status: 'published', liveWriteApplied: true, contentMeta: { purpose: 'service', imageOrigin: 'FALLBACK', imageSource: 'branded_graphic' } },
    { status: 'published', liveWriteApplied: true, contentMeta: { purpose: 'offer', imageOrigin: 'OWNER_SELECTED', imageSource: 'customer_photo' } },
    { status: 'published', liveWriteApplied: true, contentMeta: { purpose: 'local', imageSource: 'customer_photo' } }, // legacy auto-picked photo
    { status: 'blocked', contentMeta: { purpose: 'local', imageOrigin: 'AI_GENERATED' } }, // never reached Google
  ]);
  assert.deepEqual(c.images, { aiGenerated: 1, ownerSelected: 1, fallback: 1 });
  assert.equal(c.customerPhotosUsed, 1, 'legacy auto-picked photo stays in its own line');
  const line = contentActivityLines(c).find((l) => l.startsWith('Post images'))!;
  assert.equal(line, 'Post images: 1 new AI-generated, 1 photo you chose, 1 branded graphic (AI image unavailable)');
});
