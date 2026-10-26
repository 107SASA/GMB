/**
 * Platform-lead milestones and segments — pure, so tests load it directly.
 *
 * ONE definition behind the Conversion Overview KPIs and funnel, the
 * Conversion Analytics rates, and the Leads & Pipeline filters: a KPI's
 * `segment` key is passed to /admin/leads?segment=<key>, which applies the
 * SAME predicate, so a number and the list it opens can't disagree.
 *
 * "Reached" milestones are historical: a lead that booked a demo and then
 * paid still counts as having scheduled a demo. They are derived from the
 * lead's current state, its LeadEvent history (platform events only — never
 * a customer tenant's), and its DemoBookings. Each milestone also implies the
 * ones it logically requires (a completed demo was scheduled; a payment
 * shows purchase intent). A purchase does NOT imply a demo — people can buy
 * without one — so the funnel is a list of stages reached, not a strict cone.
 */

/** Lead score from which a lead counts as qualified — the WARM band floor (services/nba/rules.ts computeScoreBand). */
export const QUALIFIED_MIN_SCORE = 26;

/** Stages that are themselves past NEW (a lead that got here engaged). */
export const PAST_NEW_STAGES = [
  'QUALIFYING', 'NURTURING', 'DEMO_REQUESTED', 'DEMO_SCHEDULED', 'DEMO_COMPLETED',
  'CONVERSION_PENDING', 'PAYMENT_VERIFIED', 'CUSTOMER',
];

const PURCHASE_INTENTS = ['PURCHASE_INTEREST', 'READY_TO_BUY'];
/** Intents that show engagement; EXPLORING (the default) and NOT_INTERESTED do not. */
const QUALIFYING_INTENTS = ['LEARNING', 'PROBLEM_AWARE', 'SOLUTION_AWARE', 'DEMO_INTEREST', ...PURCHASE_INTENTS];
/** Bookings that had a real slot (a cancelled-before-confirming Pending row is only a request). */
const SCHEDULED_BOOKING_STATUSES = ['Confirmed', 'Rescheduled', 'Completed', 'No Show'];
export const UPCOMING_BOOKING_STATUSES = ['Pending', 'Confirmed', 'Rescheduled'];

export interface LeadFacts {
  currentStage?: string | null;
  currentAgent?: string | null;
  intent?: string | null;
  leadScore?: number | null;
  nextBestAction?: string | null;
  nurtureStatus?: string | null;
  humanHandoff?: { active?: boolean | null } | null;
}

export interface MilestoneEvent {
  type: string;
  payload?: Record<string, unknown> | null;
}

export interface MilestoneBooking {
  status?: string | null;
}

export type Milestone =
  | 'qualified'
  | 'demoInterest'
  | 'demoScheduled'
  | 'demoCompleted'
  | 'purchaseIntent'
  | 'paymentVerified'
  | 'customer'
  | 'humanHandoff'
  | 'optedOut';

const isCustomerNow = (l: LeadFacts) => l.currentAgent === 'IN_HOUSE' || l.currentStage === 'CUSTOMER';

/** Every milestone this lead has ever reached. */
export function reachedMilestones(lead: LeadFacts, events: MilestoneEvent[] = [], bookings: MilestoneBooking[] = []): Set<Milestone> {
  const has = (t: string) => events.some((e) => e.type === t);
  const everIntents = new Set<string>([lead.intent || '']);
  for (const e of events) if (e.type === 'INTENT_CHANGED' && typeof e.payload?.to === 'string') everIntents.add(e.payload.to);
  const everIntent = (list: string[]) => list.some((i) => everIntents.has(i));
  const bookingWith = (statuses: string[]) => bookings.some((b) => statuses.includes(b.status || ''));
  const r = new Set<Milestone>();

  if (isCustomerNow(lead) || has('CUSTOMER_ACTIVATED')) r.add('customer');
  if (r.has('customer') || lead.currentStage === 'PAYMENT_VERIFIED' || has('PAYMENT_SUCCESS')) r.add('paymentVerified');
  if (
    r.has('paymentVerified') ||
    everIntent(PURCHASE_INTENTS) ||
    lead.currentStage === 'CONVERSION_PENDING' ||
    lead.nextBestAction === 'OFFER_SUBSCRIPTION'
  ) r.add('purchaseIntent');
  if (lead.currentStage === 'DEMO_COMPLETED' || has('DEMO_COMPLETED') || bookingWith(['Completed'])) r.add('demoCompleted');
  if (
    r.has('demoCompleted') ||
    lead.currentStage === 'DEMO_SCHEDULED' ||
    has('DEMO_SCHEDULED') || has('DEMO_RESCHEDULED') || has('DEMO_NO_SHOW') ||
    bookingWith(SCHEDULED_BOOKING_STATUSES)
  ) r.add('demoScheduled');
  if (
    r.has('demoScheduled') ||
    everIntent(['DEMO_INTEREST']) ||
    lead.currentStage === 'DEMO_REQUESTED' ||
    has('DEMO_REQUESTED') ||
    bookings.length > 0
  ) r.add('demoInterest');
  if (
    r.has('demoInterest') || r.has('purchaseIntent') ||
    PAST_NEW_STAGES.includes(lead.currentStage || '') ||
    (lead.leadScore ?? 0) >= QUALIFIED_MIN_SCORE ||
    everIntent(QUALIFYING_INTENTS)
  ) r.add('qualified');
  if (lead.currentAgent === 'HUMAN' || lead.humanHandoff?.active === true || has('HUMAN_HANDOFF')) r.add('humanHandoff');
  if (lead.nurtureStatus === 'OPTED_OUT' || has('OPT_OUT')) r.add('optedOut');
  return r;
}

/**
 * Where the lead is NOW — the furthest current stage, one label. The Stage
 * column and the Stage filter on Leads & Pipeline both use this.
 */
export function currentFunnelStage(lead: LeadFacts): string {
  if (isCustomerNow(lead)) return 'Customer';
  if (lead.currentStage === 'PAYMENT_VERIFIED') return 'Payment verified';
  if (lead.nurtureStatus === 'OPTED_OUT') return 'Opted out';
  if (lead.currentStage === 'LOST' || lead.currentStage === 'DO_NOT_CONTACT') return 'Lost';
  if (lead.currentAgent === 'HUMAN' || lead.currentStage === 'HUMAN_HANDOFF') return 'Human handoff';
  if (lead.currentStage === 'CONVERSION_PENDING' || PURCHASE_INTENTS.includes(lead.intent || '')) return 'Purchase intent';
  if (lead.currentStage === 'DEMO_COMPLETED') return 'Demo completed';
  if (lead.currentStage === 'DEMO_SCHEDULED') return 'Demo scheduled';
  if (lead.currentStage === 'DEMO_REQUESTED' || lead.intent === 'DEMO_INTEREST') return 'Demo interest';
  if (lead.currentStage === 'NURTURING') return 'Sales nurturing';
  if (['COLD', 'UNRESPONSIVE', 'LONG_TERM_NURTURE'].includes(lead.currentStage || '')) return 'Inactive';
  if (
    lead.currentStage === 'QUALIFYING' ||
    (lead.leadScore ?? 0) >= QUALIFIED_MIN_SCORE ||
    QUALIFYING_INTENTS.includes(lead.intent || '')
  ) return 'Qualified';
  return 'New';
}

export const CURRENT_STAGE_LABELS = [
  'New', 'Qualified', 'Sales nurturing', 'Demo interest', 'Demo scheduled', 'Demo completed',
  'Purchase intent', 'Payment verified', 'Customer', 'Human handoff', 'Inactive', 'Lost', 'Opted out',
];

/** Everything a segment predicate may look at for one lead. */
export interface SegmentInput {
  lead: LeadFacts;
  reached: Set<Milestone>;
}

export interface SegmentDef {
  label: string;
  /** Shown under the number so the definition is never a guess. */
  description: string;
  kind: 'reached' | 'current';
  test: (x: SegmentInput) => boolean;
}

/** The registry every KPI, funnel step and pipeline deep link uses. */
export const SEGMENTS: Record<string, SegmentDef> = {
  qualified: { label: 'Qualified', kind: 'reached', description: `ever engaged: past New, score ≥ ${QUALIFIED_MIN_SCORE}, or a real intent`, test: (x) => x.reached.has('qualified') },
  demoInterest: { label: 'Demo interest', kind: 'reached', description: 'ever asked for or booked a demo', test: (x) => x.reached.has('demoInterest') },
  demoScheduled: { label: 'Demo scheduled', kind: 'reached', description: 'ever had a demo slot confirmed', test: (x) => x.reached.has('demoScheduled') },
  demoCompleted: { label: 'Demo completed', kind: 'reached', description: 'attended a demo', test: (x) => x.reached.has('demoCompleted') },
  purchaseIntent: { label: 'Purchase intent', kind: 'reached', description: 'showed buying intent, was offered a subscription, or paid', test: (x) => x.reached.has('purchaseIntent') },
  paymentVerified: { label: 'Payment verified', kind: 'reached', description: 'a verified payment', test: (x) => x.reached.has('paymentVerified') },
  customer: { label: 'Customer', kind: 'reached', description: 'became a customer', test: (x) => x.reached.has('customer') },
  everHandedOff: { label: 'Ever handed to a human', kind: 'reached', description: 'a human took over at some point', test: (x) => x.reached.has('humanHandoff') },
  everOptedOut: { label: 'Ever opted out', kind: 'reached', description: 'asked to stop messages', test: (x) => x.reached.has('optedOut') },
  activeSales: {
    label: 'Active sales leads', kind: 'current', description: 'Sales agent owns them now, qualifying or nurturing',
    test: (x) => x.lead.currentAgent === 'SALES' && ['QUALIFYING', 'NURTURING'].includes(x.lead.currentStage || ''),
  },
  withHuman: {
    label: 'With a human now', kind: 'current', description: 'handed off and not returned to the AI yet',
    test: (x) => x.lead.currentAgent === 'HUMAN' || x.lead.humanHandoff?.active === true,
  },
  optedOutOrLost: {
    label: 'Opted out / lost', kind: 'current', description: 'opted out, or marked lost / do-not-contact',
    test: (x) => x.lead.nurtureStatus === 'OPTED_OUT' || ['LOST', 'DO_NOT_CONTACT'].includes(x.lead.currentStage || ''),
  },
  pendingPayment: {
    label: 'Pending payments', kind: 'current', description: 'at conversion-pending, no verified payment yet',
    test: (x) => x.lead.currentStage === 'CONVERSION_PENDING' && !x.reached.has('paymentVerified'),
  },
};

/** Ordered funnel of stages reached (each counts leads that EVER got there). */
export const FUNNEL_SEGMENTS = ['qualified', 'demoInterest', 'demoScheduled', 'demoCompleted', 'purchaseIntent', 'paymentVerified', 'customer'] as const;

export function isSegment(key: unknown): key is keyof typeof SEGMENTS {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(SEGMENTS, key);
}

/** Rounded percentage {value, num, den}, or null value when there is no denominator. */
export function rate(num: number, den: number, unavailable = 'no leads in range') {
  return den > 0 ? { value: Math.round((num / den) * 1000) / 10, num, den } : { value: null, unavailable, num, den };
}

/** Digits a phone search should match, or null when the query is not phone-like. */
export function phoneSearchDigits(q: string): string | null {
  const digits = q.replace(/\D/g, '');
  if (digits.length < 4 || /[a-z]/i.test(q.replace(/^\+/, ''))) return null;
  // A national Indian number typed with a leading 0 or 91 still matches the stored +91XXXXXXXXXX.
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  return digits;
}
