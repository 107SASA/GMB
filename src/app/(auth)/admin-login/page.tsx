'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

type Method = 'totp' | 'email' | 'recovery';
type Step =
  | { kind: 'password' }
  | { kind: 'code'; challenge: string; emailHint: string; expiresInMinutes: number; methods: Method[]; emailSent: boolean };

const inputCls =
  'w-full px-4 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all';

export default function AdminLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [method, setMethod] = useState<Method>('email');
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step.kind === 'code') codeRef.current?.focus();
  }, [step.kind, method]);

  const switchMethod = (m: Method) => {
    setMethod(m);
    setCode('');
    setError('');
    setInfo('');
  };

  // Content Studio team members have no /admin access — they land on /studio.
  const finish = (role?: string) => {
    router.push(role === 'TEAM_MEMBER' ? '/studio' : '/admin');
    router.refresh();
  };

  const backToPassword = (message?: string) => {
    setStep({ kind: 'password' });
    setCode('');
    setInfo('');
    setError(message || '');
  };

  const handleLogin = async (e: { preventDefault(): void; currentTarget: HTMLFormElement }) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const form = e.currentTarget;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;

    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Invalid credentials');
        return;
      }
      if (data.step === 'code') {
        const methods: Method[] = Array.isArray(data.methods) && data.methods.length ? data.methods : ['email'];
        setStep({ kind: 'code', challenge: data.challenge, emailHint: data.emailHint, expiresInMinutes: data.expiresInMinutes, methods, emailSent: data.emailSent !== false });
        setMethod((data.defaultMethod as Method) || methods[0]);
        setCode('');
        setCooldown(data.emailSent === false ? 0 : 60);
        return;
      }
      finish(data.user?.role);
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (step.kind !== 'code') return;
    setLoading(true);
    setError('');
    setInfo('');
    try {
      const res = await fetch('/api/admin/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge: step.challenge, code, method }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.restart) return backToPassword(data.error);
        setError(data.error || 'That code is not right.');
        setCode('');
        codeRef.current?.focus();
        return;
      }
      finish(data.user?.role);
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (step.kind !== 'code' || cooldown > 0) return;
    setError('');
    setInfo('');
    try {
      const res = await fetch('/api/admin/auth/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge: step.challenge }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.restart) return backToPassword(data.error);
        if (data.retryAfterSeconds) setCooldown(data.retryAfterSeconds);
        setError(data.error || 'Could not send a new code.');
        return;
      }
      setCode('');
      setCooldown(60);
      setMethod('email');
      setStep({ ...step, emailSent: true });
      setInfo(`A code was sent to ${step.emailHint}.`);
    } catch {
      setError('Network error — please try again');
    }
  };

  return (
    <div className="w-full bg-surface-container-lowest rounded-xl card-shadow border border-outline-variant p-8 sm:p-10">
      <div className="text-center mb-10">
        <div className="w-14 h-14 bg-primary rounded-lg mx-auto flex items-center justify-center mb-6">
          <MaterialIcon name={step.kind === 'code' ? 'mark_email_read' : 'shield'} size={28} className="text-on-primary" />
        </div>
        <h1 className="text-headline-md font-heading text-on-surface mb-2">
          {step.kind !== 'code' ? 'Super Admin' : method === 'totp' ? 'Authenticator code' : method === 'recovery' ? 'Recovery code' : 'Check your email'}
        </h1>
        <p className="text-sm text-on-surface-variant">
          {step.kind !== 'code'
            ? 'Restricted access — authorised personnel only.'
            : method === 'totp'
              ? 'Open your authenticator app and enter the 6-digit code for Growwmatics AI Admin.'
              : method === 'recovery'
                ? 'Enter one of the recovery codes you saved. Each code works once.'
                : step.emailSent
                  ? `We sent a 6-digit code to ${step.emailHint}. It expires in ${step.expiresInMinutes} minutes.`
                  : `We can email a 6-digit code to ${step.emailHint}.`}
        </p>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 mb-5 px-4 py-3 bg-error-container border border-outline-variant rounded-lg text-on-error-container text-sm">
          <MaterialIcon name="error" size={18} className="shrink-0" />
          {error}
        </div>
      )}
      {info && !error && (
        <div className="flex items-center gap-2 mb-5 px-4 py-3 bg-secondary-container/40 border border-outline-variant rounded-lg text-on-surface text-sm">
          <MaterialIcon name="check_circle" size={18} className="shrink-0 text-secondary" />
          {info}
        </div>
      )}

      {step.kind === 'password' ? (
        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-label-md text-on-surface mb-2">Email Address</label>
            <input type="email" name="email" required autoComplete="username" className={inputCls} placeholder="admin@yourdomain.com" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-label-md text-on-surface">Password</label>
              <a href="/forgot-password?context=admin" className="text-sm font-medium text-primary hover:text-primary-container">
                Forgot password?
              </a>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                required
                autoComplete="current-password"
                className={`${inputCls} pr-11`}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface transition-colors"
              >
                <MaterialIcon name={showPassword ? 'visibility_off' : 'visibility'} size={20} />
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center py-3 bg-primary hover:bg-primary-container text-on-primary font-bold rounded-lg transition-all disabled:opacity-70"
          >
            {loading ? <MaterialIcon name="progress_activity" size={20} className="animate-spin" /> : 'Continue'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="space-y-5">
          {method === 'email' && !step.emailSent ? (
            <button
              type="button"
              onClick={handleResend}
              className="w-full flex items-center justify-center py-3 bg-primary hover:bg-primary-container text-on-primary font-bold rounded-lg transition-all"
            >
              Email me a code
            </button>
          ) : (
            <>
              <div>
                <label htmlFor="admin-code" className="block text-label-md text-on-surface mb-2">
                  {method === 'recovery' ? 'Recovery code' : method === 'totp' ? 'Code from the app' : 'Code from the email'}
                </label>
                {method === 'recovery' ? (
                  <input
                    id="admin-code"
                    ref={codeRef}
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 14))}
                    autoComplete="off"
                    spellCheck={false}
                    required
                    className={`${inputCls} text-center text-xl tracking-widest font-mono`}
                    placeholder="ABCD-EFGH-JK"
                  />
                ) : (
                  <input
                    id="admin-code"
                    ref={codeRef}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    required
                    className={`${inputCls} text-center text-2xl tracking-[0.5em] font-semibold`}
                    placeholder="••••••"
                  />
                )}
              </div>
              <button
                type="submit"
                disabled={loading || (method === 'recovery' ? code.replace(/[^A-Z0-9]/g, '').length !== 10 : code.length !== 6)}
                className="w-full flex items-center justify-center py-3 bg-primary hover:bg-primary-container text-on-primary font-bold rounded-lg transition-all disabled:opacity-70"
              >
                {loading ? <MaterialIcon name="progress_activity" size={20} className="animate-spin" /> : 'Sign In to Admin Panel'}
              </button>
            </>
          )}

          <div className="flex items-center justify-between text-sm">
            <button type="button" onClick={() => backToPassword()} className="text-on-surface-variant hover:text-on-surface">
              ← Back
            </button>
            {method === 'email' && step.emailSent && (
              <button
                type="button"
                onClick={handleResend}
                disabled={cooldown > 0}
                className="font-medium text-primary hover:text-primary-container disabled:text-outline"
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </button>
            )}
          </div>

          {step.methods.length > 1 && (
            <div className="border-t border-outline-variant pt-4 space-y-2 text-sm text-center">
              {method !== 'totp' && step.methods.includes('totp') && (
                <button type="button" onClick={() => switchMethod('totp')} className="block w-full font-medium text-primary hover:text-primary-container">
                  Use the authenticator app
                </button>
              )}
              {method !== 'email' && step.methods.includes('email') && (
                <button type="button" onClick={() => switchMethod('email')} className="block w-full font-medium text-primary hover:text-primary-container">
                  Email me a code instead
                </button>
              )}
              {method !== 'recovery' && step.methods.includes('recovery') && (
                <button type="button" onClick={() => switchMethod('recovery')} className="block w-full font-medium text-primary hover:text-primary-container">
                  Use a recovery code
                </button>
              )}
            </div>
          )}
          {method === 'email' && step.emailSent && (
            <p className="text-xs text-outline text-center">Didn&apos;t get it? Check spam, or look for an email titled &quot;Super admin sign-in code&quot;.</p>
          )}
        </form>
      )}

      <p className="text-center text-xs font-medium text-outline mt-8">
        Regular users:{' '}
        <a href="/login" className="text-primary hover:text-primary-container">
          Sign in here
        </a>
      </p>
    </div>
  );
}
