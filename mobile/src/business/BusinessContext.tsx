import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { setActiveBusinessIdHeader } from '@/api/client';
import { fetchBillingStatus } from '@/api/endpoints/account';
import { deleteWorkspace, fetchBusinesses, type Business } from '@/api/endpoints/businesses';
import { useAuth } from '@/auth/AuthContext';

const BUSINESS_KEY = 'active_business_id';

// Mirrors src/proxy.ts's INTAKE_ENFORCED_SINCE on the web: only workspaces
// created on/after this date are hard-gated into the post-payment intake.
// Older workspaces are left alone (they predate the intake requirement).
const INTAKE_ENFORCED_SINCE = new Date('2026-07-23T00:00:00.000Z');

// Paid modules (every module but the always-free google_ranking_agent).
const PAID_MODULE_COUNT = 4;

/**
 * `'create'` — the user has no workspace at all; the wizard starts by finding
 * their business on Google and creating it.
 * `'intake'` — a workspace exists but its "Tell us about your business" intake
 * form hasn't been completed.
 * `null`     — onboarding is not required.
 */
export type OnboardingStep = 'create' | 'intake' | null;

interface BusinessContextValue {
  businesses: Business[];
  isLoading: boolean;
  /** Currently selected workspace (drives the x-business-id header). */
  activeBusinessId: string | null;
  activeBusiness: Business | null;
  /**
   * True when the user has multiple businesses and no valid persisted or
   * server-side default — the UI must show the picker before the tabs.
   */
  needsSelection: boolean;
  /**
   * True when the signed-in user still has onboarding to finish — no
   * workspace yet, or a workspace whose post-payment intake is incomplete.
   * The app hard-gates the tabs behind the /(onboarding) wizard while this
   * is true (see (app)/_layout.tsx), matching the web proxy.ts behaviour.
   */
  needsOnboarding: boolean;
  /** Which step the onboarding wizard should start on (see OnboardingStep). */
  onboardingStep: OnboardingStep;
  /**
   * True when the active workspace has no paid plan or trial (same
   * `workspace.isActive` signal the web WorkspaceLockGate uses). The app
   * shows the "workspace not active" screen instead of onboarding and tabs.
   */
  workspaceLocked: boolean;
  /** Why it is locked, for the copy: never paid, payment failed, or ended. */
  workspaceLockReason: 'unpaid' | 'payment_failed' | 'ended' | null;
  /**
   * Paid modules locked for the active workspace after a failed payment when
   * the billing policy restricts only some of them (the rest stay usable,
   * like the web). null = no workspace-level restriction.
   */
  workspaceRestrictedModules: string[] | null;
  /** Re-checks the active workspace's billing state (e.g. after paying). */
  refreshWorkspaceAccess: () => Promise<void>;
  selectBusiness: (businessId: string) => Promise<void>;
  /**
   * Soft-deletes a workspace. If the deleted one was active, switches to the
   * server-chosen next workspace (or clears selection when none remain), then
   * refreshes the list.
   */
  deleteBusiness: (businessId: string) => Promise<void>;
}

const BusinessContext = createContext<BusinessContextValue | null>(null);

export function BusinessProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isHydrating, user } = useAuth();
  const queryClient = useQueryClient();
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  const { data: businesses = [], isLoading: isFetching } = useQuery({
    queryKey: ['businesses', user?.id],
    queryFn: fetchBusinesses,
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  // Restore the persisted selection once per login.
  useEffect(() => {
    // While the auth token is still being restored, isAuthenticated is
    // transiently false — don't treat that as a logout.
    if (isHydrating) return;

    if (!isAuthenticated) {
      setActiveBusinessId(null);
      setActiveBusinessIdHeader(null);
      setRestored(false);
      // Drop the persisted choice so a different account on this device
      // never starts with someone else's workspace id.
      void SecureStore.deleteItemAsync(BUSINESS_KEY).catch(() => {});
      return;
    }
    let cancelled = false;
    (async () => {
      const stored = await SecureStore.getItemAsync(BUSINESS_KEY).catch(() => null);
      if (cancelled) return;
      if (stored) {
        setActiveBusinessId(stored);
        setActiveBusinessIdHeader(stored);
      }
      setRestored(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  // Once businesses load, validate the restored choice and default sensibly:
  // stored id (if still owned) → server's activeBusinessId → auto-select when
  // there is only one. With several businesses and no default, selection is
  // left null and needsSelection makes the UI show the picker.
  useEffect(() => {
    if (!restored || isFetching || businesses.length === 0) return;
    const owned = (id: string | null | undefined) =>
      id != null && businesses.some((b) => b._id === id);

    if (owned(activeBusinessId)) return;

    let fallback: string | null = null;
    if (owned(user?.activeBusinessId)) fallback = user!.activeBusinessId as string;
    else if (businesses.length === 1) fallback = businesses[0]._id;

    setActiveBusinessId(fallback);
    setActiveBusinessIdHeader(fallback);
    if (fallback) void SecureStore.setItemAsync(BUSINESS_KEY, fallback).catch(() => {});
  }, [restored, isFetching, businesses, activeBusinessId, user]);

  const selectBusiness = useCallback(async (businessId: string) => {
    setActiveBusinessId((previous) => {
      if (previous && previous !== businessId) {
        // Drop in-flight requests for the business we're leaving so a late
        // response cannot be stored against that workspace after the header moves.
        void queryClient.cancelQueries({ predicate: (query) => query.queryKey.includes(previous) });
      }
      return businessId;
    });
    setActiveBusinessIdHeader(businessId);
    // Mark this workspace's cached screens stale so Posts, audits and stats
    // refetch instead of showing the last visit's copy.
    void queryClient.invalidateQueries({
      predicate: (query) => query.queryKey.includes(businessId),
    });
    await SecureStore.setItemAsync(BUSINESS_KEY, businessId).catch(() => {});
  }, [queryClient]);

  const deleteBusiness = useCallback(
    async (businessId: string) => {
      const { nextActiveBusinessId } = await deleteWorkspace(businessId);
      if (businessId === activeBusinessId) {
        setActiveBusinessId(nextActiveBusinessId);
        setActiveBusinessIdHeader(nextActiveBusinessId);
        if (nextActiveBusinessId) {
          await SecureStore.setItemAsync(BUSINESS_KEY, nextActiveBusinessId).catch(() => {});
        } else {
          await SecureStore.deleteItemAsync(BUSINESS_KEY).catch(() => {});
        }
      }
      // Refresh the list and any workspace-scoped data for the new active id.
      await queryClient.invalidateQueries({ queryKey: ['businesses'] });
    },
    [activeBusinessId, queryClient]
  );

  const hasActiveBusiness = businesses.some((b) => b._id === activeBusinessId);

  // Per-workspace billing gate — the same /api/billing/status signal the web
  // WorkspaceLockGate reads. Keyed by workspace so switching re-checks it;
  // polled while locked so the gate lifts soon after paying on the web.
  const access = useQuery({
    queryKey: ['workspace-access', activeBusinessId],
    queryFn: fetchBillingStatus,
    enabled: isAuthenticated && hasActiveBusiness,
    refetchInterval: (query) =>
      query.state.data?.workspace && !query.state.data.workspace.isActive ? 30_000 : false,
  });

  const { refetch: refetchAccess } = access;
  const refreshWorkspaceAccess = useCallback(async () => {
    await refetchAccess();
  }, [refetchAccess]);

  // Fail open on a network/server error, like the web gate — the gated APIs
  // still enforce access server-side.
  const workspace = access.data?.workspace;
  // A failed payment that restricts only SOME paid modules keeps the rest
  // usable — the web blurs just those pages (WorkspaceLockGate).
  const partial =
    workspace?.access?.mode === 'restricted' &&
    Array.isArray(workspace.access.restrictedModules) &&
    workspace.access.restrictedModules.length < PAID_MODULE_COUNT;
  const workspaceLocked = hasActiveBusiness && !!workspace && !workspace.isActive && !partial;
  const workspaceRestrictedModules =
    hasActiveBusiness && partial ? (workspace?.access?.restrictedModules ?? null) : null;
  const workspaceLockReason: BusinessContextValue['workspaceLockReason'] = !workspaceLocked
    ? null
    : workspace?.subscriptionStatus === 'past_due' || workspace?.access?.mode === 'held'
      ? 'payment_failed'
      : workspace?.subscriptionStatus === 'canceled' || workspace?.subscriptionStatus === 'trial_active'
        ? 'ended'
        : 'unpaid';
  const accessLoading = hasActiveBusiness && access.isPending && access.fetchStatus !== 'idle';

  const value = useMemo<BusinessContextValue>(() => {
    const activeBusiness = businesses.find((b) => b._id === activeBusinessId) ?? null;
    const isLoading = isFetching || (isAuthenticated && !restored) || accessLoading;
    const needsSelection = !isLoading && businesses.length > 1 && activeBusiness === null;

    // Onboarding gate. Like web's proxy.ts, the post-payment intake only runs
    // for an unlocked (paid or trial) workspace — an unpaid one (e.g. the
    // shadow account a free report or demo booking creates) gets the
    // "workspace not active" screen instead.
    let onboardingStep: OnboardingStep = null;
    if (isAuthenticated && !isLoading && !needsSelection) {
      if (businesses.length === 0) {
        onboardingStep = 'create';
      } else if (activeBusiness && !activeBusiness.intakeCompleted && !workspaceLocked) {
        const createdAt = activeBusiness.createdAt ? new Date(activeBusiness.createdAt) : null;
        if (createdAt && createdAt >= INTAKE_ENFORCED_SINCE) {
          onboardingStep = 'intake';
        }
      }
    }

    return {
      businesses,
      isLoading,
      activeBusinessId,
      activeBusiness,
      needsSelection,
      needsOnboarding: onboardingStep !== null,
      onboardingStep,
      workspaceLocked,
      workspaceLockReason,
      workspaceRestrictedModules,
      refreshWorkspaceAccess,
      selectBusiness,
      deleteBusiness,
    };
  }, [
    businesses,
    isFetching,
    isAuthenticated,
    restored,
    activeBusinessId,
    accessLoading,
    workspaceLocked,
    workspaceLockReason,
    workspaceRestrictedModules,
    refreshWorkspaceAccess,
    selectBusiness,
    deleteBusiness,
  ]);

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness(): BusinessContextValue {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error('useBusiness must be used inside <BusinessProvider>');
  return ctx;
}
