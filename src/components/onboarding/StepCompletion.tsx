import React, { useState } from 'react';
import { OnboardingData } from './types';
import { Rocket, Loader2 } from 'lucide-react';
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

      router.push('/dashboard');
      router.refresh();
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
        className="w-20 h-20 bg-green-500 rounded-3xl flex items-center justify-center mb-8 shadow-2xl shadow-green-500/30"
      >
        <Rocket className="text-white w-10 h-10" />
      </motion.div>
      
      <motion.h1 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-4xl font-bold text-slate-900 tracking-tight mb-4"
      >
        Almost there.
      </motion.h1>

      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="text-lg text-slate-500 mb-10 max-w-md"
      >
        We'll provision the <strong>{data.businessName || 'Acme'}</strong> organization and spin up your AI services. We'll also email you a code to confirm your address before your workspace unlocks.
      </motion.p>

      {error && (
        <div className="text-red-500 text-sm font-bold mb-4">{error}</div>
      )}

      <motion.button
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
        onClick={handleLaunch}
        disabled={loading}
        className="flex items-center gap-2 px-10 py-5 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-xl hover:-translate-y-1 disabled:opacity-70 disabled:cursor-not-allowed"
      >
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Create My Workspace'}
      </motion.button>
    </div>
  );
}
