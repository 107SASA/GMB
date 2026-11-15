/**
 * Asking the same number for a review again (home "Send Review Link").
 *
 * Follow-up reminders already go out automatically after a request, so a
 * manual resend is limited (the automatic reminders are never cut short):
 *   - not while automatic reminders are still due for this number,
 *   - never before 24 hours have passed since the last request,
 *   - at most 3 requests per number in total (failed sends don't count).
 * Inside those limits the owner is asked to confirm first.
 *
 * Pure: no database.
 */

export const REVIEW_RESEND_MIN_GAP_MS = 24 * 60 * 60 * 1000;
export const REVIEW_MAX_REQUESTS_PER_NUMBER = 3;
/**
 * Default reminders land on day 2 and day 7 (a full day can push one a day
 * later). Past this, a request still marked 'Active' (a run that ended
 * early, or an old record) no longer blocks a resend.
 */
export const REVIEW_FOLLOW_UP_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

export type ReviewResendDecision =
  | { kind: 'send' }
  | { kind: 'confirm'; lastSentAt: Date; sentCount: number }
  | { kind: 'follow-ups-running'; lastSentAt: Date; sentCount: number }
  | { kind: 'too-soon'; lastSentAt: Date; sentCount: number; nextAllowedAt: Date }
  | { kind: 'limit-reached'; lastSentAt: Date; sentCount: number };

export function decideReviewResend(input: {
  /** Requests already made to this number (not failed). */
  sentCount: number;
  lastSentAt: Date | null;
  /** Automatic reminders are still scheduled for this number's latest request. */
  followUpsActive?: boolean;
  confirmed: boolean;
  now: Date;
}): ReviewResendDecision {
  const { sentCount, lastSentAt, confirmed, now } = input;
  if (!lastSentAt || sentCount <= 0) return { kind: 'send' };
  if (sentCount >= REVIEW_MAX_REQUESTS_PER_NUMBER) return { kind: 'limit-reached', lastSentAt, sentCount };
  if (input.followUpsActive && now.getTime() - lastSentAt.getTime() < REVIEW_FOLLOW_UP_WINDOW_MS) {
    return { kind: 'follow-ups-running', lastSentAt, sentCount };
  }
  const nextAllowedAt = new Date(lastSentAt.getTime() + REVIEW_RESEND_MIN_GAP_MS);
  if (now.getTime() < nextAllowedAt.getTime()) return { kind: 'too-soon', lastSentAt, sentCount, nextAllowedAt };
  return confirmed ? { kind: 'send' } : { kind: 'confirm', lastSentAt, sentCount };
}

export function formatIstDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export function formatIstDateTime(d: Date): string {
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

/** Owner-facing line for a blocked resend. */
export function reviewResendBlockedMessage(decision: Extract<ReviewResendDecision, { kind: 'follow-ups-running' | 'too-soon' | 'limit-reached' }>): string {
  if (decision.kind === 'follow-ups-running') {
    return `Review link already sent to this customer on ${formatIstDate(decision.lastSentAt)}. Automatic reminders are still going out to them, so there's no need to send again. You can send again once the reminders finish.`;
  }
  if (decision.kind === 'limit-reached') {
    return `Review link already sent to this customer ${decision.sentCount} times (last on ${formatIstDate(decision.lastSentAt)}). Follow-up reminders go out automatically, so no more links can be sent to this number.`;
  }
  return `Review link already sent to this customer on ${formatIstDateTime(decision.lastSentAt)}. Follow-up reminders go out automatically. You can send again after ${formatIstDateTime(decision.nextAllowedAt)}.`;
}
