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
import { useQuery } from '@tanstack/react-query';

import { setActiveBusinessIdHeader } from '@/api/client';
import { fetchBusinesses, type Business } from '@/api/endpoints/businesses';
import { useAuth } from '@/auth/AuthContext';

const BUSINESS_KEY = 'active_business_id';

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
  selectBusiness: (businessId: string) => Promise<void>;
}

const BusinessContext = createContext<BusinessContextValue | null>(null);

export function BusinessProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isHydrating, user } = useAuth();
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

  const value = useMemo<BusinessContextValue>(() => {
    const activeBusiness = businesses.find((b) => b._id === activeBusinessId) ?? null;
    const isLoading = isFetching || (isAuthenticated && !restored);
    return {
      businesses,
      isLoading,
      activeBusinessId,
      activeBusiness,
      needsSelection: !isLoading && businesses.length > 1 && activeBusiness === null,
      selectBusiness,
    };
  }, [businesses, isFetching, isAuthenticated, restored, activeBusinessId, selectBusiness]);

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness(): BusinessContextValue {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error('useBusiness must be used inside <BusinessProvider>');
  return ctx;
}
