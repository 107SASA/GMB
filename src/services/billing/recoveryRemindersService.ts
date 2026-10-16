import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import User from '@/models/User';
import Lead from '@/models/Lead';
import BillingRecoveryEpisode from '@/models/BillingRecoveryEpisode';
import { trialPhoneKey } from '@/lib/phone';
import { sendTemplateMessage } from '@/services/twilio/client';
import { getReminderPolicy } from '@/services/billing/trialPolicyStore';
import type { FailureSnapshot } from '@/lib/billing/billingPolicy';
import {
  openEpisode,
  closeEpisodes,
  recordDelivery,
  runRecoveryReminders,
  type ReminderContext,
  type RunSummary,
} from '@/lib/billing/recoveryReminders';

/**
 * Production wiring for WhatsApp payment-recovery reminders
 * (lib/billing/recoveryReminders.ts): real models, the central Twilio
 * template sender, and the eligibility rules below.
 *
 * Billing reminders are deliberately independent of the review-request and
 * marketing notification settings and of the grace period. They respect a
 * STOP opt-out on our WhatsApp line and the owner's billing-WhatsApp switch,
 * and only ever go to the workspace owner's VERIFIED phone.
 */

/** A new payment failure (Day 0) → its reminder episode, schedule frozen from the current policy. */
export async function openRecoveryEpisode(input: {
  businessId: string;
  userId: string | null;
  razorpaySubscriptionId?: string | null;
  snapshot: FailureSnapshot;
}): Promise<void> {
  if (!input.userId) return;
  try {
    await dbConnect();
    const policy = await getReminderPolicy();
    const { created } = await openEpisode(BillingRecoveryEpisode, {
      businessId: input.businessId,
      userId: input.userId,
      razorpaySubscriptionId: input.razorpaySubscriptionId,
      failureKind: input.snapshot.kind,
      failedAt: input.snapshot.failedAt,
      policy,
    });
    // Day 0 goes out promptly instead of waiting for the next cron pass.
    if (created && policy.enabled) {
      const { inngest } = await import('@/services/inngest/client');
      await inngest.send({ name: 'billing/recovery.process', data: { businessId: input.businessId } }).catch(() => {});
    }
  } catch (err: any) {
    console.error('[billing/reminders] could not open episode for', input.businessId, err?.message);
  }
}

/** Payment recovered / subscription cancelled → stop that workspace's reminders now. */
export async function closeRecoveryEpisodes(businessId: string, status: 'resolved' | 'stopped', reason: string): Promise<void> {
  try {
    await dbConnect();
    await closeEpisodes(BillingRecoveryEpisode, { businessId, status, reason, now: new Date() });
  } catch (err: any) {
    console.error('[billing/reminders] could not close episodes for', businessId, err?.message);
  }
}

/** Twilio status callback for a reminder message. */
export async function recordReminderDelivery(messageSid: string, status: string): Promise<void> {
  await recordDelivery(BillingRecoveryEpisode, messageSid, status, new Date()).catch(() => false);
}

function firstName(full: string | undefined): string {
  const name = (full || '').trim();
  if (!name || name.toLowerCase() === 'new user') return 'there';
  return name.split(/\s+/)[0];
}

/** Is this episode still worth a reminder, and to which verified phone? */
export async function reminderContext(episode: any): Promise<ReminderContext> {
  const business = await Business.findById(episode.businessId)
    .select('name userId subscriptionStatus billingSubscriptionId supersededSubscriptionIds isDeleted')
    .lean<any>();
  if (!business || business.isDeleted) return { close: { status: 'stopped', reason: 'account_ineligible' } };
  if (business.subscriptionStatus === 'active') return { close: { status: 'resolved', reason: 'payment_recovered' } };
  if (business.subscriptionStatus === 'canceled') return { close: { status: 'stopped', reason: 'subscription_cancelled' } };
  if (business.subscriptionStatus !== 'past_due') return { close: { status: 'stopped', reason: 'not_past_due' } };
  const sameFailure =
    !episode.razorpaySubscriptionId ||
    business.billingSubscriptionId === episode.razorpaySubscriptionId ||
    (business.supersededSubscriptionIds ?? []).includes(episode.razorpaySubscriptionId);
  if (!sameFailure) return { close: { status: 'stopped', reason: 'subscription_changed' } };
  if (String(business.userId) !== String(episode.userId)) return { close: { status: 'stopped', reason: 'owner_changed' } };

  const owner = await User.findById(episode.userId)
    .select('phone isPhoneVerified fullName notificationPreferences isDeleted')
    .lean<any>();
  if (!owner || owner.isDeleted) return { close: { status: 'stopped', reason: 'account_ineligible' } };
  const phone = trialPhoneKey(owner.phone);
  if (!owner.isPhoneVerified || !phone) return { close: { status: 'stopped', reason: 'phone_not_eligible' } };
  if (owner.notificationPreferences?.billingWhatsApp === false) return { close: { status: 'stopped', reason: 'opted_out' } };
  const lead = await Lead.findOne({ phone, tenantId: 'gmbboost-internal' }).select('nurtureStatus currentStage').lean<any>();
  if (lead && (lead.nurtureStatus === 'OPTED_OUT' || lead.currentStage === 'DO_NOT_CONTACT')) {
    return { close: { status: 'stopped', reason: 'opted_out' } };
  }
  return { phone, variables: { '1': firstName(owner.fullName), '2': business.name || 'your workspace' } };
}

export async function runRecoveryReminderPass(opts: { businessId?: string } = {}): Promise<RunSummary> {
  await dbConnect();
  const policy = await getReminderPolicy();
  let episodeId: unknown;
  if (opts.businessId) {
    const ep = await BillingRecoveryEpisode.findOne({ businessId: opts.businessId, status: 'open' }).select('_id').lean<any>();
    if (!ep) return { sent: 0, retried: 0, failed: 0, ambiguous: 0, skipped: 0, deferred: 0, closed: 0, staleClaims: 0 };
    episodeId = ep._id;
  }
  return runRecoveryReminders(
    {
      Episode: BillingRecoveryEpisode,
      now: () => new Date(),
      policy,
      loadContext: reminderContext,
      // Always the approved template — valid inside and outside WhatsApp's
      // 24-hour window, so no free-form text is ever sent for billing.
      send: (phone, contentSid, variables) => sendTemplateMessage(phone, contentSid, variables),
    },
    { episodeId }
  );
}
