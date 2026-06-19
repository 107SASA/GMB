import React, { useState } from 'react';
import { OnboardingData } from './types';
import { ArrowRight, Star } from 'lucide-react';

interface Props {
  data: OnboardingData;
  updateData: (fields: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export default function StepGoogle({ data, updateData, onNext, onBack }: Props) {
  const [error, setError] = useState('');

  const handleContinue = () => {
    onNext(); // Making this optional for smooth UX
  };

  return (
    <div className="h-full bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-10 flex flex-col border border-slate-100">
      <div className="flex-1">
        <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center mb-6">
          <Star className="text-blue-600 w-6 h-6" />
        </div>
        <h2 className="text-3xl font-bold text-slate-900 mb-2">Connect Google Profile</h2>
        <p className="text-slate-500 mb-8">This helps our AI fetch your reviews and optimize your local SEO rankings automatically.</p>

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-bold text-slate-900 mb-2">Google Place ID (Optional)</label>
            <input
              type="text"
              value={data.googlePlaceId}
              onChange={e => updateData({ googlePlaceId: e.target.value })}
              className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
              placeholder="ChIJN1t_tDeuEmsRUsoyG83frY4"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-900 mb-2">Public Review Link (Optional)</label>
            <input
              type="url"
              value={data.gbpUrl}
              onChange={e => updateData({ gbpUrl: e.target.value })}
              className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all outline-none"
              placeholder="https://g.page/r/..."
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
