import React, { useState } from 'react';
import { OnboardingData } from './types';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';

interface Props {
  data: OnboardingData;
}

export default function StepCompletion({ data }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleLaunch = async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(body.error || `Server error (${res.status}) — check the terminal for details.`);
        setLoading(false);
        return;
      }

      if (body.requiresVerification) {
        router.push(`/verify?email=${encodeURIComponent(body.email)}`);
        return;
      }

      // Hard navigation so the freshly-set session cookie is sent and the
      // dashboard renders authenticated (a soft nav can bounce back to /login).
      window.location.href = '/dashboard';
      return;
    } catch (err: any) {
      setError('Network error — could not reach the server.');
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col justify-center items-center text-center px-8">
      <motion.div 
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="w-20 h-20 bg-secondary rounded-xl flex items-center justify-center mb-8"
      >
        <MaterialIcon name="rocket_launch" size={40} className="text-on-secondary" />
      </motion.div>
      
      <motion.h1 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-headline-lg font-heading text-on-surface tracking-tight mb-4"
      >
        Almost there.
      </motion.h1>

      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="text-lg text-on-surface-variant mb-10 max-w-md"
      >
        We&apos;ll provision the <strong>{data.businessName || 'Acme'}</strong> organization and spin up your AI services. We&apos;ll also email you a code to confirm your address before your workspace unlocks.
      </motion.p>

      {error && (
        <div className="text-error text-sm font-bold mb-4">{error}</div>
      )}

      <motion.button
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
        onClick={handleLaunch}
        disabled={loading}
        className="flex items-center gap-2 px-10 py-3.5 bg-secondary hover:opacity-95 text-on-secondary rounded-lg font-bold transition-all disabled:opacity-70 disabled:cursor-not-allowed"
      >
        {loading ? <MaterialIcon name="progress_activity" size={20} className="animate-spin" /> : 'Create My Workspace'}
      </motion.button>
    </div>
  );
}
