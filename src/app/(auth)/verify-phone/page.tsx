"use client";

import { useState, Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

function VerifyPhoneContent() {
  const searchParams = useSearchParams();
  const phone = searchParams.get('phone') || '';

  const [loading, setLoading] = useState(false);
  const [otp, setOtp] = useState('');
  const [cooldown, setCooldown] = useState(60);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const handleVerify = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/verify-phone-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success('Verified! Taking you to your dashboard…');
        // Hard navigation — NOT router.push — so the just-set session cookie
        // is guaranteed to be sent and the dashboard renders authenticated.
        window.location.href = '/dashboard';
        return;
      }
      toast.error(data.error || 'Verification failed');
      setLoading(false);
    } catch {
      toast.error('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      const res = await fetch('/api/auth/verify-phone-otp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Sent a new code on WhatsApp!');
        setCooldown(60);
      } else {
        toast.error(data.error || 'Failed to resend code');
      }
    } catch {
      toast.error('An error occurred trying to resend code.');
    } finally {
      setResending(false);
    }
  };

  if (!phone) {
    return <div className="text-on-surface p-8 text-center">Missing phone number. Return to signup.</div>;
  }

  return (
    <div className="bg-surface-container-lowest border border-outline-variant card-shadow rounded-xl p-8 max-w-md w-full mx-auto">
      <div className="w-12 h-12 bg-primary-fixed rounded-lg flex items-center justify-center mb-6">
        <MaterialIcon name="chat" size={24} className="text-primary" />
      </div>
      <h2 className="text-headline-md font-heading text-on-surface mb-2">Verify Your Phone</h2>
      <p className="text-on-surface-variant mb-6 text-sm">We sent a code to {phone} on WhatsApp.</p>

      <div className="space-y-6">
        <div className="p-4 rounded-lg border border-outline-variant bg-surface-container-low">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-on-surface font-medium text-sm">WhatsApp Verification</h3>
            <button
              onClick={handleResend}
              disabled={cooldown > 0 || resending}
              className="text-xs text-primary hover:text-primary-container disabled:text-outline transition-colors"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : resending ? 'Sending…' : 'Resend Code'}
            </button>
          </div>
          <div className="flex gap-3">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              className="flex-1 bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-sm tracking-widest text-center"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
            <button
              onClick={handleVerify}
              disabled={loading || otp.length !== 6}
              className="bg-primary hover:bg-primary-container text-on-primary px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50 min-w-[80px] flex justify-center"
            >
              {loading ? <MaterialIcon name="progress_activity" size={16} className="animate-spin" /> : 'Verify'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyPhonePage() {
  return (
    <Suspense fallback={<div className="flex justify-center p-8"><MaterialIcon name="progress_activity" size={32} className="text-primary animate-spin" /></div>}>
      <VerifyPhoneContent />
    </Suspense>
  );
}
