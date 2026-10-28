import { useMemo } from 'react';

import type { ModuleKey } from '@/api/endpoints/auth';
import { useAuth } from '@/auth/AuthContext';
import { useBusiness } from '@/business/BusinessContext';
import { ALL_MODULE_KEYS, computeEntitlements, type Entitlements } from './compute';

/**
 * Client-side entitlements, derived from the subscription block on
 * /api/auth/me — the rules live in ./compute.ts (pure, unit-tested).
 * Presentation only: the server enforces the same rules and answers 403
 * MODULE_LOCKED on gated routes.
 */

export { ALL_MODULE_KEYS, computeEntitlements };
export type { Entitlements };

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

export function useEntitlements(): Entitlements {
  const { user } = useAuth();
  const { workspaceRestrictedModules } = useBusiness();
  const sub = user?.subscription;
  return useMemo(() => {
    const ent = computeEntitlements(sub);
    if (!workspaceRestrictedModules?.length) return ent;
    // The user-level plan is shared by all of the owner's workspaces; a
    // failed payment on THIS workspace can still lock some of its modules.
    const modules = { ...ent.modules };
    for (const key of ALL_MODULE_KEYS) {
      if (workspaceRestrictedModules.includes(key)) modules[key] = false;
    }
    return { ...ent, modules };
  }, [sub, workspaceRestrictedModules]);
}

/** True when the given app surface should render as locked. */
export function useSurfaceLocked(surface: SurfaceKey): boolean {
  const { modules } = useEntitlements();
  return !modules[SURFACE_MODULES[surface]];
}
