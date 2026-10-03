import { z } from 'zod';
import { api } from '../client';

/**
 * Customer CRM — the SAME stage model, follow-up tasks, calls and ROI the web
 * CRM uses (one source of truth on the server). Stages are lifeCycleStage
 * groups + sub-stages with stable ids from /api/business/lead-stages.
 */

// ── Stages ────────────────────────────────────────────────────────────────

const subStageSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  color: z.string().catch('slate'),
});
export type SubStage = z.infer<typeof subStageSchema>;

const stagesSchema = z.object({
  initialLabel: z.string().catch('Open'),
  active: z.array(subStageSchema).catch([]),
  converted: z.array(subStageSchema).catch([]),
  closed: z.array(subStageSchema).catch([]),
});
export type LeadStages = z.infer<typeof stagesSchema>;
export type LifeCycleStage = 'initial' | 'active' | 'converted' | 'closed';
export const LIFECYCLE_STAGES: LifeCycleStage[] = ['initial', 'active', 'converted', 'closed'];

export function groupLabel(stages: LeadStages | undefined, lc: string): string {
  if (lc === 'initial') return stages?.initialLabel || 'Open';
  if (lc === 'converted') return 'Won';
  if (lc === 'closed') return 'Lost';
  return 'Active';
}

/** GET /api/business/lead-stages */
export async function fetchLeadStages(): Promise<LeadStages> {
  const { data } = await api.get('/api/business/lead-stages');
  return stagesSchema.parse(data?.leadStages ?? {});
}

// ── Follow-up tasks ───────────────────────────────────────────────────────

export const FOLLOW_UP_TYPES = ['Call', 'WhatsApp', 'Email', 'Meeting', 'Other'] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];

const followUpSchema = z.object({
  _id: z.string(),
  type: z.string().nullable().catch('Call'),
  note: z.string().nullable().optional(),
  scheduledFor: z.string(),
  status: z.string().catch('pending'),
  completedAt: z.string().nullable().optional(),
});
export type FollowUp = z.infer<typeof followUpSchema>;

/** GET /api/followups?leadId= — this lead's tasks (never messages to the lead). */
export async function fetchFollowUps(leadId: string): Promise<FollowUp[]> {
  const { data } = await api.get('/api/followups', { params: { leadId } });
  return z.array(followUpSchema.nullable().catch(null)).catch([]).parse(data?.followUps)
    .filter((f): f is FollowUp => f !== null);
}

export async function createFollowUp(params: { leadId: string; dueAt: Date; type: FollowUpType; note?: string }): Promise<void> {
  await api.post('/api/followups', { ...params, dueAt: params.dueAt.toISOString() });
}

export async function updateFollowUp(id: string, action: 'complete' | 'cancel'): Promise<void> {
  await api.patch(`/api/followups/${id}`, { action });
}

// ── Calls (telephony provider, e.g. Twilio tracking number) ──────────────

const callSchema = z.object({
  _id: z.string(),
  phone: z.string(),
  callerName: z.string().nullable().optional(),
  direction: z.string().catch('inbound'),
  outcome: z.string().catch('ringing'),
  leadState: z.string().catch('pending'),
  startedAt: z.string(),
  durationSec: z.number().nullable().optional(),
  leadId: z.object({ _id: z.string(), name: z.string().catch('Lead') }).nullable().catch(null),
});
export type CallEvent = z.infer<typeof callSchema>;

/** GET /api/crm/calls — recent provider calls + how many still need a decision. */
export async function fetchCalls(pendingOnly = false): Promise<{ calls: CallEvent[]; pendingCount: number }> {
  const { data } = await api.get('/api/crm/calls', { params: pendingOnly ? { state: 'pending' } : {} });
  return {
    calls: z.array(callSchema.nullable().catch(null)).catch([]).parse(data?.calls).filter((c): c is CallEvent => c !== null),
    pendingCount: typeof data?.pendingCount === 'number' ? data.pendingCount : 0,
  };
}

export type CallAction =
  | { action: 'save'; name?: string; createCallbackTask?: boolean }
  | { action: 'link'; leadId: string }
  | { action: 'dismiss' };

/** POST /api/crm/calls/[id] — Save as Lead / Existing Lead / Dismiss. Never messages the caller. */
export async function actOnCall(id: string, body: CallAction): Promise<void> {
  await api.post(`/api/crm/calls/${id}`, body);
}

// ── Revenue / ROI ─────────────────────────────────────────────────────────

const roiSchema = z.object({
  currency: z.string().catch('INR'),
  totalLeads: z.number().catch(0),
  convertedLeads: z.number().catch(0),
  convertedWithoutValue: z.number().catch(0),
  wonRevenue: z.number().catch(0),
  conversionRate: z.number().nullable().catch(null),
  averageDealValue: z.number().nullable().catch(null),
  revenuePerLead: z.number().nullable().catch(null),
  roiPercent: z.number().nullable().catch(null),
  roiNote: z.string().nullable().catch(null),
});
export type CrmRoi = z.infer<typeof roiSchema>;

/** GET /api/crm/roi?days= — ROI % is null unless the owner configured an investment. */
export async function fetchRoi(days = 30): Promise<{ roi: CrmRoi; missedOpportunities: string[] }> {
  const { data } = await api.get('/api/crm/roi', { params: { days } });
  return {
    roi: roiSchema.parse(data?.roi ?? {}),
    missedOpportunities: z.array(z.string()).catch([]).parse(data?.missedOpportunities),
  };
}

export function formatMoney(value: number | null | undefined, currency = 'INR'): string {
  if (value == null) return '—';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString()}`;
  }
}

// ── Monthly Growth Report (same endpoint + numbers as the web report) ──────

const num = z.number().catch(0);
const numOrNull = z.number().nullable().catch(null);
const changeSchema = z.object({
  current: numOrNull,
  previous: numOrNull,
  percentChange: numOrNull,
  pointChange: numOrNull,
  kind: z.enum(['count', 'money', 'rate']).catch('count'),
});
export type GrowthChange = z.infer<typeof changeSchema>;

const growthReportSchema = z.object({
  period: z.object({
    key: z.string(),
    label: z.string(),
    rangeLabel: z.string(),
    complete: z.boolean(),
    prevKey: z.string(),
    nextKey: z.string().nullable().catch(null),
    currentKey: z.string(),
    latestCompleteKey: z.string(),
  }),
  business: z.object({ name: z.string().catch('') }),
  currency: z.string().catch('INR'),
  mixedCurrencies: z.boolean().catch(false),
  metrics: z.object({
    leadsReceived: num,
    won: num,
    wonWithoutValue: num,
    wonFromEarlierLeads: num,
    revenue: num,
    averageDeal: numOrNull,
    conversionRate: numOrNull,
    sources: z.array(z.object({ source: z.string(), leads: num, won: num, revenue: num, conversionRate: numOrNull })).catch([]),
    followUps: z.object({ due: num, completed: num, missed: num, upcoming: num, completionRate: numOrNull }),
    calls: z.object({
      measured: z.boolean().catch(false),
      received: num, missed: num, knownCallers: num, unknownCallers: num, savedAsLeads: num,
      linkedToExisting: num, dismissed: num, awaitingDecision: num, leadsFromCalls: num, wonFromCalls: num, revenueFromCalls: num,
    }),
  }),
  roi: z.object({ revenue: num, investment: numOrNull, monthlyInvestment: numOrNull, roiPercent: numOrNull, note: z.string().nullable().catch(null) }),
  comparison: z.object({
    available: z.boolean().catch(false),
    note: z.string().nullable().catch(null),
    previousLabel: z.string().catch(''),
    leads: changeSchema, won: changeSchema, revenue: changeSchema, conversionRate: changeSchema, followUpCompletionRate: changeSchema,
  }),
  pipeline: z.object({ open: num, active: num, total: num }),
  attention: z.object({ overdueTasks: num, leadsWithOverdueTasks: num, leadsNotContacted: num, staleDays: num }),
  summary: z.object({ data: z.array(z.string()).catch([]), interpretation: z.array(z.string()).catch([]) }),
  highlights: z.array(z.string()).catch([]),
  footer: z.string().catch(''),
});
export type GrowthReport = z.infer<typeof growthReportSchema>;

/** GET /api/crm/growth-report?month=YYYY-MM | current — no month = latest completed month. */
export async function fetchGrowthReport(month?: string | null): Promise<GrowthReport> {
  const { data } = await api.get('/api/crm/growth-report', { params: month ? { month } : {} });
  return growthReportSchema.parse(data?.report);
}
