import type { ModuleKey, Subscription } from '@/api/endpoints/auth';

/**
 * Pure entitlement rules behind useEntitlements(). Presentation only — the
 * server enforces the same rules (src/lib/moduleGating.ts requireModule) and
 * answers 403 MODULE_LOCKED on gated routes.
 *  - no subscription block (legacy user) → every module available
 *  - authorized free trial (trialSource 'offer', not expired) → every module
 *  - paid again but held → only the always-free module
 *  - past due (failed charge): inside the grace period → every module;
 *    after it → the restricted modules are locked (missing list = every paid
 *    module), the rest stay open
 *  - otherwise → modules map decides
 */

export const ALL_MODULE_KEYS: ModuleKey[] = [
  'google_ranking_agent',
  'reputation_agent',
  'sales_agent',
  'content_studio',
  'marketing_automation',
];

const ALWAYS_FREE: ModuleKey = 'google_ranking_agent';
const PAID_KEYS = ALL_MODULE_KEYS.filter((k) => k !== ALWAYS_FREE) as ModuleKey[];
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Entitlements {
  planType: string;
  billingStatus: string;
  isTrialing: boolean;
  /** Whole days until the trial ends (0 when not trialing/unknown). */
  trialDaysLeft: number;
  isPastDue: boolean;
  modules: Record<ModuleKey, boolean>;
}

export function computeEntitlements(sub: Subscription | null | undefined, now: number = Date.now()): Entitlements {
  if (!sub) {
    return {
      planType: 'Free',
      billingStatus: 'Active',
      isTrialing: false,
      trialDaysLeft: 0,
      isPastDue: false,
      modules: Object.fromEntries(ALL_MODULE_KEYS.map((k) => [k, true])) as Record<ModuleKey, boolean>,
    };
  }

  const endsAt = sub.trialStatus?.endsAt ? new Date(sub.trialStatus.endsAt) : null;
  // Only an authorized offer trial with an end date counts — a 'Trialing'
  // record without trialSource is an old schema default, not a trial.
  const isTrialing =
    sub.billingStatus === 'Trialing' &&
    sub.trialSource === 'offer' &&
    sub.trialStatus?.isActive === true &&
    !!endsAt &&
    endsAt.getTime() > now;
  const isPastDue = sub.billingStatus === 'PastDue';
  const trialDaysLeft = isTrialing && endsAt ? Math.max(0, Math.ceil((endsAt.getTime() - now) / DAY_MS)) : 0;
  const graceEnd = sub.paymentGraceEndsAt ? new Date(sub.paymentGraceEndsAt).getTime() : NaN;
  const inGrace = isPastDue && !Number.isNaN(graceEnd) && now < graceEnd;
  const restricted =
    Array.isArray(sub.restrictedModules) && sub.restrictedModules.every((m) => PAID_KEYS.includes(m as ModuleKey))
      ? sub.restrictedModules
      : PAID_KEYS;

  const allowed = (key: ModuleKey): boolean => {
    if (key === ALWAYS_FREE) return true;
    if (isTrialing) return true;
    if (sub.accessHold === true) return false;
    if (isPastDue) return inGrace || !restricted.includes(key);
    return sub.modules?.[key]?.enabled === true;
  };
  const modules = Object.fromEntries(ALL_MODULE_KEYS.map((key) => [key, allowed(key)])) as Record<ModuleKey, boolean>;

  return {
    planType: sub.planType ?? 'Free',
    billingStatus: sub.billingStatus ?? 'Active',
    isTrialing,
    trialDaysLeft,
    isPastDue,
    modules,
  };
}
