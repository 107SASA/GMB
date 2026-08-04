"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
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
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-2xl bg-surface-container-lowest border border-outline-variant rounded-xl p-10 card-shadow text-center">
        
        <div className="w-20 h-20 bg-primary-fixed border border-primary-fixed-dim rounded-xl mx-auto flex items-center justify-center mb-8">
          <MaterialIcon name="rocket_launch" size={40} className="text-primary" />
        </div>

        <h1 className="text-headline-lg font-heading text-on-surface mb-4 tracking-tight">Welcome to GrowwMatics AI</h1>
        <p className="text-lg text-on-surface-variant mb-10 max-w-md mx-auto">
          Your AI Growth Platform is ready. Let&apos;s start optimizing your local business presence.
        </p>

        <div className="space-y-4 mb-10 text-left max-w-sm mx-auto">
          <div className="flex items-center gap-3 bg-surface-container-low p-4 rounded-lg border border-outline-variant">
            <MaterialIcon name="check_circle" size={20} className="text-secondary" />
            <span className="text-on-surface font-medium text-sm">Account Created</span>
          </div>
          <div className="flex items-center gap-3 bg-surface-container-low p-4 rounded-lg border border-outline-variant">
            <MaterialIcon name="check_circle" size={20} className="text-secondary" />
            <span className="text-on-surface font-medium text-sm">Workspace Initialized</span>
          </div>
          <div className="flex items-center gap-3 bg-surface-container-low p-4 rounded-lg border border-outline-variant">
            <MaterialIcon name="check_circle" size={20} className="text-secondary" />
            <span className="text-on-surface font-medium text-sm">AI Engines Standby</span>
          </div>
        </div>

        <button
          onClick={completeOnboarding}
          disabled={loading}
          className="w-full sm:w-auto px-10 py-3.5 bg-secondary hover:opacity-95 text-on-secondary rounded-lg font-bold text-lg transition-all flex items-center justify-center gap-3 disabled:opacity-50 mx-auto"
        >
          {loading ? <MaterialIcon name="progress_activity" size={24} className="animate-spin" /> : 'Enter Dashboard'}
        </button>

      </div>
    </div>
  );
}
