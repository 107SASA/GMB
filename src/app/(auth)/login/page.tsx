'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

type Method = 'email' | 'phone';
type PhoneStep = 'enter-phone' | 'enter-otp';

export default function LoginPage() {
  const router = useRouter();
  const [method, setMethod] = useState<Method>('email');

  // ── Email + password ────────────────────────────────────────────────────
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailLoading(true);
    setEmailError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (data.success) {
        // Hard navigation (full reload) — NOT router.push — so the just-set
        // session cookie is guaranteed to be sent and the dashboard renders
        // authenticated. A soft client navigation can race the cookie or serve
        // a cached/prefetched (logged-out) dashboard RSC, which bounces the user
        // straight back to /login in production.
        window.location.href = '/dashboard';
        return;
      } else if (data.requiresVerification) {
        router.push(`/verify?email=${encodeURIComponent(data.email)}`);
      } else {
        setEmailError(data.error || 'Invalid credentials');
        setEmailLoading(false);
      }
    } catch (err) {
      setEmailError('An error occurred during login');
      setEmailLoading(false);
    }
  };

  // ── Phone + WhatsApp OTP ────────────────────────────────────────────────
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('enter-phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const requestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setPhoneError('');
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

  const switchMethod = (m: Method) => {
    setMethod(m);
    setEmailError('');
    setPhoneError('');
    setPhoneStep('enter-phone');
    setOtp('');
  };

  return (
    <div className="w-full bg-surface-container-lowest rounded-xl card-shadow border border-outline-variant p-8 sm:p-10">
      <div className="text-center mb-8">
        <h1 className="text-headline-md font-heading text-on-surface mb-2">Welcome Back</h1>
        <p className="text-sm text-on-surface-variant">Sign in to your GrowwMatics AI account.</p>
      </div>

      {/* Method toggle */}
      <div className="flex gap-1 p-1 bg-surface-container rounded-lg mb-6">
        <button
          type="button"
          onClick={() => switchMethod('email')}
          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
            method === 'email' ? 'bg-surface-container-lowest text-on-surface card-shadow' : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          Email
        </button>
        <button
          type="button"
          onClick={() => switchMethod('phone')}
          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
            method === 'phone' ? 'bg-surface-container-lowest text-on-surface card-shadow' : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          Phone (WhatsApp)
        </button>
      </div>

      {method === 'email' ? (
        <>
          {emailError && (
            <div className="mb-6 p-4 bg-error-container border border-outline-variant text-on-error-container text-sm font-medium rounded-lg text-center">
              {emailError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-label-md text-on-surface mb-2">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-label-md text-on-surface">Password</label>
                <a href="/forgot-password" className="text-sm font-medium text-primary hover:text-primary-container">
                  Forgot password?
                </a>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={emailLoading}
              className="w-full flex items-center justify-center py-3 bg-primary hover:bg-primary-container text-on-primary font-bold rounded-lg transition-all disabled:opacity-70"
            >
              {emailLoading ? <MaterialIcon name="progress_activity" size={20} className="animate-spin" /> : 'Sign In'}
            </button>
          </form>
        </>
      ) : (
        <>
          {phoneStep === 'enter-phone' ? (
            <form onSubmit={requestOtp} className="space-y-5">
              <div>
                <label className="block text-label-md text-on-surface mb-2">Phone Number</label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="w-full px-4 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  placeholder="+14155550100"
                  autoFocus
                />
                <p className="text-xs text-outline mt-1.5">We&apos;ll send a one-time code to this number on WhatsApp.</p>
              </div>

              {/* Sits directly above the submit button — visible right where
                  the user just clicked, not scrolled out of view above the form. */}
              {phoneError && (
                <div role="alert" className="p-4 bg-error-container border border-outline-variant text-on-error-container text-sm font-medium rounded-lg text-center">
                  {phoneError}
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
        </>
      )}

      <p className="text-center text-sm font-medium text-on-surface-variant mt-8">
        Don&apos;t have an account? <a href="/onboarding" className="text-primary hover:text-primary-container">Get Started</a>
      </p>
    </div>
  );
}
