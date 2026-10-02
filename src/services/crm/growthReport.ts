/**
 * Customer CRM — Monthly Growth Report (pure; runs under `node --test`).
 *
 * ONE calculation used by the web report and the mobile report (both read
 * GET /api/crm/growth-report). Everything is counted from recorded CRM data:
 *  - Leads received  = customer leads CREATED in the period.
 *  - Won             = leads currently Won whose convertedAt (the moment they
 *                      entered Won) falls in the period.
 *  - Revenue         = recorded deal values of those Won leads only (a Won
 *                      lead without a value is counted as "no value recorded").
 *  - Conversion rate = Won ÷ Leads received × 100 (null when 0 leads).
 *  - ROI             = the shared Customer CRM rule (roi.ts computeRoiFigures).
 * Nothing is estimated, predicted or produced by AI. Missing measurements are
 * returned as null / measured:false, and the UI says "Not measured".
 */
import { computeRoiFigures, ROI_UNAVAILABLE_NOTE } from './roi.ts';
import { STALE_LEAD_DAYS } from './constants.ts';

const DAY_MS = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number) => (b > 0 ? round1((a / b) * 100) : null);

// ── Period ────────────────────────────────────────────────────────────────

export interface ReportPeriod {
  key: string;          // 'YYYY-MM'
  from: Date;           // inclusive
  to: Date;             // exclusive (month end, or "now" for month to date)
  label: string;        // 'September 2026'
  rangeLabel: string;   // 'September 1 – September 30, 2026'
  days: number;
  complete: boolean;    // false = month to date (still in progress)
  /** The live, in-progress month ("now" is inside it). */
  live: boolean;
  /** End of the calendar month (= `to` for a completed month). */
  monthEnd: Date;
  timeZone: string;
}

function safeTimeZone(tz: string | null | undefined): string {
  try {
    if (tz) { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; }
  } catch { /* invalid → default */ }
  return 'Asia/Kolkata';
}

/** UTC offset (ms) of `tz` at the instant `at`. */
function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - at.getTime();
}

/** Instant of local midnight on the 1st of (year, month0) in `tz`. */
function zonedMonthStart(year: number, month0: number, tz: string): Date {
  const y = year + Math.floor(month0 / 12);
  const m = ((month0 % 12) + 12) % 12;
  const guess = Date.UTC(y, m, 1);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  t = guess - tzOffsetMs(new Date(t), tz);
  return new Date(t);
}

function zonedYearMonth(at: Date, tz: string): { y: number; m: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(at);
  return { y: Number(parts.find((p) => p.type === 'year')?.value), m: Number(parts.find((p) => p.type === 'month')?.value) - 1 };
}

const keyOf = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, '0')}`;
const shiftKey = (key: string, by: number) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return keyOf(d.getUTCFullYear(), d.getUTCMonth());
};

function fmtDay(d: Date, tz: string, withYear: boolean) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) }).format(d);
}

function makePeriod(key: string, tz: string, to: Date | null, live = false): ReportPeriod {
  const [y, m] = key.split('-').map(Number);
  const from = zonedMonthStart(y, m - 1, tz);
  const monthEnd = zonedMonthStart(y, m, tz);
  const end = to && to < monthEnd ? to : monthEnd;
  const complete = end.getTime() === monthEnd.getTime();
  const label = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', year: 'numeric' }).format(new Date(from.getTime() + DAY_MS));
  const last = new Date(end.getTime() - 1);
  return {
    key, from, to: end, label, timeZone: tz, complete, live, monthEnd,
    rangeLabel: `${fmtDay(from, tz, false)} – ${fmtDay(last, tz, true)}`,
    days: Math.max(1, Math.round((end.getTime() - from.getTime()) / DAY_MS)),
  };
}

export interface ResolvedReportMonth {
  period: ReportPeriod;
  /** The period compared against: the full previous month, or — for month to date — the same days of the previous month. */
  previous: ReportPeriod;
  currentKey: string;
  latestCompleteKey: string;
  prevKey: string;
  nextKey: string | null;
}

/**
 * `month`: 'YYYY-MM', 'current' (month to date) or empty (= the latest
 * COMPLETED month). A future month → null. The current month is always
 * "month to date", never presented as a completed report.
 */
export function resolveReportMonth(month: string | null | undefined, now: Date, timeZone?: string | null): ResolvedReportMonth | null {
  const tz = safeTimeZone(timeZone);
  const { y, m } = zonedYearMonth(now, tz);
  const currentKey = keyOf(y, m);
  const latestCompleteKey = shiftKey(currentKey, -1);
  let key: string;
  if (!month) key = latestCompleteKey;
  else if (month === 'current') key = currentKey;
  else if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) key = month;
  else return null;
  if (key > currentKey) return null;
  const isCurrent = key === currentKey;
  const period = makePeriod(key, tz, isCurrent ? now : null, isCurrent);
  const prevKey = shiftKey(key, -1);
  let prevCutoff: Date | null = null;
  if (isCurrent) {
    // Like-for-like: the same elapsed time of the previous month (capped at its end).
    const [py, pm] = prevKey.split('-').map(Number);
    prevCutoff = new Date(zonedMonthStart(py, pm - 1, tz).getTime() + (now.getTime() - period.from.getTime()));
  }
  const previous = makePeriod(prevKey, tz, prevCutoff);
  return { period, previous, currentKey, latestCompleteKey, prevKey, nextKey: isCurrent ? null : shiftKey(key, 1) };
}

// ── Inputs ────────────────────────────────────────────────────────────────

export interface GrowthLead {
  _id?: unknown;
  source?: string | null;
  lifeCycleStage?: string | null;
  status?: string | null;
  createdAt: Date | string;
  convertedAt?: Date | string | null;
  lastContactedAt?: Date | string | null;
  deal?: { value?: number | null; currency?: string | null; valueMissing?: boolean | null } | null;
}

export interface GrowthTask {
  leadId?: unknown;
  status: string; // pending | completed | cancelled
  scheduledFor: Date | string;
}

export interface GrowthCall {
  direction?: string | null;
  startedAt: Date | string;
  outcome?: string | null;
  leadState?: string | null;
  /** True when the owner acted on the call (save / link / dismiss); false = matched automatically. */
  handled?: boolean;
}

// ── Metrics for one period ────────────────────────────────────────────────

const inRange = (d: Date | string | null | undefined, p: ReportPeriod) => {
  if (!d) return false;
  const t = new Date(d).getTime();
  return t >= p.from.getTime() && t < p.to.getTime();
};
const dealValue = (l: GrowthLead) => (typeof l.deal?.value === 'number' && l.deal.value >= 0 && !l.deal.valueMissing ? l.deal.value : null);
const wonIn = (l: GrowthLead, p: ReportPeriod) => l.lifeCycleStage === 'converted' && inRange(l.convertedAt, p);

export interface SourceRow { source: string; leads: number; won: number; revenue: number; conversionRate: number | null }

export interface PeriodMetrics {
  leadsReceived: number;
  won: number;
  wonWithoutValue: number;
  /** Won leads that were received in an earlier month (explains a conversion rate above 100%). */
  wonFromEarlierLeads: number;
  revenue: number;
  averageDeal: number | null;
  conversionRate: number | null;
  sources: SourceRow[];
  followUps: { due: number; completed: number; missed: number; upcoming: number; completionRate: number | null };
  calls: {
    measured: boolean;
    received: number; missed: number; knownCallers: number; unknownCallers: number;
    savedAsLeads: number; linkedToExisting: number; dismissed: number; awaitingDecision: number;
    leadsFromCalls: number; wonFromCalls: number; revenueFromCalls: number;
  };
}

export function computePeriodMetrics(input: { period: ReportPeriod; now: Date; leads: GrowthLead[]; tasks: GrowthTask[]; calls: GrowthCall[]; callsMeasured: boolean }): PeriodMetrics {
  const { period: p, now } = input;
  const received = input.leads.filter((l) => inRange(l.createdAt, p));
  const won = input.leads.filter((l) => wonIn(l, p));
  const values = won.map(dealValue).filter((v): v is number => v != null);
  const revenue = values.reduce((a, v) => a + v, 0);

  const bySource = new Map<string, SourceRow>();
  const row = (s: string | null | undefined) => {
    const k = s || 'Unknown';
    if (!bySource.has(k)) bySource.set(k, { source: k, leads: 0, won: 0, revenue: 0, conversionRate: null });
    return bySource.get(k)!;
  };
  for (const l of received) row(l.source).leads++;
  for (const l of won) { const r = row(l.source); r.won++; r.revenue += dealValue(l) ?? 0; }
  const sources = [...bySource.values()]
    .map((r) => ({ ...r, conversionRate: pct(r.won, r.leads) }))
    .sort((a, b) => b.leads - a.leads || b.revenue - a.revenue || a.source.localeCompare(b.source));

  // Follow-up TASKS due in the period (cancelled ones are not counted). For
  // the live month, the rest of the calendar month is included as "upcoming".
  const taskWindow = p.live ? { ...p, to: p.monthEnd } : p;
  const due = input.tasks.filter((t) => t.status !== 'cancelled' && inRange(t.scheduledFor, taskWindow));
  const dueBy = Math.min(p.to.getTime(), now.getTime());
  const completed = due.filter((t) => t.status === 'completed').length;
  const missed = due.filter((t) => t.status === 'pending' && new Date(t.scheduledFor).getTime() < dueBy).length;
  const upcoming = due.length - completed - missed;

  const calls = input.calls.filter((c) => inRange(c.startedAt, p) && c.direction !== 'outbound');
  const fromCalls = (l: GrowthLead) => l.source === 'Phone Call';
  const callWins = won.filter(fromCalls);
  const known = calls.filter((c) => c.leadState === 'existing_lead' && !c.handled).length;

  return {
    leadsReceived: received.length,
    won: won.length,
    wonWithoutValue: won.length - values.length,
    wonFromEarlierLeads: won.filter((l) => new Date(l.createdAt).getTime() < p.from.getTime()).length,
    revenue,
    averageDeal: values.length ? Math.round(revenue / values.length) : null,
    conversionRate: pct(won.length, received.length),
    sources,
    followUps: { due: due.length, completed, missed, upcoming, completionRate: pct(completed, completed + missed) },
    calls: {
      measured: input.callsMeasured,
      received: calls.length,
      missed: calls.filter((c) => c.outcome === 'missed').length,
      knownCallers: known,
      unknownCallers: calls.length - known,
      savedAsLeads: calls.filter((c) => c.leadState === 'saved').length,
      linkedToExisting: calls.filter((c) => c.leadState === 'existing_lead' && c.handled).length,
      dismissed: calls.filter((c) => c.leadState === 'dismissed').length,
      awaitingDecision: calls.filter((c) => c.leadState === 'pending').length,
      leadsFromCalls: received.filter(fromCalls).length,
      wonFromCalls: callWins.length,
      revenueFromCalls: callWins.map(dealValue).reduce<number>((a, v) => a + (v ?? 0), 0),
    },
  };
}

// ── Comparison ────────────────────────────────────────────────────────────

export interface Change {
  current: number | null;
  previous: number | null;
  /** Relative % change; null when the previous value is 0 / unknown (never growth "from zero"). */
  percentChange: number | null;
  /** Percentage-POINT change, for metrics that are themselves percentages. */
  pointChange: number | null;
  kind: 'count' | 'money' | 'rate';
}

function change(cur: number | null, prev: number | null, kind: Change['kind']): Change {
  if (kind === 'rate') {
    return { current: cur, previous: prev, percentChange: null, pointChange: cur != null && prev != null ? round1(cur - prev) : null, kind };
  }
  return {
    current: cur, previous: prev, pointChange: null, kind,
    percentChange: cur != null && prev != null && prev > 0 ? round1(((cur - prev) / prev) * 100) : null,
  };
}

const hasData = (m: PeriodMetrics) => m.leadsReceived + m.won + m.followUps.due + m.calls.received > 0;

// ── Report ────────────────────────────────────────────────────────────────

export interface GrowthReport {
  period: { key: string; label: string; rangeLabel: string; complete: boolean; timeZone: string; prevKey: string; nextKey: string | null; currentKey: string; latestCompleteKey: string };
  business: { name: string };
  currency: string;
  mixedCurrencies: boolean;
  metrics: PeriodMetrics;
  roi: { revenue: number; investment: number | null; monthlyInvestment: number | null; roiPercent: number | null; note: string | null };
  comparison: {
    available: boolean;
    note: string | null;
    previousLabel: string;
    leads: Change; won: Change; revenue: Change; conversionRate: Change; followUpCompletionRate: Change;
  };
  pipeline: { open: number; active: number; total: number };
  attention: { overdueTasks: number; leadsWithOverdueTasks: number; leadsNotContacted: number; staleDays: number };
  summary: { data: string[]; interpretation: string[] };
  highlights: string[];
  footer: string;
}

export function formatMoney(v: number, currency = 'INR') {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${currency} ${Math.round(v).toLocaleString('en-IN')}`;
  }
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const moveWord = (pc: number) => (pc > 0 ? `increased by ${Math.abs(pc)}%` : pc < 0 ? `decreased by ${Math.abs(pc)}%` : 'was unchanged');

export function buildGrowthReport(input: {
  resolved: ResolvedReportMonth;
  now: Date;
  businessName: string;
  leads: GrowthLead[];
  tasks: GrowthTask[];
  calls: GrowthCall[];
  callsMeasured: boolean;
  monthlyInvestment?: number | null;
  /** Leads with a booked (Scheduled / Pending Confirmation) appointment — not "needing follow-up". */
  bookedLeadIds?: Set<string>;
}): GrowthReport {
  const { resolved, now } = input;
  const p = resolved.period;
  const cur = computePeriodMetrics({ period: p, now, leads: input.leads, tasks: input.tasks, calls: input.calls, callsMeasured: input.callsMeasured });
  const prev = computePeriodMetrics({ period: resolved.previous, now, leads: input.leads, tasks: input.tasks, calls: input.calls, callsMeasured: input.callsMeasured });

  const wonNow = input.leads.filter((l) => wonIn(l, p) && dealValue(l) != null);
  const currencies = new Set(wonNow.map((l) => l.deal?.currency || 'INR'));
  const currency = [...currencies][0] || 'INR';
  const money = (v: number) => formatMoney(v, currency);

  const { monthly, investmentAmount, roiPercent } = computeRoiFigures(cur.revenue, input.monthlyInvestment, p.days);

  const prevAvailable = hasData(prev);
  const comparison = {
    available: prevAvailable,
    note: prevAvailable ? null : 'No previous-month data available.',
    previousLabel: resolved.previous.complete ? resolved.previous.label : `${resolved.previous.rangeLabel}`,
    leads: change(cur.leadsReceived, prevAvailable ? prev.leadsReceived : null, 'count'),
    won: change(cur.won, prevAvailable ? prev.won : null, 'count'),
    revenue: change(cur.revenue, prevAvailable ? prev.revenue : null, 'money'),
    conversionRate: change(cur.conversionRate, prevAvailable ? prev.conversionRate : null, 'rate'),
    followUpCompletionRate: change(cur.followUps.completionRate, prevAvailable ? prev.followUps.completionRate : null, 'rate'),
  };

  // Snapshot — "right now", not historical (there is no stage history to rebuild a past pipeline).
  const live = input.leads.filter((l) => l.status !== 'inactive');
  const open = live.filter((l) => (l.lifeCycleStage || 'initial') === 'initial').length;
  const active = live.filter((l) => l.lifeCycleStage === 'active').length;
  const nowMs = now.getTime();
  const pendingTasks = input.tasks.filter((t) => t.status === 'pending');
  const overdue = pendingTasks.filter((t) => new Date(t.scheduledFor).getTime() < nowMs);
  const pendingLeadIds = new Set(pendingTasks.map((t) => String(t.leadId)));
  const booked = input.bookedLeadIds ?? new Set<string>();
  const cutoff = nowMs - STALE_LEAD_DAYS * DAY_MS;
  const notContacted = live.filter((l) => ['initial', 'active'].includes(l.lifeCycleStage || 'initial')
    && new Date(l.lastContactedAt || l.createdAt).getTime() <= cutoff
    && !pendingLeadIds.has(String(l._id)) && !booked.has(String(l._id))).length;

  // ── Summary: DATA (what happened) …
  const when = p.complete ? p.label : `So far in ${p.label.split(' ')[0]} (month to date)`;
  const data: string[] = [
    `${when}${p.complete ? ' brought' : ':'} ${plural(cur.leadsReceived, 'new lead')}, with ${plural(cur.won, 'recorded win')} and ${money(cur.revenue)} in recorded revenue.`,
  ];
  if (cur.wonWithoutValue > 0) data.push(`${plural(cur.wonWithoutValue, 'won lead')} ${cur.wonWithoutValue === 1 ? 'has' : 'have'} no deal value recorded and ${cur.wonWithoutValue === 1 ? 'is' : 'are'} not included in revenue.`);
  if (prevAvailable) {
    const parts: string[] = [];
    const lc = comparison.leads;
    if (lc.percentChange != null) parts.push(`lead volume ${moveWord(lc.percentChange)}`);
    else if ((lc.previous ?? 0) === 0 && cur.leadsReceived > 0) parts.push(`leads rose from 0 to ${cur.leadsReceived}`);
    const rc = comparison.revenue;
    if (rc.percentChange != null) parts.push(`recorded revenue ${moveWord(rc.percentChange)}`);
    else if ((rc.previous ?? 0) === 0 && cur.revenue > 0) parts.push(`recorded revenue rose from ${money(0)} to ${money(cur.revenue)}`);
    if (parts.length) data.push(`Compared with ${comparison.previousLabel}, ${parts.join(' while ')}.`);
  }

  // … and INTERPRETATION (what the numbers suggest) — cautious, never causal.
  const interpretation: string[] = [];
  const cpp = comparison.conversionRate.pointChange;
  if (comparison.leads.percentChange != null && comparison.leads.percentChange > 0 && cpp != null && cpp < 0) {
    interpretation.push('More leads came in, but a smaller share of them were won than last month.');
  }
  if (cur.followUps.missed > 0) interpretation.push(`${plural(cur.followUps.missed, 'follow-up')} due in this period ${cur.followUps.missed === 1 ? 'was' : 'were'} not completed.`);
  if (notContacted > 0) interpretation.push(`${plural(notContacted, 'lead')} currently ${notContacted === 1 ? 'needs' : 'need'} follow-up (no contact for ${STALE_LEAD_DAYS}+ days).`);
  if (cur.calls.measured && cur.calls.awaitingDecision > 0) interpretation.push(`${plural(cur.calls.awaitingDecision, 'call')} from this period ${cur.calls.awaitingDecision === 1 ? 'is' : 'are'} still waiting to be saved or dismissed.`);

  // ── Highlights — only where the data supports them; ties shown as ties.
  const highlights: string[] = [];
  const withLeads = cur.sources.filter((s) => s.leads > 0);
  if (withLeads.length) {
    const top = withLeads[0].leads;
    const tied = withLeads.filter((s) => s.leads === top);
    highlights.push(tied.length === 1
      ? `Your highest lead source was ${tied[0].source} with ${plural(top, 'lead')}.`
      : `${tied.map((s) => s.source).join(' and ')} each brought ${plural(top, 'lead')}.`);
  }
  const withRevenue = cur.sources.filter((s) => s.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  if (withRevenue.length && (withRevenue.length === 1 || withRevenue[0].revenue > withRevenue[1].revenue)) {
    highlights.push(`${withRevenue[0].source} brought the most recorded revenue: ${money(withRevenue[0].revenue)}.`);
  }
  if (cur.calls.measured && cur.calls.savedAsLeads > 0) highlights.push(`Calls generated ${plural(cur.calls.savedAsLeads, 'saved lead')}.`);
  if (cur.followUps.completionRate != null) highlights.push(`Your follow-up completion rate was ${cur.followUps.completionRate}%.`);
  if (comparison.revenue.percentChange != null && cur.revenue > 0) {
    highlights.push(`Recorded revenue ${moveWord(comparison.revenue.percentChange)} compared with ${comparison.previousLabel}.`);
  }
  if (cur.averageDeal != null) highlights.push(`Average recorded deal: ${money(cur.averageDeal)}.`);

  return {
    period: { key: p.key, label: p.complete ? p.label : `${p.label} (month to date)`, rangeLabel: p.rangeLabel, complete: p.complete, timeZone: p.timeZone, prevKey: resolved.prevKey, nextKey: resolved.nextKey, currentKey: resolved.currentKey, latestCompleteKey: resolved.latestCompleteKey },
    business: { name: input.businessName },
    currency,
    mixedCurrencies: currencies.size > 1,
    metrics: cur,
    roi: {
      revenue: cur.revenue,
      investment: investmentAmount,
      monthlyInvestment: monthly,
      roiPercent,
      note: monthly == null ? ROI_UNAVAILABLE_NOTE : cur.wonWithoutValue > 0 ? `${plural(cur.wonWithoutValue, 'won lead')} without a deal value ${cur.wonWithoutValue === 1 ? 'is' : 'are'} not in the revenue.` : null,
    },
    comparison,
    pipeline: { open, active, total: open + active },
    attention: { overdueTasks: overdue.length, leadsWithOverdueTasks: new Set(overdue.map((t) => String(t.leadId))).size, leadsNotContacted: notContacted, staleDays: STALE_LEAD_DAYS },
    summary: { data, interpretation },
    highlights,
    footer: `Based on recorded CRM activity for ${p.complete ? p.label : `${p.rangeLabel} (month to date)`}.`,
  };
}
