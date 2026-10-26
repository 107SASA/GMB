import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import LeadEvent from '@/models/LeadEvent';
import DemoBooking from '@/models/DemoBooking';
import { createdAtFilter, scoped, type ResolvedRange } from '@/lib/admin/conversionFunnel';
import {
  FUNNEL_SEGMENTS,
  SEGMENTS,
  UPCOMING_BOOKING_STATUSES,
  rate,
  reachedMilestones,
  type Milestone,
} from '@/lib/admin/leadMilestones';

/**
 * Loads platform leads with everything lib/admin/leadMilestones.ts needs —
 * milestone events and demo bookings — and builds the Conversion Overview /
 * Analytics report from the SAME segment registry the Leads & Pipeline page
 * filters with.
 */

/** Event types that mark a milestone or carry its timing. MESSAGE_* events are never loaded here. */
export const MILESTONE_EVENT_TYPES = [
  'LEAD_CREATED', 'INTENT_CHANGED', 'DEMO_REQUESTED', 'DEMO_SCHEDULED', 'DEMO_RESCHEDULED',
  'DEMO_COMPLETED', 'DEMO_NO_SHOW', 'PAYMENT_SUCCESS', 'CUSTOMER_ACTIVATED', 'HUMAN_HANDOFF', 'OPT_OUT',
];

export const LEAD_ROW_FIELDS =
  'name phone email businessId businessType source createdAt currentAgent currentStage intent leadScore aiLeadScore ' +
  'nextBestAction nextActionAt nurtureStatus humanHandoff lastActivityAt lastMeaningfulInteractionAt ' +
  'city tags assignedUserId deal captureSources subStage subStageId';

export interface LeadRow {
  lead: any;
  reached: Set<Milestone>;
  bookings: any[];
  /** First time each timed milestone event happened. */
  firstAt: Partial<Record<'demoScheduled' | 'paid', Date>>;
}

/**
 * Milestone events for these leads: by leadId, or (events logged before a
 * Lead existed) by phone — but never a customer tenant's event, and never an
 * event that names a different lead.
 */
async function eventsByLead(leads: any[]): Promise<Map<string, any[]>> {
  const ids = leads.map((l) => l._id);
  const byPhone = new Map<string, string>();
  for (const l of leads) if (l.phone) byPhone.set(l.phone, String(l._id));
  const out = new Map<string, any[]>();
  if (!ids.length) return out;
  const events: any[] = await LeadEvent.find({
    type: { $in: MILESTONE_EVENT_TYPES },
    $or: [
      { leadId: { $in: ids } },
      { leadId: { $exists: false }, phone: { $in: [...byPhone.keys()] }, conversationType: { $ne: 'tenant' } },
    ],
  })
    .select('leadId phone type payload createdAt')
    .sort({ createdAt: 1 })
    .lean();
  for (const e of events) {
    const key = e.leadId ? String(e.leadId) : byPhone.get(e.phone);
    if (!key) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(e);
  }
  return out;
}

/** Platform leads matching `filter`, each with its reached milestones. */
export async function loadLeadRows(filter: Record<string, unknown> = {}, fields = LEAD_ROW_FIELDS): Promise<LeadRow[]> {
  await dbConnect();
  const leads: any[] = await Lead.find(scoped(filter)).select(fields).lean();
  if (!leads.length) return [];
  const [events, bookings] = await Promise.all([
    eventsByLead(leads),
    DemoBooking.find({ leadId: { $in: leads.map((l) => l._id) } })
      .select('leadId status date timeSlot startUtc createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .lean() as Promise<any[]>,
  ]);
  const bookingsByLead = new Map<string, any[]>();
  for (const b of bookings) {
    const k = String(b.leadId);
    if (!bookingsByLead.has(k)) bookingsByLead.set(k, []);
    bookingsByLead.get(k)!.push(b);
  }
  return leads.map((lead) => {
    const id = String(lead._id);
    const ev = events.get(id) ?? [];
    const bk = bookingsByLead.get(id) ?? [];
    const first = (types: string[]) => ev.find((e) => types.includes(e.type))?.createdAt as Date | undefined;
    return {
      lead,
      reached: reachedMilestones(lead, ev, bk),
      bookings: bk,
      firstAt: {
        demoScheduled: first(['DEMO_SCHEDULED']),
        paid: first(['PAYMENT_SUCCESS', 'CUSTOMER_ACTIVATED']),
      },
    };
  });
}

export const countSegment = (rows: LeadRow[], key: string) =>
  SEGMENTS[key] ? rows.filter((r) => SEGMENTS[key].test({ lead: r.lead, reached: r.reached })).length : 0;

function avgDays(rows: LeadRow[], pick: (r: LeadRow) => Date | undefined) {
  const gaps: number[] = [];
  for (const r of rows) {
    const end = pick(r);
    const start = r.lead.createdAt ? new Date(r.lead.createdAt) : null;
    if (end && start && end.getTime() >= start.getTime()) gaps.push((end.getTime() - start.getTime()) / 86_400_000);
  }
  if (gaps.length < 3) return { value: null, unavailable: `only ${gaps.length} data points — need at least 3`, sampleSize: gaps.length };
  return { value: Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10, sampleSize: gaps.length };
}

/** Demo bookings of these leads, by status — bookings, not leads. */
export function bookingSummary(rows: LeadRow[], now = new Date()) {
  const all = rows.flatMap((r) => r.bookings);
  const n = (s: string) => all.filter((b) => b.status === s).length;
  const upcoming = all.filter((b) => UPCOMING_BOOKING_STATUSES.includes(b.status) && (!b.startUtc || new Date(b.startUtc).getTime() >= now.getTime())).length;
  return {
    total: all.length,
    upcoming,
    pending: n('Pending'),
    confirmed: n('Confirmed') + n('Rescheduled'),
    completed: n('Completed'),
    noShow: n('No Show'),
    cancelled: n('Cancelled'),
    noShowRate: rate(n('No Show'), n('Completed') + n('No Show'), 'no demos held yet'),
  };
}

/** The report for leads created in `range` (all time when the range is open). */
export async function conversionReport(range: ResolvedRange) {
  const rows = await loadLeadRows(createdAtFilter(range));
  const leads = rows.length;
  const count = (key: string) => countSegment(rows, key);

  const funnel = [
    { key: 'leads', label: 'Leads', count: leads },
    ...FUNNEL_SEGMENTS.map((key) => ({ key, label: SEGMENTS[key].label, count: count(key) })),
  ];

  const demoDone = rows.filter((r) => r.reached.has('demoCompleted'));
  const demoToPurchase = demoDone.filter((r) => r.reached.has('purchaseIntent')).length;

  const segments = Object.fromEntries(Object.keys(SEGMENTS).map((k) => [k, count(k)]));

  return {
    leads,
    segments,
    funnel,
    bookings: bookingSummary(rows),
    conversion: {
      leadToQualified: rate(segments.qualified, leads),
      leadToDemo: rate(segments.demoInterest, leads),
      leadToDemoScheduled: rate(segments.demoScheduled, leads),
      demoToPurchase: rate(demoToPurchase, demoDone.length, 'no completed demos yet'),
      leadToCustomer: rate(segments.customer, leads),
      humanHandoffRate: rate(segments.everHandedOff, leads),
      optOutRate: rate(segments.everOptedOut, leads),
      lostRate: rate(rows.filter((r) => ['LOST', 'DO_NOT_CONTACT'].includes(r.lead.currentStage)).length, leads),
      noShowRate: bookingSummary(rows).noShowRate,
      avgTimeToDemoDays: avgDays(rows, (r) => r.firstAt.demoScheduled),
      avgTimeToConversionDays: avgDays(rows, (r) => r.firstAt.paid),
    },
    rows,
  };
}
