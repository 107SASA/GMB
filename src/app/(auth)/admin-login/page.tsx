'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

export default function AdminLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

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
        setLoading(false);
        return;
      }

      router.push('/admin');
      router.refresh();
    } catch {
      setError('Network error — please try again');
      setLoading(false);
    }
  };

  return (
    <div className="w-full bg-surface-container-lowest rounded-xl card-shadow border border-outline-variant p-8 sm:p-10">
      <div className="text-center mb-10">
        <div className="w-14 h-14 bg-primary rounded-lg mx-auto flex items-center justify-center mb-6">
          <MaterialIcon name="shield" size={28} className="text-on-primary" />
        </div>
        <h1 className="text-headline-md font-heading text-on-surface mb-2">Super Admin</h1>
        <p className="text-sm text-on-surface-variant">Restricted access — authorised personnel only.</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 mb-5 px-4 py-3 bg-error-container border border-outline-variant rounded-lg text-on-error-container text-sm">
          <MaterialIcon name="error" size={18} className="shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-5">
        <div>
          <label className="block text-label-md text-on-surface mb-2">Email Address</label>
          <input
            type="email"
            name="email"
            required
            className="w-full px-4 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
            placeholder="admin@yourdomain.com"
          />
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
              className="w-full px-4 py-3 pr-11 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
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
          {loading ? <MaterialIcon name="progress_activity" size={20} className="animate-spin" /> : 'Sign In to Admin Panel'}
        </button>
      </form>

      <p className="text-center text-xs font-medium text-outline mt-8">
        Regular users:{' '}
        <a href="/login" className="text-primary hover:text-primary-container">
          Sign in here
        </a>
      </p>
    </div>
  );
}
