/**
 * Shared query layer for the SuperAdmin **Conversion Dashboard**
 * (/admin/pipeline and friends, served by /api/admin/conversion/*).
 *
 * SOURCE OF TRUTH — this dashboard is built ENTIRELY on the Lead Engine, not
 * on the legacy Business.pipelineStage funnel:
 *
 *   Lead        (tenantId 'gmbboost-internal', leadType 'Platform Prospect')
 *   + LeadEvent (append-only timeline — src/models/LeadEvent.ts)
 *   + DemoBooking
 *   + Business.subscriptionStatus  (the real per-workspace billing state,
 *                                   set by the Razorpay webhook)
 *
 * FUNNEL STAGE MAPPING (documented once here; every consumer uses these
 * predicates so the numbers can never disagree between the overview KPIs,
 * the funnel chart and the pipeline table):
 *
 *   LEADS            every platform-prospect Lead
 *   QUALIFIED        past NEW: currentStage is QUALIFYING, NURTURING, any
 *                    DEMO_ stage, CONVERSION_PENDING, PAYMENT_VERIFIED or
 *                    CUSTOMER, OR leadScore >= 15, OR intent not EXPLORING
 *   SALES_NURTURING  currentAgent SALES and currentStage in QUALIFYING/NURTURING
 *   DEMO_INTEREST    intent DEMO_INTEREST OR currentStage DEMO_REQUESTED
 *   DEMO_SCHEDULED   currentStage DEMO_SCHEDULED OR a DemoBooking in
 *                    Pending/Confirmed/Rescheduled
 *   DEMO_COMPLETED   currentStage DEMO_COMPLETED OR a DemoBooking Completed
 *   PURCHASE_INTENT  intent PURCHASE_INTEREST/READY_TO_BUY OR currentStage
 *                    CONVERSION_PENDING OR nextBestAction OFFER_SUBSCRIPTION
 *   PAYMENT          currentStage PAYMENT_VERIFIED OR a CUSTOMER_ACTIVATED or
 *                    PAYMENT_SUCCESS LeadEvent
 *   CUSTOMER         currentStage CUSTOMER OR currentAgent IN_HOUSE
 *
 *   (side states, not part of the linear funnel)
 *   LOST             currentStage LOST
 *   OPTED_OUT        nurtureStatus OPTED_OUT
 *   HUMAN_HANDOFF    currentAgent HUMAN
 *
 * These are DERIVED views over existing state — no new Lead field, no new
 * event type, no parallel funnel-state machine.
 *
 * All of this is SuperAdmin-only (every route calls requireSuperAdmin) and
 * hard-scoped to the platform tenant — it never reads another business's
 * private customer data.
 */
// Query fragments are plain objects composed by the routes; keeping this a
// loose record avoids coupling to a specific mongoose type-export shape.
type FilterQuery<_T = unknown> = Record<string, unknown>;

/** The one tenant every query here is locked to. */
export const PLATFORM_TENANT = 'gmbboost-internal';
export const PLATFORM_LEAD_MATCH = { tenantId: PLATFORM_TENANT } as const;

export type DateRangeKey = 'today' | '7d' | '30d' | '90d' | 'all' | 'custom';

export interface ResolvedRange {
  key: DateRangeKey;
  /** Inclusive lower bound, or null for "all time". */
  since: Date | null;
  until: Date | null;
}

/** Parses ?range= / ?from= / ?to= into a concrete window. Defaults to 30d. */
export function resolveDateRange(params: URLSearchParams): ResolvedRange {
  const key = (params.get('range') || '30d') as DateRangeKey;
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  if (key === 'custom') {
    const from = params.get('from');
    const to = params.get('to');
    return {
      key,
      since: from ? new Date(from) : null,
      until: to ? new Date(to) : null,
    };
  }
  if (key === 'all') return { key, since: null, until: null };
  if (key === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { key, since: start, until: null };
  }
  const map: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
  return { key: (map[key] ? key : '30d') as DateRangeKey, since: daysAgo(map[key] ?? 30), until: null };
}

/** A `createdAt` filter fragment for a resolved range (empty when "all"). */
export function createdAtFilter(range: ResolvedRange): Record<string, unknown> {
  if (!range.since && !range.until) return {};
  const f: Record<string, Date> = {};
  if (range.since) f.$gte = range.since;
  if (range.until) f.$lte = range.until;
  return { createdAt: f };
}

// ---------------------------------------------------------------------------
// Funnel-stage predicates as Mongo filter fragments (composed with the
// platform-tenant match + optional date filter by callers).
// ---------------------------------------------------------------------------

export const STAGE_SETS = {
  /** Everything at or past QUALIFYING (used for the "engaged" definition). */
  pastNew: ['QUALIFYING', 'NURTURING', 'DEMO_REQUESTED', 'DEMO_SCHEDULED', 'DEMO_COMPLETED', 'CONVERSION_PENDING', 'PAYMENT_VERIFIED', 'CUSTOMER'],
  demoScheduled: ['DEMO_SCHEDULED'],
  demoCompleted: ['DEMO_COMPLETED'],
} as const;

export const FUNNEL_FILTERS: Record<string, FilterQuery<any>> = {
  leads: {},
  qualified: {
    $or: [
      { currentStage: { $in: STAGE_SETS.pastNew } },
      { leadScore: { $gte: 15 } },
      { intent: { $nin: ['EXPLORING', null] } },
    ],
  },
  salesNurturing: { currentAgent: 'SALES', currentStage: { $in: ['QUALIFYING', 'NURTURING'] } },
  demoInterest: { $or: [{ intent: 'DEMO_INTEREST' }, { currentStage: 'DEMO_REQUESTED' }] },
  demoScheduled: { currentStage: 'DEMO_SCHEDULED' },
  demoCompleted: { currentStage: 'DEMO_COMPLETED' },
  purchaseIntent: {
    $or: [
      { intent: { $in: ['PURCHASE_INTEREST', 'READY_TO_BUY'] } },
      { currentStage: 'CONVERSION_PENDING' },
      { nextBestAction: 'OFFER_SUBSCRIPTION' },
    ],
  },
  paymentVerified: { currentStage: 'PAYMENT_VERIFIED' },
  customer: { $or: [{ currentStage: 'CUSTOMER' }, { currentAgent: 'IN_HOUSE' }] },
  lost: { currentStage: 'LOST' },
  optedOut: { nurtureStatus: 'OPTED_OUT' },
  humanHandoff: { currentAgent: 'HUMAN' },
};

/** The ordered funnel steps the chart renders, top (widest) to bottom. */
export const FUNNEL_STEPS: { key: string; label: string; filter: FilterQuery<any> }[] = [
  { key: 'leads', label: 'Leads', filter: FUNNEL_FILTERS.leads },
  { key: 'qualified', label: 'Qualified / engaged', filter: FUNNEL_FILTERS.qualified },
  { key: 'salesNurturing', label: 'Sales nurturing', filter: FUNNEL_FILTERS.salesNurturing },
  { key: 'demoInterest', label: 'Demo interest', filter: FUNNEL_FILTERS.demoInterest },
  { key: 'demoScheduled', label: 'Demo scheduled', filter: FUNNEL_FILTERS.demoScheduled },
  { key: 'demoCompleted', label: 'Demo completed', filter: FUNNEL_FILTERS.demoCompleted },
  { key: 'purchaseIntent', label: 'Purchase intent', filter: FUNNEL_FILTERS.purchaseIntent },
  { key: 'paymentVerified', label: 'Payment verified', filter: FUNNEL_FILTERS.paymentVerified },
  { key: 'customer', label: 'Customer', filter: FUNNEL_FILTERS.customer },
];

/** Combines the platform-tenant match with an optional extra filter. */
export function scoped(extra: FilterQuery<any> = {}): FilterQuery<any> {
  return { ...PLATFORM_LEAD_MATCH, ...extra };
}

/**
 * Derives a single human-readable funnel-stage label for one lead doc — the
 * FURTHEST stage it has reached. Used by the pipeline table & lead detail so
 * the UI shows one consistent "where is this lead" answer.
 */
export function deriveFunnelStage(lead: {
  currentStage?: string | null;
  currentAgent?: string | null;
  nurtureStatus?: string | null;
  intent?: string | null;
  leadScore?: number | null;
}): string {
  if (lead.currentAgent === 'IN_HOUSE' || lead.currentStage === 'CUSTOMER') return 'Customer';
  if (lead.currentStage === 'PAYMENT_VERIFIED') return 'Payment verified';
  if (lead.nurtureStatus === 'OPTED_OUT') return 'Opted out';
  if (lead.currentStage === 'LOST') return 'Lost';
  if (lead.currentAgent === 'HUMAN' || lead.currentStage === 'HUMAN_HANDOFF') return 'Human handoff';
  if (lead.currentStage === 'CONVERSION_PENDING' || ['PURCHASE_INTEREST', 'READY_TO_BUY'].includes(lead.intent || '')) return 'Purchase intent';
  if (lead.currentStage === 'DEMO_COMPLETED') return 'Demo completed';
  if (lead.currentStage === 'DEMO_SCHEDULED') return 'Demo scheduled';
  if (lead.currentStage === 'DEMO_REQUESTED' || lead.intent === 'DEMO_INTEREST') return 'Demo interest';
  if (lead.currentStage === 'NURTURING') return 'Sales nurturing';
  if (lead.currentStage === 'QUALIFYING' || (lead.leadScore ?? 0) >= 15 || (lead.intent && lead.intent !== 'EXPLORING')) return 'Qualified';
  return 'New';
}
