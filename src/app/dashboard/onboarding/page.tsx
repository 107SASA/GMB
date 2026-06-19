"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Rocket, CheckCircle2 } from 'lucide-react';
import { toast } from 'react-hot-toast';

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const completeOnboarding = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/onboarding', {
        method: 'POST',
      });
      const data = await res.json();

      if (data.success) {
        toast.success("Welcome aboard!");
        router.push('/dashboard');
        router.refresh();
      } else {
        toast.error(data.error || 'Failed to complete onboarding');
        setLoading(false);
      }
    } catch (err) {
      toast.error('An error occurred');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 font-sans">
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-3xl p-10 shadow-sm text-center">
        
        <div className="w-20 h-20 bg-indigo-50 border border-indigo-100 rounded-3xl mx-auto flex items-center justify-center mb-8 shadow-sm">
          <Rocket className="w-10 h-10 text-primary" />
        </div>

        <h1 className="text-4xl font-bold text-slate-900 mb-4 tracking-tight">Welcome to GMBBoost</h1>
        <p className="text-lg text-slate-500 mb-10 max-w-md mx-auto">
          Your AI Growth Platform is ready. Let's start optimizing your local business presence.
        </p>

        <div className="space-y-4 mb-10 text-left max-w-sm mx-auto">
          <div className="flex items-center gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-100">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <span className="text-slate-700 font-medium text-sm">Account Created</span>
          </div>
          <div className="flex items-center gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-100">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <span className="text-slate-700 font-medium text-sm">Workspace Initialized</span>
          </div>
          <div className="flex items-center gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-100">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <span className="text-slate-700 font-medium text-sm">AI Engines Standby</span>
          </div>
        </div>

        <button
          onClick={completeOnboarding}
          disabled={loading}
          className="w-full sm:w-auto px-10 py-4 bg-primary hover:bg-primary/90 text-white rounded-2xl font-bold text-lg transition-all shadow-md flex items-center justify-center gap-3 disabled:opacity-50 mx-auto"
        >
          {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Enter Dashboard'}
        </button>

      </div>
    </div>
  );
}
