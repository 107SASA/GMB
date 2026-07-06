import { useMemo } from 'react';

import type { ModuleKey } from '@/api/endpoints/auth';
import { useAuth } from '@/auth/AuthContext';

/**
 * Client-side entitlements, derived from the subscription block on
 * /api/auth/me. Presentation only — the server enforces the same rules and
 * answers 403 MODULE_LOCKED on gated routes.
 *
 * Mirrors the server's requireModule semantics (src/lib/moduleGating.ts):
 *  - no subscription block (legacy user) → every module available
 *  - active trial → every module available
 *  - otherwise → modules map decides
 */

export const ALL_MODULE_KEYS: ModuleKey[] = [
  'google_ranking_agent',
  'reputation_agent',
  'sales_agent',
  'content_studio',
  'marketing_automation',
];

export const MODULE_NAMES: Record<ModuleKey, string> = {
  google_ranking_agent: 'Google Ranking',
  reputation_agent: 'Reviews & Reputation',
  sales_agent: 'Inbox & Leads',
  content_studio: 'Content Studio',
  marketing_automation: 'Campaigns',
};

/** Which module each app surface belongs to — mirrors the server catalog. */
export const SURFACE_MODULES = {
  dashboard: 'google_ranking_agent',
  inbox: 'sales_agent',
  leads: 'sales_agent',
  reviews: 'reputation_agent',
  content: 'content_studio',
  scheduler: 'content_studio',
  campaigns: 'marketing_automation',
} as const satisfies Record<string, ModuleKey>;
export type SurfaceKey = keyof typeof SURFACE_MODULES;

/**
 * Per-module choice between the two locked UXs: false = tab stays visible
 * and renders the locked screen; true = tab is hidden entirely. Flip per
 * module when the product decides.
 */
export const HIDE_TAB_WHEN_LOCKED: Record<ModuleKey, boolean> = {
  google_ranking_agent: false,
  reputation_agent: false,
  sales_agent: false,
  content_studio: false,
  marketing_automation: false,
};

export interface Entitlements {
  planType: string;
  billingStatus: string;
  isTrialing: boolean;
  /** Whole days until the trial ends (0 when not trialing/unknown). */
  trialDaysLeft: number;
  isPastDue: boolean;
  modules: Record<ModuleKey, boolean>;
}

export function useEntitlements(): Entitlements {
  const { user } = useAuth();
  const sub = user?.subscription;

  return useMemo(() => {
    // Legacy account with no subscription doc: nothing is locked.
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
    const isTrialing =
      sub.billingStatus === 'Trialing' &&
      sub.trialStatus?.isActive === true &&
      (!endsAt || endsAt.getTime() > Date.now());
    const trialDaysLeft =
      isTrialing && endsAt
        ? Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
        : 0;

    const modules = Object.fromEntries(
      ALL_MODULE_KEYS.map((key) => [
        key,
        isTrialing ? true : sub.modules?.[key]?.enabled === true,
      ])
    ) as Record<ModuleKey, boolean>;

    return {
      planType: sub.planType ?? 'Free',
      billingStatus: sub.billingStatus ?? 'Active',
      isTrialing,
      trialDaysLeft,
      isPastDue: sub.billingStatus === 'PastDue',
      modules,
    };
  }, [sub]);
}

/** True when the given app surface should render as locked. */
export function useSurfaceLocked(surface: SurfaceKey): boolean {
  const { modules } = useEntitlements();
  return !modules[SURFACE_MODULES[surface]];
}
