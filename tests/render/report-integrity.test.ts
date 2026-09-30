/**
 * FINAL AUDIT-INTEGRITY TEST — no customer-visible number or claim without
 * evidence, on every surface, including when each provider fails.
 *
 * Renders the Free Report, the Dashboard / connected report, the PDF HTML
 * and the WhatsApp messages from real stored audits (tests/fixtures/audits,
 * captured from live runs) and from provider-failure variants of them, then:
 *   • every number shown must trace to the audit's own data (evidence);
 *   • no fabricated rank / competitor / ROI / GBP claim / fallback number;
 *   • each failure shows its status text instead of a guessed value.
 *
 * Needs React + the app's `@/` paths, so it runs under tsx:
 *   npx tsx --test tests/render/report-integrity.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:1/render-integrity';
process.env.GROQ_API_KEY ||= 'render-integrity';

const FIXTURES = path.resolve('tests/fixtures/audits');
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// ── Rendering ──────────────────────────────────────────────────────────────

let R: any;
async function renderers() {
  if (R) return R;
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const FreeReportView = (await import('../../src/components/audit/FreeReportView')).default;
  const AuditReportGrexa = (await import('../../src/components/audit/AuditReportGrexa')).default;
  const { buildReportHtml } = await import('../../src/lib/pdf/reportHtml');
  const { extractReportScores, composeSummaryMessage } = await import('../../src/services/report/reportAgent');
  const { defaultReportAgentConfig } = await import('../../src/lib/reportAgentDefaults');
  const { extractScores, composeFirstMessage } = await import('../../src/services/sales/salesAgent');
  const { defaultSalesAgentConfig } = await import('../../src/lib/salesAgentDefaults');
  const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime' as string);
  const noop = () => {};
  const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop, hmrRefresh: noop };
  const render = (el: any) => renderToStaticMarkup(React.createElement(AppRouterContext.Provider, { value: router }, el));
  R = { React, render, FreeReportView, AuditReportGrexa, buildReportHtml, extractReportScores, composeSummaryMessage, defaultReportAgentConfig, extractScores, composeFirstMessage, defaultSalesAgentConfig };
  return R;
}

const strip = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<(path|svg|circle|rect|line|polyline)[^>]*>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

async function surfaces(fx: any) {
  const r = await renderers();
  const audit: any = { _id: 'fixture', businessName: fx.businessName, location: fx.location, status: 'COMPLETED', fastMode: fx.fastMode, auditData: fx.auditData, createdAt: '2026-09-29T00:00:00.000Z' };
  const lt = fx.auditData?.facts?.reviews?.lifetime;
  const business = { rating: lt?.rating ?? null, reviewCount: lt?.totalCount ?? null };
  const cfg = r.defaultSalesAgentConfig('https://example.invalid/billing', 'https://example.invalid/pricing');
  return {
    free: strip(r.render(r.React.createElement(r.FreeReportView, { audit }))),
    dashboard: strip(r.render(r.React.createElement(r.AuditReportGrexa, { audit, onDownload: () => {} }))),
    pdf: strip(r.buildReportHtml({ audit } as any)),
    whatsapp: [
      r.composeSummaryMessage(r.defaultReportAgentConfig(), r.extractReportScores(audit, business), 'Owner', 'https://example.invalid/r'),
      await r.composeFirstMessage({ ...cfg, firstMessage: { ...cfg.firstMessage, mode: 'template' } } as any, r.extractScores(audit, business), 'Owner'),
    ].join('\n'),
  } as Record<string, string>;
}

// ── Evidence: every number the audit itself carries ─────────────────────────

/**
 * Numbers printed by the templates themselves: provider window (top 20),
 * ranking bands (3/5/10), the review window (14 days), plan labels
 * (30/60/90, week 1-2, day 15-45/46-90), description limits (150/750),
 * list numbering, 100%, 28-day performance window.
 */
const TEMPLATE_NUMBERS = new Set(['0', '1', '2', '3', '4', '5', '6', '10', '14', '15', '20', '28', '30', '45', '46', '60', '90', '100', '150', '750']);

/** Keys whose values are identifiers, links, coordinates or timestamps — never evidence for a displayed number. */
const NOT_EVIDENCE_KEYS = new Set([
  'placeId', 'cid', 'key', 'id', '_id', 'auditId', 'businessId', 'sourceUrl', 'url', 'website', 'origin', 'bookingUrl',
  'collectedAt', 'fetchedAt', 'measuredAt', 'checkedAt', 'capturedAt', 'at', 'lat', 'lng', 'point', 'coordinates',
  'homepageHash', 'requestedUrl', 'phone', 'phones', 'emails',
]);
/** Audit sections that are internal records, not customer-facing evidence. */
const NOT_EVIDENCE_SECTIONS = new Set(['providerUsage', 'dataQuality', 'validation', 'evidenceItems', 'aiStatus', 'evidence', 'observations']);

function evidenceNumbers(data: any): Set<string> {
  const out = new Set<string>();
  const add = (n: number) => {
    if (!Number.isFinite(n)) return;
    for (const v of [n, Math.round(n), Math.round(n * 10) / 10]) out.add(String(v));
    if (n > 0 && n <= 1) out.add(String(Math.round(n * 100)));
  };
  const walk = (v: any, depth = 0) => {
    if (v == null) return;
    if (typeof v === 'number') return add(v);
    if (typeof v === 'string') return (v.match(/\d+(?:\.\d+)?/g) || []).forEach((m) => add(Number(m)));
    if (Array.isArray(v)) { add(v.length); return v.forEach((x) => walk(x, depth + 1)); }
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (NOT_EVIDENCE_KEYS.has(k)) continue;
        if (depth === 0 && NOT_EVIDENCE_SECTIONS.has(k)) continue;
        walk(x, depth + 1);
      }
    }
  };
  walk(data);
  // Measured search results are evidence only through their rank / counts.
  for (const o of data?.facts?.observations || []) {
    if (o.rank != null) add(o.rank);
    add((o.ahead || []).length);
  }
  // Derived counts the UI computes (completion breakdown).
  const cl: any[] = data?.profileCompletion?.checklist || [];
  const complete = cl.filter((c) => c.status === 'Complete' || c.status === 'Partial').length;
  const missing = cl.filter((c) => c.status === 'Missing').length;
  [complete, missing, complete + missing, cl.length - complete - missing].forEach(add);
  return out;
}

function unexplainedNumbers(text: string, data: any): string[] {
  const allowed = evidenceNumbers(data);
  const cleaned = text
    .replace(/(\d),(?=\d{2,3}\b)/g, '$1')
    // Template numbering and stamps — not data: section bars ("8. SUGGESTED …"),
    // list numbering ("01."), the PDF's own generation date.
    .replace(/\b\d{1,2}\.\s+(?=[A-Z][A-Z&'’ ]{3,})/g, ' ')
    .replace(/\b0\d\.\s/g, ' ')
    .replace(/Generated \d{1,2} [A-Z][a-z]+ \d{4}/g, ' ');
  const found = (cleaned.match(/\d+(?:\.\d+)?/g) || []).map((n) => String(Number(n)));
  return Array.from(new Set(found.filter((n) => !allowed.has(n) && !TEMPLATE_NUMBERS.has(n))));
}

const FABRICATION = [
  /\b20\+/, /#21\b/, /\brank(?:ed)? (?:#)?21\b/i, /#0\b/, /losing customers/i, /\bindustry avg/i, /similarity/i,
  /\b\d[\d,.]*\s*(?:%|x|×)?\s*(?:more|extra|additional)\s+(?:calls|customers|leads|visits|revenue|sales|bookings)\b/i,
  /\byou will (?:rank|get|reach)\b/i, /guaranteed/i,
  /(?:your )?(?:gbp|google business profile) (?:is missing|lacks|does not list)/i,
];

function assertIntegrity(label: string, s: Record<string, string>, data: any) {
  for (const [surface, text] of Object.entries(s)) {
    assert.ok(text.length > 40, `${label}/${surface}: rendered`);
    for (const re of FABRICATION) assert.ok(!re.test(text), `${label}/${surface}: fabricated pattern ${re} — "${(text.match(re) || [''])[0]}"`);
    const extra = unexplainedNumbers(text, data);
    const where = extra.map((n) => {
      const i = text.search(new RegExp(`(^|[^\\d.])${n.replace('.', '\\.')}([^\\d]|$)`));
      return `${n} … "${text.slice(Math.max(0, i - 60), i + 40)}"`;
    });
    assert.deepEqual(extra, [], `${label}/${surface}: numbers with no evidence in the audit: ${where.join(' | ')}`);
  }
}

// ── Variants: each external provider failing on its own ─────────────────────

function rankingFailed(fx: any) {
  const f = clone(fx); const d = f.auditData;
  d.facts.observations = d.facts.observations.map((o: any) => ({ ...o, status: 'unavailable', found: false, rank: null, ahead: [], others: undefined, target: undefined }));
  d.facts.ranking.overall = { status: 'unavailable', totalSearches: d.facts.observations.length, testedCount: 0, unavailableCount: d.facts.observations.length, foundCount: 0, notFoundCount: 0, averageObservedRank: null, bestRank: null, visibilityRate: null, notFoundRate: null, top3Count: 0, top3Rate: null, top5Count: 0, top5Rate: null, top10Count: 0, top10Rate: null };
  d.facts.ranking.primary = { ...d.facts.ranking.overall };
  d.facts.ranking.byKeyword = [];
  d.facts.competitorsAhead = { count: 0, names: [], searchesChecked: 0 };
  d.competitors = []; d.localPackCompetitors = [];
  delete d.geoGridRank; d.googleSearchRank = null;
  d.keywordTable = (d.keywordTable || []).map((k: any) => ({ ...k, rankStatus: 'unavailable', found: false, rank: null, mapsRank: null }));
  d.findings = (d.findings || []).filter((x: any) => !/^ranking\.|^competitors\./.test(x.id));
  d.priorityFixes = (d.priorityFixes || []).filter((x: any) => !/^ranking\.|^competitors\./.test(x.id));
  if (d.seoPlanDraft) {
    d.seoPlanDraft.competitorLandscape = []; d.seoPlanDraft.competitorInsights = [];
    d.seoPlanDraft.criticalGap = { ...d.seoPlanDraft.criticalGap, rows: [] };
    d.seoPlanDraft.marketOpportunities = [];
    d.seoPlanDraft.rankTimeline = (d.seoPlanDraft.rankTimeline || []).map((m: any, i: number) => (i === 0 ? { ...m, rank: 'Unavailable', note: 'Ranking check did not complete' } : m));
    d.seoPlanDraft.performanceSnapshot = (d.seoPlanDraft.performanceSnapshot || []).map((t: any) => (t.label === 'Google Maps rank' ? { ...t, value: 'Unavailable', note: 'Ranking check did not complete' } : t));
    d.seoPlanDraft.keyFinding = undefined; d.seoPlanDraft.keywordInsights = [];
  }
  d.strengths = []; d.weaknesses = [];
  return f;
}

function aiFailed(fx: any) {
  const f = clone(fx); const d = f.auditData;
  d.strengths = []; d.weaknesses = [];
  d.aiStatus = { analysis: 'failed', consultant: 'partial', consultantFailed: ['narrative', 'actionPlan'] };
  d.priorityFixes = (d.priorityFixes || []).map((p: any) => ({ ...p, reason: undefined }));
  if (d.seoPlanDraft) {
    Object.assign(d.seoPlanDraft, { keyFinding: undefined, keywordInsights: [], competitorCounterPosition: undefined, actionPhases: [], weeklyPostThemes: [], suggestedQas: [], proposedKeywords: [], failed: ['narrative', 'actionPlan'] });
    d.seoPlanDraft.marketOpportunities = (d.seoPlanDraft.marketOpportunities || []).map((m: any) => ({ ...m, rationale: '' }));
  }
  return f;
}

function noWebsite(fx: any) {
  const f = clone(fx); const d = f.auditData;
  d.facts.website = null;
  if (d.seoPlanDraft) d.seoPlanDraft.websiteSummary = { url: '', status: 'none', services: [] };
  d.findings = (d.findings || []).filter((x: any) => !x.id.startsWith('website.'));
  return f;
}

function websiteFailed(fx: any) {
  const f = clone(fx); const d = f.auditData;
  if (d.facts.website) d.facts.website = { ...d.facts.website, status: 'failed', services: [], bookingLinks: [] };
  if (d.seoPlanDraft?.websiteSummary) d.seoPlanDraft.websiteSummary = { ...d.seoPlanDraft.websiteSummary, status: 'failed', services: [] };
  return f;
}

/** Google Places failed at intake: no lifetime reviews, no listing snapshot. */
function placesFailed(fx: any) {
  const f = clone(fx); const d = f.auditData;
  d.facts.reviews.lifetime = { status: 'unknown', totalCount: null, rating: null, source: null, sampleSize: null };
  d.facts.reviewComparison = null;
  delete d.reviewAnalysis;
  d.findings = (d.findings || []).filter((x: any) => !x.id.startsWith('reviews.'));
  d.priorityFixes = (d.priorityFixes || []).filter((x: any) => !x.id.startsWith('reviews.'));
  d.profileCompletion = { ...d.profileCompletion, completionPercentage: 0, checklist: (d.profileCompletion?.checklist || []).map((c: any) => ({ ...c, status: 'Unknown' })) };
  d.strengths = (d.strengths || []).filter((s: any) => !/review|rating/i.test(`${s.title} ${s.evidence}`));
  d.weaknesses = (d.weaknesses || []).filter((s: any) => !/review|rating/i.test(`${s.title} ${s.evidence}`));
  if (d.seoPlanDraft) {
    d.seoPlanDraft.performanceSnapshot = (d.seoPlanDraft.performanceSnapshot || []).map((t: any) =>
      t.label === 'Google reviews' ? { ...t, value: 'Unknown', note: 'Review total unavailable' } : t.label === 'Profile completion' ? { ...t, value: 'Not measured', note: 'No fields could be checked' } : t);
    d.seoPlanDraft.competitorInsights = (d.seoPlanDraft.competitorInsights || []).filter((i: any) => i.topic !== 'reviews');
    d.seoPlanDraft.keyFinding = undefined;
    d.seoPlanDraft.competitorLandscape = (d.seoPlanDraft.competitorLandscape || []);
  }
  return f;
}

/** SerpApi failed: recent-activity window not synced. */
function reviewSyncFailed(fx: any) {
  const f = clone(fx); const d = f.auditData;
  d.facts.reviews.recent = { status: 'unknown', periodDays: 14, newReviewCount: null, reviewsPerWeek: null, responseRate: null, replyUnknownCount: 0, sentiment: null, textSampleCount: 0 };
  if (d.reviewAnalysis) Object.assign(d.reviewAnalysis, { reviewsPerWeek: null, responseRate: null, recentReviewCount: null, reviewThemes: 'unknown', mostCommonPraises: [], mostCommonComplaints: [], estimatedFromPlaces: true });
  d.findings = (d.findings || []).filter((x: any) => !/^reviews\.(unanswered|response_rate)/.test(x.id));
  d.priorityFixes = (d.priorityFixes || []).filter((x: any) => !/^reviews\.(unanswered|response_rate)/.test(x.id));
  return f;
}

function searchVolumeFailed(fx: any) {
  const f = clone(fx); const d = f.auditData;
  d.keywordTable = (d.keywordTable || []).map((k: any) => ({ ...k, searchVolume: null, volumeBand: null, demandStatus: 'unavailable', estimated: true }));
  if (d.seoPlanDraft) d.seoPlanDraft.marketOpportunities = [];
  return f;
}

function connected(fx: any) {
  const f = clone(fx); const d = f.auditData;
  d.auditKind = 'connected_baseline';
  d.performanceBaseline = { status: 'verified', source: 'gbp_performance_api', periodStart: '2026-08-29', periodEnd: '2026-09-25', daysWithData: 28, calls: 31, websiteClicks: 57, directionRequests: 12, conversations: 0, profileViews: 1406, collectedAt: '2026-09-29T00:00:00.000Z' };
  d.comparison = { previousAuditId: 'free', previousKind: 'free_report', previousAt: '2026-09-28T00:00:00.000Z', rows: [
    { metric: 'Searches where you appear in the top 20', before: '6 of 11', after: '27 of 45', change: 'not_comparable', note: 'Different searches were measured, so rankings are not compared.' },
    { metric: 'Calls from Google (28 days)', before: 'not measured', after: '31', change: 'not_comparable', pctChange: null, note: 'Not measured in both audits (needs a Google connection each time).' },
  ] };
  return f;
}

// ── Tests ──────────────────────────────────────────────────────────────────

for (const name of ['mulsetu-free', 'mulsetu-dashboard', 'desun-free']) {
  test(`integrity: ${name} — every number on every surface traces to evidence`, async () => {
    const fx = load(name);
    assertIntegrity(name, await surfaces(fx), fx.auditData);
  });
}

const VARIANTS: Array<[string, (fx: any) => any, (s: Record<string, string>) => void]> = [
  ['ranking provider failure', rankingFailed, (s) => {
    assert.match(s.free, /couldn.t complete the ranking check|could not be completed/i);
    assert.match(s.pdf, /could not be completed|Unavailable/i);
    assert.ok(!/#\d/.test(s.free.replace(/#\d+ /g, (m) => m)) || !/Average[^.]{0,40}#\d/i.test(s.free), 'no average rank from a failed check');
    assert.match(s.whatsapp, /not measured/i);
  }],
  ['AI failure (Groq down / quota exceeded)', aiFailed, (s) => {
    assert.match(s.free, /Additional AI analysis is temporarily unavailable/);
    assert.match(s.pdf, /GBP PROFILE GAP ANALYSIS/i);
  }],
  ['no website', noWebsite, (s) => {
    assert.match(s.free, /No website was available for analysis/);
    assert.match(s.pdf, /No website was available for analysis/);
  }],
  ['website unavailable', websiteFailed, (s) => {
    assert.match(s.free, /did not respond when we checked/);
  }],
  ['Google Places failure (no listing data)', placesFailed, (s) => {
    for (const t of [s.free, s.dashboard, s.pdf]) assert.ok(!/\b0 (Google )?reviews\b/i.test(t), 'unknown review count is never "0 reviews"');
    assert.match(s.whatsapp, /not measured/i);
  }],
  ['SerpApi failure (review sync)', reviewSyncFailed, (s) => {
    assert.ok(!/\b0(\.0)?\s*\/\s*week\b/i.test(s.dashboard), 'no 0/week');
    assert.ok(!/Response Rate[^A-Za-z]{0,20}0%/.test(s.dashboard), 'no 0% response rate');
  }],
  ['search volume unavailable', searchVolumeFailed, (s) => {
    assert.match(s.free, /Not available/);
  }],
  ['connected GBP (performance baseline + comparison)', connected, (s) => {
    assert.match(s.dashboard, /Measured results baseline/);
    assert.match(s.dashboard, /Not comparable/);
  }],
];

for (const [label, mutate, check] of VARIANTS) {
  for (const name of ['mulsetu-free', 'desun-free']) {
    test(`integrity under failure: ${label} — ${name}`, async () => {
      const fx = mutate(load(name));
      const s = await surfaces(fx);
      assertIntegrity(`${name}/${label}`, s, fx.auditData);
      check(s);
    });
  }
}

test('integrity: no-evidence number detector catches a fabricated value', async () => {
  const fx = load('mulsetu-free');
  const s = await surfaces(fx);
  const planted = `${s.free} You could see 47 more calls.`;
  assert.ok(unexplainedNumbers(planted, fx.auditData).includes('47'));
  assert.ok(FABRICATION.some((re) => re.test(planted)));
});

// ── Monthly optimization report ─────────────────────────────────────────────

test('integrity: monthly report — every number traces to evidence, sections present', async () => {
  const fx = load('mulsetu-monthly');
  const s = await surfaces(fx);
  assertIntegrity('mulsetu-monthly', s, fx.auditData);
  for (const t of ['What changed this month', 'What GrowwMatics optimized', 'What you optimized', 'Google performance', 'Ranking progress', 'Review activity', 'Profile health', 'Completed plan', 'Pending plan', 'Issues that remain']) {
    assert.ok(s.dashboard.includes(t), `dashboard: ${t}`);
    assert.ok(s.pdf.includes(t), `pdf: ${t}`);
  }
  // Disclaimers ("not revenue") are fine; a revenue CLAIM is not.
  assert.ok(!/(generated|earned|added|extra|additional|more|increased?)\s+[^.]{0,25}\brevenue\b|₹\s*\d[\d,]*/i.test(s.dashboard + s.pdf + s.whatsapp), 'no revenue claims');
});

test('integrity: monthly report when Google performance is unavailable', async () => {
  const fx = clone(load('mulsetu-monthly'));
  fx.auditData.monthly.performance = { status: 'unavailable', rows: [] };
  fx.auditData.performanceBaseline = { status: 'unavailable', reason: 'Performance API error' };
  const s = await surfaces(fx);
  assertIntegrity('mulsetu-monthly/perf-unavailable', s, fx.auditData);
  assert.match(s.dashboard, /Google performance data unavailable for this period/);
  assert.match(s.pdf, /Google performance data unavailable for this period/);
});

test('integrity: monthly report when AI fails — facts still render', async () => {
  const fx = aiFailed(load('mulsetu-monthly'));
  const s = await surfaces(fx);
  assertIntegrity('mulsetu-monthly/ai-failed', s, fx.auditData);
  assert.match(s.dashboard, /What changed this month/);
  assert.match(s.dashboard, /Additional AI analysis is temporarily unavailable/);
});

test('integrity: monthly report when ranking provider failed — ranking not compared', async () => {
  const fx = rankingFailed(load('mulsetu-monthly'));
  fx.auditData.monthly.ranking = [];
  fx.auditData.comparison = { rows: [] };
  const s = await surfaces(fx);
  assertIntegrity('mulsetu-monthly/ranking-failed', s, fx.auditData);
  assert.match(s.dashboard, /Ranking data unavailable for comparison/);
});
