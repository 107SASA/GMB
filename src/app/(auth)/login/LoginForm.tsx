'use client';

import { useEffect, useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { PhoneNumberInput } from '@/components/shared/PhoneNumberInput';

type PhoneStep = 'enter-phone' | 'enter-otp';

export default function LoginForm({ staleSession = false }: { staleSession?: boolean }) {
  // The page handed us a session cookie whose account no longer exists — clear
  // it so this visit (and the next) starts clean instead of the cookie
  // steering /dashboard's guard back here.
  useEffect(() => {
    if (staleSession) {
      fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    }
  }, [staleSession]);

  // ── Phone + WhatsApp OTP (the only login method) ────────────────────────
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('enter-phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [noAccount, setNoAccount] = useState(false);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const requestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setPhoneError('');
    setNoAccount(false);
    // PhoneNumberInput has no native `required` — replaces the old input's
    // HTML5 validation (same check /free-report uses for the same component).
    if (!phone || phone.replace(/\D/g, '').length < 8) {
      setPhoneError('Please enter a valid phone number.');
      return;
    }
    setPhoneLoading(true);
    try {
      const res = await fetch('/api/auth/phone-login/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!data.success) {
        setPhoneError(data.error || 'Could not send code.');
        setNoAccount(!!data.noAccount);
        return;
      }
      setMaskedPhone(data.maskedPhone || phone);
      setPhoneStep('enter-otp');
    } catch {
      setPhoneError('Network error. Please try again.');
    } finally {
      setPhoneLoading(false);
    }
  };

  const resendOtp = async () => {
    setResending(true);
    setPhoneError('');
    try {
      const res = await fetch('/api/auth/phone-login/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!data.success) setPhoneError(data.error || 'Could not resend code.');
    } catch {
      setPhoneError('Network error. Please try again.');
    } finally {
      setResending(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setPhoneError('');
    setPhoneLoading(true);
    try {
      const res = await fetch('/api/auth/phone-login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp }),
      });
      const data = await res.json();
      if (data.success) {
        // Same hard-navigation reasoning as the email flow above.
        window.location.href = '/dashboard';
        return;
      }
      setPhoneError(data.error || 'Incorrect or expired code.');
      setPhoneLoading(false);
    } catch {
      setPhoneError('Network error. Please try again.');
      setPhoneLoading(false);
    }
  };

  return (
    <div className="w-full bg-surface-container-lowest rounded-xl card-shadow border border-outline-variant p-8 sm:p-10">
      <div className="text-center mb-8">
        <h1 className="text-headline-md font-heading text-on-surface mb-2">Welcome Back</h1>
        <p className="text-sm text-on-surface-variant">Sign in with your phone number — we&apos;ll send a one-time code on WhatsApp.</p>
      </div>

      {phoneStep === 'enter-phone' ? (
            <form onSubmit={requestOtp} className="space-y-5">
              <div>
                <label className="block text-label-md text-on-surface mb-2">Phone Number</label>
                <PhoneNumberInput value={phone} onChange={setPhone} />
                <p className="text-xs text-outline mt-1.5">We&apos;ll send a one-time code to this number on WhatsApp.</p>
              </div>

              {/* Sits directly above the submit button — visible right where
                  the user just clicked, not scrolled out of view above the form. */}
              {phoneError && (
                <div role="alert" className="p-4 bg-error-container border border-outline-variant text-on-error-container text-sm font-medium rounded-lg text-center">
                  {noAccount ? (
                    <>
                      No account found for this number.{' '}
                      <a href="/free-report" className="underline hover:text-primary">Get your free report</a>{' '}
                      or <a href="/book-demo" className="underline hover:text-primary">book a demo</a> to get started.
                    </>
                  ) : (
                    phoneError
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={phoneLoading}
                className="w-full flex items-center justify-center gap-2 py-3 bg-primary hover:bg-primary-container text-on-primary font-bold rounded-lg transition-all disabled:opacity-70"
              >
                {phoneLoading ? <MaterialIcon name="progress_activity" size={20} className="animate-spin" /> : (
                  <><MaterialIcon name="chat" size={18} /> Send code on WhatsApp</>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyOtp} className="space-y-5">
              <div>
                <label className="block text-label-md text-on-surface mb-2">Enter Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  maxLength={6}
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-3 text-center text-2xl tracking-[0.5em] bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  placeholder="······"
                  autoFocus
                />
                <p className="text-xs text-outline mt-1.5">
                  Sent to {maskedPhone || phone} on WhatsApp.{' '}
                  <button type="button" onClick={() => setPhoneStep('enter-phone')} className="text-primary hover:underline font-medium">
                    Wrong number?
                  </button>
                </p>
              </div>

              {phoneError && (
                <div role="alert" className="p-4 bg-error-container border border-outline-variant text-on-error-container text-sm font-medium rounded-lg text-center">
                  {phoneError}
                </div>
              )}

              <button
                type="submit"
                disabled={phoneLoading || otp.length !== 6}
                className="w-full flex items-center justify-center py-3 bg-primary hover:bg-primary-container text-on-primary font-bold rounded-lg transition-all disabled:opacity-70"
              >
                {phoneLoading ? <MaterialIcon name="progress_activity" size={20} className="animate-spin" /> : 'Verify & Sign In'}
              </button>

              <button
                type="button"
                onClick={resendOtp}
                disabled={resending}
                className="w-full text-center text-sm font-medium text-primary hover:text-primary-container disabled:opacity-60"
              >
                {resending ? 'Resending…' : "Didn't get a code? Resend"}
              </button>
            </form>
          )}

      <p className="text-center text-sm font-medium text-on-surface-variant mt-8">
        Don&apos;t have an account? <a href="/free-report" className="text-primary hover:text-primary-container">Get your free report</a>
      </p>
    </div>
  );
}
