import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import User from '@/models/User';
import Subscription from '@/models/Subscription';
import { CYCLES, getActivePlan, isBillingCycle } from '@/lib/billing/planCatalog';
import { notifyOwner } from '@/services/ownerNotify';

/**
 * Subscription & billing WhatsApp notices (Segment 2). One message per
 * real-world event, decided from verified billing facts and re-checked
 * against the database right before sending:
 *
 *  - first payment   — 'payment-first:<subscriptionId>'           (paid_count ≤ 1)
 *  - renewal         — 'payment-renewal:<subscriptionId>:<paid_count>' (paid_count ≥ 2)
 *  - trial ending    — 'trial-ending:<trialEndsAt>'  TRIAL_REMINDER_DAYS before the end
 *  - trial expired   — 'trial-expired:<trialEndsAt>' unpaid trial reached its end
 *
 * Each key is claimed atomically on Business.billingNoticeKeys ($addToSet)
 * before sending and released if the send fails, so webhook retries,
 * reconciliation and out-of-order events can never send the same notice
 * twice. A notice never changes payment or entitlement state. Payment
 * failure keeps its existing path (markBusinessPastDue → billing_past_due,
 * once per failure episode; recovery reminders stay off unless enabled).
 *
 * Sending reuses notifyOwner's billing events (owner phone, free text inside
 * the 24h window, else the approved notification template).
 */

/** The existing daily subscription job sends one trial reminder this many days before the trial ends. */
export const TRIAL_REMINDER_DAYS = 3;
const DAY = 86_400_000;

const appBase = () => (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
const absolute = (path: string) => (/^https?:\/\//.test(appBase()) ? `${appBase()}${path}` : null);

/** Billing page link, or null when no absolute app URL is configured. */
export const billingPageLink = () => absolute('/dashboard/billing');

/**
 * The app download page (/app) — only when the Android APK URL that page
 * offers is actually configured (NEXT_PUBLIC_ANDROID_APK_URL). Without it
 * the page says "coming very soon", so no link is sent.
 */
export function appDownloadLink(): string | null {
  if (!(process.env.NEXT_PUBLIC_ANDROID_APK_URL || '').trim()) return null;
  return absolute('/app');
}

/** First payment vs renewal, from Razorpay's own charge counter — never from the workspace's current status. */
export function paymentNoticeKind(paidCount: number | null | undefined): 'first' | 'renewal' {
  return Number(paidCount || 0) >= 2 ? 'renewal' : 'first';
}

/** Whether a trial ending at `trialEndsAt` is inside the reminder window at `now`. */
export function trialReminderDue(trialEndsAt: Date | string | null | undefined, now = new Date()): boolean {
  if (!trialEndsAt) return false;
  const left = new Date(trialEndsAt).getTime() - now.getTime();
  return left > 0 && left <= TRIAL_REMINDER_DAYS * DAY;
}

const dateLabel = (d: Date | string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const linkLine = (label: string, link: string | null, fallback: string) => (link ? `${label}: ${link}` : fallback);
const BILLING_FALLBACK = 'Open Billing in your Growwmatics dashboard.';

export function paymentConfirmedText(input: { kind: 'first' | 'renewal'; businessName: string; planName: string; periodEnd?: Date | null }): string {
  const lines = [`Hi ${input.businessName},`, ''];
  if (input.kind === 'first') {
    lines.push(`Thank you — your payment was successful and your ${input.planName} subscription is now active.`);
    lines.push('', linkLine('Manage billing', billingPageLink(), BILLING_FALLBACK));
    const app = appDownloadLink();
    if (app) lines.push(`Get the app: ${app}`);
  } else {
    lines.push(`We received your payment — your ${input.planName} subscription has been renewed${input.periodEnd ? ` until ${dateLabel(input.periodEnd)}` : ''}. No action is needed.`);
    lines.push('', linkLine('Manage billing', billingPageLink(), BILLING_FALLBACK));
  }
  lines.push('', '— Team Growwmatics');
  return lines.join('\n');
}

export function trialEndingText(input: { businessName: string; trialEndsAt: Date | string; cancelled: boolean; planName: string }): string {
  const body = input.cancelled
    ? `Your Growwmatics free trial ends on ${dateLabel(input.trialEndsAt)}. Subscribe before then to keep your access.`
    : `Your Growwmatics free trial ends on ${dateLabel(input.trialEndsAt)}. Your ${input.planName} subscription then starts automatically with the payment method you authorised.`;
  return [`Hi ${input.businessName},`, '', body, '', linkLine(input.cancelled ? 'Subscribe' : 'Manage billing', billingPageLink(), BILLING_FALLBACK), '', '— Team Growwmatics'].join('\n');
}

export function trialExpiredText(input: { businessName: string; trialEndsAt: Date | string }): string {
  const lines = [
    `Hi ${input.businessName},`, '',
    `Your Growwmatics free trial ended on ${dateLabel(input.trialEndsAt)}. Subscribe to keep using Growwmatics — your data is safe.`,
    '', linkLine('Subscribe', billingPageLink(), BILLING_FALLBACK),
  ];
  const app = appDownloadLink();
  if (app) lines.push(`Get the app: ${app}`);
  lines.push('', '— Team Growwmatics');
  return lines.join('\n');
}

/** "GrowwMatics AI (Yearly)" — the configured plan name plus the subscription's billing cycle. */
export async function planNameFor(subscriptionNotes: any): Promise<string> {
  let name = 'Growwmatics';
  try { name = (await getActivePlan()).displayName || name; } catch { /* keep the generic name */ }
  const cycle = subscriptionNotes?.billingCycle;
  return isBillingCycle(cycle) ? `${name} (${CYCLES[cycle].label})` : name;
}

async function claim(businessId: string, key: string): Promise<boolean> {
  const res = await Business.updateOne({ _id: businessId, billingNoticeKeys: { $ne: key } }, { $addToSet: { billingNoticeKeys: key } });
  return res.modifiedCount === 1;
}
async function release(businessId: string, key: string): Promise<void> {
  await Business.updateOne({ _id: businessId }, { $pull: { billingNoticeKeys: key } }).catch(() => {});
}

/** Has this owner paid on ANY of their workspaces (or at user level)? */
async function ownerHasPaid(userId: unknown): Promise<boolean> {
  if (!userId) return false;
  const [active, sub] = await Promise.all([
    Business.exists({ userId, subscriptionStatus: { $in: ['active', 'past_due'] } }),
    Subscription.findOne({ userId }).select('billingStatus planType').lean<any>(),
  ]);
  return !!active || sub?.billingStatus === 'Active';
}

type NoticeResult = { status: 'sent' } | { status: 'skipped'; reason: string } | { status: 'failed'; error?: string };

async function sendClaimed(businessId: string, key: string, event: 'billing_activated' | 'billing_trial_ending' | 'billing_trial_expired', text: string): Promise<NoticeResult> {
  if (!(await claim(businessId, key))) return { status: 'skipped', reason: 'already-sent' };
  const res = await notifyOwner(businessId, { event, text });
  if (res.status === 'sent') return { status: 'sent' };
  // Nothing went out — give the key back so a later event or run can try again.
  await release(businessId, key);
  return res.status === 'failed' ? { status: 'failed', error: res.error } : { status: 'skipped', reason: res.reason };
}

/**
 * One confirmation per verified charge, after activation. Re-checks that
 * access is really active for THIS subscription (not held for review).
 * Called for webhook AND reconciliation activations — the claim keeps it to
 * one message per charge whichever arrives first.
 */
export async function notifyPaymentConfirmed(input: {
  businessId: string;
  subscriptionId: string;
  paidCount: number | null | undefined;
  subscriptionNotes?: any;
  periodEnd?: Date | null;
}): Promise<NoticeResult> {
  try {
    await dbConnect();
    const b: any = await Business.findById(input.businessId).select('name userId subscriptionStatus paymentAccessHold billingSubscriptionId').lean();
    if (!b) return { status: 'skipped', reason: 'no-business' };
    if (b.subscriptionStatus !== 'active' || b.paymentAccessHold === true) return { status: 'skipped', reason: 'access-not-active' };
    if (b.billingSubscriptionId && b.billingSubscriptionId !== input.subscriptionId) return { status: 'skipped', reason: 'not-the-paying-subscription' };

    const kind = paymentNoticeKind(input.paidCount);
    const key = kind === 'first' ? `payment-first:${input.subscriptionId}` : `payment-renewal:${input.subscriptionId}:${Number(input.paidCount)}`;
    if (kind === 'first' && b.userId) {
      // Transition from the old per-user guard: a payment_received template
      // sent in the last week was this subscription's first confirmation.
      const legacy: any = await Subscription.findOne({ userId: b.userId }).select('paymentReceivedMessageSentAt').lean();
      if (legacy?.paymentReceivedMessageSentAt && Date.now() - new Date(legacy.paymentReceivedMessageSentAt).getTime() < 7 * DAY) {
        await claim(input.businessId, key);
        return { status: 'skipped', reason: 'already-sent' };
      }
    }
    const text = paymentConfirmedText({
      kind,
      businessName: b.name || 'your workspace',
      planName: await planNameFor(input.subscriptionNotes),
      periodEnd: input.periodEnd ?? null,
    });
    return await sendClaimed(input.businessId, key, 'billing_activated', text);
  } catch (err: any) {
    console.error('[billingWhatsApp] payment confirmation failed (state unchanged):', err?.message);
    return { status: 'failed', error: err?.message };
  }
}

/** One reminder per trial end date, only while the trial is active, unpaid and inside the window. */
export async function sendTrialEndingReminder(businessId: string, now = new Date()): Promise<NoticeResult> {
  try {
    await dbConnect();
    const b: any = await Business.findById(businessId).select('name userId subscriptionStatus trialEndsAt trialCancelledAt').lean();
    if (!b || b.subscriptionStatus !== 'trial_active') return { status: 'skipped', reason: 'not-in-trial' };
    if (!trialReminderDue(b.trialEndsAt, now)) return { status: 'skipped', reason: 'not-due' };
    if (await ownerHasPaid(b.userId)) return { status: 'skipped', reason: 'already-paid' };
    const owner: any = b.userId ? await User.findById(b.userId).select('notificationPreferences').lean() : null;
    if (owner?.notificationPreferences?.billingWhatsApp === false) return { status: 'skipped', reason: 'opted-out' };
    const text = trialEndingText({ businessName: b.name || 'your workspace', trialEndsAt: b.trialEndsAt, cancelled: !!b.trialCancelledAt, planName: await planNameFor(null) });
    return await sendClaimed(businessId, `trial-ending:${new Date(b.trialEndsAt).toISOString()}`, 'billing_trial_ending', text);
  } catch (err: any) {
    console.error('[billingWhatsApp] trial reminder failed:', err?.message);
    return { status: 'failed', error: err?.message };
  }
}

/** Daily pass (subscriptionExpiryWorker): reminders for active trials ending within the window. */
export async function runTrialEndingReminders(now = new Date()): Promise<{ due: number; sent: number }> {
  await dbConnect();
  const due: any[] = await Business.find({
    subscriptionStatus: 'trial_active',
    trialEndsAt: { $gt: now, $lte: new Date(now.getTime() + TRIAL_REMINDER_DAYS * DAY) },
  }).select('_id').limit(500).lean();
  let sent = 0;
  for (const b of due) if ((await sendTrialEndingReminder(String(b._id), now)).status === 'sent') sent++;
  return { due: due.length, sent };
}

/**
 * One expiry notice when an unpaid trial has reached its end (called right
 * after the daily job closes a cancelled trial). Skipped if the trial was
 * extended, or the owner has paid on any workspace.
 */
export async function sendTrialExpiredNotice(businessId: string, now = new Date()): Promise<NoticeResult> {
  try {
    await dbConnect();
    const b: any = await Business.findById(businessId).select('name userId subscriptionStatus trialEndsAt').lean();
    if (!b?.trialEndsAt) return { status: 'skipped', reason: 'no-trial' };
    if (new Date(b.trialEndsAt).getTime() > now.getTime()) return { status: 'skipped', reason: 'trial-extended' };
    if (['active', 'past_due', 'trial_active'].includes(b.subscriptionStatus)) return { status: 'skipped', reason: `workspace-${b.subscriptionStatus}` };
    if (await ownerHasPaid(b.userId)) return { status: 'skipped', reason: 'already-paid' };
    const owner: any = b.userId ? await User.findById(b.userId).select('notificationPreferences').lean() : null;
    if (owner?.notificationPreferences?.billingWhatsApp === false) return { status: 'skipped', reason: 'opted-out' };
    const text = trialExpiredText({ businessName: b.name || 'your workspace', trialEndsAt: b.trialEndsAt });
    return await sendClaimed(businessId, `trial-expired:${new Date(b.trialEndsAt).toISOString()}`, 'billing_trial_expired', text);
  } catch (err: any) {
    console.error('[billingWhatsApp] trial expiry notice failed:', err?.message);
    return { status: 'failed', error: err?.message };
  }
}
