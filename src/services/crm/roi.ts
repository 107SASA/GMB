/**
 * Customer CRM revenue / ROI — pure (runs under `node --test`).
 *
 * Converted = lifeCycleStage 'converted' (the one canonical definition).
 * Revenue = sum of recorded deal values. ROI is shown ONLY when the owner has
 * configured what they spend; otherwise "unavailable" — never a fake 0%.
 * Missed calls are counted as opportunities, never turned into lost revenue.
 */

export interface RoiLead {
  source?: string | null;
  lifeCycleStage?: string | null;
  createdAt: Date | string;
  convertedAt?: Date | string | null;
  deal?: { value?: number | null; currency?: string | null; valueMissing?: boolean | null } | null;
}

export interface RoiCall {
  phone: string;
  startedAt: Date | string;
  outcome: string;
  leadState: string;
  leadId?: string | null;
}

export interface SourceRow {
  source: string;
  leads: number;
  converted: number;
  conversionRate: number | null;
  wonRevenue: number;
  averageDeal: number | null;
}

export interface CrmRoi {
  period: { from: string; to: string; days: number };
  currency: string;
  totalLeads: number;
  convertedLeads: number;
  /** Converted leads whose deal value was never recorded (e.g. older app builds). */
  convertedWithoutValue: number;
  wonRevenue: number;
  conversionRate: number | null;
  averageDealValue: number | null;
  revenuePerLead: number | null;
  investment: { amount: number; monthly: number; currency: string } | null;
  roiPercent: number | null;
  roiNote: string | null;
  bySource: SourceRow[];
  phone: {
    observed: boolean;
    callsReceived: number;
    uniqueCallers: number;
    missedCalls: number;
    callsFromKnownLeads: number;
    savedAsLeads: number;
    notSaved: number;
    convertedCallLeads: number;
    callLeadRevenue: number;
  };
}

const DAY = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number) => (b > 0 ? round1((a / b) * 100) : null);
const inRange = (d: Date | string | null | undefined, from: Date, to: Date) => {
  if (!d) return false;
  const t = new Date(d).getTime();
  return t >= from.getTime() && t < to.getTime();
};
const isConverted = (l: RoiLead) => l.lifeCycleStage === 'converted';
const value = (l: RoiLead) => (typeof l.deal?.value === 'number' && l.deal.value >= 0 ? l.deal.value : null);

export const ROI_UNAVAILABLE_NOTE = 'ROI unavailable — investment/cost not configured.';

/**
 * The ONE Customer CRM ROI rule (Analytics + Monthly Growth Report):
 * investment = configured monthly amount × period days / 30.44; ROI % =
 * (revenue − investment) ÷ investment × 100. No / zero / negative monthly
 * amount → not configured → ROI null (never a fake 0%).
 */
export function computeRoiFigures(revenue: number, monthlyAmount: number | null | undefined, days: number): {
  monthly: number | null; investmentAmount: number | null; roiPercent: number | null;
} {
  const monthly = typeof monthlyAmount === 'number' && monthlyAmount > 0 ? monthlyAmount : null;
  const investmentAmount = monthly != null ? Math.round(monthly * (days / 30.44)) : null;
  const roiPercent = investmentAmount && investmentAmount > 0 ? round1(((revenue - investmentAmount) / investmentAmount) * 100) : null;
  return { monthly, investmentAmount, roiPercent };
}

/**
 * Leads CREATED in the period are the denominator; their conversions (any
 * time up to `to`) are the numerator — so the conversion rate describes that
 * cohort of leads.
 */
export function computeCrmRoi(input: {
  leads: RoiLead[];
  calls: RoiCall[];
  from: Date;
  to: Date;
  currency?: string;
  investment?: { monthlyAmount?: number | null; currency?: string | null } | null;
  /** Lead ids that came from a saved call, with their conversion state. */
  callLeadIds?: Set<string>;
  callLeads?: RoiLead[];
}): CrmRoi {
  const { from, to } = input;
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY));
  const cohort = input.leads.filter((l) => inRange(l.createdAt, from, to));
  const converted = cohort.filter(isConverted);
  const withValue = converted.filter((l) => value(l) != null);
  const wonRevenue = withValue.reduce((a, l) => a + (value(l) || 0), 0);
  const currency = input.currency || converted.find((l) => l.deal?.currency)?.deal?.currency || 'INR';

  const { monthly, investmentAmount, roiPercent } = computeRoiFigures(wonRevenue, input.investment?.monthlyAmount, days);
  const roiNote = monthly == null
    ? ROI_UNAVAILABLE_NOTE
    : converted.length && withValue.length < converted.length
      ? `${converted.length - withValue.length} converted lead(s) have no deal value recorded and are not in the revenue.`
      : null;

  const sources = new Map<string, RoiLead[]>();
  for (const l of cohort) {
    const k = l.source || 'Unknown';
    sources.set(k, [...(sources.get(k) || []), l]);
  }
  const bySource: SourceRow[] = Array.from(sources.entries())
    .map(([source, ls]) => {
      const conv = ls.filter(isConverted);
      const vals = conv.map(value).filter((v): v is number => v != null);
      const won = vals.reduce((a, v) => a + v, 0);
      return {
        source,
        leads: ls.length,
        converted: conv.length,
        conversionRate: pct(conv.length, ls.length),
        wonRevenue: won,
        averageDeal: vals.length ? Math.round(won / vals.length) : null,
      };
    })
    .sort((a, b) => b.wonRevenue - a.wonRevenue || b.leads - a.leads);

  const calls = input.calls.filter((c) => inRange(c.startedAt, from, to));
  const callLeads = input.callLeads || [];
  const convertedCall = callLeads.filter(isConverted);
  return {
    period: { from: from.toISOString(), to: to.toISOString(), days },
    currency,
    totalLeads: cohort.length,
    convertedLeads: converted.length,
    convertedWithoutValue: converted.length - withValue.length,
    wonRevenue,
    conversionRate: pct(converted.length, cohort.length),
    averageDealValue: withValue.length ? Math.round(wonRevenue / withValue.length) : null,
    revenuePerLead: cohort.length ? Math.round(wonRevenue / cohort.length) : null,
    investment: investmentAmount != null ? { amount: investmentAmount, monthly: monthly!, currency: input.investment?.currency || currency } : null,
    roiPercent,
    roiNote,
    bySource,
    phone: {
      observed: calls.length > 0,
      callsReceived: calls.length,
      uniqueCallers: new Set(calls.map((c) => c.phone)).size,
      missedCalls: calls.filter((c) => c.outcome === 'missed').length,
      callsFromKnownLeads: calls.filter((c) => c.leadState === 'existing_lead').length,
      savedAsLeads: calls.filter((c) => c.leadState === 'saved').length,
      notSaved: calls.filter((c) => c.leadState === 'pending' || c.leadState === 'dismissed').length,
      convertedCallLeads: convertedCall.length,
      callLeadRevenue: convertedCall.reduce((a, l) => a + (value(l) || 0), 0),
    },
  };
}

/** Plain-language missed-opportunity lines — counts only, never an amount of money. */
export function missedOpportunityLines(r: CrmRoi): string[] {
  const lines: string[] = [];
  const p = r.phone;
  if (p.notSaved > 0) {
    lines.push(`${p.notSaved} call${p.notSaved === 1 ? ' was' : 's were'} not saved as a lead.`);
    lines.push('If these were genuine prospects, they are missed CRM opportunities — save them to follow up.');
  }
  if (p.missedCalls > 0) lines.push(`${p.missedCalls} call${p.missedCalls === 1 ? ' was' : 's were'} missed.`);
  return lines;
}
