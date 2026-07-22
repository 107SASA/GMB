import React, { useState } from 'react';
import { OnboardingData } from './types';
import { ArrowRight, Building2, AlertCircle } from 'lucide-react';

interface Props {
  data: OnboardingData;
  updateData: (fields: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function StepOrganization({ data, updateData, onNext, onBack }: Props) {
  const [error, setError] = useState('');

  const handleContinue = () => {
    if (!data.companyName) {
      setError('Company name is required.');
      return;
    }
    setError('');
    onNext();
  };

  return (
    <div className="h-full bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-10 flex flex-col border border-slate-100">
      <div className="flex-1">
        <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mb-6">
          <Building2 className="text-slate-900 w-6 h-6" />
        </div>
        <h2 className="text-3xl font-bold text-slate-900 mb-2">Name your organization</h2>
        <p className="text-slate-500 mb-8">This is the parent company that will hold all your businesses and locations.</p>


        <div className="space-y-5">
          <div>
            <label className="block text-sm font-bold text-slate-900 mb-2">Company Name</label>
            <input
              type="text"
              value={data.companyName}
              onChange={e => updateData({ companyName: e.target.value })}
              className="w-full px-4 py-4 text-xl font-medium bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
              placeholder="e.g. Acme Corp"
              autoFocus
            />
          </div>
        </div>
      </div>

      {/* Error sits directly above the Continue button so it is visible right
          where the user just clicked, instead of at the top of the form. */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-4 p-4 bg-red-50 text-red-700 rounded-xl text-sm font-medium border border-red-200 flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-between items-center pt-6 border-t border-slate-100">
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
