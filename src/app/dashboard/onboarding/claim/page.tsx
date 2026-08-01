'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, ShieldCheck, KeyRound, MailCheck } from 'lucide-react';

const inputCls = 'w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors';

/**
 * Mandatory, one-time step for a shadow account (see src/lib/shadowAccount.ts)
 * once its workspace unlocks (i.e. right after paying) — sets a real
 * email + password via POST /api/onboarding/claim so there's a durable way
 * to log back in. Gated here by src/proxy.ts before intake/dashboard.
 *
 * Two-step UI: form first, then an OTP step. The OTP step matters even
 * though the existing session already lets us straight into /dashboard —
 * skipping it would leave isEmailVerified=false forever (POST /api/auth/login
 * refuses unverified accounts), silently breaking the "log back in later"
 * promise this whole page exists for if the claimed address had a typo or
 * the user never returns to verify it.
 *
 * src/proxy.ts redirects here with ?step=verify&email=... for a session that
 * already claimed but never finished verifying (e.g. refreshed mid-flow or
 * came back later) — that's read below to skip straight to the OTP step
 * instead of re-showing the claim form (which would just 400 as "already claimed").
 */
function ClaimAccountForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStep = searchParams.get('step') === 'verify' ? 'verify' : 'form';
  const [step, setStep] = useState<'form' | 'verify'>(initialStep);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(initialStep === 'verify' ? searchParams.get('email') || '' : '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [otp, setOtp] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim()) return setError('Please enter your name.');
    if (!email.trim()) return setError('Please enter your email.');
    if (password !== confirmPassword) return setError('Passwords do not match.');

    setSaving(true);
    try {
      const res = await fetch('/api/onboarding/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email, password }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Could not save. Please try again.');
      setStep('verify');
      setResendCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (otp.length !== 6) return setError('Enter the 6-digit code from your email.');

    setVerifying(true);
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Invalid or expired code.');
      // proxy.ts re-evaluates on the next navigation — isShadowAccount is now
      // false, so it naturally continues to intake (or straight to the
      // dashboard if intake is already done) without us duplicating that logic here.
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.');
      setVerifying(false);
    }
  };

  const resend = async () => {
    if (resendCooldown > 0) return;
    setResending(true);
    setError(null);
    try {
      await fetch('/api/auth/resend-email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setResendCooldown(60);
    } finally {
      setResending(false);
    }
  };

  if (step === 'verify') {
    return (
      <div className="max-w-md mx-auto py-12 px-4">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-indigo-50 border border-indigo-100 rounded-2xl mx-auto flex items-center justify-center mb-4">
            <MailCheck className="w-8 h-8 text-indigo-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Verify your email</h1>
          <p className="text-slate-500 mt-2">We sent a 6-digit code to {email}. Enter it below to finish securing your account.</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
        )}

        <form onSubmit={verify} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Verification code</label>
            <input
              type="text"
              className={`${inputCls} text-center tracking-[0.5em] text-lg`}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              maxLength={6}
              autoFocus
            />
          </div>

          <button
            type="submit"
            disabled={verifying || otp.length !== 6}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {verifying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Verifying…
              </>
            ) : (
              'Verify and continue'
            )}
          </button>

          <button
            type="button"
            onClick={resend}
            disabled={resending || resendCooldown > 0}
            className="w-full text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : resending ? 'Sending…' : 'Resend code'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-12 px-4">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-indigo-50 border border-indigo-100 rounded-2xl mx-auto flex items-center justify-center mb-4">
          <ShieldCheck className="w-8 h-8 text-indigo-600" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Secure your account</h1>
        <p className="text-slate-500 mt-2">
          You&apos;re subscribed! Set a password so you can log back in anytime — your report and workspace are already saved.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-700">Your name</label>
          <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Priya Sharma" autoFocus />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-700">Email</label>
          <input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-700">Password</label>
          <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
          <p className="text-xs text-slate-400">Needs an uppercase letter, a lowercase letter, a number, and a special character.</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-700">Confirm password</label>
          <input type="password" className={inputCls} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter your password" />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <KeyRound className="w-4 h-4" /> Save and continue
            </>
          )}
        </button>
      </form>
    </div>
  );
}

export default function ClaimAccountPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-24"><Loader2 className="w-8 h-8 text-indigo-600 animate-spin" /></div>}>
      <ClaimAccountForm />
    </Suspense>
  );
}
