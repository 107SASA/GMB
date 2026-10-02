/**
 * Customer CRM — Monthly Growth Report: pure calculation tests.
 * Run: node --experimental-strip-types --test tests/integration/crm-growth-report.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrowthReport, computePeriodMetrics, resolveReportMonth, type GrowthLead } from '../../src/services/crm/growthReport.ts';
import { ROI_UNAVAILABLE_NOTE } from '../../src/services/crm/roi.ts';

const NOW = new Date('2026-10-14T06:00:00Z'); // 14 Oct 2026, 11:30 IST
const IST = 'Asia/Kolkata';
const resolved = (m?: string) => resolveReportMonth(m, NOW, IST)!;
const L = (o: Partial<GrowthLead> & { createdAt: string }): GrowthLead => ({ source: 'Manual', lifeCycleStage: 'initial', status: 'active', ...o });
const report = (leads: GrowthLead[], extra: Partial<Parameters<typeof buildGrowthReport>[0]> = {}) =>
  buildGrowthReport({ resolved: resolved('2026-09'), now: NOW, businessName: 'Biz', leads, tasks: [], calls: [], callsMeasured: false, ...extra });

test('period: default = latest COMPLETED month; IST calendar boundaries; labels', () => {
  const r = resolved();
  assert.equal(r.period.key, '2026-09');
  assert.equal(r.period.complete, true);
  assert.equal(r.period.from.toISOString(), '2026-08-31T18:30:00.000Z', 'Sep 1 00:00 IST');
  assert.equal(r.period.to.toISOString(), '2026-09-30T18:30:00.000Z', 'Oct 1 00:00 IST (exclusive)');
  assert.equal(r.period.label, 'September 2026');
  assert.equal(r.period.rangeLabel, 'September 1 – September 30, 2026');
  assert.equal(r.period.days, 30);
  assert.equal(r.previous.key, '2026-08');
  assert.equal(r.previous.days, 31);
  assert.equal(r.nextKey, '2026-10');
});

test('period: current month is month-to-date (never a completed report); compared like-for-like', () => {
  const r = resolved('current');
  assert.equal(r.period.key, '2026-10');
  assert.equal(r.period.complete, false);
  assert.equal(r.period.to.getTime(), NOW.getTime());
  assert.equal(r.nextKey, null);
  assert.equal(r.previous.key, '2026-09');
  assert.equal(r.previous.complete, false, 'previous = the same elapsed days of September, not all of it');
  assert.equal(r.previous.to.getTime() - r.previous.from.getTime(), NOW.getTime() - r.period.from.getTime());
  assert.equal(resolved('2026-10').period.complete, false, 'asking for the current month by key is also month to date');
  const rep = buildGrowthReport({ resolved: r, now: NOW, businessName: 'B', leads: [], tasks: [], calls: [], callsMeasured: false });
  assert.match(rep.period.label, /month to date/);
  assert.match(rep.footer, /month to date/);
});

test('period: future / malformed months rejected; other timezones respected', () => {
  assert.equal(resolveReportMonth('2026-11', NOW, IST), null);
  assert.equal(resolveReportMonth('2026-13', NOW, IST), null);
  assert.equal(resolveReportMonth('garbage', NOW, IST), null);
  const ny = resolveReportMonth('2026-09', NOW, 'America/New_York')!;
  assert.equal(ny.period.from.toISOString(), '2026-09-01T04:00:00.000Z');
  assert.equal(resolveReportMonth('2026-09', NOW, 'Not/AZone')!.period.timeZone, 'Asia/Kolkata', 'invalid tz → IST');
});

test('0 leads: no NaN, conversion null, ₹0 recorded, no fabricated highlights', () => {
  const r = report([]);
  assert.equal(r.metrics.leadsReceived, 0);
  assert.equal(r.metrics.conversionRate, null);
  assert.equal(r.metrics.revenue, 0);
  assert.equal(r.metrics.averageDeal, null);
  assert.match(r.summary.data[0], /0 new leads, with 0 recorded wins and ₹0 in recorded revenue/);
  assert.deepEqual(r.highlights, []);
  assert.equal(r.comparison.available, false);
  assert.equal(r.comparison.note, 'No previous-month data available.');
});

test('leads with no Won deals; Won with ₹0; Won with value; Won without value; mixed Won/Lost/Open', () => {
  const r = report([
    L({ createdAt: '2026-09-03T10:00:00Z' }),
    L({ createdAt: '2026-09-04T10:00:00Z', lifeCycleStage: 'closed' }),
    L({ createdAt: '2026-09-05T10:00:00Z', lifeCycleStage: 'converted', convertedAt: '2026-09-10T10:00:00Z', deal: { value: 0, currency: 'INR' } }),
    L({ createdAt: '2026-09-06T10:00:00Z', lifeCycleStage: 'converted', convertedAt: '2026-09-11T10:00:00Z', deal: { value: 40000, currency: 'INR' } }),
    L({ createdAt: '2026-09-07T10:00:00Z', lifeCycleStage: 'converted', convertedAt: '2026-09-12T10:00:00Z', deal: { value: null, currency: 'INR', valueMissing: true } }),
    L({ createdAt: '2026-09-08T10:00:00Z', lifeCycleStage: 'active' }),
  ]);
  assert.equal(r.metrics.leadsReceived, 6);
  assert.equal(r.metrics.won, 3);
  assert.equal(r.metrics.wonWithoutValue, 1);
  assert.equal(r.metrics.revenue, 40000, '₹0 deal counts as a recorded ₹0; missing value is not invented');
  assert.equal(r.metrics.averageDeal, 20000, 'average over recorded values (0 and 40000)');
  assert.equal(r.metrics.conversionRate, 50);
  assert.ok(r.summary.data.some((s) => /1 won lead has no deal value recorded/.test(s)));
  const none = report([L({ createdAt: '2026-09-03T10:00:00Z' }), L({ createdAt: '2026-09-04T10:00:00Z', lifeCycleStage: 'active' })]);
  assert.equal(none.metrics.won, 0);
  assert.equal(none.metrics.conversionRate, 0);
  assert.equal(none.metrics.revenue, 0);
});

test('Won = entered Won in the period (convertedAt), incl. leads received earlier; pre-Won value never revenue', () => {
  const r = report([
    L({ createdAt: '2026-07-01T10:00:00Z', lifeCycleStage: 'converted', convertedAt: '2026-09-02T10:00:00Z', deal: { value: 5000 } }),
    L({ createdAt: '2026-09-01T10:00:00Z', lifeCycleStage: 'converted', convertedAt: '2026-10-02T10:00:00Z', deal: { value: 9000 } }),
    L({ createdAt: '2026-09-02T10:00:00Z', lifeCycleStage: 'active', deal: { value: 7000 } }),
  ]);
  assert.equal(r.metrics.won, 1);
  assert.equal(r.metrics.revenue, 5000);
  assert.equal(r.metrics.wonFromEarlierLeads, 1);
  assert.equal(r.metrics.leadsReceived, 2);
});

test('multiple sources: real source names, revenue ₹0 not estimated, conversion per source; ties shown as ties', () => {
  const r = report([
    L({ createdAt: '2026-09-03T10:00:00Z', source: 'WhatsApp', lifeCycleStage: 'converted', convertedAt: '2026-09-09T10:00:00Z', deal: { value: 30000 } }),
    L({ createdAt: '2026-09-03T11:00:00Z', source: 'WhatsApp' }),
    L({ createdAt: '2026-09-04T10:00:00Z', source: 'Phone Call' }),
    L({ createdAt: '2026-09-04T11:00:00Z', source: 'Phone Call' }),
    L({ createdAt: '2026-09-05T10:00:00Z', source: 'CSV Import' }),
  ]);
  const by = Object.fromEntries(r.metrics.sources.map((s) => [s.source, s]));
  assert.deepEqual(by.WhatsApp, { source: 'WhatsApp', leads: 2, won: 1, revenue: 30000, conversionRate: 50 });
  assert.deepEqual(by['Phone Call'], { source: 'Phone Call', leads: 2, won: 0, revenue: 0, conversionRate: 0 });
  assert.equal(by['CSV Import'].revenue, 0);
  assert.ok(r.highlights.includes('Phone Call and WhatsApp each brought 2 leads.') || r.highlights.includes('WhatsApp and Phone Call each brought 2 leads.'), r.highlights.join(' | '));
  assert.ok(r.highlights.some((h) => /WhatsApp brought the most recorded revenue: ₹30,000/.test(h)));
});

test('ROI: no investment → unavailable; zero investment → unavailable; configured → shared rule', () => {
  const leads = [L({ createdAt: '2026-09-03T10:00:00Z', lifeCycleStage: 'converted', convertedAt: '2026-09-09T10:00:00Z', deal: { value: 30000 } })];
  const none = report(leads);
  assert.equal(none.roi.roiPercent, null);
  assert.equal(none.roi.note, ROI_UNAVAILABLE_NOTE);
  const zero = report(leads, { monthlyInvestment: 0 });
  assert.equal(zero.roi.roiPercent, null);
  assert.equal(zero.roi.note, ROI_UNAVAILABLE_NOTE);
  const cfg = report(leads, { monthlyInvestment: 10000 });
  const inv = Math.round(10000 * (30 / 30.44));
  assert.equal(cfg.roi.investment, inv);
  assert.equal(cfg.roi.roiPercent, Math.round(((30000 - inv) / inv) * 1000) / 10);
  assert.equal(cfg.roi.revenue, 30000);
});

test('month-over-month: % change for counts/money, percentage POINTS for rates, nothing "from zero"', () => {
  const leads: GrowthLead[] = [
    // August: 10 leads, 1 won (10%), ₹10,000
    ...Array.from({ length: 10 }, (_, i) => L({ createdAt: `2026-08-${String(i + 2).padStart(2, '0')}T10:00:00Z` })),
    L({ createdAt: '2026-07-20T10:00:00Z', lifeCycleStage: 'converted', convertedAt: '2026-08-15T10:00:00Z', deal: { value: 10000 } }),
    // September: 12 leads... wait — keep 25: 3 won (12%), ₹13,000
    ...Array.from({ length: 25 }, (_, i) => L({ createdAt: `2026-09-${String((i % 28) + 2).padStart(2, '0')}T10:00:00Z` })),
    ...[4000, 4000, 5000].map((v, i) => L({ createdAt: '2026-07-25T10:00:00Z', lifeCycleStage: 'converted', convertedAt: `2026-09-1${i}T10:00:00Z`, deal: { value: v } })),
  ];
  const r = report(leads);
  assert.equal(r.comparison.available, true);
  assert.equal(r.comparison.leads.percentChange, 150);
  assert.equal(r.comparison.won.percentChange, 200);
  assert.equal(r.comparison.revenue.percentChange, 30);
  assert.equal(r.comparison.conversionRate.current, 12);
  assert.equal(r.comparison.conversionRate.previous, 10);
  assert.equal(r.comparison.conversionRate.pointChange, 2, '+2.0 percentage points, not +20%');
  assert.equal(r.comparison.conversionRate.percentChange, null);
  assert.ok(r.summary.data.some((s) => /Compared with August 2026, lead volume increased by 150% while recorded revenue increased by 30%/.test(s)), r.summary.data.join(' | '));
});

test('previous month has zero data → "No previous-month data available." and no growth computed', () => {
  const r = report([L({ createdAt: '2026-09-03T10:00:00Z', lifeCycleStage: 'converted', convertedAt: '2026-09-04T10:00:00Z', deal: { value: 1000 } })]);
  assert.equal(r.comparison.available, false);
  assert.equal(r.comparison.leads.percentChange, null);
  assert.equal(r.comparison.leads.previous, null);
  assert.ok(!r.highlights.some((h) => /increased|decreased/.test(h)));
});

test('previous month has leads but ₹0 revenue → revenue change is "rose from ₹0", never a % from zero', () => {
  const r = report([
    L({ createdAt: '2026-08-03T10:00:00Z' }),
    L({ createdAt: '2026-09-03T10:00:00Z', lifeCycleStage: 'converted', convertedAt: '2026-09-04T10:00:00Z', deal: { value: 1000 } }),
  ]);
  assert.equal(r.comparison.available, true);
  assert.equal(r.comparison.revenue.percentChange, null);
  assert.ok(r.summary.data.some((s) => /recorded revenue rose from ₹0 to ₹1,000/.test(s)), r.summary.data.join(' | '));
});

test('follow-ups: due / completed / missed / completion rate; cancelled excluded; month-to-date upcoming not "missed"', () => {
  const tasks = [
    { status: 'completed', scheduledFor: '2026-09-05T10:00:00Z', leadId: 'a' },
    { status: 'completed', scheduledFor: '2026-09-06T10:00:00Z', leadId: 'b' },
    { status: 'pending', scheduledFor: '2026-09-07T10:00:00Z', leadId: 'c' },
    { status: 'cancelled', scheduledFor: '2026-09-08T10:00:00Z', leadId: 'd' },
    { status: 'pending', scheduledFor: '2026-10-20T10:00:00Z', leadId: 'e' },
  ];
  const r = report([], { tasks });
  assert.deepEqual(r.metrics.followUps, { due: 3, completed: 2, missed: 1, upcoming: 0, completionRate: 66.7 });
  const mtd = buildGrowthReport({ resolved: resolved('current'), now: NOW, businessName: 'B', leads: [], tasks, calls: [], callsMeasured: false });
  assert.deepEqual(mtd.metrics.followUps, { due: 1, completed: 0, missed: 0, upcoming: 1, completionRate: null });
  assert.equal(r.attention.overdueTasks, 1, 'right now: the September task still pending is overdue');
});

test('calls: Not measured without telephony; otherwise known / unknown / saved / linked / dismissed / revenue from calls', () => {
  assert.equal(report([]).metrics.calls.measured, false);
  const calls = [
    { direction: 'inbound', startedAt: '2026-09-03T10:00:00Z', outcome: 'ended', leadState: 'existing_lead', handled: false },
    { direction: 'inbound', startedAt: '2026-09-03T11:00:00Z', outcome: 'missed', leadState: 'saved', handled: true },
    { direction: 'inbound', startedAt: '2026-09-04T11:00:00Z', outcome: 'ended', leadState: 'existing_lead', handled: true },
    { direction: 'inbound', startedAt: '2026-09-05T11:00:00Z', outcome: 'ended', leadState: 'dismissed', handled: true },
    { direction: 'inbound', startedAt: '2026-09-06T11:00:00Z', outcome: 'ended', leadState: 'pending', handled: false },
    { direction: 'outbound', startedAt: '2026-09-06T12:00:00Z', outcome: 'ended', leadState: 'existing_lead', handled: false },
    { direction: 'inbound', startedAt: '2026-10-06T11:00:00Z', outcome: 'ended', leadState: 'pending', handled: false },
  ];
  const leads = [L({ createdAt: '2026-09-03T11:00:00Z', source: 'Phone Call', lifeCycleStage: 'converted', convertedAt: '2026-09-20T10:00:00Z', deal: { value: 8000 } })];
  const r = report(leads, { calls, callsMeasured: true });
  assert.deepEqual(r.metrics.calls, {
    measured: true, received: 5, missed: 1, knownCallers: 1, unknownCallers: 4, savedAsLeads: 1, linkedToExisting: 1, dismissed: 1,
    awaitingDecision: 1, leadsFromCalls: 1, wonFromCalls: 1, revenueFromCalls: 8000,
  });
  assert.ok(r.highlights.includes('Calls generated 1 saved lead.'));
});

test('pipeline snapshot = Open + Active, excluding Won, Lost and Inactive; leads needing follow-up', () => {
  const r = report([
    L({ _id: 'o1', createdAt: '2026-09-01T10:00:00Z', lifeCycleStage: 'initial' }),
    L({ _id: 'a1', createdAt: '2026-09-01T10:00:00Z', lifeCycleStage: 'active', lastContactedAt: '2026-10-13T10:00:00Z' }),
    L({ _id: 'i1', createdAt: '2026-09-01T10:00:00Z', lifeCycleStage: 'active', status: 'inactive' }),
    L({ _id: 'w1', createdAt: '2026-09-01T10:00:00Z', lifeCycleStage: 'converted', convertedAt: '2026-09-02T10:00:00Z' }),
    L({ _id: 'l1', createdAt: '2026-09-01T10:00:00Z', lifeCycleStage: 'closed' }),
    L({ _id: 'b1', createdAt: '2026-09-01T10:00:00Z', lifeCycleStage: 'active' }),
  ], { bookedLeadIds: new Set(['b1']) });
  assert.deepEqual(r.pipeline, { open: 1, active: 2, total: 3 });
  assert.equal(r.attention.leadsNotContacted, 1, 'o1 only: a1 contacted yesterday, b1 has a booked appointment, inactive/won/lost excluded');
});

test('wording: data vs interpretation, never causal or invented money', () => {
  const r = report([
    ...Array.from({ length: 4 }, (_, i) => L({ createdAt: `2026-09-0${i + 2}T10:00:00Z` })),
    L({ createdAt: '2026-08-02T10:00:00Z' }),
  ], { tasks: [{ status: 'pending', scheduledFor: '2026-09-05T10:00:00Z', leadId: 'x' }] });
  const all = [...r.summary.data, ...r.summary.interpretation, ...r.highlights, r.footer].join(' ');
  assert.doesNotMatch(all, /GrowwMatics (generated|earned|made|brought)|you lost|lost ₹|could have|potential revenue|estimated/i);
  assert.ok(r.summary.interpretation.some((s) => /1 follow-up due in this period was not completed/.test(s)));
  assert.equal(r.footer, 'Based on recorded CRM activity for September 2026.');
});

test('computePeriodMetrics never invents calls when telephony is not measured', () => {
  const p = resolved('2026-09').period;
  const m = computePeriodMetrics({ period: p, now: NOW, leads: [], tasks: [], calls: [], callsMeasured: false });
  assert.equal(m.calls.measured, false);
  assert.equal(m.calls.received, 0);
});

test('wiring: web + mobile read the same endpoint; push and in-app taps open the report; no WhatsApp/AI in the report path', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(import.meta.dirname, '../..');
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
  assert.match(read('src/components/crm/GrowthReport.tsx'), /\/api\/crm\/growth-report/);
  assert.match(read('mobile/src/api/endpoints/crm.ts'), /api\.get\('\/api\/crm\/growth-report'/);
  assert.match(read('src/components/crm/CRMAnalytics.tsx'), /href="\/dashboard\/crm\/growth-report"/);
  assert.match(read('mobile/src/app/(app)/leads/index.tsx'), /router\.push\('\/leads\/growth-report'\)/);
  assert.match(read('mobile/src/app/_layout.tsx'), /growthReportMonth[\s\S]{0,200}\/leads\/growth-report/);
  assert.match(read('mobile/src/app/(app)/notifications.tsx'), /id === 'growth-report'/);
  assert.ok(fs.existsSync(path.join(root, 'src/app/dashboard/crm/growth-report/page.tsx')));
  for (const f of ['src/services/crm/growthReport.ts', 'src/services/crm/growthReportData.ts', 'src/app/api/crm/growth-report/route.ts']) {
    assert.doesNotMatch(read(f), /groq|openai|anthropic|sendOutboundMessage|notifyOwner|whatsapp\/send/i, `${f}: no AI, no WhatsApp`);
  }
  // The route never reads a business id from the request.
  assert.doesNotMatch(read('src/app/api/crm/growth-report/route.ts'), /searchParams\.get\('business/);
});
