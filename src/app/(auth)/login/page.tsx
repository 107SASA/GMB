'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
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
        setError(data.error || 'Invalid credentials');
        setLoading(false);
      }
    } catch (err) {
      setError('An error occurred during login');
      setLoading(false);
    }
  };

  return (
    <div className="w-full bg-surface-container-lowest rounded-xl card-shadow border border-outline-variant p-8 sm:p-10">
      <div className="text-center mb-10">
        <h1 className="text-headline-md font-heading text-on-surface mb-2">Welcome Back</h1>
        <p className="text-sm text-on-surface-variant">Sign in to your GrowwMatics AI account.</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-error-container border border-outline-variant text-on-error-container text-sm font-medium rounded-lg text-center">
          {error}
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
          disabled={loading}
          className="w-full flex items-center justify-center py-3 bg-primary hover:bg-primary-container text-on-primary font-bold rounded-lg transition-all disabled:opacity-70"
        >
          {loading ? <MaterialIcon name="progress_activity" size={20} className="animate-spin" /> : 'Sign In'}
        </button>
      </form>

      <p className="text-center text-sm font-medium text-on-surface-variant mt-8">
        Don&apos;t have an account? <a href="/onboarding" className="text-primary hover:text-primary-container">Get Started</a>
      </p>
    </div>
  );
}
