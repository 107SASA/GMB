'use client';

import type { PlanDuration } from './useRazorpayCheckout';

/** Returns the duration matching `cycle`, or the first available one. */
export function pickDuration(durations: PlanDuration[] | undefined, cycle: string): PlanDuration | undefined {
  if (!durations?.length) return undefined;
  return durations.find((d) => d.cycle === cycle) ?? durations[0];
}

/**
 * Genuine "you save ₹X vs paying monthly" — never a fabricated original
 * price. Shared by /checkout and every duration-picker-carrying pricing
 * surface (AuditPaywallSidebar, WorkspaceLockGate) so the savings math is
 * computed exactly once.
 */
export function computeSavings(durations: PlanDuration[] | undefined, selected: PlanDuration | undefined): number | null {
  if (!durations || !selected || selected.months <= 1) return null;
  const monthly = durations.find((d) => d.months === 1);
  if (!monthly) return null;
  const savings = monthly.priceInr * selected.months - selected.priceInr;
  return savings > 0 ? savings : null;
}

// Cosmetic urgency countdown — shared by /checkout and any pricing surface
// that opts into the same "Launch price" badge (AuditPaywallSidebar's
// `promoStyle`). Resets every visit; there's no real fixed deadline behind
// it (no separate "launch ends at" field exists in the billing config) — the
// actual price/savings shown alongside it are always real, computed values,
// never fabricated to match. See computeSavings above.
export const LAUNCH_WINDOW_SECONDS = 30 * 60;

export function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const PREFERRED_CYCLE_KEY = 'gm_preferred_billing_cycle';

/**
 * The billing cycle a visitor picked on the homepage pricing teaser, before
 * they ever hit a real checkout button — persisted so it carries through the
 * free-audit flow to wherever checkout actually happens (the audit paywall
 * sidebar, the dashboard lock gate, or a direct visit to /pricing).
 */
export function getPreferredCycle(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(PREFERRED_CYCLE_KEY);
  } catch {
    return null;
  }
}

export function setPreferredCycle(cycle: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFERRED_CYCLE_KEY, cycle);
  } catch {
    // Private browsing / storage disabled — the picker still works in-page.
  }
}

/**
 * Compact billing-duration selector. Renders nothing when there's only one
 * (or zero) duration, so single-cycle plans look exactly as before.
 */
export function DurationPicker({
  durations,
  value,
  onChange,
}: {
  durations: PlanDuration[];
  value: string;
  onChange: (cycle: string) => void;
}) {
  if (!durations || durations.length <= 1) return null;

  return (
    <div className="mb-4 grid grid-cols-2 gap-2">
      {durations.map((d) => {
        const active = d.cycle === value;
        const perMonth = d.months > 0 ? Math.round(d.priceInr / d.months) : d.priceInr;
        return (
          <button
            key={d.cycle}
            type="button"
            onClick={() => onChange(d.cycle)}
            className={`rounded-xl border px-3 py-2 text-left transition-all ${
              active ? 'border-primary bg-primary-fixed ring-1 ring-primary' : 'border-outline-variant hover:border-outline-variant'
            }`}
          >
            <div className="text-xs font-bold text-on-surface">{d.label}</div>
            <div className="text-[11px] text-on-surface-variant">
              ₹{d.priceInr.toLocaleString('en-IN')}
              {d.months > 1 ? ` · ₹${perMonth.toLocaleString('en-IN')}/mo` : ''}
            </div>
          </button>
        );
      })}
    </div>
  );
}
