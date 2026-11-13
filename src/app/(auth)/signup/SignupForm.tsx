'use client';

import { useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { BusinessAutocomplete, type SelectedBusiness } from '@/components/shared/BusinessAutocomplete';
import { PhoneNumberInput } from '@/components/shared/PhoneNumberInput';

/**
 * Website "Create free account" — same flow and API as the app
 * (POST /api/auth/signup/send-otp → POST /api/auth/signup, channel 'website'):
 * name + business (Google listing, or typed) + WhatsApp code → free account
 * (CRM + visiting-card scan) and, when a listing was picked, the free report.
 * ?next=upgrade (Pricing → Get started) continues to the upgrade page.
 */
export default function SignupForm() {
  const [step, setStep] = useState<'details' | 'otp'>('details');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<SelectedBusiness | null>(null);
  const [manual, setManual] = useState(false);
  const [bizName, setBizName] = useState('');
  const [category, setCategory] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [existing, setExisting] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const businessReady = !!selected || (manual && bizName.trim().length > 1);

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    if (name.trim().length < 2) return setError('Please enter your name.');
    if (!businessReady) return setError('Please pick your business on Google, or type its name.');
    if (phone.replace(/\D/g, '').length < 8) return setError('Please enter your WhatsApp number.');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.error || 'Could not send the code. Please try again.');
      } else {
        setMaskedPhone(data.maskedPhone || phone);
        setExisting(!!data.existingAccount);
        setOtp('');
        setStep('otp');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          otp,
          name: name.trim(),
          channel: 'website',
          business: selected
            ? { googlePlaceId: selected.googlePlaceId, name: selected.name, city: selected.city, category: selected.category }
            : { name: bizName.trim(), category: category.trim() || undefined, city: city.trim() || undefined },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.error || 'Incorrect or expired code.');
        setLoading(false);
        return;
      }
      const next = new URLSearchParams(window.location.search).get('next');
      // Existing accounts go to their dashboard; new free accounts to the CRM
      // (or the upgrade page when they came from Pricing).
      window.location.href = data.outcome === 'existing' ? '/dashboard' : next === 'upgrade' ? '/dashboard/upgrade' : '/dashboard/crm';
    } catch {
      setError('Network error. Please try again.');
      setLoading(false);
    }
  };

  const inputCls =
    'w-full px-4 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all';

  return (
    <div className="w-full bg-surface-container-lowest rounded-xl card-shadow border border-outline-variant p-6 sm:p-10">
      <div className="text-center mb-8">
        <h1 className="text-headline-md font-heading text-on-surface mb-2">Create your free account</h1>
        <p className="text-sm text-on-surface-variant">
          Free CRM and visiting-card scanner — plus a free report on how your business shows up on Google.
        </p>
      </div>

      {step === 'details' ? (
        <form onSubmit={sendCode} className="space-y-5">
          <div>
            <label className="block text-label-md text-on-surface mb-2">Your name</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoComplete="name" />
          </div>

          <div>
            <label className="block text-label-md text-on-surface mb-2">Your business</label>
            {manual ? (
              <div className="space-y-3">
                <input className={inputCls} value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="Business name" />
                <input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="What do you do? e.g. Dental clinic (optional)" />
                <input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} placeholder="City (optional)" />
                <button type="button" onClick={() => setManual(false)} className="text-sm font-medium text-primary hover:underline">
                  Search Google instead
                </button>
              </div>
            ) : (
              <>
                <BusinessAutocomplete selected={selected} onSelect={setSelected} onClear={() => setSelected(null)} placeholder="Start typing your business name…" />
                <p className="text-xs text-outline mt-1.5">
                  Pick your business — we&apos;ll prepare your free Google profile report.{' '}
                  <button type="button" onClick={() => { setSelected(null); setManual(true); }} className="text-primary hover:underline font-medium">
                    Not on Google?
                  </button>
                </p>
              </>
            )}
          </div>

          <div>
            <label className="block text-label-md text-on-surface mb-2">WhatsApp number</label>
            <PhoneNumberInput value={phone} onChange={setPhone} className="[&_select]:text-base" />
            <p className="text-xs text-outline mt-1.5">
              We&apos;ll send a one-time code on WhatsApp. By continuing you agree that we may send you your report and account updates on WhatsApp.
            </p>
          </div>

          {error && (
            <div role="alert" className="p-4 bg-error-container border border-outline-variant text-on-error-container text-sm font-medium rounded-lg text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 bg-primary hover:bg-primary-container text-on-primary font-bold rounded-lg transition-all disabled:opacity-70"
          >
            {loading ? <MaterialIcon name="progress_activity" size={20} className="animate-spin" /> : <><MaterialIcon name="chat" size={18} /> Send code on WhatsApp</>}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-5">
          {existing && (
            <p className="p-3 rounded-lg bg-surface-container text-sm text-on-surface text-center">
              You already have an account with this number — this code will sign you in.
            </p>
          )}
          <div>
            <label className="block text-label-md text-on-surface mb-2">Enter code</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              className={`${inputCls} text-center text-2xl tracking-[0.5em]`}
              placeholder="······"
              autoFocus
            />
            <p className="text-xs text-outline mt-1.5">
              Sent to {maskedPhone} on WhatsApp.{' '}
              <button type="button" onClick={() => setStep('details')} className="text-primary hover:underline font-medium">
                Change details
              </button>
            </p>
          </div>

          {error && (
            <div role="alert" className="p-4 bg-error-container border border-outline-variant text-on-error-container text-sm font-medium rounded-lg text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || otp.length !== 6}
            className="w-full flex items-center justify-center py-3 bg-primary hover:bg-primary-container text-on-primary font-bold rounded-lg transition-all disabled:opacity-70"
          >
            {loading ? <MaterialIcon name="progress_activity" size={20} className="animate-spin" /> : existing ? 'Verify & sign in' : 'Create my free account'}
          </button>
          <button type="button" onClick={() => void sendCode()} disabled={loading} className="w-full text-center text-sm font-medium text-primary hover:text-primary-container disabled:opacity-60">
            Didn&apos;t get a code? Resend
          </button>
        </form>
      )}

      <p className="text-center text-sm font-medium text-on-surface-variant mt-8">
        Already have an account? <a href="/login" className="text-primary hover:text-primary-container">Sign in</a>
      </p>
    </div>
  );
}
