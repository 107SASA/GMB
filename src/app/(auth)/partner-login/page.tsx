'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

const INPUT =
  'w-full px-4 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all';

function PartnerLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(
    searchParams.get('error') === 'suspended' ? 'Your partner account is suspended. Please contact us.' : ''
  );
  const justCreated = searchParams.get('created') === '1';

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/partner/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.error || 'Invalid email or password');
        setLoading(false);
        return;
      }
      router.push('/partner');
      router.refresh();
    } catch {
      setError('Network error — please try again');
      setLoading(false);
    }
  };

  return (
    <div className="w-full bg-surface-container-lowest rounded-xl card-shadow border border-outline-variant p-8 sm:p-10">
      <div className="text-center mb-8">
        <div className="w-14 h-14 bg-primary rounded-lg mx-auto flex items-center justify-center mb-6">
          <MaterialIcon name="handshake" size={28} className="text-on-primary" />
        </div>
        <h1 className="text-headline-md font-heading text-on-surface mb-2">Growth Partner Login</h1>
        <p className="text-sm text-on-surface-variant">Sign in to manage your leads and commissions.</p>
      </div>

      {justCreated && !error && (
        <div className="flex items-center gap-2 mb-5 px-4 py-3 bg-secondary-container/40 border border-secondary-fixed rounded-lg text-on-secondary-container text-sm">
          <MaterialIcon name="check_circle" size={18} className="shrink-0" />
          Your partner account is ready. Sign in with your new password.
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center gap-2 mb-5 px-4 py-3 bg-error-container border border-outline-variant rounded-lg text-on-error-container text-sm">
          <MaterialIcon name="error" size={18} className="shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-5">
        <div>
          <label htmlFor="pl-email" className="block text-label-md text-on-surface mb-2">Email address</label>
          <input id="pl-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} placeholder="you@company.com" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="pl-password" className="block text-label-md text-on-surface">Password</label>
            <a href="/forgot-password?context=partner" className="text-sm font-medium text-primary hover:text-primary-container">
              Forgot password?
            </a>
          </div>
          <div className="relative">
            <input
              id="pl-password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${INPUT} pr-11`}
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
          {loading ? <MaterialIcon name="progress_activity" size={20} className="animate-spin" /> : 'Sign in'}
        </button>
      </form>

      <p className="text-center text-xs font-medium text-outline mt-8">
        Not a partner yet?{' '}
        <a href="/growth-partner/apply" className="text-primary hover:text-primary-container">Apply here</a>
        {' · '}
        Business owners:{' '}
        <a href="/login" className="text-primary hover:text-primary-container">Sign in here</a>
      </p>
    </div>
  );
}

export default function PartnerLoginPage() {
  return (
    <Suspense>
      <PartnerLoginForm />
    </Suspense>
  );
}
