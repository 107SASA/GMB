/**
 * Pre-sales (Sales Agent) messaging rules — pure, so they run under plain
 * `node --test`. services/sales/preSalesPolicy.ts loads the records and
 * applies them immediately before every scheduled sales send.
 *
 * The lifecycle (Oct 2026): respond to what the person does, don't drip.
 *  - After a free report: ONE invitation (at least SALES_INVITE_MIN_DELAY_MINUTES
 *    after the report, outside quiet hours) and at most SALES_FOLLOW_UP_LIMIT
 *    follow-up, SALES_FOLLOW_UP_DELAY_MINUTES later, only if there was no reply.
 *  - A reply, a demo booking, a trial or payment, an opt-out or "not
 *    interested" ends the automated sequence. Live replies still answer.
 *  - After a demo: one follow-up when it was marked attended, one
 *    rescheduling message when it was marked missed, nothing when unknown.
 * When a check can't be completed, the message is skipped, never sent.
 */
import { minutesUntilSendable } from '../services/nurture/nurtureSchedule.ts';

/** The invitation never lands in the same few minutes as the report itself. */
export const SALES_INVITE_MIN_DELAY_MINUTES = 120;
/** Automated sales follow-ups after the invitation, regardless of the stored sales-agent config. */
export const SALES_FOLLOW_UP_LIMIT = 1;
export const SALES_FOLLOW_UP_DELAY_MINUTES = 48 * 60;
/** Quiet hours for every automated sales message, even when the stored config has them off. */
export const SALES_QUIET_HOURS = { enabled: true, start: '21:00', end: '09:00' } as const;
export const SALES_TIMEZONE = 'Asia/Kolkata';
/** Attended-demo follow-up: a few hours after it is marked complete (well within a day). */
export const POST_DEMO_FOLLOW_UP_DELAY_MINUTES = 3 * 60;
export const MISSED_DEMO_MESSAGE_DELAY_MINUTES = 10;

export type SalesSendKind = 'invite' | 'follow-up' | 'post-demo';

type LeadFacts = {
  currentAgent?: string | null;
  currentStage?: string | null;
  nurtureStatus?: string | null;
  intent?: string | null;
  nextBestAction?: string | null;
  humanHandoff?: { active?: boolean | null } | null;
} | null | undefined;

const CUSTOMER_STAGES = new Set(['CUSTOMER', 'PAYMENT_VERIFIED']);
const STOPPED_STAGES = new Set(['DO_NOT_CONTACT', 'LOST']);
const DEMO_STAGES = new Set(['DEMO_REQUESTED', 'DEMO_SCHEDULED']);

/** Why this lead must not get an automated sales message of this kind, or null. */
export function leadPreSalesBlockedReason(lead: LeadFacts, kind: SalesSendKind): string | null {
  if (!lead) return null;
  if (lead.currentAgent === 'HUMAN' || lead.humanHandoff?.active === true || lead.currentStage === 'HUMAN_HANDOFF') return 'human-owned';
  if (lead.currentAgent === 'IN_HOUSE' || CUSTOMER_STAGES.has(lead.currentStage || '')) return 'already-customer';
  if (lead.nurtureStatus === 'OPTED_OUT') return 'opted-out';
  if (lead.nurtureStatus === 'STOPPED' || STOPPED_STAGES.has(lead.currentStage || '')) return 'stopped';
  if (lead.intent === 'NOT_INTERESTED') return 'not-interested';
  if (kind === 'post-demo') return null;
  // A demo in progress is owned by the booking flow and its reminders.
  if (lead.currentAgent === 'DEMO' || DEMO_STAGES.has(lead.currentStage || '')) return 'demo-in-progress';
  if (kind === 'follow-up') {
    if (lead.intent === 'DEMO_INTEREST' || lead.nextBestAction === 'SCHEDULE_DEMO') return 'demo-intent-owns-next-step';
    if (lead.intent === 'PURCHASE_INTEREST' || lead.intent === 'READY_TO_BUY') return 'purchase-intent-owns-next-step';
    if (lead.nextBestAction === 'HUMAN_HANDOFF' || lead.nextBestAction === 'STOP') return 'nba-stops-generic-nurture';
  }
  return null;
}

/**
 * True once a workspace has started a trial or paid — it is no longer a
 * pre-sales prospect, even while the trial is still unpaid, and stays out
 * after cancelling. The legacy 'trialing' default every new workspace gets
 * is not a trial.
 */
export function workspaceStartedTrialOrPaid(ws: {
  subscriptionStatus?: string | null;
  trialStartedAt?: Date | string | null;
  billingSubscriptionId?: string | null;
} | null | undefined, userSubscriptionPlan?: string | null): boolean {
  if (userSubscriptionPlan === 'Pro' || userSubscriptionPlan === 'Enterprise') return true;
  if (!ws) return false;
  if (['trial_active', 'active', 'past_due', 'canceled'].includes(ws.subscriptionStatus || '')) return true;
  return !!ws.trialStartedAt || !!ws.billingSubscriptionId;
}

/** Conversation-level rule: the automated sequence ends at the first reply after it started. */
export function conversationSalesBlockedReason(convo: {
  status?: string | null;
  consentStatus?: string | null;
  firstSentAt?: Date | string | null;
  lastLeadReplyAt?: Date | string | null;
} | null | undefined, kind: SalesSendKind, step?: 'consent' | 'first'): string | null {
  if (!convo) return 'conversation-missing';
  if (convo.status !== 'active') return `conversation-${convo.status || 'unknown'}`;
  if (kind === 'invite') {
    if (step === 'consent' && convo.consentStatus !== 'pending') return 'consent-not-pending';
    return null;
  }
  if (kind === 'follow-up') {
    if (!convo.firstSentAt) return 'no-first-message';
    if (convo.lastLeadReplyAt && new Date(convo.lastLeadReplyAt).getTime() > new Date(convo.firstSentAt).getTime()) {
      return 'lead-replied';
    }
  }
  return null;
}

/** Minutes to wait so an automated sales message lands outside quiet hours. */
export function minutesUntilSalesSendable(now: Date, quietHours?: { enabled?: boolean; start?: string; end?: string } | null): number {
  const q = quietHours?.enabled && quietHours.start && quietHours.end
    ? { enabled: true, start: quietHours.start, end: quietHours.end }
    : { ...SALES_QUIET_HOURS };
  return minutesUntilSendable({ now, quietHours: q, timezone: SALES_TIMEZONE, minimumMessageGapMinutes: 0 });
}

const firstWord = (name?: string | null) => (name || '').trim().split(/\s+/)[0] || '';

/**
 * Attended-demo follow-up allowed for this analysed outcome? Not when they
 * declined or aren't ready, and not when the conversation analysis
 * contradicts the "attended" mark (NO_SHOW / RESCHEDULE_REQUIRED) — that
 * attendance is ambiguous, so nothing is sent. No outcome (analysis failed)
 * still allows the generic thank-you: a person marked the demo Completed.
 */
export function attendedFollowUpAllowed(outcome?: string | null): boolean {
  return !['NOT_INTERESTED', 'NOT_READY', 'NO_SHOW', 'RESCHEDULE_REQUIRED'].includes(outcome || '');
}

// ── Demo attendance (who says what happened at the demo) ────────────────────

/** Outcomes a person can record for a demo that has ended. */
export const STAFF_ATTENDANCE_OUTCOMES = ['attended', 'no_show', 'declined', 'not_ready'] as const;
export type StaffAttendanceOutcome = (typeof STAFF_ATTENDANCE_OUTCOMES)[number];

type BookingTimes = { startUtc?: Date | string | null; endUtc?: Date | string | null };
type BookingAttendance = BookingTimes & {
  attendance?: { outcome?: string | null; source?: string | null; forStartUtc?: Date | string | null } | null;
};

/** One demo time on a booking ('unscheduled' when it has no recorded start). */
export function demoTimeKey(booking: BookingTimes): string {
  return booking.startUtc ? new Date(booking.startUtc).toISOString() : 'unscheduled';
}

/** True once the recorded demo end (or start) has passed; null when the booking has no recorded time. */
export function demoHasEnded(booking: BookingTimes, now = new Date()): boolean | null {
  const end = booking.endUtc || booking.startUtc;
  if (!end) return null;
  return new Date(end).getTime() <= now.getTime();
}

/**
 * The attendance a PERSON recorded for the booking's CURRENT demo time, or
 * null. The automatic timeout ('unconfirmed'), a missing record, and a record
 * left over from before a reschedule all return null — unknown.
 */
export function confirmedAttendance(booking: BookingAttendance): StaffAttendanceOutcome | null {
  const a = booking.attendance;
  if (!a || a.source !== 'staff') return null;
  if (!(STAFF_ATTENDANCE_OUTCOMES as readonly string[]).includes(a.outcome || '')) return null;
  const forKey = a.forStartUtc ? new Date(a.forStartUtc).toISOString() : 'unscheduled';
  if (forKey !== demoTimeKey(booking)) return null;
  return a.outcome as StaffAttendanceOutcome;
}

/** Which post-demo message (if any) a confirmed outcome allows. Declined / not ready / unknown → none. */
export function postDemoKindFor(outcome: string | null | undefined): 'attended' | 'missed' | null {
  if (outcome === 'attended') return 'attended';
  if (outcome === 'no_show') return 'missed';
  return null;
}

/** Booking status that matches a confirmed outcome (kept for the existing views and analytics). */
export function statusForAttendance(outcome: StaffAttendanceOutcome): 'Completed' | 'No Show' {
  return outcome === 'no_show' ? 'No Show' : 'Completed';
}

/** Post-demo analysis outcome forced by a confirmed outcome (attended → classified from the conversation). */
export function analysisOutcomeForAttendance(outcome: StaffAttendanceOutcome): 'NO_SHOW' | 'NOT_INTERESTED' | 'NOT_READY' | undefined {
  if (outcome === 'no_show') return 'NO_SHOW';
  if (outcome === 'declined') return 'NOT_INTERESTED';
  if (outcome === 'not_ready') return 'NOT_READY';
  return undefined;
}

/**
 * Post-demo copy, from booking/attendance data only — never claims a demo
 * happened unless it was marked attended. Returns null when the outcome
 * says not to follow up (declined, or not ready yet).
 */
export function postDemoMessage(input: {
  kind: 'attended' | 'missed';
  name?: string | null;
  businessName?: string | null;
  outcome?: string | null;
  whenLabel?: string | null;
  subscribeUrl?: string | null;
}): string | null {
  const hi = firstWord(input.name) ? `Hi ${firstWord(input.name)},` : 'Hi,';
  if (input.kind === 'missed') {
    const when = input.whenLabel ? ` on ${input.whenLabel}` : '';
    return `${hi} sorry we missed you at your Growwmatics demo${when}. Would you like to pick another time? Reply RESCHEDULE and I'll share the open slots.`;
  }
  if (!attendedFollowUpAllowed(input.outcome)) return null;
  const forBiz = input.businessName ? ` for ${input.businessName}` : '';
  const next =
    input.outcome === 'PRICE_CONCERN' ? 'If you would like to go over the plan and pricing again, just reply here.'
      : input.outcome === 'NEEDS_APPROVAL' ? 'If it helps your discussion with your team, reply here and we can send a short summary.'
        : input.outcome === 'NEEDS_MORE_INFORMATION' ? 'Reply with anything you would like to know more about and we will answer here.'
          : 'If you have any questions, just reply here.';
  const start = input.subscribeUrl ? ` When you are ready, you can get started here: ${input.subscribeUrl}` : '';
  return `${hi} thank you for joining the Growwmatics demo${forBiz}. ${next}${start}`;
}
