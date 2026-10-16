import { TRIAL_CHARGE_PROCESSING_MS, ALWAYS_FREE_MODULE, PAID_MODULE_KEYS } from './billingPolicy.ts';

/**
 * ONE definition of "this workspace / user has the paid plan right now", used
 * by every gate, automation and usage limit (pure, so it's unit-tested).
 *
 * The paid plan applies to:
 *  - a paid workspace (subscriptionStatus 'active') — unless it is held
 *    after a recovery payment (policy restoreAccessOnRecovery: false);
 *  - an AUTHORIZED free trial: 'trial_active' (only set from a verified
 *    Razorpay trial authorization) within its window — until trialEndsAt,
 *    plus the first-charge processing window unless the trial was cancelled;
 *  - a payment failure (past_due) still inside the grace period frozen at
 *    Day 0. The status stays past_due — grace is access, not payment.
 * Never to: 'trialing' (the never-paid default), past_due after its grace,
 * canceled, an expired/cancelled trial past its end, or a user-level
 * 'Trialing' record without trialSource 'offer' (the old 14-day default).
 */

export interface WorkspacePlanFacts {
  subscriptionStatus?: string | null;
  trialEndsAt?: Date | string | null;
  trialCancelledAt?: Date | string | null;
  paymentGraceEndsAt?: Date | string | null;
  paymentRestrictedModules?: string[] | null;
  paymentAccessHold?: boolean | null;
}

/** When an authorized trial's access ends (null = no valid trial). */
export function trialAccessEndsAt(ws: WorkspacePlanFacts): Date | null {
  if (ws.subscriptionStatus !== 'trial_active' || !ws.trialEndsAt) return null;
  const end = new Date(ws.trialEndsAt).getTime();
  if (Number.isNaN(end)) return null;
  return new Date(end + (ws.trialCancelledAt ? 0 : TRIAL_CHARGE_PROCESSING_MS));
}

function inGrace(graceEndsAt: Date | string | null | undefined, now: Date): boolean {
  if (!graceEndsAt) return false;
  const end = new Date(graceEndsAt).getTime();
  return !Number.isNaN(end) && now.getTime() < end;
}

export function workspaceHasPlanAccess(ws: WorkspacePlanFacts | null | undefined, now: Date = new Date()): boolean {
  if (!ws) return false;
  if (ws.subscriptionStatus === 'active') return ws.paymentAccessHold !== true;
  if (ws.subscriptionStatus === 'past_due') return inGrace(ws.paymentGraceEndsAt, now);
  const end = trialAccessEndsAt(ws);
  return !!end && now.getTime() < end.getTime();
}

export type WorkspaceAccessMode = 'full' | 'grace' | 'restricted' | 'held' | 'none';

/**
 * What the dashboard should do for this workspace. 'restricted' carries the
 * modules to lock (the rest of the paid plan stays usable); with the default
 * policy that is every paid module, i.e. a full lock.
 */
export function workspaceAccessState(
  ws: WorkspacePlanFacts | null | undefined,
  now: Date = new Date()
): { mode: WorkspaceAccessMode; restrictedModules: string[] | null; graceEndsAt: Date | null } {
  if (!ws) return { mode: 'none', restrictedModules: null, graceEndsAt: null };
  if (ws.subscriptionStatus === 'active') {
    return ws.paymentAccessHold === true
      ? { mode: 'held', restrictedModules: [...PAID_MODULE_KEYS], graceEndsAt: null }
      : { mode: 'full', restrictedModules: null, graceEndsAt: null };
  }
  if (ws.subscriptionStatus === 'past_due') {
    if (inGrace(ws.paymentGraceEndsAt, now)) return { mode: 'grace', restrictedModules: null, graceEndsAt: new Date(ws.paymentGraceEndsAt!) };
    return { mode: 'restricted', restrictedModules: restrictedListOrAll(ws.paymentRestrictedModules), graceEndsAt: null };
  }
  return workspaceHasPlanAccess(ws, now)
    ? { mode: 'full', restrictedModules: null, graceEndsAt: null }
    : { mode: 'none', restrictedModules: null, graceEndsAt: null };
}

/** A missing or malformed frozen list means every paid module is restricted. */
function restrictedListOrAll(list: unknown): string[] {
  if (Array.isArray(list) && list.every((m) => (PAID_MODULE_KEYS as readonly string[]).includes(m))) return [...list];
  return [...PAID_MODULE_KEYS];
}

/** Business fields the workspace rules need — add to any .select(). */
export const PLAN_ACCESS_FIELDS =
  'subscriptionStatus trialEndsAt trialCancelledAt paymentGraceEndsAt paymentRestrictedModules paymentAccessHold';

/** Same rule as workspaceHasPlanAccess, as a MongoDB filter for crons. */
export function planAccessWorkspaceFilter(now: Date = new Date()): Record<string, unknown> {
  return {
    $or: [
      { subscriptionStatus: 'active', paymentAccessHold: { $ne: true } },
      {
        subscriptionStatus: 'trial_active',
        trialCancelledAt: { $exists: false },
        trialEndsAt: { $gt: new Date(now.getTime() - TRIAL_CHARGE_PROCESSING_MS) },
      },
      { subscriptionStatus: 'trial_active', trialCancelledAt: { $exists: true }, trialEndsAt: { $gt: now } },
      { subscriptionStatus: 'past_due', paymentGraceEndsAt: { $gt: now } },
    ],
  };
}

export interface UserSubscriptionFacts {
  billingStatus?: string | null;
  trialSource?: string | null;
  trialStatus?: { isActive?: boolean | null; endsAt?: Date | string | null } | null;
  paymentGraceEndsAt?: Date | string | null;
  restrictedModules?: string[] | null;
  accessHold?: boolean | null;
  modules?: Record<string, { enabled?: boolean | null } | undefined> | null;
}

/** User-level trial (requireModule, mobile): only an authorized offer trial within its end date. */
export function isOfferTrialActive(sub: UserSubscriptionFacts | null | undefined, now: Date = new Date()): boolean {
  if (!sub || sub.billingStatus !== 'Trialing' || sub.trialSource !== 'offer') return false;
  if (!sub.trialStatus?.isActive || !sub.trialStatus.endsAt) return false;
  return new Date(sub.trialStatus.endsAt).getTime() > now.getTime();
}

/**
 * Module entitlement for one user (requireModule; mirrored by the mobile app).
 *  - no Subscription doc (legacy account)  → allowed
 *  - always-free module                    → allowed
 *  - authorized offer trial                → allowed
 *  - paid again but held                   → locked
 *  - payment failure, inside grace         → allowed (the paid plan continues)
 *  - payment failure, after grace          → locked if the frozen policy restricts it
 *                                            (missing list = all paid modules), else allowed
 *  - otherwise                             → the modules map
 */
export function userCanUseModule(sub: UserSubscriptionFacts | null | undefined, module: string, now: Date = new Date()): boolean {
  if (!sub) return true;
  if (module === ALWAYS_FREE_MODULE) return true;
  if (isOfferTrialActive(sub, now)) return true;
  if (sub.accessHold === true) return false;
  if (sub.billingStatus === 'PastDue') {
    if (inGrace(sub.paymentGraceEndsAt, now)) return true;
    return !restrictedListOrAll(sub.restrictedModules).includes(module);
  }
  return sub.modules?.[module]?.enabled === true;
}

/**
 * The plan whose usage limits apply. A paid user keeps their plan; an
 * authorized offer trial, or a payment failure still in grace, gets the paid
 * plan's limits ('Pro' — THE sellable plan, see planCatalog.ts), never
 * unlimited and never Free; everyone else Free.
 */
export function limitsPlanFor(
  userPlan: string | null | undefined,
  sub: UserSubscriptionFacts | null | undefined,
  now: Date = new Date()
): string {
  if (userPlan && userPlan !== 'Free') return userPlan;
  if (isOfferTrialActive(sub, now)) return 'Pro';
  if (sub?.billingStatus === 'PastDue' && inGrace(sub.paymentGraceEndsAt, now)) return 'Pro';
  return 'Free';
}
