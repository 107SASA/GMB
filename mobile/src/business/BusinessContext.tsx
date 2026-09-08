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
import { deleteWorkspace, fetchBusinesses, type Business } from '@/api/endpoints/businesses';
import { useAuth } from '@/auth/AuthContext';

const BUSINESS_KEY = 'active_business_id';

// Mirrors src/proxy.ts's INTAKE_ENFORCED_SINCE on the web: only workspaces
// created on/after this date are hard-gated into the post-payment intake.
// Older workspaces are left alone (they predate the intake requirement).
const INTAKE_ENFORCED_SINCE = new Date('2026-07-23T00:00:00.000Z');

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
    setActiveBusinessId(businessId);
    setActiveBusinessIdHeader(businessId);
    await SecureStore.setItemAsync(BUSINESS_KEY, businessId).catch(() => {});
  }, []);

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

  const value = useMemo<BusinessContextValue>(() => {
    const activeBusiness = businesses.find((b) => b._id === activeBusinessId) ?? null;
    const isLoading = isFetching || (isAuthenticated && !restored);
    const needsSelection = !isLoading && businesses.length > 1 && activeBusiness === null;

    // Onboarding gate. Deliberately independent of subscription status (unlike
    // web's proxy.ts, which wraps the intake check in isWorkspaceUnlocked) —
    // BusinessContext has no billing data and the real-world entry point is a
    // customer opening the app right after paying, so the intake form is the
    // right next screen for them regardless. An unpaid user who reaches here
    // is a rare edge and the intake form is harmless.
    let onboardingStep: OnboardingStep = null;
    if (isAuthenticated && !isLoading && !needsSelection) {
      if (businesses.length === 0) {
        onboardingStep = 'create';
      } else if (activeBusiness && !activeBusiness.intakeCompleted) {
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
      selectBusiness,
      deleteBusiness,
    };
  }, [businesses, isFetching, isAuthenticated, restored, activeBusinessId, selectBusiness, deleteBusiness]);

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness(): BusinessContextValue {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error('useBusiness must be used inside <BusinessProvider>');
  return ctx;
}
