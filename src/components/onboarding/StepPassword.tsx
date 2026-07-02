import React, { useState } from 'react';
import { OnboardingData } from './types';
import { ArrowRight, Lock } from 'lucide-react';

interface Props {
  data: OnboardingData;
  updateData: (fields: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function StepPassword({ data, updateData, onNext, onBack }: Props) {
  const [error, setError] = useState('');

  const handleContinue = () => {
    if (!data.password || !data.confirmPassword) {
      setError('Please fill out both password fields.');
      return;
    }
    if (data.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (data.password !== data.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setError('');
    onNext();
  };

  return (
    <div className="h-full bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-10 flex flex-col border border-slate-100">
      <div className="flex-1">
        <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mb-6">
          <Lock className="text-slate-900 w-6 h-6" />
        </div>
        <h2 className="text-3xl font-bold text-slate-900 mb-2">Secure your account</h2>
        <p className="text-slate-500 mb-8">Create a strong password for your new workspace.</p>

        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-xl text-sm font-medium border border-red-100">
            {error}
          </div>
        )}

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-bold text-slate-900 mb-2">Password</label>
            <input
              type="password"
              value={data.password || ''}
              onChange={e => updateData({ password: e.target.value })}
              className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
              placeholder="••••••••"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-900 mb-2">Confirm Password</label>
            <input
              type="password"
              value={data.confirmPassword || ''}
              onChange={e => updateData({ confirmPassword: e.target.value })}
              className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
              placeholder="••••••••"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center pt-8 border-t border-slate-100">
        <button onClick={onBack} className="text-slate-500 font-bold hover:text-slate-900 transition-colors px-4 py-2">
          Back
        </button>
        <button 
          onClick={handleContinue}
          className="flex items-center gap-2 px-8 py-3.5 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-md"
        >
          Continue <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
