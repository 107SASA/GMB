import ReviewRequest from '@/models/ReviewRequest';
import { decideReviewResend, formatIstDate, reviewResendBlockedMessage, type ReviewResendDecision } from '@/lib/reviewResendRule';

/**
 * The resend rule (lib/reviewResendRule.ts) against this customer's past
 * review requests. Used by every manual send path (home quick-add, the
 * per-customer Send button on web and app, add-customer duplicate) and by
 * the campaign queue. Not used for follow-up reminders — those belong to a
 * request that was already made.
 */
export async function checkReviewResend(opts: {
  businessId: unknown;
  customerId: unknown;
  confirmed: boolean;
}): Promise<{
  decision: ReviewResendDecision;
  /** Owner-facing line; empty when the send just goes ahead. */
  message: string;
  alreadySentAt?: string;
  sentCount: number;
}> {
  const prior = { businessId: opts.businessId, customerId: opts.customerId, status: { $ne: 'Failed' } };
  const [last, sentCount] = await Promise.all([
    ReviewRequest.findOne(prior).sort({ createdAt: -1 }).select('sentAt createdAt status automationStatus').lean<{ sentAt?: Date; createdAt?: Date; status?: string; automationStatus?: string }>(),
    ReviewRequest.countDocuments(prior),
  ]);
  const lastAt = last ? (last.sentAt || last.createdAt || null) : null;
  const decision = decideReviewResend({
    sentCount,
    lastSentAt: lastAt ? new Date(lastAt) : null,
    // Reminders still scheduled: the run marks the request 'Completed' when
    // they finish, 'Stopped' on STOP / a click. Cancelled never sent.
    followUpsActive: !!last && last.automationStatus === 'Active' && last.status !== 'Cancelled',
    confirmed: opts.confirmed,
    now: new Date(),
  });
  if (decision.kind === 'send') return { decision, message: '', sentCount };
  const message = decision.kind === 'confirm'
    ? `A review link was already sent to this customer on ${formatIstDate(decision.lastSentAt)}. Follow-up reminders already go out automatically. Send again?`
    : reviewResendBlockedMessage(decision);
  return { decision, message, alreadySentAt: decision.lastSentAt.toISOString(), sentCount };
}
