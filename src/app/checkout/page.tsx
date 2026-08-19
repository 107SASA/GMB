'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  MODULE_LABELS,
  usePublicPlan,
  useRazorpayCheckout,
  type PlanDuration,
} from '@/components/billing/useRazorpayCheckout';
import { pickDuration, setPreferredCycle } from '@/components/billing/DurationPicker';
import { PhoneNumberInput } from '@/components/shared/PhoneNumberInput';

const LAUNCH_WINDOW_SECONDS = 30 * 60; // cosmetic — see the countdown note below.

function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Genuine "you save ₹X vs paying monthly" — never a fabricated original price. */
function computeSavings(durations: PlanDuration[] | undefined, selected: PlanDuration | undefined): number | null {
  if (!durations || !selected || selected.months <= 1) return null;
  const monthly = durations.find((d) => d.months === 1);
  if (!monthly) return null;
  const savings = monthly.priceInr * selected.months - selected.priceInr;
  return savings > 0 ? savings : null;
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutForm />
    </Suspense>
  );
}

function CheckoutForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('return') || '/dashboard';

  const { plan, loading } = usePublicPlan();
  const [cycle, setCycle] = useState(() => searchParams.get('cycle') || 'yearly');

  const [profileLoading, setProfileLoading] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('+91');
  const [originalName, setOriginalName] = useState('');
  const [originalPhone, setOriginalPhone] = useState('');
  const [formError, setFormError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Cosmetic urgency timer — a genuine "launch price" is set super-admin
  // side via the price editor (no separate deadline field exists), so this
  // resets every visit rather than counting down to a real fixed instant.
  // Real, per-cycle discount math (see computeSavings) is what actually
  // drives the numbers on this page — this timer is decoration only.
  const [secondsLeft, setSecondsLeft] = useState(LAUNCH_WINDOW_SECONDS);
  useEffect(() => {
    const t = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  const { checkout, subscribe } = useRazorpayCheckout({
    onUnauthenticated: () => router.push(`/login?next=${encodeURIComponent(`/checkout?cycle=${cycle}&return=${returnTo}`)}`),
    onActivated: () => {
      router.push(returnTo);
      router.refresh();
    },
  });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/user/profile')
      .then((r) => {
        if (r.status === 401) {
          router.push(`/login?next=${encodeURIComponent(`/checkout?cycle=${cycle}&return=${returnTo}`)}`);
          return null;
        }
        return r.json();
      })
      .then((json) => {
        if (cancelled || !json?.user) return;
        setName(json.user.fullName || '');
        setEmail(json.user.email || '');
        setPhone(json.user.phone || '+91');
        setOriginalName(json.user.fullName || '');
        setOriginalPhone(json.user.phone || '');
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setProfileLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = checkout.phase === 'starting' || checkout.phase === 'confirming' || savingProfile;
  const selected = pickDuration(plan?.durations, cycle);
  const price = selected?.priceInr ?? plan?.priceInr;
  const cycleLabel = selected?.label ?? plan?.billingCycle ?? 'month';
  const savings = computeSavings(plan?.durations, selected);
  const features = plan?.features?.length ? plan.features : (plan?.modules ?? []).map((m) => MODULE_LABELS[m] ?? m);

  const handleSubscribe = async () => {
    setFormError('');
    if (!name.trim()) {
      setFormError('Please enter your name.');
      return;
    }
    if (!phone || phone.replace(/\D/g, '').length < 8) {
      setFormError('Please enter a valid phone number.');
      return;
    }

    // Persist any edits to the account before opening the payment widget, so
    // the Razorpay prefill (read fresh from the User doc server-side) and
    // the invoice reflect what the visitor just typed here.
    if (name.trim() !== originalName || phone !== originalPhone) {
      setSavingProfile(true);
      try {
        const res = await fetch('/api/user/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fullName: name.trim(), phone }),
        });
        const json = await res.json();
        if (!res.ok) {
          setFormError(json.error || 'Could not save your details. Please try again.');
          setSavingProfile(false);
          return;
        }
        setOriginalName(name.trim());
        setOriginalPhone(phone);
      } catch {
        setFormError('Network error saving your details. Please try again.');
        setSavingProfile(false);
        return;
      }
      setSavingProfile(false);
    }

    setPreferredCycle(cycle);
    subscribe(cycle);
  };

  return (
    <div className="min-h-screen bg-background py-16 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="font-heading text-3xl sm:text-4xl font-bold text-on-surface tracking-tight">
            You&apos;re one step from unlocking everything
          </h1>
          <p className="text-on-surface-variant mt-2">Confirm your plan and details, then pay securely with Razorpay.</p>
        </div>

        {checkout.phase === 'error' && (
          <div className="mb-6 p-4 bg-error-container border border-error-container rounded-xl flex items-center gap-3 text-on-error-container">
            <MaterialIcon name="cancel" size={20} className="shrink-0 text-on-error-container" />
            {checkout.message}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {/* Left: plan + duration */}
          <div className="bg-surface-container-lowest rounded-2xl border-2 border-primary card-shadow overflow-hidden">
            <div className="bg-gradient-to-r from-primary to-primary-container px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-white flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <MaterialIcon name="bolt" size={14} className="text-white" /> Launch price
              </span>
              <span className="tabular-nums">Ends in {formatCountdown(secondsLeft)}</span>
            </div>

            <div className="p-6">
              {loading ? (
                <div className="h-64 animate-pulse rounded-xl bg-surface-container-high" />
              ) : plan ? (
                <>
                  <div className="space-y-2.5 mb-5">
                    {plan.durations?.map((d) => {
                      const active = d.cycle === cycle;
                      const perMonth = d.months > 0 ? Math.round(d.priceInr / d.months) : d.priceInr;
                      const dSavings = computeSavings(plan.durations, d);
                      return (
                        <button
                          key={d.cycle}
                          type="button"
                          onClick={() => setCycle(d.cycle)}
                          className={`w-full text-left rounded-xl border-2 px-4 py-3 transition-all relative ${
                            active ? 'border-primary bg-primary-fixed' : 'border-outline-variant hover:border-outline'
                          }`}
                        >
                          {d.months > 1 && (
                            <span className="absolute -top-2.5 right-3 px-2 py-0.5 rounded-full bg-primary text-on-primary text-[10px] font-bold">
                              Recommended
                            </span>
                          )}
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-bold text-on-surface text-sm">{plan.displayName} — {d.label}</div>
                              <div className="text-xs text-on-surface-variant mt-0.5">
                                {d.months > 1 ? `₹${perMonth.toLocaleString('en-IN')} / month` : 'Billed monthly'}
                              </div>
                            </div>
                            <div className="text-right shrink-0 pl-3">
                              <div className="font-heading font-bold text-on-surface">₹{d.priceInr.toLocaleString('en-IN')}</div>
                              {dSavings != null && (
                                <div className="text-[11px] font-bold text-secondary">Save ₹{dSavings.toLocaleString('en-IN')}</div>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mb-5 pb-5 border-b border-outline-variant">
                    <span className="font-heading text-3xl font-bold text-on-surface">
                      ₹{(price ?? plan.priceInr).toLocaleString('en-IN')}
                    </span>
                    <span className="text-outline text-sm"> / {cycleLabel}</span>
                    {savings != null && (
                      <div className="text-sm font-bold text-secondary mt-1">You save ₹{savings.toLocaleString('en-IN')} vs paying monthly</div>
                    )}
                  </div>

                  <ul className="space-y-2.5">
                    {(features.length ? features : plan.modules.map((m) => MODULE_LABELS[m] ?? m)).map((f, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-on-surface">
                        <MaterialIcon name="check_circle" size={16} className="text-secondary shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="text-center text-sm text-on-surface-variant py-8">Pricing is unavailable right now.</div>
              )}
            </div>
          </div>

          {/* Right: details + subscribe */}
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant card-shadow p-6 flex flex-col">
            <div className="text-xs font-bold uppercase tracking-widest text-primary mb-1">Final step</div>
            <h2 className="font-heading text-xl font-bold text-on-surface mb-6">Your details</h2>

            <div className="space-y-4 flex-1">
              <div>
                <label className="block text-sm font-bold text-on-surface mb-1.5">Full name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={profileLoading}
                  className="w-full px-4 py-3 bg-surface border border-outline-variant rounded-lg text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all disabled:opacity-60"
                  placeholder="Your full name"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-on-surface mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  disabled
                  className="w-full px-4 py-3 bg-surface-container border border-outline-variant rounded-lg text-on-surface-variant outline-none cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-on-surface mb-1.5">Phone number</label>
                <PhoneNumberInput value={phone} onChange={setPhone} className={profileLoading ? 'opacity-60 pointer-events-none' : ''} />
              </div>
            </div>

            {(formError || checkout.phase === 'error') && (
              <div role="alert" className="mt-4 p-3 bg-error-container text-on-error-container rounded-lg text-sm font-medium flex items-start gap-2">
                <MaterialIcon name="error" size={18} className="shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            <button
              onClick={handleSubscribe}
              disabled={!plan?.available || busy || profileLoading}
              className="mt-6 w-full py-3.5 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2 bg-primary text-on-primary hover:bg-primary-container disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {(checkout.phase === 'starting' || savingProfile) && (
                <MaterialIcon name="progress_activity" size={16} className="animate-spin text-on-primary" />
              )}
              {checkout.phase === 'confirming' ? 'Activating…' : `Subscribe now @ ₹${(price ?? 0).toLocaleString('en-IN')} / ${cycleLabel}`}
            </button>

            <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-outline">
              <MaterialIcon name="shield" size={14} className="text-outline" />
              Secure payment via Razorpay · Cancel anytime
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
