import { workspaceAccessState, trialAccessEndsAt } from './entitlements.ts';

/**
 * Super-admin subscription monitoring — the row shape, derived status and
 * redaction (pure, unit-tested). Nothing here can carry card data: the app
 * never stores any. Contact details are masked; Razorpay ids are shown
 * (needed to look a subscription up in the Razorpay dashboard), secrets never.
 */

export type MonitorStatus =
  | 'trial'
  | 'trial_cancelled'
  | 'paid'
  | 'held'
  | 'past_due_grace'
  | 'past_due_restricted'
  | 'cancelled'
  | 'never_paid';

export const MONITOR_STATUSES: MonitorStatus[] = [
  'trial', 'trial_cancelled', 'paid', 'held', 'past_due_grace', 'past_due_restricted', 'cancelled', 'never_paid',
];

export function maskPhone(phone: unknown): string | null {
  if (typeof phone !== 'string' || !phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `${phone.startsWith('+') ? '+' : ''}${'•'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

export function maskEmail(email: unknown): string | null {
  if (typeof email !== 'string' || !email.includes('@')) return null;
  if (/@shadow\.growwmatics\.internal$/i.test(email)) return null; // placeholder, not a real address
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(1, Math.min(local.length - 1, 6)))}@${domain}`;
}

export function monitorStatus(ws: Record<string, any>, now: Date = new Date()): MonitorStatus {
  switch (ws.subscriptionStatus) {
    case 'active':
      return ws.paymentAccessHold === true ? 'held' : 'paid';
    case 'trial_active':
      return ws.trialCancelledAt ? 'trial_cancelled' : 'trial';
    case 'past_due':
      return workspaceAccessState(ws, now).mode === 'grace' ? 'past_due_grace' : 'past_due_restricted';
    case 'canceled':
      return 'cancelled';
    default:
      return 'never_paid';
  }
}

/** MongoDB filter for one monitor status (the grace split needs `now`). */
export function statusFilter(status: MonitorStatus, now: Date = new Date()): Record<string, unknown> {
  switch (status) {
    case 'paid': return { subscriptionStatus: 'active', paymentAccessHold: { $ne: true } };
    case 'held': return { subscriptionStatus: 'active', paymentAccessHold: true };
    case 'trial': return { subscriptionStatus: 'trial_active', trialCancelledAt: { $exists: false } };
    case 'trial_cancelled': return { subscriptionStatus: 'trial_active', trialCancelledAt: { $exists: true } };
    case 'past_due_grace': return { subscriptionStatus: 'past_due', paymentGraceEndsAt: { $gt: now } };
    case 'past_due_restricted': return { subscriptionStatus: 'past_due', $or: [{ paymentGraceEndsAt: { $lte: now } }, { paymentGraceEndsAt: { $exists: false } }] };
    case 'cancelled': return { subscriptionStatus: 'canceled' };
    case 'never_paid': return { $or: [{ subscriptionStatus: 'trialing' }, { subscriptionStatus: { $exists: false } }] };
  }
}

/** The next charge Razorpay should attempt, as far as our records know. */
export function nextBillingDate(ws: Record<string, any>): Date | null {
  if (ws.subscriptionStatus === 'trial_active') return ws.trialCancelledAt ? null : ws.trialEndsAt ? new Date(ws.trialEndsAt) : null;
  if (ws.subscriptionStatus === 'active' && !ws.subscriptionCancelAtPeriodEnd && ws.subscriptionCurrentPeriodEnd) return new Date(ws.subscriptionCurrentPeriodEnd);
  return null;
}

export interface MonitoringInput {
  business: Record<string, any>;
  owner?: Record<string, any> | null;
  episode?: Record<string, any> | null;
  /** Latest captured charge we recorded (BillingEvent). */
  lastCharge?: { amountPaise?: number | null; currency?: string | null; eventAt?: Date | string } | null;
  /** Latest Razorpay-reported subscription event we recorded (BillingEvent). */
  lastRazorpayEvent?: { eventType: string; eventAt?: Date | string } | null;
  now?: Date;
}

export function buildMonitoringRow(input: MonitoringInput) {
  const { business: b, owner, episode } = input;
  const now = input.now ?? new Date();
  const access = workspaceAccessState(b, now);
  const status = monitorStatus(b, now);
  const nextStep = episode?.steps?.find((s: any) => s.status === 'pending' || s.status === 'retry') ?? null;
  const attempted = (episode?.steps ?? []).filter((s: any) => s.attempts > 0);
  const lastSend = attempted[attempted.length - 1] ?? null;
  return {
    businessId: String(b._id),
    workspace: b.name ?? null,
    owner: owner
      ? { id: String(owner._id), name: owner.fullName ?? null, phone: maskPhone(owner.phone), email: maskEmail(owner.email), phoneVerified: !!owner.isPhoneVerified }
      : null,
    status,
    // A trial is the paid plan on trial (the user record still says Free).
    plan: status === 'trial' || status === 'trial_cancelled' ? 'Pro (trial)' : owner?.subscriptionPlan ?? 'Free',
    lastChargeInr: input.lastCharge?.amountPaise != null ? input.lastCharge.amountPaise / 100 : null,
    lastChargeAt: input.lastCharge?.eventAt ?? null,
    trialEndsAt: b.trialEndsAt ?? null,
    trialAccessEndsAt: trialAccessEndsAt(b),
    nextBillingAt: nextBillingDate(b),
    paidThrough: b.subscriptionCurrentPeriodEnd ?? null,
    razorpaySubscriptionId: b.billingSubscriptionId ?? b.razorpaySubscriptionId ?? null,
    lastRazorpayEvent: input.lastRazorpayEvent ? { type: input.lastRazorpayEvent.eventType, at: input.lastRazorpayEvent.eventAt ?? null } : null,
    payment: {
      failedAt: b.paymentFailedAt ?? null,
      failureReason: b.paymentFailureReason ?? null,
      failureKind: b.paymentFailureKind ?? null,
      graceEndsAt: b.paymentGraceEndsAt ?? null,
      restrictedModules: access.mode === 'restricted' ? access.restrictedModules : null,
      accessMode: access.mode,
    },
    recovery: {
      held: b.paymentAccessHold === true,
      openCheckout: b.recoveryCheckout?.subscriptionId
        ? { subscriptionId: b.recoveryCheckout.subscriptionId, expiresAt: b.recoveryCheckout.expiresAt, expired: new Date(b.recoveryCheckout.expiresAt).getTime() <= now.getTime() }
        : null,
      supersededSubscriptionIds: b.supersededSubscriptionIds ?? [],
    },
    reminders: episode
      ? {
          episodeStatus: episode.status,
          stopReason: episode.stopReason ?? null,
          sent: episode.remindersSent ?? 0,
          nextDueAt: nextStep?.nextAttemptAt ?? null,
          lastDelivery: lastSend ? { step: lastSend.key, status: lastSend.status, delivery: lastSend.deliveryStatus ?? null, at: lastSend.sentAt ?? lastSend.claimedAt ?? null } : null,
          needsReview: !!episode.needsReview,
        }
      : null,
  };
}

export type MonitoringRow = ReturnType<typeof buildMonitoringRow>;
