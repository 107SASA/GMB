'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { getPasswordError as validatePasswordStrength } from '@/lib/passwordPolicy';

type Step = 'email' | 'otp' | 'choose' | 'newPassword' | 'done';

const RESEND_COOLDOWN_SECONDS = 60;
const GENERIC_MESSAGE = 'If an account exists with this email, an OTP has been sent.';

const inputCls =
  'w-full px-4 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all';
const primaryBtn =
  'w-full flex items-center justify-center py-3 bg-primary hover:bg-primary-container text-on-primary font-bold rounded-lg transition-all disabled:opacity-70';

function ForgotPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Reached from /admin-login (Super Admin) vs the regular /login page —
  // determines where "back to login" / "continue to login" / the final
  // redirect send the user. The reset flow itself (email → OTP → password)
  // is identical either way; only the destination changes.
  const isAdminContext = searchParams.get('context') === 'admin';
  const loginHref = isAdminContext ? '/admin-login' : '/login';

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // ---- Step 1: request OTP ----
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();

      toast.success(data.message || GENERIC_MESSAGE);
      setStep('otp');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      // Even network errors shouldn't reveal anything different — keep it generic
      // and still let the user move forward to enter the code they may have received.
      toast.success(GENERIC_MESSAGE);
      setStep('otp');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      toast.success(data.message || GENERIC_MESSAGE);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      toast.error('Something went wrong. Please try again.');
    }
  };

  // ---- Step 2: verify OTP ----
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) return;
    setLoading(true);

    try {
      const res = await fetch('/api/auth/verify-reset-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), otp }),
      });
      const data = await res.json();

      if (data.success) {
        setResetToken(data.resetToken);
        setStep('choose');
        toast.success('Code verified!');
      } else {
        toast.error(data.error || 'Invalid or expired code.');
      }
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ---- Step 4A: set a new password ----
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newPassword || !confirmPassword) {
      toast.error('Please fill out both password fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }
    const strengthError = validatePasswordStrength(newPassword);
    if (strengthError) {
      toast.error(strengthError);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetToken, newPassword, confirmPassword }),
      });
      const data = await res.json();

      if (data.success) {
        setStep('done');
        toast.success('Password reset successfully!');
        setTimeout(() => router.push(loginHref), 1800);
      } else {
        toast.error(data.error || 'Could not reset your password. Please try again.');
        // If the token expired mid-flow, send the user back to request a fresh code.
        if (res.status === 400 && /expired|invalid/i.test(data.error || '')) {
          setStep('email');
          setOtp('');
        }
      }
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ---- Step 4B: skip changing the password ----
  const handleContinueToLogin = () => {
    router.push(loginHref);
  };

  return (
    <div className="bg-surface-container-lowest border border-outline-variant card-shadow rounded-xl p-8 max-w-md w-full mx-auto">
      {step === 'email' && (
        <>
          <div className="w-12 h-12 bg-primary-fixed rounded-lg flex items-center justify-center mb-6">
            <MaterialIcon name="mail" size={24} className="text-primary" />
          </div>
          <h2 className="text-headline-md font-heading text-on-surface mb-2">Forgot your password?</h2>
          <p className="text-on-surface-variant mb-6 text-sm">
            Enter the email address associated with your account and we&apos;ll send you a one-time code to reset your password.
          </p>
          <form onSubmit={handleSendOtp} className="space-y-5">
            <div>
              <label className="block text-label-md text-on-surface mb-2">Email Address</label>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={e => setEmail(e.target.value)}
                className={inputCls}
                placeholder="you@company.com"
              />
            </div>
            <button type="submit" disabled={loading} className={primaryBtn}>
              {loading ? <MaterialIcon name="progress_activity" size={20} className="animate-spin" /> : 'Send Code'}
            </button>
          </form>
          <a href={loginHref} className="mt-6 flex items-center justify-center gap-1.5 text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors">
            <MaterialIcon name="arrow_back" size={16} /> Back to login
          </a>
        </>
      )}

      {step === 'otp' && (
        <>
          <div className="w-12 h-12 bg-primary-fixed rounded-lg flex items-center justify-center mb-6">
            <MaterialIcon name="verified_user" size={24} className="text-primary" />
          </div>
          <h2 className="text-headline-md font-heading text-on-surface mb-2">Enter verification code</h2>
          <p className="text-on-surface-variant mb-6 text-sm">
            We sent a 6-digit code to <span className="font-semibold text-on-surface">{email}</span>. It expires in 10 minutes.
          </p>
          <form onSubmit={handleVerifyOtp} className="space-y-5">
            <div>
              <label className="block text-label-md text-on-surface mb-2">One-Time Code</label>
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                maxLength={6}
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                className={`${inputCls} font-bold text-center tracking-[0.5em] text-lg`}
                placeholder="------"
              />
            </div>
            <button type="submit" disabled={loading || otp.length !== 6} className={primaryBtn}>
              {loading ? <MaterialIcon name="progress_activity" size={20} className="animate-spin" /> : 'Verify Code'}
            </button>
          </form>

          <div className="mt-5 text-center text-sm">
            <button
              onClick={handleResend}
              disabled={cooldown > 0}
              className="font-medium text-primary hover:text-primary-container disabled:text-outline transition-colors"
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
          </div>

          <button
            onClick={() => setStep('email')}
            className="mt-4 flex items-center justify-center gap-1.5 w-full text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <MaterialIcon name="arrow_back" size={16} /> Use a different email
          </button>
        </>
      )}

      {step === 'choose' && (
        <>
          <div className="w-12 h-12 bg-secondary-container rounded-lg flex items-center justify-center mb-6">
            <MaterialIcon name="check_circle" size={24} className="text-on-secondary-container" />
          </div>
          <h2 className="text-headline-md font-heading text-on-surface mb-2">Code verified</h2>
          <p className="text-on-surface-variant mb-8 text-sm">
            You can create a new password now, or skip this and continue signing in with your existing password.
          </p>
          <div className="space-y-3">
            <button
              onClick={() => setStep('newPassword')}
              className="w-full flex items-center justify-center gap-2 py-3 bg-primary hover:bg-primary-container text-on-primary font-bold rounded-lg transition-all"
            >
              <MaterialIcon name="key" size={18} /> Create New Password
            </button>
            <button
              onClick={handleContinueToLogin}
              className="w-full py-3 bg-surface-container hover:bg-surface-container-high text-on-surface font-bold rounded-lg transition-all"
            >
              Continue to Login Without Changing Password
            </button>
          </div>
        </>
      )}

      {step === 'newPassword' && (
        <>
          <div className="w-12 h-12 bg-primary-fixed rounded-lg flex items-center justify-center mb-6">
            <MaterialIcon name="key" size={24} className="text-primary" />
          </div>
          <h2 className="text-headline-md font-heading text-on-surface mb-2">Create a new password</h2>
          <p className="text-on-surface-variant mb-6 text-sm">Choose a strong password you haven&apos;t used before.</p>
          <form onSubmit={handleResetPassword} className="space-y-5">
            <div>
              <label className="block text-label-md text-on-surface mb-2">New Password</label>
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  autoFocus
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className={`${inputCls} pr-12`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(v => !v)}
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex items-center pr-4 text-outline hover:text-on-surface transition-colors"
                >
                  <MaterialIcon name={showNewPassword ? 'visibility_off' : 'visibility'} size={20} />
                </button>
              </div>
            </div>
            <div>
              <label className="block text-label-md text-on-surface mb-2">Confirm Password</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className={`${inputCls} pr-12`}
                  placeholder="••••••••"
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
            <p className="text-xs text-outline">
              Must be at least 8 characters, with an uppercase letter, a lowercase letter, a number, and a special character.
            </p>
            <button type="submit" disabled={loading} className={primaryBtn}>
              {loading ? <MaterialIcon name="progress_activity" size={20} className="animate-spin" /> : 'Reset Password'}
            </button>
          </form>
          <button
            onClick={() => setStep('choose')}
            className="mt-4 flex items-center justify-center gap-1.5 w-full text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <MaterialIcon name="arrow_back" size={16} /> Back
          </button>
        </>
      )}

      {step === 'done' && (
        <div className="text-center py-4">
          <div className="w-14 h-14 bg-secondary rounded-full flex items-center justify-center mx-auto mb-6">
            <MaterialIcon name="check_circle" size={28} className="text-on-secondary" />
          </div>
          <h2 className="text-headline-md font-heading text-on-surface mb-2">Password updated</h2>
          <p className="text-on-surface-variant text-sm">Redirecting you to login...</p>
        </div>
      )}
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
