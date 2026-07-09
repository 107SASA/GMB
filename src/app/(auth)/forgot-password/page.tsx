'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Mail, ShieldCheck, KeyRound, ArrowLeft, CheckCircle2 } from 'lucide-react';

type Step = 'email' | 'otp' | 'choose' | 'newPassword' | 'done';

const RESEND_COOLDOWN_SECONDS = 60;
const GENERIC_MESSAGE = 'If an account exists with this email, an OTP has been sent.';

// Mirrors validatePasswordStrength in src/services/auth/security.ts — kept in sync
// manually since that file pulls in bcryptjs/jsonwebtoken and can't be imported
// into a client bundle. See also StepPassword.tsx, which does the same thing.
function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain a number.';
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) return 'Password must contain a special character.';
  return null;
}

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
    <div className="bg-white border border-slate-200 shadow-xl rounded-2xl p-8 max-w-md w-full mx-auto">
      {step === 'email' && (
        <>
          <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mb-6">
            <Mail className="text-slate-900 w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Forgot your password?</h2>
          <p className="text-slate-500 mb-6 text-sm">
            Enter the email address associated with your account and we'll send you a one-time code to reset your password.
          </p>
          <form onSubmit={handleSendOtp} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Email Address</label>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all font-medium text-slate-900 placeholder-slate-400"
                placeholder="you@company.com"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md shadow-indigo-600/20 transition-all disabled:opacity-70"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send Code'}
            </button>
          </form>
          <a href={loginHref} className="mt-6 flex items-center justify-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to login
          </a>
        </>
      )}

      {step === 'otp' && (
        <>
          <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mb-6">
            <ShieldCheck className="text-slate-900 w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Enter verification code</h2>
          <p className="text-slate-500 mb-6 text-sm">
            We sent a 6-digit code to <span className="font-semibold text-slate-700">{email}</span>. It expires in 10 minutes.
          </p>
          <form onSubmit={handleVerifyOtp} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">One-Time Code</label>
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                maxLength={6}
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all font-bold text-slate-900 placeholder-slate-400 text-center tracking-[0.5em] text-lg"
                placeholder="------"
              />
            </div>
            <button
              type="submit"
              disabled={loading || otp.length !== 6}
              className="w-full flex items-center justify-center py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md shadow-indigo-600/20 transition-all disabled:opacity-70"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify Code'}
            </button>
          </form>

          <div className="mt-5 text-center text-sm">
            <button
              onClick={handleResend}
              disabled={cooldown > 0}
              className="font-medium text-indigo-600 hover:text-indigo-700 disabled:text-slate-400 transition-colors"
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </button>
          </div>

          <button
            onClick={() => setStep('email')}
            className="mt-4 flex items-center justify-center gap-1.5 w-full text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Use a different email
          </button>
        </>
      )}

      {step === 'choose' && (
        <>
          <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center mb-6">
            <CheckCircle2 className="text-emerald-600 w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Code verified</h2>
          <p className="text-slate-500 mb-8 text-sm">
            You can create a new password now, or skip this and continue signing in with your existing password.
          </p>
          <div className="space-y-3">
            <button
              onClick={() => setStep('newPassword')}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md shadow-indigo-600/20 transition-all"
            >
              <KeyRound className="w-4 h-4" /> Create New Password
            </button>
            <button
              onClick={handleContinueToLogin}
              className="w-full py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-all"
            >
              Continue to Login Without Changing Password
            </button>
          </div>
        </>
      )}

      {step === 'newPassword' && (
        <>
          <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mb-6">
            <KeyRound className="text-slate-900 w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Create a new password</h2>
          <p className="text-slate-500 mb-6 text-sm">Choose a strong password you haven't used before.</p>
          <form onSubmit={handleResetPassword} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">New Password</label>
              <input
                type="password"
                required
                autoFocus
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all font-medium text-slate-900 placeholder-slate-400"
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Confirm Password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-600 focus:border-transparent outline-none transition-all font-medium text-slate-900 placeholder-slate-400"
                placeholder="••••••••"
              />
            </div>
            <p className="text-xs text-slate-400">
              Must be at least 8 characters, with an uppercase letter, a lowercase letter, a number, and a special character.
            </p>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md shadow-indigo-600/20 transition-all disabled:opacity-70"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Reset Password'}
            </button>
          </form>
          <button
            onClick={() => setStep('choose')}
            className="mt-4 flex items-center justify-center gap-1.5 w-full text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        </>
      )}

      {step === 'done' && (
        <div className="text-center py-4">
          <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="text-emerald-600 w-7 h-7" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Password updated</h2>
          <p className="text-slate-500 text-sm">Redirecting you to login...</p>
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
