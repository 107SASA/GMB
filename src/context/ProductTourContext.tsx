'use client';

import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useBusiness } from './BusinessContext';
import { PRODUCT_TOUR_STEPS, type TourStep } from '@/lib/productTour';

const STORAGE_KEY = 'gm_product_tour_step';

interface ProductTourContextType {
  /** Tour is running (user hasn't finished/skipped it) AND has a current step. */
  active: boolean;
  stepIndex: number;
  stepCount: number;
  step: TourStep | null;
  /** Whether the current page IS the current step's target route. */
  onCurrentRoute: boolean;
  next: () => void;
  back: () => void;
  skip: () => void;
}

const ProductTourContext = createContext<ProductTourContextType | null>(null);

export function useProductTour(): ProductTourContextType {
  const ctx = useContext(ProductTourContext);
  if (!ctx) throw new Error('useProductTour must be used within ProductTourProvider');
  return ctx;
}

/**
 * Drives the dashboard product tour's state — which step, whether it's
 * still eligible to show at all (the user hasn't finished or skipped it
 * before), and whether the step the user is currently on lives on the page
 * they're looking at right now.
 *
 * Step progress is persisted to localStorage (not just React state) because
 * step 1 (connect Google) involves a full-page redirect to Google's OAuth
 * consent screen and back — that round trip destroys all in-memory React
 * state, so resuming afterward needs something that survives a real
 * navigation, not just client-side routing.
 */
export function ProductTourProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { activeBusiness } = useBusiness();

  const [loaded, setLoaded] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // One-time check on mount: has this user already finished/skipped the
  // tour before (persisted server-side, so it stays gone across devices and
  // browser data clears), and if not, resume from wherever localStorage says.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        const json = await res.json();
        if (cancelled || !json?.success) return;
        if (!json.user?.hasCompletedProductTour) {
          setEligible(true);
          const saved = Number(localStorage.getItem(STORAGE_KEY));
          setStepIndex(Number.isFinite(saved) && saved >= 0 && saved < PRODUCT_TOUR_STEPS.length ? saved : 0);
        }
      } catch {
        // Can't confirm eligibility — stay hidden rather than risk showing
        // the tour again to someone who already finished it.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setStep = useCallback((i: number) => {
    setStepIndex(i);
    try {
      localStorage.setItem(STORAGE_KEY, String(i));
    } catch {
      /* localStorage unavailable (private mode, etc.) — tour still works for this session */
    }
  }, []);

  const finish = useCallback(() => {
    setEligible(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    fetch('/api/user/product-tour', { method: 'POST' }).catch(() => {
      /* best-effort — worst case the tour reappears next session, not the end of the world */
    });
  }, []);

  // Step 1 (connect Google) is the one step a "Next" click can't reliably
  // catch: clicking "Connect" navigates all the way to Google's consent
  // screen and back, landing back on this same page with the connection
  // already made. Auto-advance the instant the workspace shows connected,
  // rather than leaving a stale "connect Google" spotlight up over an
  // already-connected profile.
  useEffect(() => {
    if (eligible && stepIndex === 0 && activeBusiness?.googleConnected) {
      setStep(1);
    }
  }, [eligible, stepIndex, activeBusiness?.googleConnected, setStep]);

  const next = useCallback(() => {
    if (stepIndex >= PRODUCT_TOUR_STEPS.length - 1) {
      finish();
      return;
    }
    setStep(stepIndex + 1);
  }, [stepIndex, setStep, finish]);

  const back = useCallback(() => {
    if (stepIndex <= 0) return;
    setStep(stepIndex - 1);
  }, [stepIndex, setStep]);

  const step = eligible ? PRODUCT_TOUR_STEPS[stepIndex] ?? null : null;

  const value: ProductTourContextType = {
    active: loaded && eligible && !!step,
    stepIndex,
    stepCount: PRODUCT_TOUR_STEPS.length,
    step,
    onCurrentRoute: !!step && pathname === step.route,
    next,
    back,
    skip: finish,
  };

  return <ProductTourContext.Provider value={value}>{children}</ProductTourContext.Provider>;
}
