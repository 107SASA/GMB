"use client";

import { useState, Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Loader2 } from 'lucide-react';

function VerifyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') || '';

  const [loading, setLoading] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailOtp, setEmailOtp] = useState('');
  const [emailCooldown, setEmailCooldown] = useState(60);

  useEffect(() => {
    if (emailCooldown > 0) {
      const timer = setTimeout(() => setEmailCooldown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [emailCooldown]);

  const handleVerify = async () => {
    setLoading(true);

    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: emailOtp }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(data.message);
        setEmailVerified(true);
        toast.success("Account fully verified! Redirecting to login...");
        setTimeout(() => router.push('/login'), 1500);
      } else {
        toast.error(data.error || 'Verification failed');
      }
    } catch (error) {
      toast.error('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      const res = await fetch('/api/auth/resend-email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success('Sent a new verification code to your email!');
        setEmailCooldown(60);
      } else {
        toast.error(data.error || 'Failed to resend code');
      }
    } catch (error) {
      toast.error('An error occurred trying to resend code.');
    }
  };

  if (!email) {
    return <div className="text-slate-900 p-8 text-center">Missing email parameter. Return to register.</div>;
  }

  return (
    <div className="bg-white border border-slate-200 shadow-xl rounded-2xl p-8 max-w-md w-full mx-auto">
      <h2 className="text-2xl font-semibold text-slate-900 mb-2">Verify Your Email</h2>
      <p className="text-slate-500 mb-6 text-sm">We sent a verification code to {email}</p>

      <div className="space-y-6">
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-slate-900 font-medium">Email Verification</h3>
            {!emailVerified && (
              <button 
                onClick={handleResend}
                disabled={emailCooldown > 0}
                className="text-xs text-primary hover:text-primary/80 disabled:text-white/30 transition-colors"
              >
                {emailCooldown > 0 ? `Resend in ${emailCooldown}s` : 'Resend Code'}
              </button>
            )}
          </div>
          {emailVerified ? (
            <div className="text-emerald-400 text-sm flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              Verified Successfully
            </div>
          ) : (
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="6-digit code"
                className="flex-1 bg-white border border-slate-200 shadow-sm rounded-lg px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-primary text-sm tracking-widest text-center"
                maxLength={6}
                value={emailOtp}
                onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, ''))}
              />
              <button
                onClick={handleVerify}
                disabled={loading || emailOtp.length !== 6}
                className="bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 min-w-[80px] flex justify-center"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="flex justify-center p-8"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>}>
      <VerifyContent />
    </Suspense>
  );
}
