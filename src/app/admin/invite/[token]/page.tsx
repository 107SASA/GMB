'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ShieldCheck, Loader2, Eye, EyeOff } from 'lucide-react';

export default function AcceptInvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    setError(null);

    if (!name || !password || !confirmPassword) {
      setError('All fields are required');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch('/api/admin/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name, password, phone }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      setSuccess(true);
      setTimeout(() => router.push('/admin/login'), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-secondary-container rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-8 h-8 text-secondary" />
          </div>
          <h1 className="font-heading text-2xl font-bold text-on-surface mb-2">Account Created!</h1>
          <p className="text-on-surface-variant text-sm">
            Your super admin account has been created successfully. Redirecting to login...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-primary rounded-xl flex items-center justify-center mx-auto mb-4">
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <h1 className="font-heading text-2xl font-bold text-on-surface">Accept Admin Invite</h1>
          <p className="text-sm text-on-surface-variant mt-1">Set up your super admin account</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-error-container border border-error-container rounded-xl text-on-error-container text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-on-surface mb-1">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              className="w-full px-4 py-2 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-on-surface mb-1">Phone (optional)</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91XXXXXXXXXX"
              className="w-full px-4 py-2 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-on-surface mb-1">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 8 characters"
                className="w-full px-4 py-2 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-outline"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-on-surface mb-1">Confirm Password</label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className="w-full px-4 py-2 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary pr-10"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-outline"
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-on-primary rounded-xl hover:bg-primary-container transition-all text-sm font-medium disabled:opacity-50 mt-2"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4" />
            )}
            Create Admin Account
          </button>
        </div>
      </div>
    </div>
  );
}