'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';

const inputCls =
  'w-full px-4 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all';

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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
      setError(friendlyClientMessage(err, 'Could not save.'));
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
      setError(friendlyClientMessage(err, 'Verification failed.'));
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
          <div className="w-16 h-16 bg-primary-fixed border border-primary-fixed-dim rounded-xl mx-auto flex items-center justify-center mb-4">
            <MaterialIcon name="mark_email_read" size={32} className="text-primary" />
          </div>
          <h1 className="text-headline-lg font-heading text-on-surface tracking-tight">Verify your email</h1>
          <p className="text-on-surface-variant mt-2">We sent a 6-digit code to {email}. Enter it below to finish securing your account.</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-error-container border border-outline-variant rounded-lg text-sm text-on-error-container">{error}</div>
        )}

        <form onSubmit={verify} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 card-shadow space-y-5">
          <div className="space-y-2">
            <label className="text-label-md text-on-surface">Verification code</label>
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
            className="w-full flex items-center justify-center gap-2 py-3 bg-primary hover:bg-primary-container text-on-primary rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {verifying ? (
              <>
                <MaterialIcon name="progress_activity" size={16} className="animate-spin" /> Verifying…
              </>
            ) : (
              'Verify and continue'
            )}
          </button>

          <button
            type="button"
            onClick={resend}
            disabled={resending || resendCooldown > 0}
            className="w-full text-sm text-on-surface-variant hover:text-on-surface disabled:opacity-50"
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
        <div className="w-16 h-16 bg-primary-fixed border border-primary-fixed-dim rounded-xl mx-auto flex items-center justify-center mb-4">
          <MaterialIcon name="shield" size={32} className="text-primary" />
        </div>
        <h1 className="text-headline-lg font-heading text-on-surface tracking-tight">Secure your account</h1>
        <p className="text-on-surface-variant mt-2">
          You&apos;re subscribed! Set a password so you can log back in anytime — your report and workspace are already saved.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-error-container border border-outline-variant rounded-lg text-sm text-on-error-container">{error}</div>
      )}

      <form onSubmit={submit} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 card-shadow space-y-5">
        <div className="space-y-2">
          <label className="text-label-md text-on-surface">Your name</label>
          <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Priya Sharma" autoFocus />
        </div>
        <div className="space-y-2">
          <label className="text-label-md text-on-surface">Email</label>
          <input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div className="space-y-2">
          <label className="text-label-md text-on-surface">Password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              className={`${inputCls} pr-12`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 flex items-center pr-4 text-outline hover:text-on-surface transition-colors"
            >
              <MaterialIcon name={showPassword ? 'visibility_off' : 'visibility'} size={20} />
            </button>
          </div>
          <p className="text-xs text-outline">Needs an uppercase letter, a lowercase letter, a number, and a special character.</p>
        </div>
        <div className="space-y-2">
          <label className="text-label-md text-on-surface">Confirm password</label>
          <div className="relative">
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              className={`${inputCls} pr-12`}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter your password"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(v => !v)}
              aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 flex items-center pr-4 text-outline hover:text-on-surface transition-colors"
            >
              <MaterialIcon name={showConfirmPassword ? 'visibility_off' : 'visibility'} size={20} />
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-3 bg-primary hover:bg-primary-container text-on-primary rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <MaterialIcon name="progress_activity" size={16} className="animate-spin" /> Saving…
            </>
          ) : (
            <>
              <MaterialIcon name="key" size={16} /> Save and continue
            </>
          )}
        </button>
      </form>
    </div>
  );
}

export default function ClaimAccountPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-24"><MaterialIcon name="progress_activity" size={32} className="text-primary animate-spin" /></div>}>
      <ClaimAccountForm />
    </Suspense>
  );
}
