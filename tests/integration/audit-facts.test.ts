/**
 * Unit tests for the audit engine's facts / findings / validation layer
 * (src/services/audit/{facts,findings,validateAudit}.ts) — pure functions,
 * no DB, no network, no `@/` aliases.
 *
 * Covers the Sep 2026 correctness rules: Not Found is null (never 21),
 * provider failure is "unavailable" (never 20+), averages exclude Not Found,
 * competitors ahead are real deduped businesses, lifetime vs recent reviews,
 * unknown ≠ missing, evidence-backed findings and labels, AI grounding.
 *
 * Run with: node --test tests/integration/audit-facts.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildObservation,
  summarizeRankings,
  summarizeByKeyword,
  competitorsFromObservations,
  competitorsAhead,
  buildReviewFacts,
  compareReviews,
  profileFieldStates,
  suspensionRiskHeuristic,
  formatObservedRank,
  reviewSampleSize,
  type SearchObservation,
} from '../../src/services/audit/facts.ts';
import {
  buildEvidenceAndFindings,
  opportunityLabel,
  selectOpportunities,
  isCustomerIssue,
  GROWWMATICS_CAPABILITIES,
  type KeywordRow,
} from '../../src/services/audit/findings.ts';
import { validateAudit, groundItems, allowedNumbersFrom, groundText } from '../../src/services/audit/validateAudit.ts';

const biz = (name: string, placeId?: string, extra: Record<string, unknown> = {}) => ({ name, placeId, ...extra });

function obs(keyword: string, names: string[], targetPos: number | null, kind: 'primary' | 'nearby' = 'primary'): SearchObservation {
  return buildObservation({
    keyword,
    kind,
    results: names.map((n) => biz(n, `pid-${n}`, { rating: 4.5, reviewCount: 100 })),
    targetPosition: targetPos,
  });
}

// ── D / E / F / G / H / I: ranking ──────────────────────────────────────────

test('D: not found is found:false, rank:null — never 21', () => {
  const o = obs('dentist pune', ['A', 'B', 'C'], null);
  assert.equal(o.found, false);
  assert.equal(o.rank, null);
  assert.equal(o.status, 'ok');
  assert.equal(formatObservedRank(o.found, o.rank), '20+');
});

test('D: a position beyond 20 is not found (display window), rank stays null', () => {
  const names = Array.from({ length: 30 }, (_, i) => `B${i}`);
  const o = obs('kw', names, 25);
  assert.equal(o.found, false);
  assert.equal(o.rank, null);
  assert.equal(o.ahead.length, 10, 'top 10 kept as businesses ahead');
});

test('E: provider failure is unavailable — not found, not 20+, no competitors', () => {
  const o = buildObservation({ keyword: 'kw', kind: 'primary', results: null, targetPosition: null });
  assert.equal(o.status, 'unavailable');
  assert.equal(o.ahead.length, 0);
  assert.equal(formatObservedRank(o.found, o.rank, o.status), 'Unavailable');
  const s = summarizeRankings([o, o]);
  assert.equal(s.status, 'unavailable');
  assert.equal(s.testedCount, 0);
  assert.equal(s.averageObservedRank, null);
  assert.equal(s.visibilityRate, null, 'no rate from zero valid searches');
});

test('F/G/H/I: average excludes not found; visibility, top3, top5 separate', () => {
  const s = summarizeRankings([
    obs('k', ['A', 'B'], 3),
    obs('k', Array.from({ length: 7 }, (_, i) => `X${i}`), 8),
    obs('k', ['A'], null),
    obs('k', ['A'], null),
  ]);
  assert.equal(s.averageObservedRank, 5.5, '(3 + 8) / 2, not (3+8+21+21)/4');
  assert.equal(s.testedCount, 4);
  assert.equal(s.foundCount, 2);
  assert.equal(s.visibilityRate, 0.5);
  assert.equal(s.notFoundRate, 0.5);
  assert.equal(s.top3Count, 1);
  assert.equal(s.top3Rate, 0.25);
  assert.equal(s.top5Count, 1);
  assert.equal(s.top5Rate, 0.25);
});

test('F: failed searches are excluded from the denominator (partial)', () => {
  const failed = buildObservation({ keyword: 'k', kind: 'primary', results: null, targetPosition: null });
  const s = summarizeRankings([obs('k', [], 1), failed]);
  assert.equal(s.status, 'partial');
  assert.equal(s.testedCount, 1);
  assert.equal(s.top5Rate, 1);
});

// ── J / K / L: competitors ─────────────────────────────────────────────────

test('J/K: competitors ahead are unique real businesses (spec example → 3)', () => {
  // Search 1: A #2, B #5, target #14 · Search 2: A #1, target #3 · Search 3: B #4, C #6, target #10
  const s1 = buildObservation({
    keyword: 'k1', kind: 'primary', targetPosition: 14,
    results: [biz('P1', 'p1'), biz('A', 'a'), biz('P3', 'p3'), biz('P4', 'p4'), biz('B', 'b'), ...Array.from({ length: 8 }, (_, i) => biz(`F${i}`, `f${i}`)), biz('Target', 't')],
  });
  const s2 = buildObservation({ keyword: 'k2', kind: 'primary', targetPosition: 3, results: [biz('A', 'a'), biz('Q', 'q'), biz('Target', 't')] });
  const s3 = buildObservation({
    keyword: 'k3', kind: 'primary', targetPosition: 10,
    results: [biz('R1', 'r1'), biz('R2', 'r2'), biz('R3', 'r3'), biz('B', 'b'), biz('R5', 'r5'), biz('C', 'c'), biz('R7', 'r7'), biz('R8', 'r8'), biz('R9', 'r9'), biz('Target', 't')],
  });
  const comps = competitorsFromObservations([s1, s2, s3]);
  const a = comps.find((c) => c.name === 'A')!;
  const b = comps.find((c) => c.name === 'B')!;
  assert.equal(a.searchesAhead, 2);
  assert.equal(b.searchesAhead, 2);
  assert.ok(comps.find((c) => c.name === 'C'));
  // Unique place ids, no double counting across searches.
  assert.equal(new Set(comps.map((c) => c.key)).size, comps.length);
  assert.equal(competitorsAhead([s1, s2, s3]).count, comps.length);
  assert.ok(!comps.some((c) => c.name === 'Target'), 'target excluded');
});

test('K: dedupe by place id even when names differ; name fallback when no id', () => {
  const s1 = buildObservation({ keyword: 'k', kind: 'primary', targetPosition: 3, results: [biz('Joe Pizza', 'x1'), biz('Anna Cafe'), biz('T', 't')] });
  const s2 = buildObservation({ keyword: 'k2', kind: 'primary', targetPosition: 3, results: [biz("Joe's Pizza Ltd", 'x1'), biz('anna cafe'), biz('T', 't')] });
  const comps = competitorsFromObservations([s1, s2]);
  assert.equal(comps.length, 2);
  assert.ok(comps.every((c) => c.searchesAhead === 2));
});

test('L: competitor metrics are sourced, never fabricated', () => {
  const o = buildObservation({ keyword: 'k', kind: 'primary', targetPosition: 2, results: [biz('A', 'a', { rating: 4.7, reviewCount: 842, category: 'Dentist' }), biz('T', 't')] });
  const [c] = competitorsFromObservations([o]);
  assert.equal(c.rating, 4.7);
  assert.equal(c.reviewCount, 842);
  assert.equal(c.category, 'Dentist');
  assert.equal(c.similarityScore, null);
  assert.equal(c.source, 'dataforseo');
  const bare = buildObservation({ keyword: 'k', kind: 'primary', targetPosition: 2, results: [biz('B'), biz('T')] });
  const [cb] = competitorsFromObservations([bare]);
  assert.equal(cb.rating, null, 'unknown stays null');
  assert.equal(cb.category, null, 'never copied from the target');
});

test('K: isTarget guard removes the target from its own competitor list', () => {
  const o = buildObservation({
    keyword: 'k', kind: 'primary', targetPosition: null, results: [biz('A', 'a'), biz('Mulsetu Pvt Ltd', 'm2')],
    isTarget: (r) => r.name.toLowerCase().includes('mulsetu'),
  });
  assert.deepEqual(o.ahead.map((r) => r.name), ['A']);
});

// ── A / B / C: reviews ─────────────────────────────────────────────────────

test('A/B/C: lifetime total and recent window are separate', () => {
  const r = buildReviewFacts(
    { count: 500, rating: 4.6, source: 'serpapi' },
    { periodDays: 14, synced: true, reviews: [{ rating: 5, hasReply: true, sentiment: 'positive', text: 'Great service, very professional team' }, { rating: 4, hasReply: false }] },
  );
  assert.equal(r.lifetime.totalCount, 500, 'total reviews = lifetime, not the 14-day count');
  assert.equal(r.lifetime.rating, 4.6);
  assert.equal(r.recent.newReviewCount, 2);
  assert.equal(r.recent.reviewsPerWeek, 1, '2 reviews / 2 weeks');
  assert.equal(r.recent.responseRate, 0.5);
  assert.equal(r.recent.textSampleCount, 1);
});

test('velocity is unknown without a synced window — never 0.5', () => {
  const r = buildReviewFacts({ count: 3, rating: 5, source: 'google_places' }, { periodDays: 14, synced: false, reviews: [] });
  assert.equal(r.recent.reviewsPerWeek, null);
  assert.equal(r.recent.responseRate, null);
  assert.equal(r.recent.newReviewCount, null);
  const one = buildReviewFacts(null, { periodDays: 14, synced: true, reviews: [{ rating: 5, hasReply: false }] });
  assert.equal(one.recent.reviewsPerWeek, 0.5, '1 review over a real 14-day window');
  assert.equal(one.lifetime.status, 'unknown');
});

test('sample size is descriptive; 5.0★ from 3 reviews is very_small', () => {
  assert.equal(reviewSampleSize(3), 'very_small');
  assert.equal(reviewSampleSize(0), 'none');
  assert.equal(reviewSampleSize(842), 'large');
  assert.equal(reviewSampleSize(null), null);
});

// ── M: unknown profile fields ──────────────────────────────────────────────

test('M: Unknown stays unknown and never becomes a finding', () => {
  const fields = profileFieldStates([
    { field: 'Phone', status: 'Missing' },
    { field: 'Business Description', status: 'Unknown' },
    { field: 'Website', status: 'Complete' },
  ]);
  assert.equal(fields['Business Description'], 'unknown');
  const { findings } = buildEvidenceAndFindings(baseInput({ fields }));
  assert.ok(findings.some((f) => f.id === 'profile.phone.missing'));
  assert.ok(!findings.some((f) => f.id.includes('business_description')), 'unknown description is not a problem');
});

// ── N / O / T: findings, actionability, no false causation ─────────────────

test('O: every finding has evidence and valid actionability; capability only if verified', () => {
  const { findings, evidence } = buildEvidenceAndFindings(baseInput({}));
  const ids = new Set(evidence.map((e) => e.id));
  assert.ok(findings.length > 0);
  for (const f of findings) {
    assert.ok(f.evidenceIds.length > 0 && f.evidenceIds.every((id) => ids.has(id)), `${f.id} evidence`);
    assert.ok(['directly_fixable', 'indirectly_influenceable', 'monitor_only', 'not_actionable', 'unknown'].includes(f.actionability));
    if (f.growwmaticsCapability) assert.ok(f.growwmaticsCapability in GROWWMATICS_CAPABILITIES);
  }
  const hours = buildEvidenceAndFindings(baseInput({ fields: { 'Business Hours': 'verified_missing' } })).findings.find((x) => x.id === 'profile.business_hours.missing')!;
  assert.equal(hours.growwmaticsCapability, null, 'GrowwMatics cannot write hours — not sold as a GrowwMatics fix');
});

test('T: review gap is stated as a comparison, never as the cause of ranking', () => {
  const { findings } = buildEvidenceAndFindings(baseInput({}));
  const gap = findings.find((f) => f.id === 'reviews.volume_gap')!;
  assert.ok(gap, 'review gap found vs competitors ahead');
  const text = `${gap.title} ${gap.evidence} ${gap.businessImpact}`.toLowerCase();
  assert.ok(!/\b(because|causes?|why you rank|ranks? poorly)\b/.test(text), text);
});

test('E: provider failure yields a data_quality finding, not a business problem', () => {
  const failed = buildObservation({ keyword: 'k', kind: 'primary', results: null, targetPosition: null });
  const { findings } = buildEvidenceAndFindings(baseInput({ primary: [failed, failed, failed] }));
  const dq = findings.find((f) => f.id === 'data_quality.ranking_unavailable')!;
  assert.ok(dq);
  assert.equal(isCustomerIssue(dq), false);
  assert.ok(!findings.some((f) => f.category === 'ranking'));
});

test('suspension risk is a heuristic category with reasons — no percentage', () => {
  const low = suspensionRiskHeuristic({ selfPraiseTerm: null });
  assert.equal(low.level, 'Low');
  assert.ok(!('pct' in low));
  const med = suspensionRiskHeuristic({ selfPraiseTerm: 'best' });
  assert.equal(med.level, 'Medium');
  assert.equal(med.reasons.length, 1);
  // A long real name is not evidence of keyword stuffing.
  assert.ok(!med.reasons.some((r) => /words/.test(r)));
});

test('opportunity labels require live demand + measured rank', () => {
  const row = (o: Partial<KeywordRow>): KeywordRow => ({ keyword: 'k', volumeBand: 'HIGH', estimated: false, searchVolume: 1500, status: 'ok', found: false, rank: null, ...o });
  assert.equal(opportunityLabel(row({ estimated: true })), null, 'estimated demand cannot earn a label');
  assert.equal(opportunityLabel(row({ status: 'unavailable' })), null);
  assert.equal(opportunityLabel(row({})), 'HIGHEST POTENTIAL');
  assert.equal(opportunityLabel(row({ found: true, rank: 6 })), 'IMMEDIATE WIN');
  assert.equal(opportunityLabel(row({ volumeBand: 'LOW' })), null);
  assert.equal(selectOpportunities([row({ estimated: true }), row({ volumeBand: 'NICHE' })]).length, 0, 'no evidence → no labels');
});

// ── N: AI grounding ────────────────────────────────────────────────────────

test('N: AI items citing numbers not in the facts are dropped', () => {
  const allowed = allowedNumbersFrom({ reviews: 3, rating: 5, rank: 14, visibility: 0.4 });
  const { kept, dropped } = groundItems(
    [
      { title: 'Excellent rating', evidence: '5★ from 3 reviews' },
      { title: 'Ranks well', evidence: 'Visible in 40% of searches, rank #14' },
      { title: 'Busy clinic', evidence: 'Serves 1200 patients a month' },
    ],
    ['title', 'evidence'],
    allowed,
  );
  assert.equal(kept.length, 2);
  assert.equal(dropped.length, 1);
  assert.equal(groundText('Over 250 happy customers', allowed), undefined);
});

// ── Mulsetu regression (§48) ───────────────────────────────────────────────

test('Mulsetu regression: 5.0★/3 reviews, 88%, ranks #14, #1, 20+, 20+, 20+', () => {
  const ahead13 = Array.from({ length: 13 }, (_, i) => biz(`Comp ${i + 1}`, `c${i + 1}`, { rating: 4.5 + (i % 5) / 10, reviewCount: 40 + i * 30 }));
  const primary = [
    buildObservation({ keyword: 'mulsetu kw', kind: 'primary', results: [...ahead13, biz('Mulsetu', 'mul')], targetPosition: 14 }),
    buildObservation({ keyword: 'mulsetu kw', kind: 'primary', results: [biz('Mulsetu', 'mul'), biz('Comp 1', 'c1')], targetPosition: 1 }),
    buildObservation({ keyword: 'mulsetu kw', kind: 'primary', results: ahead13.slice(0, 12), targetPosition: null }),
  ];
  const nearby = [
    buildObservation({ keyword: 'mulsetu area a', kind: 'nearby', results: ahead13.slice(2, 12), targetPosition: null }),
    buildObservation({ keyword: 'mulsetu area b', kind: 'nearby', results: ahead13.slice(0, 5), targetPosition: null }),
  ];
  const all = [...primary, ...nearby];
  const summary = summarizeRankings(all);
  // 9–13: #14 and #1 kept as-is, 20+ internally not found and excluded from the average.
  assert.equal(primary[0].rank, 14);
  assert.equal(primary[1].rank, 1);
  assert.deepEqual(all.filter((o) => !o.found).map((o) => o.rank), [null, null, null]);
  assert.equal(summary.averageObservedRank, 7.5, '(14 + 1) / 2');
  assert.equal(summary.visibilityRate, 0.4, 'visibility reported separately: 2 of 5');

  // 1–3: rating and lifetime count preserved and separate.
  const reviews = buildReviewFacts({ count: 3, rating: 5.0, source: 'google_places' }, { periodDays: 14, synced: false, reviews: [] });
  assert.equal(reviews.lifetime.rating, 5.0);
  assert.equal(reviews.lifetime.totalCount, 3);
  assert.equal(reviews.lifetime.sampleSize, 'very_small');

  // 4–8: real competitors, real metrics, ahead = actual businesses.
  const comps = competitorsFromObservations(all);
  const ahead = competitorsAhead(all);
  assert.equal(ahead.count, comps.length);
  assert.equal(ahead.count, 13, 'unique businesses above Mulsetu, not averageRank − 1');
  assert.ok(comps.every((c) => c.placeId && c.rating != null && c.reviewCount != null));

  // 14–15: phone verified missing stays an issue; unknown fields stay unknown. 7/8 = 88%.
  const fields = profileFieldStates([
    ...['Business Name', 'Primary Category', 'Address', 'Website', 'Service Area', 'Business Photos', 'Business Hours'].map((f) => ({ field: f, status: 'Complete' })),
    { field: 'Phone', status: 'Missing' },
    ...['Additional Keywords', 'Business Description', 'Services Listed', 'Social Links', 'Videos', 'Logo / Cover Image', 'Attributes', 'Booking / Appointment Link'].map((f) => ({ field: f, status: 'Unknown' })),
  ]);
  const present = Object.values(fields).filter((s) => s === 'verified_present').length;
  const missingN = Object.values(fields).filter((s) => s === 'verified_missing').length;
  assert.equal(Math.round((present / (present + missingN)) * 100), 88);

  const cmp = compareReviews(reviews, comps);
  const { findings, evidence } = buildEvidenceAndFindings({
    ...baseInput({}),
    fields,
    primaryRanking: summarizeRankings(primary),
    nearbyRanking: summarizeRankings(nearby),
    nearbyByKeyword: summarizeByKeyword(nearby),
    competitors: comps,
    competitorsAhead: ahead,
    reviews,
    reviewComparison: cmp,
    keywordRows: [],
    title: { name: 'Mulsetu', selfPraiseTerm: null, wordCount: 1 },
    primaryKeyword: 'mulsetu kw',
  });
  assert.ok(findings.some((f) => f.id === 'profile.phone.missing'), 'phone remains a profile issue');
  assert.ok(!findings.some((f) => /description|services|attributes|hours/i.test(f.id)), 'no issues for unknown fields');
  // 22–23: every priority item has evidence + actionability.
  const ids = new Set(evidence.map((e) => e.id));
  assert.ok(findings.every((f) => f.evidenceIds.every((id) => ids.has(id)) && f.actionability));
  // Review gap is a comparison, not "ranks poorly because of 3 reviews".
  const gap = findings.find((f) => f.id === 'reviews.volume_gap')!;
  assert.match(gap.evidence, /5★ from 3 reviews/);

  const v = validateAudit({
    targetName: 'Mulsetu',
    targetPlaceId: 'mul',
    observations: all,
    competitors: comps,
    competitorsAheadCount: ahead.count,
    averageObservedRank: summary.averageObservedRank,
    reviews,
    displayedReviewCount: 3,
    evidence,
    findings,
    reviewThemes: { praises: ['Friendly staff'], complaints: [] },
    suspensionRisk: suspensionRiskHeuristic({ selfPraiseTerm: null }),
    marketOpportunities: [{ keyword: 'made up', potential: 'HIGHEST POTENTIAL' }],
    keywordRows: [],
  });
  assert.equal(v.ok, true, v.errors.join('; '));
  assert.ok(v.repairs.some((r) => r.includes('review themes')), '21: no review insights without review text');
  assert.ok(v.repairs.some((r) => r.includes('opportunity')), 'unsupported label removed');
});

test('validateAudit catches a sentinel rank and a self-listed target', () => {
  const bad = obs('k', ['A'], 1);
  (bad as any).rank = 21;
  const v = validateAudit({
    targetName: 'Target Co',
    observations: [bad],
    competitors: [{ key: 'name:target', name: 'Target Co', placeId: null, cid: null, category: null, address: null, rating: null, reviewCount: null, searchesAhead: 1, aheadRate: 1, averageObservedRank: 1, bestObservedRank: 1, top5Count: 1, top3Count: 1, keywords: ['k'], website: null, phone: null, additionalCategories: null, hasHours: null, bookingUrl: null, isClaimed: null, appearances: 1, relevance: 'incidental', source: 'dataforseo', similarityScore: null }],
    competitorsAheadCount: 1,
    averageObservedRank: 21,
    reviews: buildReviewFacts(null, { periodDays: 14, synced: false, reviews: [] }),
    evidence: [],
    findings: [],
    suspensionRisk: { level: 'Low', reasons: [], basis: 'heuristic', pct: 45 },
    keywordRows: [],
  });
  assert.equal(v.ok, false, 'an impossible rank is unrepairable → audit must not complete');
  assert.ok(v.errors.some((e) => e.includes('outside')));
  assert.ok(v.repairs.some((r) => r.includes('removed the business itself')), 'self-listing is repaired, not shown');
  assert.ok(v.repairs.some((r) => r.includes('percentage')));
});

// ── helpers ────────────────────────────────────────────────────────────────

function baseInput(o: { fields?: Record<string, any>; primary?: SearchObservation[] }) {
  const primary = o.primary || [obs('dentist pune', ['A', 'B', 'C', 'D'], 5), obs('dentist pune', ['A', 'E'], null)];
  const comps = competitorsFromObservations(primary);
  const reviews = buildReviewFacts({ count: 12, rating: 4.8, source: 'google_places' }, { periodDays: 14, synced: false, reviews: [] });
  return {
    fields: o.fields || { Phone: 'verified_present', Website: 'verified_present' },
    title: { name: 'Smile Dental', selfPraiseTerm: null, wordCount: 2 },
    primaryKeyword: 'dentist pune',
    primaryRanking: summarizeRankings(primary),
    nearbyRanking: summarizeRankings([]),
    nearbyByKeyword: [],
    competitors: comps,
    competitorsAhead: competitorsAhead(primary),
    reviews,
    reviewComparison: compareReviews(reviews, comps),
    keywordRows: [],
    website: null,
    suspensionRisk: suspensionRiskHeuristic({ selfPraiseTerm: null }),
  } as any;
}

// ── P: cost calculation ────────────────────────────────────────────────────

test('P: per-audit cost at list price matches the traced call profiles', async () => {
  const { CALL_PROFILES, auditCostUsd, toInr } = await import('../../src/services/audit/costModel.ts');
  assert.equal(auditCostUsd(CALL_PROFILES.freeBefore), 0.3335);
  assert.equal(toInr(auditCostUsd(CALL_PROFILES.freeBefore)), 29.3);
  assert.ok(auditCostUsd(CALL_PROFILES.freeAfter) < auditCostUsd(CALL_PROFILES.freeBefore));
  assert.ok(auditCostUsd(CALL_PROFILES.dashboardAfter) < auditCostUsd(CALL_PROFILES.dashboardBefore));
  assert.ok(auditCostUsd(CALL_PROFILES.monthlyAfter) < auditCostUsd(CALL_PROFILES.monthlyBefore));
});

test('P: Google free monthly allowances apply per SKU at volume', async () => {
  const { volumeCostUsd } = await import('../../src/services/audit/costModel.ts');
  // 1,000 Text Search requests are inside the 5,000 free allowance.
  assert.equal(volumeCostUsd({ googleTextSearch: 1 }, 1000), 0);
  // 6,000 → 1,000 billable × $0.032.
  assert.equal(volumeCostUsd({ googleTextSearch: 1 }, 6000), 32);
  // DataForSEO has no free allowance.
  assert.equal(volumeCostUsd({ dataForSeoMapsLiveTask: 1 }, 100), 0.2);
});

// ── describeEvidence: evidence text is deterministic, never AI-written ─────

test('evidence descriptions come from values, not prose', () => {
  const { evidence } = buildEvidenceAndFindings(baseInput({}));
  const lifetime = evidence.find((e) => e.id === 'reviews.lifetime')!;
  return import('../../src/services/audit/findings.ts').then(({ describeEvidence }) => {
    assert.equal(describeEvidence(lifetime), '4.8★ from 12 Google reviews');
    const unavailable = { ...lifetime, status: 'unavailable' as const };
    assert.match(describeEvidence(unavailable), /unavailable/);
  });
});
